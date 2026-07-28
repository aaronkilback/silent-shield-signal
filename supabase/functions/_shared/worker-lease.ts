/**
 * Single-flight lease for job-worker (INC-JOBWORKER-SATURATION-2026-07-27).
 *
 * pg_cron fires job-worker every 60s, but a run can last up to 110s. Without a
 * guard, ticks overlap and concurrent workers exhaust the DB connection pool —
 * the exact incident this closes. These helpers implement a cross-invocation
 * mutex over a singleton row (`job_worker_lease`, id=1).
 *
 * The atomic conditional UPDATE runs SERVER-SIDE via SQL RPCs
 * (try_acquire_job_worker_lease / release_job_worker_lease). An earlier version
 * expressed the "free OR stale" predicate as a PostgREST `.or()` filter on an
 * UPDATE; that did not match the `locked_at IS NULL` branch through the REST
 * layer, so acquire returned false even when the lease was free and the worker
 * never ran. The RPC removes that ambiguity — the predicate is plain SQL.
 *
 * Advisory locks are deliberately NOT used: PostgREST transaction-pools
 * connections, so a session-level pg_advisory_lock would not span the worker's
 * many statements. The lease row is the reliable mechanism.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Stale threshold — must exceed job-worker RUN_TIMEOUT_MS (110s) plus margin. */
export const DEFAULT_STALE_SECONDS = 150;

/**
 * Acquire the lease. Calls try_acquire_job_worker_lease(run_id, stale_secs),
 * which performs one atomic conditional UPDATE and returns whether a row was
 * updated (lease was free or stale). Returns false if another run holds a
 * fresh lease → caller must no-op.
 *
 * Fails CLOSED: on RPC error we return false (do NOT run). Overlap is the
 * failure being guarded against, so "unsure → don't run" is the safe default.
 * A crashed worker's lease self-expires after staleSeconds, so fail-closed
 * cannot permanently deadlock the queue.
 */
export async function acquireWorkerLease(
  supabase: SupabaseClient,
  runId: string,
  staleSeconds: number = DEFAULT_STALE_SECONDS,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_acquire_job_worker_lease", {
    p_run_id: runId,
    p_stale_secs: staleSeconds,
  });
  if (error) {
    console.warn(`[worker-lease] acquire failed-closed: ${error.message}`);
    return false;
  }
  return data === true;
}

/**
 * Release the lease, but only if we still own it (locked_by = runId, enforced
 * inside the RPC). If our lease already expired and another worker reclaimed
 * it, the release is a no-op. Never throws.
 */
export async function releaseWorkerLease(
  supabase: SupabaseClient,
  runId: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_job_worker_lease", {
    p_run_id: runId,
  });
  if (error) console.warn(`[worker-lease] release failed: ${error.message}`);
}
