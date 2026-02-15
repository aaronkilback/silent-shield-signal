/**
 * Intelligence Engine — Consolidated Domain Service
 * 
 * Single entry point for all AI-powered analysis, prediction, and assessment operations.
 * Replaces 12 individual edge functions with action-based routing.
 * 
 * Actions:
 *   sentiment-drift          — Analyze sentiment trends across signals
 *   multi-model-consensus    — Multi-model verification for critical assessments
 *   multi-agent-debate       — Multi-agent debate protocol for complex analysis
 *   decision-engine          — AI decision engine with rule matching
 *   predictive-forecast      — Predictive threat forecasting
 *   impact-analysis          — Signal/threat impact analysis
 *   threat-radar             — Threat landscape radar analysis
 *   threat-cluster           — Pre-incident pattern detection
 *   predictive-scorer        — Predict signal-to-incident escalation probability
 *   anticipation-index       — Calculate organizational anticipation index
 *   precursor-indicators     — Identify precursor threat indicators
 *   critical-failure-points  — Identify critical failure points in operations
 */

import { corsHeaders, handleCors, errorResponse } from "../_shared/supabase-client.ts";
import type { IntelligenceEngineAction, DomainRequest } from "../_shared/types.ts";

const ACTION_TO_FUNCTION: Record<string, string> = {
  'sentiment-drift': 'analyze-sentiment-drift',
  'multi-model-consensus': 'multi-model-consensus',
  'multi-agent-debate': 'multi-agent-debate',
  'decision-engine': 'ai-decision-engine',
  'predictive-forecast': 'predictive-forecast',
  'impact-analysis': 'perform-impact-analysis',
  'threat-radar': 'threat-radar-analysis',
  'threat-cluster': 'threat-cluster-detector',
  'predictive-scorer': 'predictive-incident-scorer',
  'anticipation-index': 'calculate-anticipation-index',
  'precursor-indicators': 'identify-precursor-indicators',
  'critical-failure-points': 'identify-critical-failure-points',
};

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (!action) {
      return errorResponse(
        `Missing "action" field. Valid actions: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
        400
      );
    }

    console.log(`[IntelligenceEngine] Dispatching action: ${action}`);

    const functionName = ACTION_TO_FUNCTION[action];
    if (!functionName) {
      return errorResponse(
        `Unknown action: ${action}. Valid actions: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
        400
      );
    }

    return await delegateToFunction(functionName, body);
  } catch (error) {
    console.error('[IntelligenceEngine] Router error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function delegateToFunction(functionName: string, body: Record<string, unknown>): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const { action, ...forwardBody } = body;

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(forwardBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return errorResponse(`${functionName} timed out after 55s`, 504);
    }
    return errorResponse(
      `Failed to delegate to ${functionName}: ${err instanceof Error ? err.message : 'Unknown'}`,
      502
    );
  }
}
