/**
 * execute-approved-action
 *
 * Called when an analyst clicks Approve on an entry in the
 * agent_actions_awaiting_approval queue. Loads the action row, validates
 * status, executes per action_type, marks the row 'executed' or 'failed'.
 *
 * Permission model (WO-INBOUND-WEBHOOK-UNSIGNED, 2026-09-11 — ENFORCED here, was not before):
 *   - The docstring PREVIOUSLY claimed "verify_jwt=true … role checked by the gateway" and trusted
 *     body.approver_user_id. NONE of that was true: config + deployed verify_jwt were FALSE, there was
 *     no in-function auth at all, and the approver id came from the (forgeable) request body. Anyone
 *     with the URL could approve/execute or reject ANY pending agent action and forge the approver.
 *   - Now: gateway verify_jwt=true (config) + in-function getCallerIdentity (fail-closed 401), the
 *     approver identity is DERIVED FROM THE TOKEN (not the body), and a user caller must hold an
 *     approver role (super_admin/admin/analyst) AND have access to the action's client. Trusted
 *     service_role callers bypass the user checks.
 *   - Action must be status='awaiting_approval'; the executed payload is the STORED action_payload.
 *
 * Per-action executors live below. Adding a new propose-tier action means
 * adding a case here; the queue page UI is generic.
 */

import { createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity, getAccessibleClientIds } from "../_shared/supabase-client.ts";

const APPROVER_ROLES = new Set(["super_admin", "admin", "analyst"]);

interface ExecuteInput {
  action_id: string;
  approver_user_id: string;
  decision: 'approve' | 'reject';
  rejection_reason?: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  try {
    // WO-INBOUND-WEBHOOK-UNSIGNED: authenticate BEFORE loading or mutating anything. Fail closed.
    const caller = await getCallerIdentity(req);
    if (caller.kind === 'unauthorized') {
      return errorResponse(caller.error || 'authentication required', caller.status || 401);
    }

    const body = await req.json().catch(() => ({})) as ExecuteInput;
    if (!body?.action_id || !body?.decision) {
      return errorResponse('action_id and decision are required', 400);
    }
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return errorResponse('decision must be approve or reject', 400);
    }
    // Approver identity is DERIVED FROM THE TOKEN, never the request body (kills forged attribution).
    // approved_by/rejected_by are nullable uuid — a service_role caller may pass an explicit uuid, but
    // a non-uuid/absent value falls back to NULL (never the literal 'service_role', which would fail
    // the uuid column). WO finding E.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const approverId: string | null = caller.kind === 'user'
      ? caller.userId
      : (typeof body.approver_user_id === 'string' && UUID_RE.test(body.approver_user_id) ? body.approver_user_id : null);

    // 1. Load the action
    const { data: action, error: loadError } = await supabase
      .from('agent_actions')
      .select('*')
      .eq('id', body.action_id)
      .maybeSingle();
    if (loadError || !action) return errorResponse('Action not found', 404);
    if (action.status !== 'awaiting_approval') {
      return errorResponse(`Action is in status='${action.status}', cannot ${body.decision}`, 409);
    }

    // WO-INBOUND-WEBHOOK-UNSIGNED authorization — user callers must hold an approver role AND have
    // access to the action's client. service_role callers are trusted internal and bypass.
    if (caller.kind === 'user') {
      const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', caller.userId);
      const roles = (roleRows ?? []).map((r: any) => r.role as string);
      if (!roles.some((r) => APPROVER_ROLES.has(r))) {
        return errorResponse('Forbidden: approver role (super_admin/admin/analyst) required', 403);
      }
      if (action.client_id) {
        // client-scoped action → caller must have access to that client (same standard as send-sms).
        const accessible = await getAccessibleClientIds(supabase, caller.userId);
        if (!accessible.includes(action.client_id)) {
          return errorResponse("Forbidden: no access to this action's client", 403);
        }
      } else {
        // WO finding D: a NULL-client action is platform/global-scoped (agents often emit these). It is
        // bound to no tenant, so a tenant-scoped analyst must NOT approve/execute it — do NOT skip the
        // check; require super_admin. Enforcing (not skipping) is the whole point.
        if (!roles.includes('super_admin')) {
          return errorResponse('Forbidden: null-client (platform-scoped) action requires super_admin', 403);
        }
      }
    }

