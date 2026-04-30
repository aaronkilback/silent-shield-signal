/**
 * Per-call telemetry helper for edge functions.
 *
 * Writes one row to public.function_telemetry per measured call. Designed for
 * fire-and-forget use from any function — failures are logged to console only,
 * never thrown. The table itself is append-only and indexed for time-window
 * queries; the function_telemetry_24h view is what dashboards read.
 *
 * Usage:
 *   import { recordTelemetry } from "../_shared/observability.ts";
 *
 *   const t = Date.now();
 *   try {
 *     // ... do work ...
 *     await recordTelemetry(supabase, {
 *       functionName: 'monitor-rss-sources',
 *       durationMs: Date.now() - t,
 *       status: 'success',
 *     });
 *   } catch (err) {
 *     await recordTelemetry(supabase, {
 *       functionName: 'monitor-rss-sources',
 *       durationMs: Date.now() - t,
 *       status: 'error',
 *       errorClass: classifyError(err),
 *       errorMessage: err.message,
 *     });
 *     throw err;
 *   }
 *
 * For AI calls, the ai-gateway is the canonical caller — it records
 * ai_provider, ai_model, tokens_in, tokens_out automatically.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface TelemetryRecord {
  functionName: string;
  durationMs: number;
  status: 'success' | 'error' | 'timeout' | 'circuit_open';
  // AI-call metadata (omit for non-AI calls)
  aiProvider?: 'openai' | 'gemini' | 'perplexity';
  aiModel?: string;
  tokensIn?: number;
  tokensOut?: number;
  // Error metadata (omit on success)
  errorClass?: 'rate_limit' | 'timeout' | 'invalid_response' | 'auth' | 'parse' | 'other';
  errorMessage?: string;
  // Free-form context (kept small — do NOT shove full prompts/responses here)
  context?: Record<string, unknown>;
}

/**
 * Record one telemetry row. Never throws. Safe to call from anywhere.
 */
export async function recordTelemetry(
  supabase: SupabaseClient,
  record: TelemetryRecord,
): Promise<void> {
  try {
    await supabase.from('function_telemetry').insert({
      function_name: record.functionName,
      duration_ms: Math.round(record.durationMs),
      status: record.status,
      ai_provider: record.aiProvider ?? null,
      ai_model: record.aiModel ?? null,
      tokens_in: record.tokensIn ?? null,
      tokens_out: record.tokensOut ?? null,
      error_class: record.errorClass ?? null,
      error_message: record.errorMessage?.substring(0, 500) ?? null,
      context: record.context ?? {},
    });
  } catch (err: any) {
    // Telemetry failures must never break the caller. Log to console for
    // operator visibility — if telemetry breaks broadly, operators will see
    // a console flood that is actionable on its own.
    console.warn('[observability] recordTelemetry failed:', err?.message || err);
  }
}

/**
 * Classify an error into a coarse error_class for aggregate metrics.
 * Pass the raw error or response status; returns the bucket name.
 */
export function classifyError(err: unknown, statusCode?: number): TelemetryRecord['errorClass'] {
  if (statusCode === 429 || (typeof err === 'string' && /rate.?limit/i.test(err))) return 'rate_limit';
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('aborted')) return 'timeout';
    if (msg.includes('rate limit') || msg.includes('429')) return 'rate_limit';
    if (msg.includes('parse') || msg.includes('json') || msg.includes('invalid response')) return 'parse';
    if (msg.includes('auth')) return 'auth';
  }
  if (statusCode && statusCode >= 500) return 'other';
  if (statusCode === 0 || statusCode === undefined) return 'other';
  return 'other';
}
