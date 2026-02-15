/**
 * Entity Manager — Consolidated Domain Service
 * 
 * Single entry point for all entity lifecycle operations.
 * Replaces 12 individual edge functions with action-based routing.
 * 
 * Actions:
 *   create                — Create new entity
 *   enrich                — AI-powered entity enrichment
 *   auto-enrich           — Batch enrich entities with generic descriptions
 *   deep-scan             — Deep OSINT scan for an entity
 *   correlate             — Match entities mentioned in text
 *   cross-reference       — Cross-reference entities against documents
 *   configure-monitoring  — Configure entity monitoring settings
 *   scan-content          — Scan web for entity-related content
 *   scan-photos           — Scan web for entity photos
 *   proximity-monitor     — Monitor threats near entity locations
 *   osint-scan            — OSINT entity scan (web + social)
 *   vip-deep-scan         — VIP intake deep scan
 *   vip-osint-discovery   — VIP OSINT discovery scan
 */

import { corsHeaders, handleCors, errorResponse } from "../_shared/supabase-client.ts";
import type { EntityManagerAction, DomainRequest } from "../_shared/types.ts";

const ACTION_TO_FUNCTION: Record<string, string> = {
  'create': 'create-entity',
  'enrich': 'enrich-entity',
  'auto-enrich': 'auto-enrich-entities',
  'deep-scan': 'entity-deep-scan',
  'correlate': 'correlate-entities',
  'cross-reference': 'cross-reference-entities',
  'configure-monitoring': 'configure-entity-monitoring',
  'scan-content': 'scan-entity-content',
  'scan-photos': 'scan-entity-photos',
  'proximity-monitor': 'monitor-entity-proximity',
  'osint-scan': 'osint-entity-scan',
  'vip-deep-scan': 'vip-deep-scan',
  'vip-osint-discovery': 'vip-osint-discovery',
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

    console.log(`[EntityManager] Dispatching action: ${action}`);

    const functionName = ACTION_TO_FUNCTION[action];
    if (!functionName) {
      return errorResponse(
        `Unknown action: ${action}. Valid actions: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
        400
      );
    }

    return await delegateToFunction(functionName, body);
  } catch (error) {
    console.error('[EntityManager] Router error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// ═══════════════════════════════════════════════════════════════
//                    DELEGATION HELPER
// ═══════════════════════════════════════════════════════════════

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
