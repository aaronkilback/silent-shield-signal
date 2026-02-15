/**
 * Cross-Signal Contradiction Detection
 * 
 * Scans signals sharing entity_tags within a time window.
 * Uses AI to detect conflicting assessments about the same entity.
 * Stores contradictions for analyst review.
 * 
 * Called by: system-watchdog (remediation), manual trigger
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const lookbackDays = body.lookback_days || 7;
    const maxPairs = body.max_pairs || 50;

    console.log(`[Contradictions] Scanning signals from last ${lookbackDays} days...`);

    const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString();

    // Get recent signals that have entity_tags
    const { data: signals, error: sigError } = await supabase
      .from('signals')
      .select('id, title, normalized_text, entity_tags, severity, category, confidence, client_id, received_at')
      .not('entity_tags', 'is', null)
      .gte('received_at', cutoff)
      .order('received_at', { ascending: false })
      .limit(300);

    if (sigError) throw sigError;
    if (!signals || signals.length < 2) {
      return successResponse({ success: true, contradictions: 0, message: 'Not enough tagged signals to compare' });
    }

    // Build entity → signals index
    const entityIndex = new Map<string, typeof signals>();
    for (const sig of signals) {
      if (!sig.entity_tags || !Array.isArray(sig.entity_tags)) continue;
      for (const tag of sig.entity_tags) {
        const normalized = tag.toLowerCase().trim();
        if (normalized.length < 3) continue;
        if (!entityIndex.has(normalized)) entityIndex.set(normalized, []);
        entityIndex.get(normalized)!.push(sig);
      }
    }

    // Find entities with multiple signals that might conflict
    const candidatePairs: Array<{
      entity: string;
      signalA: typeof signals[0];
      signalB: typeof signals[0];
    }> = [];

    for (const [entity, entitySignals] of entityIndex) {
      if (entitySignals.length < 2) continue;

      // Compare pairs — look for severity/category mismatches as quick pre-filter
      for (let i = 0; i < entitySignals.length && candidatePairs.length < maxPairs; i++) {
        for (let j = i + 1; j < entitySignals.length && candidatePairs.length < maxPairs; j++) {
          const a = entitySignals[i];
          const b = entitySignals[j];

          // Quick heuristic: different severity or category = potential contradiction
          const severityConflict = a.severity !== b.severity && a.severity && b.severity;
          const categoryConflict = a.category !== b.category && a.category && b.category;
          const differentClient = a.client_id !== b.client_id;

          if (severityConflict || categoryConflict || differentClient) {
            candidatePairs.push({ entity, signalA: a, signalB: b });
          }
        }
      }
    }

    if (candidatePairs.length === 0) {
      return successResponse({ success: true, contradictions: 0, message: 'No potential contradictions found' });
    }

    console.log(`[Contradictions] Found ${candidatePairs.length} candidate pairs for AI analysis`);

    // Batch AI analysis
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Chunk candidates for AI (max 10 per call for reliability)
    const chunks: typeof candidatePairs[] = [];
    for (let i = 0; i < candidatePairs.length; i += 10) {
      chunks.push(candidatePairs.slice(i, i + 10));
    }

    let totalContradictions = 0;

    for (const chunk of chunks) {
      const prompt = `You are an intelligence analyst reviewing signal pairs about the same entity. For each pair, determine if they present CONTRADICTORY assessments.

A contradiction means:
- Opposite threat assessments (one says safe, other says dangerous)
- Conflicting status claims (one says active, other says inactive)
- Incompatible severity ratings with contradictory content
- Opposing conclusions about the same event

NOT contradictions:
- Same event from different angles
- Complementary information
- Different aspects of the same entity
- Updates that supersede older info

For each pair, respond with JSON:
{ "pairs": [{ "index": 0, "is_contradiction": true/false, "contradiction_type": "conflicting_assessment"|"status_conflict"|"severity_mismatch"|"temporal_contradiction", "severity": "high"|"medium"|"low", "confidence": 0.0-1.0, "explanation": "brief reason" }] }

Signal pairs:
${chunk.map((p, idx) => `
--- Pair ${idx} (Entity: "${p.entity}") ---
Signal A [${p.signalA.severity}/${p.signalA.category}]: ${(p.signalA.normalized_text || p.signalA.title || '').substring(0, 300)}
Signal B [${p.signalB.severity}/${p.signalB.category}]: ${(p.signalB.normalized_text || p.signalB.title || '').substring(0, 300)}
`).join('\n')}`;

      try {
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
          }),
        });

        if (!response.ok) {
          console.error(`[Contradictions] AI call failed: ${response.status}`);
          continue;
        }

        const data = await response.json();
        let content = (data.choices?.[0]?.message?.content || '').trim();
        if (content.startsWith('```')) content = content.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();

        const result = JSON.parse(content);
        const contradictions = (result.pairs || []).filter((p: any) => p.is_contradiction && p.confidence >= 0.6);

        for (const c of contradictions) {
          const pair = chunk[c.index];
          if (!pair) continue;

          // Check if this contradiction already exists
          const { data: existing } = await supabase
            .from('signal_contradictions')
            .select('id')
            .eq('signal_a_id', pair.signalA.id)
            .eq('signal_b_id', pair.signalB.id)
            .limit(1);

          if (existing && existing.length > 0) continue;

          const { error: insertErr } = await supabase.from('signal_contradictions').insert({
            entity_name: pair.entity,
            signal_a_id: pair.signalA.id,
            signal_b_id: pair.signalB.id,
            signal_a_summary: (pair.signalA.normalized_text || pair.signalA.title || '').substring(0, 500),
            signal_b_summary: (pair.signalB.normalized_text || pair.signalB.title || '').substring(0, 500),
            contradiction_type: c.contradiction_type || 'conflicting_assessment',
            severity: c.severity || 'medium',
            confidence: c.confidence || 0.6,
          });

          if (!insertErr) totalContradictions++;
        }
      } catch (err) {
        console.error('[Contradictions] Chunk analysis failed:', err);
      }
    }

    console.log(`[Contradictions] Detected ${totalContradictions} new contradictions`);

    return successResponse({
      success: true,
      contradictions: totalContradictions,
      candidates_analyzed: candidatePairs.length,
      entities_scanned: entityIndex.size,
    });

  } catch (error) {
    console.error('[Contradictions] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
