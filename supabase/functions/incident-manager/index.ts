/**
 * Incident Manager — Consolidated Domain Service
 * 
 * Single entry point for all incident lifecycle operations.
 * Replaces 10 individual edge functions with action-based routing.
 * 
 * Actions:
 *   action               — Execute incident actions (update status, assign, etc.)
 *   check-escalation     — Check if signal warrants incident escalation
 *   summarize            — AI-generate incident title/summary
 *   agent-orchestrate    — Multi-agent incident response orchestration
 *   alert-delivery       — Send email alerts for incidents
 *   alert-delivery-secure — Send alerts via Teams/Slack/SMS
 *   manage-ticket        — Create/update incident tickets
 *   watch                — Surge monitoring for active P1/P2 incidents
 *   threat-escalation    — Analyze threat escalation patterns
 *   generate-briefing    — Generate executive incident briefings
 */

import { corsHeaders, handleCors, errorResponse } from "../_shared/supabase-client.ts";
import type { IncidentManagerAction, DomainRequest } from "../_shared/types.ts";

const ACTION_TO_FUNCTION: Record<string, string> = {
  'action': 'incident-action',
  'check-escalation': 'check-incident-escalation',
  'summarize': 'auto-summarize-incident',
  'agent-orchestrate': 'incident-agent-orchestrator',
  'alert-delivery': 'alert-delivery',
  'alert-delivery-secure': 'alert-delivery-secure',
  'manage-ticket': 'manage-incident-ticket',
  'watch': 'incident-watch',
  'threat-escalation': 'analyze-threat-escalation',
  'generate-briefing': 'generate-incident-briefing',
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

    console.log(`[IncidentManager] Dispatching action: ${action}`);

    const functionName = ACTION_TO_FUNCTION[action];
    if (!functionName) {
      return errorResponse(
        `Unknown action: ${action}. Valid actions: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
        400
      );
    }

    return await delegateToFunction(functionName, body, req);
  } catch (error) {
    console.error('[IncidentManager] Router error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// ═══════════════════════════════════════════════════════════════
//                    DELEGATION HELPER
// ═══════════════════════════════════════════════════════════════

async function delegateToFunction(
  functionName: string,
  body: Record<string, unknown>,
  originalReq: Request
): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const { action, ...forwardBody } = body;

    // Forward the original Authorization header for user-scoped actions
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    };

    // For user-authenticated actions, forward their token instead
    const userAuth = originalReq.headers.get('Authorization');
    if (functionName === 'incident-action' && userAuth) {
      headers['Authorization'] = userAuth;
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers,
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
