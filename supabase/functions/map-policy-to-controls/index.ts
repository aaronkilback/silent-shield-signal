import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, policy_document_content, policy_name } = await req.json();
    console.log('Mapping policy to controls for client:', client_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Fetch client configuration to understand current controls
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      throw new Error('Client not found');
    }

    // Fetch escalation rules as proxy for automated controls
    const { data: escalationRules } = await supabase
      .from('escalation_rules')
      .select('*')
      .eq('is_active', true);

    // Fetch monitoring configuration
    const { data: sources } = await supabase
      .from('sources')
      .select('*')
      .eq('status', 'active');

    const mappingPrompt = `
You are a compliance analyst mapping security policy requirements to implemented technical and procedural controls.

POLICY DOCUMENT:
Name: ${policy_name}
Content:
${policy_document_content}

CURRENT CLIENT CONFIGURATION:
- Industry: ${client.industry || 'Unknown'}
- Monitoring Config: ${JSON.stringify(client.monitoring_config || {})}
- Active Escalation Rules: ${escalationRules?.length || 0}
- Active Monitoring Sources: ${sources?.length || 0}

TASK:
Analyze the policy document and map each policy requirement to existing or missing controls. Provide:

1. POLICY REQUIREMENTS EXTRACTION:
   - List all explicit security requirements from the policy
   - Categorize by control type (technical, procedural, administrative)
   - Identify compliance-critical vs. best-practice requirements

2. CONTROL MAPPING:
   For each policy requirement, identify:
   
   A. EXISTING CONTROLS:
      - Technical controls (access controls, monitoring, encryption, etc.)
      - Physical controls (facility security, access systems)
      - Administrative controls (policies, procedures, training)
      - Confidence level in control adequacy (High/Medium/Low)
   
   B. CONTROL GAPS:
      - Requirements without corresponding controls
      - Partially implemented controls
      - Controls requiring enhancement
      - Gap severity (Critical/High/Medium/Low)

3. GAP ANALYSIS:
   - Total policy requirements identified
   - Percentage of requirements with adequate controls
   - Critical gaps requiring immediate attention
   - Medium-priority gaps for planning

4. REMEDIATION ROADMAP:
   For each identified gap:
   - Specific control to implement
   - Implementation complexity (Low/Medium/High)
   - Estimated timeline
   - Resource requirements
   - Compliance impact if not addressed

5. COMPLIANCE RISK ASSESSMENT:
   - Overall compliance posture (Strong/Adequate/Weak)
   - Highest-risk gap areas
   - Regulatory exposure
   - Recommended audit priorities

6. CONTINUOUS MONITORING RECOMMENDATIONS:
   - Controls requiring ongoing monitoring
   - Audit/review cadence
   - Effectiveness metrics

Provide a clear, actionable compliance gap analysis that enables prioritized remediation planning.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert compliance analyst specializing in security control mapping and gap analysis.' },
          { role: 'user', content: mappingPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const mapping = data.choices?.[0]?.message?.content;

    if (!mapping) {
      throw new Error('No mapping generated');
    }

    console.log('Policy-to-control mapping completed');

    return new Response(
      JSON.stringify({ 
        client_id,
        policy_name,
        control_mapping: mapping,
        analyzed_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in map-policy-to-controls:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
