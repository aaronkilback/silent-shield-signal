/**
 * Source Credibility Updater
 *
 * Updates source credibility scores using Bayesian updating when signals are verified.
 *
 * POST body options:
 *   Single update: { signal_id: string, was_accurate: boolean, verification_method?: string, note?: string }
 *   Batch mode:    {} (no signal_id) — processes up to 20 unverified signals from resolved incidents
 */

import {
  createServiceClient,
  corsHeaders,
  handleCors,
  successResponse,
  errorResponse,
} from '../_shared/supabase-client.ts';

// ═══════════════════════════════════════════════════════════════════════════
//  CREDIBILITY UPDATE MATH
// ═══════════════════════════════════════════════════════════════════════════

function updateCredibilityScore(oldScore: number, wasAccurate: boolean): number {
  if (wasAccurate) {
    return Math.min(0.98, oldScore + (1 - oldScore) * 0.15);
  } else {
    return Math.max(0.05, oldScore - oldScore * 0.20);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SINGLE SIGNAL UPDATE
// ═══════════════════════════════════════════════════════════════════════════

async function processSingleUpdate(
  supabase: any,
  signalId: string,
  wasAccurate: boolean,
  verificationMethod?: string,
  note?: string,
  verifiedBy?: string
) {
  // 1. Load the signal to get source_key and signal_type
  const { data: signal, error: signalErr } = await supabase
    .from('signals')
    .select('id, source_key, signal_type')
    .eq('id', signalId)
    .single();

  if (signalErr || !signal) {
    throw new Error(`Signal not found: ${signalId}`);
  }

  const sourceKey: string = signal.source_key ?? 'unknown';
  const signalType: string = signal.signal_type ?? 'unknown';

  // 2. Insert into signal_verifications (UNIQUE on signal_id — will error on duplicate)
  const verificationInsert: any = {
    signal_id: signalId,
    source_key: sourceKey,
    was_accurate: wasAccurate,
    verification_method: verificationMethod ?? 'manual',
    verification_note: note ?? null,
  };
  if (verifiedBy) verificationInsert.verified_by = verifiedBy;

  const { error: insertErr } = await supabase
    .from('signal_verifications')
    .insert(verificationInsert);

  if (insertErr) {
    // If duplicate key, the signal was already verified
    if (insertErr.code === '23505') {
      throw new Error(`Signal ${signalId} has already been verified`);
    }
    throw new Error(`Failed to insert verification: ${insertErr.message}`);
  }

  // 3. Load or bootstrap current source_credibility_scores
  const { data: existing } = await supabase
    .from('source_credibility_scores')
    .select('*')
    .eq('source_key', sourceKey)
    .maybeSingle();

  const oldCredibility: number = existing?.current_credibility ?? 0.65;
  const signalTypeScores: Record<string, number> = existing?.signal_type_scores ?? {};
  const oldTypeScore: number = signalTypeScores[signalType] ?? 0.65;

  // 4. Bayesian update on overall and per-type score
  const newCredibility = updateCredibilityScore(oldCredibility, wasAccurate);
  const newTypeScore = updateCredibilityScore(oldTypeScore, wasAccurate);

  const updatedTypeScores = { ...signalTypeScores, [signalType]: Math.round(newTypeScore * 1000) / 1000 };

  const newTotal = (existing?.total_signals ?? 0) + 1;
  const newConfirmed = (existing?.confirmed_signals ?? 0) + (wasAccurate ? 1 : 0);
  const newRefuted = (existing?.refuted_signals ?? 0) + (wasAccurate ? 0 : 1);

  // 5. UPSERT to source_credibility_scores
  const { error: upsertErr } = await supabase
    .from('source_credibility_scores')
    .upsert({
      source_key: sourceKey,
      prior_credibility: existing?.prior_credibility ?? 0.65,
      current_credibility: Math.round(newCredibility * 1000) / 1000,
      total_signals: newTotal,
      confirmed_signals: newConfirmed,
      refuted_signals: newRefuted,
      unverified_signals: Math.max(0, (existing?.unverified_signals ?? 0) - 1),
      signal_type_scores: updatedTypeScores,
      last_updated_at: new Date().toISOString(),
    }, { onConflict: 'source_key' });

  if (upsertErr) {
    throw new Error(`Failed to upsert credibility score: ${upsertErr.message}`);
  }

  const adjustment = Math.round((newCredibility - oldCredibility) * 1000) / 1000;

  return {
    source_key: sourceKey,
    signal_type: signalType,
    old_credibility: Math.round(oldCredibility * 1000) / 1000,
    new_credibility: Math.round(newCredibility * 1000) / 1000,
    adjustment,
    was_accurate: wasAccurate,
    total_signals: newTotal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  BATCH MODE
// ═══════════════════════════════════════════════════════════════════════════

async function processBatch(supabase: any): Promise<{ processed: number; details: any[] }> {
  // Find false-positive signals not yet in signal_verifications
  const { data: falsePositiveSignals, error: fpErr } = await supabase
    .from('signals')
    .select('id, source_key, signal_type')
    .eq('is_false_positive', true)
    .not('id', 'in', supabase.from('signal_verifications').select('signal_id'))
    .limit(20);

  if (fpErr) {
    console.error('[source-credibility-updater] Batch false-positive query error:', fpErr);
  }

  const toProcess: Array<{ id: string; source_key: string; signal_type: string; was_accurate: boolean }> = [];

  // Mark false positives as inaccurate
  for (const sig of (falsePositiveSignals ?? [])) {
    toProcess.push({ ...sig, was_accurate: false });
  }

  // If under 20, also look for signals confirmed via resolved incidents
  if (toProcess.length < 20) {
    const remaining = 20 - toProcess.length;
    const fpIds = toProcess.map(s => s.id);

    // Find signals linked to resolved (non-false-alarm) incidents
    const { data: confirmedSignals, error: csErr } = await supabase
      .from('signals')
      .select('id, source_key, signal_type, incident_id')
      .not('incident_id', 'is', null)
      .eq('is_false_positive', false)
      .not('id', 'in', supabase.from('signal_verifications').select('signal_id'))
      .limit(remaining);

    if (csErr) {
      console.error('[source-credibility-updater] Batch confirmed query error:', csErr);
    }

    for (const sig of (confirmedSignals ?? [])) {
      if (!fpIds.includes(sig.id)) {
        toProcess.push({ ...sig, was_accurate: true });
      }
    }
  }

  const details: any[] = [];
  let processed = 0;

  for (const sig of toProcess) {
    try {
      const result = await processSingleUpdate(
        supabase,
        sig.id,
        sig.was_accurate,
        'incident_resolved'
      );
      details.push(result);
      processed++;
    } catch (err) {
      // Skip already-verified or not-found signals
      console.warn(`[source-credibility-updater] Batch skip signal ${sig.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { processed, details };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));

    // Single update mode
    if (body.signal_id) {
      const { signal_id, was_accurate, verification_method, note, verified_by } = body;

      if (typeof was_accurate !== 'boolean') {
        return errorResponse('was_accurate must be a boolean', 400);
      }

      const result = await processSingleUpdate(
        supabase,
        signal_id,
        was_accurate,
        verification_method,
        note,
        verified_by
      );

      console.log(`[source-credibility-updater] Updated ${result.source_key}: ${result.old_credibility} → ${result.new_credibility} (${result.adjustment > 0 ? '+' : ''}${result.adjustment})`);
      return successResponse(result);
    }

    // Batch mode
    const result = await processBatch(supabase);
    console.log(`[source-credibility-updater] Batch processed ${result.processed} signals`);
    return successResponse(result);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[source-credibility-updater] Error:', message);
    return errorResponse(message, 500);
  }
});
