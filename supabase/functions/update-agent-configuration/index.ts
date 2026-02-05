import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface AgentConfigUpdate {
  agent_id: string;
  updates: {
    header_name?: string;
    codename?: string;
    call_sign?: string;
    persona?: string;
    specialty?: string;
    mission_scope?: string;
    interaction_style?: string;
    input_sources?: string[];
    output_types?: string[];
    is_client_facing?: boolean;
    is_active?: boolean;
    avatar_color?: string;
    system_prompt?: string;
  };
  reason?: string;
  requested_by?: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { agent_id, updates, reason, requested_by }: AgentConfigUpdate = await req.json();

    if (!agent_id) {
      return errorResponse('agent_id is required', 400);
    }

    if (!updates || Object.keys(updates).length === 0) {
      return errorResponse('updates object is required and must contain at least one field', 400);
    }

    const supabase = createServiceClient();

    // Fetch current agent configuration for audit trail
    const { data: currentAgent, error: fetchError } = await supabase
      .from('ai_agents')
      .select('*')
      .eq('id', agent_id)
      .single();

    if (fetchError || !currentAgent) {
      return errorResponse(`Agent not found: ${agent_id}`, 404);
    }

    // Allowed fields for update (safety filter)
    const allowedFields = [
      'codename', 'call_sign', 'persona', 'specialty', 'mission_scope',
      'interaction_style', 'input_sources', 'output_types', 
      'is_client_facing', 'is_active', 'avatar_color', 'system_prompt', 'header_name'
    ];

    const sanitizedUpdates: Record<string, any> = {};
    const changesLog: Record<string, { from: any; to: any }> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        sanitizedUpdates[key] = value;
        changesLog[key] = {
          from: currentAgent[key],
          to: value
        };
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return errorResponse(`No valid fields to update. Allowed fields: ${allowedFields.join(', ')}`, 400);
    }

    // Add updated_at timestamp
    sanitizedUpdates.updated_at = new Date().toISOString();

    // Perform the update
    const { data: updatedAgent, error: updateError } = await supabase
      .from('ai_agents')
      .update(sanitizedUpdates)
      .eq('id', agent_id)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      return errorResponse(`Failed to update agent: ${updateError.message}`, 500);
    }

    // Create audit log entry in intelligence_config
    const auditKey = `agent_config_audit_${agent_id}_${Date.now()}`;
    const auditEntry = {
      agent_id,
      agent_codename: currentAgent.codename,
      changes: changesLog,
      reason: reason || 'Configuration update via API',
      requested_by: requested_by || 'system',
      timestamp: new Date().toISOString(),
      previous_config: {
        codename: currentAgent.codename,
        call_sign: currentAgent.call_sign,
        persona: currentAgent.persona,
        specialty: currentAgent.specialty,
        mission_scope: currentAgent.mission_scope,
        input_sources: currentAgent.input_sources,
        output_types: currentAgent.output_types,
        system_prompt: currentAgent.system_prompt
      }
    };

    await supabase
      .from('intelligence_config')
      .upsert({
        key: auditKey,
        value: auditEntry,
        description: `Agent configuration change audit: ${currentAgent.codename}`,
        updated_at: new Date().toISOString()
      });

    console.log(`[AUDIT] Agent ${currentAgent.codename} (${agent_id}) configuration updated:`, changesLog);

    return successResponse({
      message: `Agent "${updatedAgent.codename}" configuration updated successfully`,
      agent: updatedAgent,
      changes: changesLog,
      audit_key: auditKey
    });

  } catch (error: unknown) {
    console.error('Error in update-agent-configuration:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Internal server error: ${message}`, 500);
  }
});