    // 2. Reject path — WO race fix (#2): CONDITIONAL compare-and-swap. Only the transition FROM
    // awaiting_approval succeeds; a concurrent decision / double-click changes 0 rows → 409, never twice.
    if (body.decision === 'reject') {
      const { data: rejRows, error: rejErr } = await supabase.from('agent_actions').update({
        status: 'rejected',
        rejected_by: approverId,
        rejected_at: new Date().toISOString(),
        rejection_reason: (body.rejection_reason || '').substring(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', body.action_id).eq('status', 'awaiting_approval').select('id');
      if (rejErr) return errorResponse(`Failed to reject action: ${rejErr.message}`, 500);
      if (!rejRows || rejRows.length !== 1) return errorResponse('Action already processed (concurrent decision)', 409);
      return successResponse({ status: 'rejected', action_id: body.action_id });
    }

    // 3. Approve path — WO race fix (#2): CAS the transition on (id AND status='awaiting_approval');
    // exactly ONE row must change, or another approver already claimed it (409, do NOT execute twice).
    // This is the atomic lock — the prior "update by id only" let two approvers each execute.
    const { data: apprRows, error: apprErr } = await supabase.from('agent_actions').update({
      status: 'approved',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', body.action_id).eq('status', 'awaiting_approval').select('id');
    if (apprErr) return errorResponse(`Failed to mark action approved: ${apprErr.message}`, 500);
    if (!apprRows || apprRows.length !== 1) return errorResponse('Action already processed (concurrent approval)', 409);

    let result: unknown = null;
    let executionStatus: 'executed' | 'failed' = 'executed';
    let errorMsg: string | null = null;
    try {
      switch (action.action_type) {
        case 'propose_severity_correction':
          // WO finding #1: bind the payload target to the action's authorized client scope.
          result = await executeSeverityCorrection(supabase, action.action_payload, action.client_id);
          break;
        case 'notify_oncall_via_slack':
          result = await executeOncallSlackNotify(action.action_payload);
          break;
        default:
          // For unknown propose-tier types we record approval but don't have
          // an executor. The action stays approved but not executed; the
          // analyst gets visibility this happened. Adding more cases is the
          // correct response.
          result = { note: `No executor registered for action_type='${action.action_type}'. Recorded approval only.` };
          break;
      }
    } catch (e: any) {
      executionStatus = 'failed';
      errorMsg = e?.message || String(e);
      result = { error: errorMsg };
    }

    await supabase.from('agent_actions').update({
      status: executionStatus,
      executed_at: new Date().toISOString(),
      execution_result: typeof result === 'object' && result !== null ? result as Record<string, unknown> : { value: result },
      updated_at: new Date().toISOString(),
    }).eq('id', body.action_id);

    return successResponse({
      status: executionStatus,
      action_id: body.action_id,
      result,
      error: errorMsg,
    });
  } catch (error) {
    console.error('[execute-approved-action] Fatal:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// ── Executors ──────────────────────────────────────────────────────────────

async function executeSeverityCorrection(supabase: any, payload: any, actionClientId: string | null) {
  const signalId = payload?.signal_id;
  const proposedSeverity = payload?.proposed_severity;
  const evidence = payload?.evidence ?? '';
  if (!signalId || !proposedSeverity) {
    throw new Error('signal_id and proposed_severity required in payload');
  }
  if (!['low', 'medium', 'high', 'critical'].includes(proposedSeverity)) {
    throw new Error(`Invalid severity '${proposedSeverity}'`);
  }
  // WO finding #1 — PAYLOAD-SCOPE BINDING (cross-tenant write prevention). The approver was authorized
  // against action.client_id, NOT against payload.signal_id. The fleet generates these payloads and we
  // have already found contaminated ones, so a payload pointing at another client's signal must be
  // refused even though the ACTION passed authorization. A signal write must be client-scoped.
  if (!actionClientId) {
    throw new Error('refused: signal-targeting action has null client_id — must be client-scoped');
  }
  const { data: sig, error: sigErr } = await supabase
    .from('signals').select('id, client_id').eq('id', signalId).maybeSingle();
  if (sigErr) throw new Error(`target signal lookup failed: ${sigErr.message}`);
  if (!sig) throw new Error(`target signal ${signalId} not found`);
  if (sig.client_id !== actionClientId) {
    throw new Error(`refused cross-tenant payload: signal ${signalId} belongs to client ${sig.client_id}, action scoped to ${actionClientId}`);
  }
  const severityScore = proposedSeverity === 'critical' ? 90
                      : proposedSeverity === 'high' ? 70
                      : proposedSeverity === 'medium' ? 40 : 20;
  const { data, error } = await supabase
    .from('signals')
    .update({
      severity: proposedSeverity,
      severity_score: severityScore,
      triage_override: 'agent_proposed',
    })
    .eq('id', signalId)
    .eq('client_id', actionClientId)  // belt-and-suspenders: physically cannot touch another client's signal
    .select('id, severity, severity_score')
    .single();
  if (error) throw new Error(`Update failed: ${error.message}`);
  return { updated: data, evidence };
}

async function executeOncallSlackNotify(payload: any) {
  const message = (payload?.message || '').toString().substring(0, 1000);
  const urgency = payload?.urgency ?? 'medium';
  const webhookUrl = Deno.env.get('SLACK_ONCALL_WEBHOOK_URL');
  if (!webhookUrl) {
    return { skipped: true, note: 'SLACK_ONCALL_WEBHOOK_URL not configured. Action approved but no message sent.' };
  }
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `:rotating_light: *Fortress AI oncall page* (urgency: ${urgency})\n${message}`,
    }),
  });
  if (!resp.ok) throw new Error(`Slack webhook returned ${resp.status}: ${await resp.text()}`);
  return { sent: true, urgency };
}
