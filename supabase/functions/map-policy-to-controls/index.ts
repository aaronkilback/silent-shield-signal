import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { client_id, policy_document_content, policy_name } = await req.json();
    console.log('Mapping policy to controls for client:', client_id);

    const supabase = createServiceClient();

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

    const result = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are an expert compliance analyst specializing in security control mapping and gap analysis.' },
        { role: 'user', content: mappingPrompt }
      ],
      functionName: 'map-policy-to-controls',
      dlqOnFailure: true,
      dlqPayload: { client_id, policy_name },
    });

    if (result.error) {
      throw new Error(result.error);
    }

    console.log('Policy-to-control mapping completed');

    return successResponse({ 
      client_id,
      policy_name,
      control_mapping: result.content,
      analyzed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in map-policy-to-controls:', error);
    await logError(error, { functionName: 'map-policy-to-controls', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
