/**
 * Signal Processor — Consolidated Domain Service
 * 
 * Single entry point for all signal processing operations.
 * Replaces 8 individual edge functions with action-based routing.
 * 
 * Actions:
 *   deduplicate          — Hash-based and fuzzy duplicate detection
 *   near-duplicate       — Levenshtein-based near-duplicate detection
 *   cleanup-duplicates   — Clean confirmed duplicate signals
 *   correlate            — Time/content-based signal correlation
 *   consolidate          — Post-ingestion merge of related signals
 *   propose-merge        — Create merge proposals for review
 *   execute-merge        — Execute approved signal merges
 *   extract-insights     — NER & structured insight extraction
 *   backfill-media       — Backfill missing media/thumbnails
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import type { SignalProcessorAction, DomainRequest } from "../_shared/types.ts";

const VALID_ACTIONS: SignalProcessorAction[] = [
  'ingest', 'deduplicate', 'correlate', 'merge',
  'consolidate', 'extract-insights', 'backfill-media',
];

// Extended actions that map to legacy function names
const ACTION_TO_FUNCTION: Record<string, string> = {
  'deduplicate': 'detect-duplicates',
  'near-duplicate': 'detect-near-duplicate-signals',
  'cleanup-duplicates': 'cleanup-duplicate-signals',
  'correlate': 'correlate-signals',
  'consolidate': 'consolidate-signals',
  'propose-merge': 'propose-signal-merge',
  'execute-merge': 'execute-signal-merge',
  'extract-insights': 'extract-signal-insights',
  'backfill-media': 'backfill-signal-media',
};

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'deduplicate';

    console.log(`[SignalProcessor] Dispatching action: ${action}`);

    const functionName = ACTION_TO_FUNCTION[action];
    if (!functionName) {
      return errorResponse(
        `Unknown action: ${action}. Valid actions: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
        400
      );
    }

    // Delegate to existing function (will inline critical-path ones in future iterations)
    return await delegateToFunction(functionName, body);
  } catch (error) {
    console.error('[SignalProcessor] Router error:', error);
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

    // Remove `action` from forwarded body to avoid confusion in legacy functions
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
