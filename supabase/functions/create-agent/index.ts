import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateAgentRequest {
  codename: string;
  call_sign: string;
  persona: string;
  specialty: string;
  mission_scope: string;
  interaction_style?: string;
  input_sources?: string[];
  output_types?: string[];
  is_client_facing?: boolean;
  is_active?: boolean;
  avatar_color?: string;
  system_prompt?: string;
  roe_id?: string;
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

    const requestData: CreateAgentRequest = await req.json();

    // Validate required fields
    const requiredFields = ['codename', 'call_sign', 'persona', 'specialty', 'mission_scope'];
    const missingFields = requiredFields.filter(field => !requestData[field as keyof CreateAgentRequest]);
    
    if (missingFields.length > 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing required fields', 
          missing: missingFields,
          required: requiredFields 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if agent with same codename or call_sign already exists
    const { data: existingAgent, error: checkError } = await supabase
      .from('ai_agents')
      .select('id, codename, call_sign')
      .or(`codename.eq.${requestData.codename},call_sign.eq.${requestData.call_sign}`)
      .limit(1);

    if (checkError) {
      console.error('Error checking existing agent:', checkError);
      return new Response(
        JSON.stringify({ error: 'Failed to check for existing agent', details: checkError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (existingAgent && existingAgent.length > 0) {
      const conflict = existingAgent[0];

      // Idempotency: treat "already exists" as a successful outcome so callers don't get blocked
      // by non-2xx responses when retrying agent provisioning.
      return new Response(
        JSON.stringify({
          success: true,
          already_exists: true,
          agent: {
            id: conflict.id,
            codename: conflict.codename,
            call_sign: conflict.call_sign,
          },
          message: `Agent already exists: "${conflict.codename}" (${conflict.call_sign}). Use update_agent_configuration to modify it, or choose a different codename/call_sign to create a new agent.`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare agent data with defaults
    const agentData = {
      codename: requestData.codename,
      call_sign: requestData.call_sign,
      persona: requestData.persona,
      specialty: requestData.specialty,
      mission_scope: requestData.mission_scope,
      interaction_style: requestData.interaction_style || 'chat',
      input_sources: requestData.input_sources || ['signals', 'incidents', 'entities'],
      output_types: requestData.output_types || ['analysis', 'recommendations'],
      is_client_facing: requestData.is_client_facing ?? false,
      is_active: requestData.is_active ?? true,
      avatar_color: requestData.avatar_color || generateRandomColor(),
      system_prompt: requestData.system_prompt || generateDefaultSystemPrompt(requestData),
      roe_id: requestData.roe_id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Create the agent
    const { data: newAgent, error: createError } = await supabase
      .from('ai_agents')
      .insert(agentData)
      .select()
      .single();

    if (createError) {
      console.error('Error creating agent:', createError);
      return new Response(
        JSON.stringify({ error: 'Failed to create agent', details: createError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create audit log entry
    const auditKey = `agent_creation_${newAgent.id}_${Date.now()}`;
    await supabase
      .from('intelligence_config')
      .upsert({
        key: auditKey,
        value: {
          action: 'agent_created',
          agent_id: newAgent.id,
          agent_codename: newAgent.codename,
          agent_call_sign: newAgent.call_sign,
          configuration: agentData,
          requested_by: requestData.requested_by || 'system',
          timestamp: new Date().toISOString()
        },
        description: `New agent created: ${newAgent.codename} (${newAgent.call_sign})`,
        updated_at: new Date().toISOString()
      });

    console.log(`[AUDIT] New agent created: ${newAgent.codename} (${newAgent.call_sign}) - ID: ${newAgent.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Agent "${newAgent.codename}" (${newAgent.call_sign}) created successfully`,
        agent: newAgent,
        audit_key: auditKey
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in create-agent:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function generateRandomColor(): string {
  const colors = [
    '#3B82F6', // blue
    '#10B981', // emerald
    '#8B5CF6', // violet
    '#F59E0B', // amber
    '#EF4444', // red
    '#EC4899', // pink
    '#06B6D4', // cyan
    '#84CC16', // lime
    '#F97316', // orange
    '#6366F1', // indigo
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function generateDefaultSystemPrompt(config: CreateAgentRequest): string {
  return `You are ${config.codename}, callsign ${config.call_sign}.

PERSONA: ${config.persona}

SPECIALTY: ${config.specialty}

MISSION SCOPE: ${config.mission_scope}

OPERATIONAL GUIDELINES:
- Maintain professional communication at all times
- Provide accurate, actionable intelligence
- Cite sources and evidence when making assessments
- Escalate critical findings appropriately
- Protect sensitive information

INPUT SOURCES: ${(config.input_sources || ['signals', 'incidents', 'entities']).join(', ')}

OUTPUT TYPES: ${(config.output_types || ['analysis', 'recommendations']).join(', ')}

Always identify yourself by your callsign when communicating. Prioritize mission objectives while adhering to established rules of engagement.`;
}
