/**
 * Producer helper for the function_jobs queue.
 *
 * Replaces fire-and-forget patterns. Instead of:
 *
 *   fetch(`${supabaseUrl}/functions/v1/review-signal-agent`, {...})
 *     .catch((e) => console.warn('failed:', e));
 *
 * call sites do:
 *
 *   await enqueueJob(supabase, {
 *     type: 'review-signal-agent',
 *     payload: { signal_id, composite_score, ai_confidence, ... },
 *   });
 *
 * The row is durable; the job-worker function drains it on the next cron
 * tick (~60s), with retry on failure. Edge runtime teardown does not lose
 * the work because it is committed to Postgres before the producer returns.
 *
 * For a one-at-most operation (e.g. a single review per signal), supply
 * `idempotencyKey` — the unique index will reject duplicate enqueues.
 *
 * For delayed work, supply `scheduledFor` — the worker only claims jobs
 * whose scheduled_for has elapsed.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface EnqueueJobInput {
  /** Identifies which handler the worker routes to (e.g. 'review-signal-agent'). */
  type: string;
  /** Arbitrary JSON payload — passed to the handler verbatim. */
  payload: Record<string, unknown>;
  /** When the job is eligible to run. Default: now. */
  scheduledFor?: Date;
  /** Maximum retry count before the job is marked failed. Default: 3. */
  maxAttempts?: number;
  /** Optional unique key — if a row already exists with this key in
   *  pending/in_progress/completed status, the enqueue silently no-ops
   *  and returns the existing job's id. */
  idempotencyKey?: string;
}

export interface EnqueueJobResult {
  jobId: string;
  /** True when an existing job with the same idempotency_key was found. */
  deduped: boolean;
}

/**
 * Enqueue a job. Returns the job id. Throws on database error so the
 * producer fails loudly — there is no point producing if we can't durably
 * commit the request.
 */
export async function enqueueJob(
  supabase: SupabaseClient,
  input: EnqueueJobInput,
): Promise<EnqueueJobResult> {
  const row: Record<string, unknown> = {
    job_type: input.type,
    payload: input.payload,
    max_attempts: input.maxAttempts ?? 3,
    scheduled_for: (input.scheduledFor ?? new Date()).toISOString(),
  };
  if (input.idempotencyKey) {
    row.idempotency_key = input.idempotencyKey;
  }

  const { data, error } = await supabase
    .from('function_jobs')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    // Postgres unique-violation on idempotency_key — return the existing row
    // rather than failing. This is the dedupe contract.
    if (error.code === '23505' && input.idempotencyKey) {
      const existing = await supabase
        .from('function_jobs')
        .select('id')
        .eq('idempotency_key', input.idempotencyKey)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (existing.data) {
        return { jobId: existing.data.id, deduped: true };
      }
    }
    throw new Error(`enqueueJob(${input.type}) failed: ${error.message}`);
  }

  return { jobId: data!.id as string, deduped: false };
}

/**
 * Convenience: cancel a still-pending job. No-op if already running or done.
 */
export async function cancelJob(supabase: SupabaseClient, jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('function_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('id');
  if (error) {
    console.warn(`[queue] cancelJob(${jobId}) failed:`, error.message);
    return false;
  }
  return (data ?? []).length > 0;
}
