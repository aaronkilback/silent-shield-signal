/**
 * prediction-tracker
 *
 * Called by score-signal-anomaly (and directly) to check whether a new signal
 * confirms or refutes any active agent world predictions.
 *
 * Logic:
 * 1. Load all active predictions (status='active', not yet expired).
 * 2. Embed the incoming signal text via OpenAI text-embedding-3-small.
 * 3. For each prediction, embed its triggering_conditions and falsifying_conditions
 *    and compute cosine similarity against the signal embedding.
 * 4. Similarity > 0.72 to triggering_conditions → confirm prediction.
 * 5. Similarity > 0.72 to falsifying_conditions → refute prediction.
 * 6. Predictions whose expected_by has passed → mark expired; high-confidence
 *    expired predictions → log an unexpected_escalation deviation.
 *
 * Returns: { confirmations, refutations, expirations, signal_id }
 */

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";
import { embedText } from "../_shared/semantic-rag.ts";

// ── Cosine similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const { signal_id, signal_type, title, description, severity, location } = body;

    if (!signal_id) return errorResponse('signal_id required', 400);

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return errorResponse('OPENAI_API_KEY not configured', 500);

    const supabase = createServiceClient();
    const now = new Date();

    // ── 1. Load active predictions ───────────────────────────────────────────
    const { data: activePredictions, error: predErr } = await supabase
      .from('agent_world_predictions')
      .select(`
        id, agent_call_sign, prediction_text, domain,
        confidence_probability, expected_by,
        triggering_conditions, falsifying_conditions, status
      `)
      .eq('status', 'active');

    if (predErr) {
      console.error('[prediction-tracker] Failed to load predictions:', predErr);
      return errorResponse('Failed to load predictions', 500);
    }

    if (!activePredictions || activePredictions.length === 0) {
      return successResponse({ confirmations: 0, refutations: 0, expirations: 0, signal_id });
    }

    // ── 2. Embed the incoming signal ─────────────────────────────────────────
    const signalText = [
      title || '',
      description || '',
      signal_type || '',
      severity || '',
      location || '',
    ].filter(Boolean).join(' ');

    const signalEmbedding = await embedText(signalText, openaiKey);
    if (!signalEmbedding) {
      console.warn('[prediction-tracker] Could not embed signal text, skipping similarity checks');
    }

    let confirmations = 0;
    let refutations = 0;
    let expirations = 0;

    for (const prediction of activePredictions) {
      const expectedBy = prediction.expected_by ? new Date(prediction.expected_by) : null;
      const isExpired = expectedBy !== null && expectedBy < now;

      // ── Handle expired predictions ─────────────────────────────────────────
      if (isExpired) {
        await supabase
          .from('agent_world_predictions')
          .update({ status: 'expired', updated_at: now.toISOString() })
          .eq('id', prediction.id);

        expirations++;

        // High-confidence expired prediction → log unexpected_escalation
        if (prediction.confidence_probability > 0.75) {
          await supabase
            .from('prediction_deviations')
            .insert({
              prediction_id: prediction.id,
              signal_id,
              deviation_type: 'unexpected_escalation',
              deviation_magnitude: prediction.confidence_probability,
              deviation_note:
                'High-confidence prediction expired without confirmation — reality deviated from forecast',
            });
        }

        continue; // Skip similarity checks for expired predictions
      }

      // ── Similarity checks (only if embedding succeeded) ───────────────────
      if (!signalEmbedding) continue;

      const triggeringText = (prediction.triggering_conditions || []).join(' ');
      const falsifyingText = (prediction.falsifying_conditions || []).join(' ');

      let confirmed = false;
      let refuted = false;

      // Check triggering conditions
      if (triggeringText.trim()) {
        const triggeringEmbedding = await embedText(triggeringText, openaiKey);
        if (triggeringEmbedding) {
          const similarity = cosineSimilarity(signalEmbedding, triggeringEmbedding);
          if (similarity > 0.72) {
            confirmed = true;

            // Determine if this confirmation is early or late
            let deviationType: string;
            if (expectedBy && now < expectedBy) {
              deviationType = 'early_confirmation';
            } else {
              deviationType = 'late_confirmation';
            }

            await supabase
              .from('agent_world_predictions')
              .update({
                status: 'confirmed',
                confirmed_at: now.toISOString(),
                confirmation_signal_id: signal_id,
                updated_at: now.toISOString(),
              })
              .eq('id', prediction.id);

            await supabase
              .from('prediction_deviations')
              .insert({
                prediction_id: prediction.id,
                signal_id,
                deviation_type: deviationType,
                deviation_magnitude: Math.round((1 - similarity) * 1000) / 1000,
                deviation_note: `Signal similarity to triggering conditions: ${Math.round(similarity * 1000) / 1000}`,
              });

            confirmations++;
          }
        }
      }

      // Check falsifying conditions (only if not already confirmed)
      if (!confirmed && falsifyingText.trim()) {
        const falsifyingEmbedding = await embedText(falsifyingText, openaiKey);
        if (falsifyingEmbedding) {
          const similarity = cosineSimilarity(signalEmbedding, falsifyingEmbedding);
          if (similarity > 0.72) {
            refuted = true;

            await supabase
              .from('agent_world_predictions')
              .update({
                status: 'refuted',
                refuted_at: now.toISOString(),
                updated_at: now.toISOString(),
              })
              .eq('id', prediction.id);

            await supabase
              .from('prediction_deviations')
              .insert({
                prediction_id: prediction.id,
                signal_id,
                deviation_type: 'contradicting_signal',
                deviation_magnitude: Math.round(similarity * 1000) / 1000,
                deviation_note: `Signal similarity to falsifying conditions: ${Math.round(similarity * 1000) / 1000}`,
              });

            refutations++;
          }
        }
      }
    }

    console.log(
      `[prediction-tracker] signal=${signal_id} confirmations=${confirmations} refutations=${refutations} expirations=${expirations}`
    );

    return successResponse({ confirmations, refutations, expirations, signal_id });

  } catch (err) {
    console.error('[prediction-tracker] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
