/**
 * Shared heartbeat helpers for scheduled edge functions.
 *
 * cron_heartbeat columns (authoritative reference — do not guess):
 *   id             uuid  PK
 *   job_name       text
 *   started_at     timestamptz
 *   completed_at   timestamptz
 *   status         text   ('running' | 'succeeded' | 'failed' | 'completed')
 *   result_summary jsonb
 *   error_message  text
 *   duration_ms    int4
 *
 * NEVER write raw cron_heartbeat SQL in edge functions — use these helpers.
 *
 * --- Usage patterns ---
 *
 * Pattern A — track run/complete lifecycle (preferred for long-running functions):
 *
 *   import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
 *
 *   const hb = await startHeartbeat(supabase, 'my-job-nightly');
 *   try {
 *     // ... do work ...
 *     await completeHeartbeat(supabase, hb, { items_processed: 42 });
 *   } catch (err) {
 *     await failHeartbeat(supabase, hb, err);
 *     throw err;
 *   }
 *
 * Pattern B — single insert at end (for short functions or fire-and-forget):
 *
 *   import { recordHeartbeat } from "../_shared/heartbeat.ts";
 *
 *   await recordHeartbeat(supabase, 'my-job-hourly', 'completed', { signals_created: 5 });
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface HeartbeatHandle {
  id: string | null;
  jobName: string;
  startedAt: number; // Date.now() at start — used to compute duration_ms
}

/**
 * Insert a 'running' heartbeat row and return a handle for later completion.
 * If the insert fails (schema mismatch, permissions), the handle will have id=null
 * and completion calls will fall back to a fresh insert.
 */
export async function startHeartbeat(
  supabase: SupabaseClient,
  jobName: string
): Promise<HeartbeatHandle> {
  const startedAt = Date.now();
  try {
    const { data } = await supabase
      .from("cron_heartbeat")
      .insert({ job_name: jobName, started_at: new Date(startedAt).toISOString(), status: "running" })
      .select("id")
      .single();
    return { id: data?.id ?? null, jobName, startedAt };
  } catch {
    return { id: null, jobName, startedAt };
  }
}

/**
 * Mark a heartbeat run as succeeded.
 * Updates the existing row if we have an id, otherwise inserts a new completed row.
 */
export async function completeHeartbeat(
  supabase: SupabaseClient,
  hb: HeartbeatHandle,
  resultSummary?: Record<string, unknown>
): Promise<void> {
  const payload = {
    completed_at: new Date().toISOString(),
    status: "succeeded",
    duration_ms: Date.now() - hb.startedAt,
    ...(resultSummary ? { result_summary: resultSummary } : {}),
  };
  try {
    if (hb.id) {
      await supabase.from("cron_heartbeat").update(payload).eq("id", hb.id);
    } else {
      await supabase.from("cron_heartbeat").insert({ job_name: hb.jobName, ...payload });
    }
  } catch (e) {
    console.error(`[heartbeat] completeHeartbeat failed for ${hb.jobName}:`, e);
  }
}

/**
 * Mark a heartbeat run as failed.
 * Updates the existing row if we have an id, otherwise inserts a new failed row.
 */
export async function failHeartbeat(
  supabase: SupabaseClient,
  hb: HeartbeatHandle,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    completed_at: new Date().toISOString(),
    status: "failed",
    duration_ms: Date.now() - hb.startedAt,
    error_message: message.substring(0, 500),
    result_summary: { error: message },
  };
  try {
    if (hb.id) {
      await supabase.from("cron_heartbeat").update(payload).eq("id", hb.id);
    } else {
      await supabase.from("cron_heartbeat").insert({ job_name: hb.jobName, ...payload });
    }
  } catch (e) {
    console.error(`[heartbeat] failHeartbeat failed for ${hb.jobName}:`, e);
  }
}

/**
 * Single-insert pattern — write one completed row at the end of a run.
 * Use this for short functions that don't need a 'running' state visible during execution.
 */
export async function recordHeartbeat(
  supabase: SupabaseClient,
  jobName: string,
  status: "succeeded" | "failed" | "completed",
  resultSummary?: Record<string, unknown>,
  startedAt?: Date
): Promise<void> {
  try {
    await supabase.from("cron_heartbeat").insert({
      job_name: jobName,
      ...(startedAt ? { started_at: startedAt.toISOString() } : {}),
      completed_at: new Date().toISOString(),
      status,
      ...(resultSummary ? { result_summary: resultSummary } : {}),
    });
  } catch (e) {
    console.error(`[heartbeat] recordHeartbeat failed for ${jobName}:`, e);
  }
}
