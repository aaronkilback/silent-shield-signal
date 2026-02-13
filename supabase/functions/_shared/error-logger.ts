/**
 * Centralized Error Logger for Edge Functions
 * 
 * Captures all failures to `edge_function_errors` table with context,
 * enabling silent failure elimination across the entire platform.
 * 
 * Usage:
 *   import { logError, withErrorLogging } from "../_shared/error-logger.ts";
 */

import { createClient } from "npm:@supabase/supabase-js@2";

interface ErrorContext {
  functionName: string;
  userId?: string;
  tenantId?: string;
  clientId?: string;
  severity?: 'warning' | 'error' | 'critical';
  requestContext?: Record<string, unknown>;
  durationMs?: number;
}

/**
 * Log an error to the edge_function_errors table.
 * This is fire-and-forget — it won't throw even if logging fails.
 */
export async function logError(
  error: unknown,
  context: ErrorContext
): Promise<string | null> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const errorObj = error instanceof Error ? error : new Error(String(error));
    const errorCode = (error as any)?.code || (error as any)?.status || null;

    const { data, error: insertErr } = await supabase
      .from('edge_function_errors')
      .insert({
        function_name: context.functionName,
        error_message: errorObj.message,
        error_stack: errorObj.stack?.substring(0, 4000) || null,
        error_code: errorCode ? String(errorCode) : null,
        severity: context.severity || 'error',
        request_context: context.requestContext || {},
        user_id: context.userId || null,
        tenant_id: context.tenantId || null,
        client_id: context.clientId || null,
        duration_ms: context.durationMs || null,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[ErrorLogger] Failed to persist error:', insertErr.message);
      return null;
    }

    return data?.id || null;
  } catch (logErr) {
    // Last resort — at least log to console
    console.error('[ErrorLogger] Logger itself failed:', logErr);
    console.error('[ErrorLogger] Original error:', error);
    return null;
  }
}

/**
 * Higher-order function that wraps an edge function handler with
 * automatic error logging and standardized error responses.
 * 
 * Usage:
 *   Deno.serve(withErrorLogging('my-function', async (req) => {
 *     // your logic
 *     return new Response(JSON.stringify({ ok: true }));
 *   }));
 */
export function withErrorLogging(
  functionName: string,
  handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const startTime = Date.now();
    
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      });
    }

    try {
      return await handler(req);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      // Determine severity based on error type
      let severity: 'warning' | 'error' | 'critical' = 'error';
      const errMsg = error instanceof Error ? error.message : String(error);
      
      if (errMsg.includes('rate limit') || errMsg.includes('429')) {
        severity = 'warning';
      } else if (errMsg.includes('timeout') || errMsg.includes('ECONNREFUSED')) {
        severity = 'critical';
      }

      // Log to DB (fire-and-forget)
      await logError(error, {
        functionName,
        severity,
        durationMs,
        requestContext: {
          method: req.method,
          url: req.url,
          userAgent: req.headers.get('user-agent'),
        },
      });

      // Always return a structured error response
      return new Response(
        JSON.stringify({
          error: errMsg,
          function: functionName,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          },
        }
      );
    }
  };
}

/**
 * Enqueue a failed operation for retry via the dead letter queue.
 */
export async function enqueueForRetry(
  functionName: string,
  payload: Record<string, unknown>,
  errorMessage: string,
  errorId?: string | null,
  maxRetries: number = 3
): Promise<string | null> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Exponential backoff: retry_count=0 → 1min, 1→5min, 2→25min
    const nextRetryAt = new Date(Date.now() + 60_000).toISOString();

    const { data, error } = await supabase
      .from('dead_letter_queue')
      .insert({
        function_name: functionName,
        payload,
        error_message: errorMessage,
        error_id: errorId || null,
        max_retries: maxRetries,
        next_retry_at: nextRetryAt,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[DLQ] Failed to enqueue:', error.message);
      return null;
    }

    console.log(`[DLQ] Enqueued ${functionName} for retry (id: ${data?.id})`);
    return data?.id || null;
  } catch (err) {
    console.error('[DLQ] Enqueue failed:', err);
    return null;
  }
}
