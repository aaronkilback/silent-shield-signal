// src/lib/cop-timeline-writer.ts
//
// Decision Layer Option C — Phase C.2 (G2): canonical writer for public.cop_timeline_events.
//
// Per Decision Layer Option C G2 (CQ4 v2 + RC4): all writes to cop_timeline_events MUST
// route through this module. The CI guard at scripts/check-cop-timeline-writer-discipline.mjs
// enforces this by failing CI on any direct `.from('cop_timeline_events').(insert|upsert|update|delete)`
// outside this file.
//
// DEFENSE IN DEPTH (three layers):
//   1. DB parent  — C.0 trigger on investigation_workspaces (chain consistency)
//   2. DB child   — C.1 trigger on cop_timeline_events (workspace-tenant match enforcement)
//   3. Application — this helper + the RC4 CI guard
//
// The C.1 trigger already auto-fills tenant_id from investigation_workspaces.tenant_id when
// the writer omits it. This helper makes that resolution explicit in application code so:
//   - workspace-lookup failures surface here with a clear error code, before hitting the DB
//     and turning into an FK violation or NOT NULL violation
//   - tenant_id flow is visible to code readers
//   - future writers (when added to the allowlist) can be quickly audited against a single
//     pattern
//
// References:
//   docs/platform-operations/architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md
//   docs/platform-operations/decision-layer-c2-authorization-package-2026-05-30.md

import { supabase } from '@/integrations/supabase/client';

export type CopTimelineEventInput = {
  workspace_id: string;
  title: string;
  event_time: string; // ISO timestamp
  event_type:
    | 'signal'
    | 'incident'
    | 'task'
    | 'decision'
    | 'evidence'
    | 'entity'
    | 'general'
    | 'milestone';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  description?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  added_by_user_id?: string | null;
  added_by_agent_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CopTimelineEventResult =
  | { ok: true; event_id: string; tenant_id: string }
  | {
      ok: false;
      code: 'TENANT_LOOKUP_FAILED' | 'TENANT_NOT_RESOLVED' | 'INSERT_FAILED';
      error: string;
    };

/**
 * Insert one cop_timeline_events row using canonical tenant resolution.
 *
 * Flow:
 *   1. Call public.get_workspace_tenant_id(workspace_id) via RPC.
 *      Returns the canonical tenant_id, or raises if the workspace doesn't exist
 *      or has NULL tenant_id (impossible post-C.0 in steady state).
 *   2. Insert the event row with explicit tenant_id from the RPC result.
 *      The C.1 trigger validates the explicit-set against the workspace's canonical
 *      value and accepts because we pass the canonical value verbatim.
 *
 * Returns a discriminated union so callers handle errors explicitly. Never throws.
 *
 * Caller-supplied tenant_id is intentionally NOT part of the input type — the canonical
 * tenant is always derived from the workspace. A caller cannot supply a tenant_id even
 * via type-system escapes; the function reads it only from the RPC result.
 */
export async function writeCopTimelineEvent(
  input: CopTimelineEventInput,
): Promise<CopTimelineEventResult> {
  // Step 1: resolve canonical tenant_id from workspace.
  const { data: tenant_id, error: tenantError } = await supabase.rpc('get_workspace_tenant_id', {
    p_workspace_id: input.workspace_id,
  });

  if (tenantError) {
    return {
      ok: false,
      code: 'TENANT_LOOKUP_FAILED',
      error: `get_workspace_tenant_id failed: ${tenantError.message}`,
    };
  }
  if (!tenant_id) {
    return {
      ok: false,
      code: 'TENANT_NOT_RESOLVED',
      error: `Workspace ${input.workspace_id} returned no tenant_id from RPC`,
    };
  }

  // Step 2: insert with explicit tenant_id.
  const { data: inserted, error: insertError } = await supabase
    .from('cop_timeline_events')
    .insert({
      ...input,
      tenant_id,
    })
    .select('id')
    .single();

  if (insertError) {
    return {
      ok: false,
      code: 'INSERT_FAILED',
      error: insertError.message,
    };
  }

  return { ok: true, event_id: inserted.id, tenant_id };
}
