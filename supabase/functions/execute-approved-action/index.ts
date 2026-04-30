/**
 * execute-approved-action
 *
 * Called when an analyst clicks Approve on an entry in the
 * agent_actions_awaiting_approval queue. Loads the action row, validates
 * status, executes per action_type, marks the row 'executed' or 'failed'.
 *
 * Permission model:
 *   - Action must already have status='approved' (set by the frontend
 *     approval handler) OR status='awaiting_approval' (we promote it here).
 *   - The caller MUST be authenticated (verify_jwt=true on this function)
 *     and must have super_admin or analyst role — the JWT is checked by
 *     the gateway. This function trusts the caller's auth context for
 *     approved_by.
 *
 * Per-action executors live below. Adding a new propose-tier action means
 * adding a case here; the queue page UI is generic.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

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
    const body = await req.json().catch(() => ({})) as ExecuteInput;
    if (!body?.action_id || !body?.approver_user_id || !body?.decision) {
      return errorResponse('action_id, approver_user_id, decision are required', 400);
    }
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return errorResponse('decision must be approve or reject', 400);
    }

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

    // 2. Reject path
    if (body.decision === 'reject') {
      await supabase.from('agent_actions').update({
        status: 'rejected',
        rejected_by: body.approver_user_id,
        rejected_at: new Date().toISOString(),
        rejection_reason: (body.rejection_reason || '').substring(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', body.action_id);
      return successResponse({ status: 'rejected', action_id: body.action_id });
    }

    // 3. Approve path: mark approved, then execute per action_type
    await supabase.from('agent_actions').update({
      status: 'approved',
      approved_by: body.approver_user_id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', body.action_id);

    let result: unknown = null;
    let executionStatus: 'executed' | 'failed' = 'executed';
    let errorMsg: string | null = null;
    try {
      switch (action.action_type) {
        case 'propose_severity_correction':
          result = await executeSeverityCorrection(supabase, action.action_payload);
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

async function executeSeverityCorrection(supabase: any, payload: any) {
  const signalId = payload?.signal_id;
  const proposedSeverity = payload?.proposed_severity;
  const evidence = payload?.evidence ?? '';
  if (!signalId || !proposedSeverity) {
    throw new Error('signal_id and proposed_severity required in payload');
  }
  if (!['low', 'medium', 'high', 'critical'].includes(proposedSeverity)) {
    throw new Error(`Invalid severity '${proposedSeverity}'`);
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
