/**
 * Tier 2 Signal Review Agent
 *
 * Fires asynchronously for signals with composite_confidence ≥ 0.60.
 * Also fires for high-value signals (≥0.75 composite + severity_score ≥50) dispatched
 * by ai-decision-engine after the April 24, 2026 agent trigger expansion.
 * Gathers contextual evidence (similar signals, active incidents, entity graph)
 * and makes a contextual promote/enrich/flag/dismiss decision.
 *
 * Verdicts:
 *   promote  — create an incident (for 0.60–0.64 signals that passed model gates but
 *               fell below the composite threshold; agent found corroborating context)
 *   enrich   — add agent review context to the existing incident (for ≥0.65 signals)
 *   flag     — mark incident as low_confidence (agent doubts the signal)
 *   dismiss  — no action needed (agent found no corroboration)
 *
 * This function is intentionally non-blocking: ai-decision-engine fires it via
 * fire-and-forget fetch(). It never throws back to the caller.
 *
 * Called by: ai-decision-engine (async, post-decision)
 * DB writes: signals.raw_json.agent_review, incidents.ai_analysis_log (enrich/flag paths)
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";

const CONTEXT_SIGNALS_LIMIT = 5;   // similar recent signals to surface for context
const CONTEXT_LOOKBACK_DAYS = 30;  // how far back to look for related signals

interface AgentReview {
  verdict: 'promote' | 'enrich' | 'flag' | 'dismiss';
  reasoning: string;
  confidence_delta: number;   // suggested adjustment to composite_confidence (-0.15 to +0.15)
  reviewed_at: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const body = await req.json().catch(() => ({}));
    const { signal_id, composite_score, ai_confidence, relevance_score, source_credibility, incident_id } = body;

    if (!signal_id) return errorResponse('signal_id is required', 400);

    const compositeScore = Number(composite_score) || 0;
    if (compositeScore < 0.60) {
      // Below minimum threshold — nothing to do
      return successResponse({ skipped: true, reason: 'composite_score below 0.60' });
    }

    // ── 1. Fetch the signal ──────────────────────────────────────────────────
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .select('id, normalized_text, category, severity, entity_tags, source_id, client_id, raw_json, relevance_score, composite_confidence')
      .eq('id', signal_id)
      .single();

    if (signalError || !signal) {
      console.error('[ReviewAgent] Signal not found:', signal_id);
      return errorResponse('Signal not found', 404);
    }

    // ── 2. Gather context: similar recent signals for this client ────────────
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - CONTEXT_LOOKBACK_DAYS);

    let contextSignals: any[] = [];
    try {
      const entityTags: string[] = signal.entity_tags || [];
      if (entityTags.length > 0) {
        const tagFilter = entityTags.slice(0, 3).map((t: string) =>
          `entity_tags.cs.{"${t}"}`
        ).join(',');

        const { data: similar } = await supabase
          .from('signals')
          .select('id, normalized_text, category, severity, composite_confidence, created_at')
          .eq('client_id', signal.client_id)
          .neq('id', signal_id)
          .gte('created_at', lookbackDate.toISOString())
          .or(tagFilter)
          .order('created_at', { ascending: false })
          .limit(CONTEXT_SIGNALS_LIMIT);

        contextSignals = similar || [];
      }
    } catch (e) {
      console.warn('[ReviewAgent] Context signal fetch failed (non-fatal):', e);
    }

    // ── 3. Gather context: active incidents for this client ──────────────────
    let activeIncidents: any[] = [];
    try {
      const { data: incidents } = await supabase
        .from('incidents')
        .select('id, title, status, priority, created_at')
        .eq('client_id', signal.client_id)
        .in('status', ['open', 'investigating'])
        .order('created_at', { ascending: false })
        .limit(5);

      activeIncidents = incidents || [];
    } catch (e) {
      console.warn('[ReviewAgent] Active incident fetch failed (non-fatal):', e);
    }

    // ── 4. Build the prompt ──────────────────────────────────────────────────
    const isSubThreshold = compositeScore < 0.65;
    const context = `
Signal under review:
- ID: ${signal.id}
- Category: ${signal.category || 'unknown'}
- Severity: ${signal.severity || 'unknown'}
- Entity tags: ${(signal.entity_tags || []).join(', ') || 'none'}
- Text: ${(signal.normalized_text || '').substring(0, 800)}
- Composite score: ${compositeScore.toFixed(3)} (ai=${(ai_confidence || 0).toFixed(2)}, relevance=${(relevance_score || 0).toFixed(2)}, source_credibility=${(source_credibility || 0).toFixed(2)})
- Status: ${isSubThreshold ? 'BELOW threshold (0.60–0.64) — no incident created yet' : 'ABOVE threshold (0.65–0.74) — incident already created'}
${incident_id ? `- Existing incident ID: ${incident_id}` : ''}

Related signals (last ${CONTEXT_LOOKBACK_DAYS} days, same client, same entities):
${contextSignals.length === 0
  ? '  (none found)'
  : contextSignals.map((s: any) => `  - [${s.category}/${s.severity}] score=${s.composite_confidence?.toFixed(2) ?? 'n/a'} "${(s.normalized_text || '').substring(0, 150)}"`).join('\n')}

Active incidents for this client:
${activeIncidents.length === 0
  ? '  (none)'
  : activeIncidents.map((i: any) => `  - [${i.priority}/${i.status}] "${i.title}"`).join('\n')}
`.trim();

    const systemPrompt = isSubThreshold
      ? `You are a Tier 2 Signal Review Agent for a corporate security intelligence platform. A signal scored ${compositeScore.toFixed(3)} composite confidence — just below the 0.65 incident creation threshold. The automated tier-1 gates passed this signal as relevant. Your job is to review it with broader context and decide if an incident should be created.\n\nReturn JSON with exactly: { "verdict": "promote"|"dismiss", "reasoning": "1-2 sentences", "confidence_delta": number between -0.10 and +0.10 }\n\nRules:\n- "promote" only if the context clearly corroborates a real threat (related signals, active incidents, escalating pattern)\n- "dismiss" if the signal appears isolated, low-quality, or not corroborated by context\n- confidence_delta: how much you'd adjust the composite score (+= for promotion, -= for dismiss)\n- Be conservative: only promote if genuinely warranted by evidence`
      : `You are a Tier 2 Signal Review Agent for a corporate security intelligence platform. A signal scored ${compositeScore.toFixed(3)} composite confidence — above threshold but in the 0.65–0.75 range where additional review adds value. An incident was already created. Your job is to assess whether the incident needs enrichment or a low-confidence flag.\n\nReturn JSON with exactly: { "verdict": "enrich"|"flag"|"dismiss", "reasoning": "1-2 sentences", "confidence_delta": number between -0.10 and +0.10 }\n\nRules:\n- "enrich" if context adds meaningful intelligence to the existing incident\n- "flag" if the signal appears weak, isolated, or potentially a false positive — adds a low_confidence note\n- "dismiss" if the incident is already well-contextualized and no action needed\n- confidence_delta: suggested score adjustment`;

    // ── 5. Call AI ───────────────────────────────────────────────────────────
    const aiResult = await callAiGatewayJson<AgentReview>({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
      functionName: 'review-signal-agent',
      extraBody: { response_format: { type: 'json_object' } },
    });

    if (aiResult.error || !aiResult.data) {
      console.error('[ReviewAgent] AI call failed:', aiResult.error);
      return errorResponse('AI review failed', 500);
    }

    const review = aiResult.data;
    const verdict = review.verdict as string;
    const validVerdicts = isSubThreshold ? ['promote', 'dismiss'] : ['enrich', 'flag', 'dismiss'];
    if (!validVerdicts.includes(verdict)) {
      console.warn(`[ReviewAgent] Unexpected verdict "${verdict}", treating as dismiss`);
      review.verdict = 'dismiss';
    }

    const agentReview: AgentReview = {
      verdict: review.verdict,
      reasoning: (review.reasoning || '').substring(0, 500),
      confidence_delta: Math.max(-0.10, Math.min(0.10, Number(review.confidence_delta) || 0)),
      reviewed_at: new Date().toISOString(),
    };

    console.log(`[ReviewAgent] Signal ${signal_id}: verdict=${agentReview.verdict}, delta=${agentReview.confidence_delta.toFixed(3)}`);

    // ── 6. Write agent_review back to signal.raw_json ────────────────────────
    const currentRawJson = signal.raw_json || {};
    const adjustedScore = Math.max(0, Math.min(1,
      Math.round((compositeScore + agentReview.confidence_delta) * 1000) / 1000
    ));
    await supabase
      .from('signals')
      .update({
        raw_json: { ...currentRawJson, agent_review: agentReview },
        composite_confidence: adjustedScore,
      })
      .eq('id', signal_id);

    // ── 6b. Write Tier 2 reasoning row to signal_agent_analyses ─────────────
    // Awaited (was fire-and-forget via .then()) so the audit trail row lands
    // before the function returns. When invoked from net.http_post the runtime
    // tore down before the row landed, leaving holes in signal_agent_analyses.
    const analysesWrite = await supabase.from('signal_agent_analyses').insert({
      signal_id,
      agent_call_sign: 'TIER2-REVIEW',
      analysis: agentReview.reasoning,
      confidence_score: adjustedScore,
      trigger_reason: isSubThreshold ? 'sub_threshold_review' : 'high_value_enrichment',
      analysis_tier: 'tier2',
      confidence_breakdown: {
        composite_before: compositeScore,
        confidence_delta: agentReview.confidence_delta,
        composite_after: adjustedScore,
        verdict: agentReview.verdict,
      },
      pattern_matches: {
        context_signals_found: contextSignals.length,
        active_incidents_found: activeIncidents.length,
        verdict: agentReview.verdict,
        is_sub_threshold: isSubThreshold,
      },
      reasoning_log: [
        {
          step: 'tier2_verdict',
          verdict: agentReview.verdict,
          reasoning: agentReview.reasoning,
          confidence_delta: agentReview.confidence_delta,
          context_signals: contextSignals.length,
          active_incidents: activeIncidents.length,
          reviewed_at: agentReview.reviewed_at,
        },
      ],
    });
    if (analysesWrite.error) {
      console.warn('[ReviewAgent] Failed to write signal_agent_analyses row:', analysesWrite.error);
    }

    // ── 7. Execute verdict ───────────────────────────────────────────────────
    if (agentReview.verdict === 'promote' && isSubThreshold) {
      // Create an incident via the standard path
      if (supabaseUrl && serviceRoleKey) {
        try {
          const incidentResp = await fetch(`${supabaseUrl}/functions/v1/ai-decision-engine`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              signal_id,
              tier2_promotion: true,  // ai-decision-engine skips composite gate on tier2_promotion
              tier2_reasoning: agentReview.reasoning,
            }),
          });
          if (incidentResp.ok) {
            console.log(`[ReviewAgent] Promoted signal ${signal_id} to incident via ai-decision-engine`);
          } else {
            console.warn(`[ReviewAgent] Promotion fetch failed (${incidentResp.status})`);
          }
        } catch (e) {
          console.error('[ReviewAgent] Promotion call failed:', e instanceof Error ? e.message : e);
        }
      }

    } else if ((agentReview.verdict === 'enrich' || agentReview.verdict === 'flag') && incident_id) {
      // Update the existing incident's AI analysis log
      const { data: incident } = await supabase
        .from('incidents')
        .select('ai_analysis_log, timeline_json')
        .eq('id', incident_id)
        .single();

      if (incident) {
        const newLogEntry = {
          timestamp: new Date().toISOString(),
          agent_id: null,
          agent_call_sign: 'Tier 2 Review Agent',
          agent_specialty: 'Contextual Signal Review',
          analysis: `## Tier 2 Review — ${agentReview.verdict.toUpperCase()}\n\n${agentReview.reasoning}\n\n**Confidence adjustment:** ${agentReview.confidence_delta >= 0 ? '+' : ''}${(agentReview.confidence_delta * 100).toFixed(1)}%`,
          investigation_focus: ['contextual review', agentReview.verdict === 'flag' ? 'low_confidence_flag' : 'enrichment'],
        };

        const updates: Record<string, any> = {
          ai_analysis_log: [...(incident.ai_analysis_log || []), newLogEntry],
          timeline_json: [...(incident.timeline_json || []), {
            timestamp: new Date().toISOString(),
            event: agentReview.verdict === 'flag'
              ? 'Tier 2 agent flagged incident as low confidence'
              : 'Tier 2 agent enriched incident with contextual analysis',
            details: agentReview.reasoning,
            actor: 'Tier 2 Review Agent',
          }],
        };

        if (agentReview.verdict === 'flag') {
          // Tag the incident so analysts know to scrutinize it
          updates.investigation_status = 'needs_review';
        }

        await supabase.from('incidents').update(updates).eq('id', incident_id);
        console.log(`[ReviewAgent] ${agentReview.verdict === 'flag' ? 'Flagged' : 'Enriched'} incident ${incident_id}`);
      }
    }

    return successResponse({
      signal_id,
      verdict: agentReview.verdict,
      confidence_delta: agentReview.confidence_delta,
      reasoning: agentReview.reasoning,
    });

  } catch (error) {
    console.error('[ReviewAgent] Unexpected error:', error instanceof Error ? error.message : error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
