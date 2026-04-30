/**
 * red-team-review
 *
 * Adversarial review of high-stakes AI threat assessments. Runs after
 * AI-DECISION-ENGINE produces a verdict for composite >= 0.75. Loads the
 * primary agent's analysis + the signal, asks the RED-TEAM persona to
 * critique it, writes the dissent into signal_agent_analyses so the
 * Reasoning panel surfaces both views to analysts.
 *
 * Triggered via the durable queue from ai-decision-engine when a high-
 * stakes call lands (queue handles retry / DLQ if the AI call fails).
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";

interface ReviewInput {
  signal_id: string;
}

interface DissentPayload {
  dissent_strength: 'strong' | 'moderate' | 'weak' | 'none';
  primary_overconfident: boolean;
  alternative_explanation: string;
  missed_considerations: string[];
  recommended_adjustment: string;
  summary: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  try {
    const body = await req.json().catch(() => ({})) as ReviewInput;
    if (!body?.signal_id) return errorResponse('signal_id is required', 400);

    // 1. Load signal + the primary AI-DECISION-ENGINE analysis
    const [{ data: signal }, { data: primaryAnalysis }, { data: redTeam }] = await Promise.all([
      supabase
        .from('signals')
        .select('id, title, category, severity, severity_score, normalized_text, composite_confidence, raw_json')
        .eq('id', body.signal_id)
        .maybeSingle(),
      supabase
        .from('signal_agent_analyses')
        .select('agent_call_sign, analysis, confidence_score, reasoning_log')
        .eq('signal_id', body.signal_id)
        .eq('agent_call_sign', 'AI-DECISION-ENGINE')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('ai_agents')
        .select('system_prompt')
        .eq('call_sign', 'RED-TEAM')
        .eq('is_active', true)
        .maybeSingle(),
    ]);

    if (!signal) return errorResponse('Signal not found', 404);
    if (!primaryAnalysis) {
      return successResponse({ skipped: true, reason: 'No AI-DECISION-ENGINE analysis to review yet' });
    }
    if (!redTeam) {
      return errorResponse('RED-TEAM agent persona not configured (run migration 20260430000008)', 500);
    }

    // 2. Compose the adversarial prompt
    const aiDecision = (signal.raw_json as any)?.ai_decision || {};
    const investigationSummary = (primaryAnalysis.reasoning_log as any)?.investigation?.summary;

    const userMsg = `=== SIGNAL ===
Title: ${(signal.title || '').substring(0, 200)}
Category: ${signal.category}
Severity: ${signal.severity} (${signal.severity_score})
Composite confidence: ${signal.composite_confidence}
Text excerpt: ${(signal.normalized_text || '').substring(0, 800)}

=== PRIMARY AGENT VERDICT (AI-DECISION-ENGINE) ===
Stated reasoning: ${(primaryAnalysis.analysis || '').substring(0, 1500)}
Stated confidence: ${primaryAnalysis.confidence_score}
${aiDecision.threat_level ? `Threat level: ${aiDecision.threat_level}` : ''}
${aiDecision.should_create_incident !== undefined ? `Should create incident: ${aiDecision.should_create_incident}` : ''}
${aiDecision.is_historical_content ? 'Marked as historical content' : ''}
${investigationSummary ? `\nInvestigation findings the primary agent gathered:\n${investigationSummary}` : ''}

Critique this assessment. Where is it weakest? What's the most charitable alternative? What did they miss?`;

    // 3. Run the RED-TEAM AI call
    const dissent = await callAiGatewayJson<DissentPayload>({
      model: 'openai/gpt-5.2',
      functionName: 'red-team-review',
      messages: [
        { role: 'system', content: redTeam.system_prompt || '' },
        { role: 'user', content: userMsg },
      ],
      extraBody: { response_format: { type: 'json_object' } },
      retries: 1,
    });

    if (dissent.error || !dissent.data) {
      return errorResponse(`RED-TEAM call failed: ${dissent.error || 'no data'}`, 500);
    }

    const d = dissent.data;

    // 4. Persist the dissent in signal_agent_analyses so the Reasoning panel
    // shows it alongside the primary verdict
    await supabase.from('signal_agent_analyses').insert({
      signal_id: signal.id,
      agent_call_sign: 'RED-TEAM',
      analysis: d.summary,
      confidence_score: d.dissent_strength === 'strong' ? 0.9
                       : d.dissent_strength === 'moderate' ? 0.7
                       : d.dissent_strength === 'weak' ? 0.4 : 0.1,
      trigger_reason: 'red_team_review',
      analysis_tier: 'adversarial',
      confidence_breakdown: {
        dissent_strength: d.dissent_strength,
        primary_overconfident: d.primary_overconfident,
        recommended_adjustment: d.recommended_adjustment,
      },
      pattern_matches: {
        missed_considerations: d.missed_considerations || [],
        alternative_explanation: d.alternative_explanation || '',
      },
      reasoning_log: {
        target_agent: 'AI-DECISION-ENGINE',
        original_confidence: primaryAnalysis.confidence_score,
        dissent_strength: d.dissent_strength,
      },
    });

    return successResponse({
      dissent_strength: d.dissent_strength,
      summary: d.summary,
      missed_considerations: d.missed_considerations || [],
      alternative_explanation: d.alternative_explanation || '',
    });
  } catch (error) {
    console.error('[red-team-review] Fatal:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
