/**
 * Agent action executor with permission tiers.
 *
 * Used by the action tools registered in agent-tools-core.ts. Each action
 * type has a permission_tier that decides whether the action runs
 * immediately ('auto') or waits for analyst approval ('propose').
 *
 * The proposeAction() helper writes an agent_actions row in the appropriate
 * status. AUTO actions are executed inline and the row is updated to
 * 'executed' / 'failed'. PROPOSE actions land in 'awaiting_approval' for
 * an analyst to review (via the dashboard).
 *
 * Read-only actions are not exposed as tools at all — the registry in
 * agent-tools-core.ts simply does not register them.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type PermissionTier = 'auto' | 'propose' | 'readonly';

export interface ProposedAction {
  agentCallSign: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  rationale: string;
  permissionTier: PermissionTier;
  contextSignalId?: string;
  contextIncidentId?: string;
  /** Optional executor — if provided AND tier === 'auto', runs inline. */
  execute?: (payload: Record<string, unknown>) => Promise<unknown>;
}

export interface ProposeActionResult {
  action_id: string;
  status: string;
  permission_tier: PermissionTier;
  message: string;
  result?: unknown;
}

/**
 * Record (and possibly execute) an agent-initiated action.
 *
 * Behaviour by tier:
 *   - readonly: refuses, returns error.
 *   - propose:  writes row with status='awaiting_approval'. Analyst must
 *               approve before anything runs. Returns the action_id so the
 *               agent can reference it.
 *   - auto:     writes row with status='auto_executing', runs the executor
 *               inline if provided, updates row to 'executed'/'failed'.
 */
export async function proposeAction(
  supabase: SupabaseClient,
  input: ProposedAction,
): Promise<ProposeActionResult> {
  if (input.permissionTier === 'readonly') {
    throw new Error(`Action type '${input.actionType}' is readonly — agents cannot trigger it.`);
  }

  const initialStatus = input.permissionTier === 'auto' ? 'auto_executing' : 'awaiting_approval';
  const { data: row, error } = await supabase
    .from('agent_actions')
    .insert({
      agent_call_sign: input.agentCallSign,
      action_type: input.actionType,
      action_payload: input.actionPayload,
      permission_tier: input.permissionTier,
      status: initialStatus,
      rationale: input.rationale.substring(0, 1000),
      context_signal_id: input.contextSignalId ?? null,
      context_incident_id: input.contextIncidentId ?? null,
    })
    .select('id')
    .single();
  if (error || !row) throw new Error(`Failed to record action: ${error?.message || 'no row'}`);

  if (input.permissionTier === 'propose') {
    return {
      action_id: row.id,
      status: 'awaiting_approval',
      permission_tier: 'propose',
      message: 'Action proposed. Awaiting analyst approval before execution.',
    };
  }

  // AUTO: execute inline if executor provided, update row with result
  if (!input.execute) {
    // Auto without executor — record as executed with no-op
    await supabase.from('agent_actions').update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      execution_result: { note: 'auto-recorded with no executor' },
    }).eq('id', row.id);
    return { action_id: row.id, status: 'executed', permission_tier: 'auto', message: 'Action recorded (no executor).' };
  }
  try {
    const result = await input.execute(input.actionPayload);
    await supabase.from('agent_actions').update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      execution_result: typeof result === 'object' && result !== null ? result as Record<string, unknown> : { value: result },
    }).eq('id', row.id);
    return { action_id: row.id, status: 'executed', permission_tier: 'auto', message: 'Action executed.', result };
  } catch (e: any) {
    await supabase.from('agent_actions').update({
      status: 'failed',
      executed_at: new Date().toISOString(),
      execution_result: { error: e?.message || String(e) },
    }).eq('id', row.id);
    return { action_id: row.id, status: 'failed', permission_tier: 'auto', message: `Executor failed: ${e?.message || e}` };
  }
}
