import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { agent_id, updates, reason, requested_by }: AgentConfigUpdate = await req.json();

    if (!agent_id) {
      return new Response(
        JSON.stringify({ error: 'agent_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!updates || Object.keys(updates).length === 0) {
      return new Response(
        JSON.stringify({ error: 'updates object is required and must contain at least one field' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch current agent configuration for audit trail
    const { data: currentAgent, error: fetchError } = await supabase
      .from('ai_agents')
      .select('*')
      .eq('id', agent_id)
      .single();

    if (fetchError || !currentAgent) {
      return new Response(
        JSON.stringify({ error: `Agent not found: ${agent_id}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'No valid fields to update', allowed_fields: allowedFields }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'Failed to update agent', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    return new Response(
      JSON.stringify({
        success: true,
        message: `Agent "${updatedAgent.codename}" configuration updated successfully`,
        agent: updatedAgent,
        changes: changesLog,
        audit_key: auditKey
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in update-agent-configuration:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
