/**
 * Job worker — drains the function_jobs queue.
 *
 * Architecture:
 *  - pg_cron triggers this every minute
 *  - Worker SELECTs up to BATCH_SIZE pending jobs whose scheduled_for has elapsed
 *  - For each job: atomic claim via UPDATE...WHERE status='pending', invoke the
 *    target edge function with the payload as body, mark completed/failed
 *  - On failure: increment attempts; if < max_attempts, reschedule with
 *    exponential backoff (60s × 2^attempts); if >= max_attempts, mark failed
 *  - Telemetry: every job execution writes a row to function_telemetry
 *
 * The job_type string IS the target edge function name. This means any edge
 * function callable via /functions/v1/<name> can be invoked through the
 * queue without registering a handler — payload becomes the request body.
 *
 * Why not pg_notify + LISTEN: Edge Functions cannot hold persistent
 * connections, so LISTEN is not viable. pg_cron polling every minute is
 * the standard Supabase pattern. Latency: ~30s average from enqueue to
 * execution, which is acceptable for the workloads we are migrating off
 * fire-and-forget (those had unbounded latency / dropped work).
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { recordTelemetry, classifyError } from "../_shared/observability.ts";

const BATCH_SIZE = 25;            // jobs claimed per worker tick
const JOB_TIMEOUT_MS = 90_000;    // per-job execution ceiling
const RUN_TIMEOUT_MS = 110_000;   // total worker run ceiling — leave room before pg_cron retriggers

interface JobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, 'job-worker');
  const runStartedAt = Date.now();
  let claimed = 0;
  let succeeded = 0;
  let failed = 0;
  let retried = 0;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    // SERVICE_ROLE_JWT is the legacy JWT-format service role key, mirrored
    // from vault.service_role_key into the function secrets so the worker
    // can use it as Bearer auth when invoking other edge functions.
    // Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') returns the new sb_secret_*
    // API key format in this project, which Edge auth rejects as
    // UNAUTHORIZED_INVALID_JWT_FORMAT.
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_JWT')
      ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_URL or SERVICE_ROLE_JWT not configured');
    }

    // ── 1. Fetch a batch of pending, due jobs ───────────────────────────────
    // Order by scheduled_for so retries that were rescheduled run when due,
    // not before. created_at is the tiebreaker for FIFO within a tick.
    const { data: candidates, error: fetchError } = await supabase
      .from('function_jobs')
      .select('id, job_type, payload, attempts, max_attempts, scheduled_for')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;
    if (!candidates || candidates.length === 0) {
      await completeHeartbeat(supabase, hb, { claimed: 0, succeeded: 0, failed: 0, retried: 0 });
      return successResponse({ message: 'No pending jobs', claimed: 0 });
    }

    // ── 2. Process each job ─────────────────────────────────────────────────
    for (const job of candidates as JobRow[]) {
      // Soft deadline — if we are out of runtime budget, leave the rest for
      // the next tick rather than risk runtime kill mid-job.
      if (Date.now() - runStartedAt > RUN_TIMEOUT_MS) {
        console.log(`[job-worker] Run timeout reached after ${claimed} jobs — yielding to next tick`);
        break;
      }

      // 2a. Atomic claim — only succeeds if status is still pending. If
      // another worker took it first (shouldn't happen with single-worker
      // cron, but belt-and-suspenders), affected rows is 0 and we skip.
      const claimAt = new Date().toISOString();
      const { data: claimedRows, error: claimError } = await supabase
        .from('function_jobs')
        .update({
          status: 'in_progress',
          started_at: claimAt,
          attempts: job.attempts + 1,
        })
        .eq('id', job.id)
        .eq('status', 'pending')
        .select('id');
      if (claimError) {
        console.warn(`[job-worker] Claim failed for ${job.id}: ${claimError.message}`);
        continue;
      }
      if (!claimedRows || claimedRows.length === 0) {
        // Another worker took it (or it was cancelled mid-batch)
        continue;
      }
      claimed++;

      // 2b. Invoke the target edge function via raw fetch
      const jobStartedAt = Date.now();
      let jobError: string | null = null;
      let jobStatus = 0;
      let resultBody: unknown = null;
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/${encodeURIComponent(job.job_type)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify(job.payload),
          signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
        });
        jobStatus = resp.status;
        const text = await resp.text();
        try { resultBody = text ? JSON.parse(text) : null; } catch { resultBody = text; }
        if (!resp.ok) {
          jobError = `HTTP ${resp.status}: ${typeof text === 'string' ? text.substring(0, 300) : ''}`;
        }
      } catch (e: any) {
        jobError = `fetch error: ${e?.message || e}`;
      }
      const jobDurationMs = Date.now() - jobStartedAt;

      // 2c. Mark completed or schedule retry
      const newAttempts = job.attempts + 1;
      if (!jobError) {
        await supabase
          .from('function_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            result: resultBody && typeof resultBody === 'object'
              ? resultBody as Record<string, unknown>
              : { raw: resultBody },
            error_message: null,
          })
          .eq('id', job.id);
        succeeded++;
      } else if (newAttempts >= job.max_attempts) {
        // Out of retries — mark failed (DLQ)
        await supabase
          .from('function_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: jobError.substring(0, 1000),
          })
          .eq('id', job.id);
        failed++;
        console.warn(`[job-worker] Job ${job.id} (${job.job_type}) FAILED after ${newAttempts} attempts: ${jobError}`);
      } else {
        // Backoff: 60s, 120s, 240s, 480s
        const backoffMs = 60_000 * Math.pow(2, newAttempts - 1);
        const nextRunAt = new Date(Date.now() + backoffMs);
        await supabase
          .from('function_jobs')
          .update({
            status: 'pending',
            scheduled_for: nextRunAt.toISOString(),
            error_message: jobError.substring(0, 1000),
          })
          .eq('id', job.id);
        retried++;
      }

      // 2d. Telemetry — one row per job execution attempt
      await recordTelemetry(supabase, {
        functionName: `job-worker:${job.job_type}`,
        durationMs: jobDurationMs,
        status: jobError ? (newAttempts >= job.max_attempts ? 'error' : 'error') : 'success',
        errorClass: jobError ? classifyError(jobError, jobStatus) : undefined,
        errorMessage: jobError ?? undefined,
        context: { job_id: job.id, attempt: newAttempts, max_attempts: job.max_attempts, http_status: jobStatus || null },
      });
    }

    await completeHeartbeat(supabase, hb, { claimed, succeeded, failed, retried });

    return successResponse({
      claimed,
      succeeded,
      failed,
      retried,
      duration_ms: Date.now() - runStartedAt,
    });
  } catch (error) {
    console.error('[job-worker] Fatal:', error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
