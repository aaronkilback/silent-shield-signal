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

    // ── 5a. Investigation phase (tool use) ───────────────────────────────────
    // Before making the verdict, let the agent investigate using tools:
    // lookup_historical_signals, query_entity_relationships,
    // retrieve_similar_past_decisions, agent_consult, emit_prediction.
    // The full tool-call trace is captured here and persisted alongside the
    // verdict in signal_agent_analyses.reasoning_log so analysts can review
    // exactly what the agent investigated to reach its conclusion.
    let investigationSummary = '';
    let investigationTrace: any[] = [];
    let investigationIterations = 0;
    try {
      const { runAgentLoop } = await import("../_shared/agent-tools.ts");
      await import("../_shared/agent-tools-core.ts"); // side-effect: registers tools
      const investigation = await runAgentLoop(supabase, {
        agentCallSign: 'TIER2-REVIEW',
        functionName: 'review-signal-agent:investigation',
        model: 'openai/gpt-5.2',
        contextSignalId: signal.id,
        contextClientId: signal.client_id,
        maxIterations: 4,
        systemPrompt: `You are a Tier 2 Signal Review investigator. Use the tools available to gather evidence about this signal before a verdict is made. Specifically:\n  - Look up historical signals about the entities mentioned\n  - Check entity relationships if a person/org is named\n  - Retrieve your prior reasoning on similar signals (category=${signal.category})\n  - Consult specialists if confidence is low and another agent has stronger expertise\n  - Emit at least one falsifiable prediction tied to your evolving assessment\nKeep tool calls focused — 2-3 calls max — and then return a 3-4 sentence INVESTIGATION SUMMARY in plain text describing what you found and how it changes your read on this signal.`,
        userMessage: context,
      });
      investigationSummary = investigation.finalContent ?? '(no investigation output)';
      investigationTrace = investigation.toolCalls;
      investigationIterations = investigation.iterations;
    } catch (invError) {
      console.warn('[ReviewAgent] Investigation phase non-fatal error:', invError);
      investigationSummary = '(investigation phase failed — proceeding with base context only)';
    }

    // ── 5b. Verdict call (structured JSON) ──────────────────────────────────
    const aiResult = await callAiGatewayJson<AgentReview>({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${context}\n\nInvestigation findings:\n${investigationSummary}` },
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
    // Embedding generated for future semantic recall.
    const { embedText: embedReviewText } = await import('../_shared/embed.ts');
    const reviewEmbedding = await embedReviewText(agentReview.reasoning || '');
    const analysesWrite = await supabase.from('signal_agent_analyses').insert({
      signal_id,
      agent_call_sign: 'TIER2-REVIEW',
      analysis: agentReview.reasoning,
      embedding: reviewEmbedding,
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
      reasoning_log: {
        verdict_step: {
          step: 'tier2_verdict',
          verdict: agentReview.verdict,
          reasoning: agentReview.reasoning,
          confidence_delta: agentReview.confidence_delta,
          context_signals: contextSignals.length,
          active_incidents: activeIncidents.length,
          reviewed_at: agentReview.reviewed_at,
        },
        // Full investigation trace — surfaced to analysts in the UI Reasoning
        // panel so they can see what the agent looked up before deciding.
        investigation: {
          summary: investigationSummary,
          iterations: investigationIterations,
          tool_calls: investigationTrace.map((tc: any) => ({
            iteration: tc.iteration,
            tool: tc.toolName,
            args: tc.args,
            result_summary: summarizeToolResult(tc.toolName, tc.result),
            duration_ms: tc.durationMs,
            error: tc.errorMessage ?? null,
          })),
        },
      },
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

// Compress raw tool output into one human-readable line for the UI Reasoning
// panel. Each known tool gets a tailored summary; unknown tools fall back to
// a JSON snippet capped at 180 chars. Stored in reasoning_log so analysts
// can scan "what did the agent investigate?" without parsing raw payloads.
function summarizeToolResult(toolName: string, result: unknown): string {
  if (!result || typeof result !== 'object') return String(result ?? 'no result').substring(0, 180);
  const r: any = result;
  if (r.error) return `error: ${String(r.error).substring(0, 160)}`;
  switch (toolName) {
    case 'lookup_historical_signals':
      return `found ${r.count ?? 0} signal(s) for "${r.term ?? '?'}" in last ${r.days_searched ?? '?'}d`;
    case 'query_entity_relationships':
      if (r.found === false) return `no matching entity for "${r.entity_name}"`;
      return `entity ${r.entity_name} (${r.type}): ${r.related_entities?.length ?? 0} related, ${r.mentions_last_90d ?? 0} mentions in 90d, monitoring=${r.monitoring_enabled}`;
    case 'retrieve_similar_past_decisions':
      return `${r.count ?? 0} past decision(s) for ${r.agent_call_sign} in category=${r.category}${r.entity_hint ? ` entity=${r.entity_hint}` : ''}`;
    case 'emit_prediction':
      return `prediction recorded (${r.prediction_id?.substring(0, 8) ?? '?'}…), expected_by ${r.expected_by ?? '?'}`;
    case 'agent_consult':
      return `${r.specialist}: ${(r.assessment ?? '').substring(0, 120)} (conf ${r.confidence})`;
    case 'get_signal_velocity':
      return `recent ${r.counts?.recent ?? 0} vs baseline ${r.counts?.baseline ?? 0} → ${r.multiplier_vs_baseline ?? '?'}x — ${r.interpretation ?? ''}`;
    case 'detect_escalation_pattern':
      return `${r.count ?? 0} signal(s) over ${r.days_searched ?? '?'}d — ${r.verdict ?? ''}`;
    case 'get_anomaly_score':
      if (r.found === false) return 'no anomaly score recorded';
      return `z=${r.z_score?.toFixed?.(2) ?? r.z_score}, type=${r.anomaly_type}, anomalous=${r.is_anomalous}`;
    case 'analyze_signal_image':
      if (r.found === false) return 'no image to analyze';
      return `image findings: ${(r.summary ?? '').substring(0, 150)}`;
    case 'file_followup_task':
    case 'schedule_entity_rescan':
      return `auto action ${r.status}: ${r.action_id?.substring(0, 8) ?? ''}`;
    case 'propose_severity_correction':
    case 'notify_oncall_via_slack':
      return `proposed (awaiting approval): ${r.action_id?.substring(0, 8) ?? ''}`;
    default:
      return JSON.stringify(r).substring(0, 180);
  }
}
