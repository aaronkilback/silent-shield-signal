import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, policy_area, audit_period_days = 90 } = await req.json();
    console.log('Auditing compliance status for client:', client_id, 'policy area:', policy_area);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // GEMINI_API_KEY handled by callAiGateway

    // Fetch client data
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      throw new Error('Client not found');
    }

    // Calculate audit period start date
    const auditStartDate = new Date();
    auditStartDate.setDate(auditStartDate.getDate() - audit_period_days);

    // Fetch incident data for the audit period
    const { data: incidents } = await supabase
      .from('incidents')
      .select('*')
      .eq('client_id', client_id)
      .gte('created_at', auditStartDate.toISOString())
      .order('created_at', { ascending: false });

    // Fetch signal data for the audit period
    const { data: signals } = await supabase
      .from('signals')
      .select('*')
      .eq('client_id', client_id)
      .gte('detected_at', auditStartDate.toISOString())
      .order('detected_at', { ascending: false });

    // Fetch incident outcomes for compliance analysis
    const { data: outcomes } = await supabase
      .from('incident_outcomes')
      .select(`
        *,
        incidents!inner (client_id, created_at)
      `)
      .eq('incidents.client_id', client_id)
      .gte('incidents.created_at', auditStartDate.toISOString());

    // Fetch active escalation rules (compliance controls)
    const { data: escalationRules } = await supabase
      .from('escalation_rules')
      .select('*')
      .eq('is_active', true);

    // Fetch entity monitoring data
    const { data: entityMentions } = await supabase
      .from('entity_mentions')
      .select('*')
      .gte('detected_at', auditStartDate.toISOString())
      .limit(100);

    const auditPrompt = `
You are a compliance auditor conducting an automated compliance status audit for a specific policy area.

CLIENT PROFILE:
- Name: ${client.name}
- Industry: ${client.industry || 'Unknown'}
- Risk Assessment: ${JSON.stringify(client.risk_assessment || {})}

POLICY AREA: ${policy_area}
AUDIT PERIOD: Last ${audit_period_days} days

OPERATIONAL DATA:
- Total Incidents: ${incidents?.length || 0}
- Open Incidents: ${incidents?.filter(i => i.status === 'open').length || 0}
- Total Signals: ${signals?.length || 0}
- Incident Outcomes Documented: ${outcomes?.length || 0}
- Active Escalation Rules: ${escalationRules?.length || 0}
- Entity Mentions Tracked: ${entityMentions?.length || 0}

TASK:
Conduct a comprehensive compliance audit for the specified policy area. Provide:

1. COMPLIANCE POSTURE ASSESSMENT:
   - Overall compliance score (0-100)
   - Compliance trend (Improving/Stable/Declining)
   - Critical compliance issues identified

2. POLICY-SPECIFIC AUDIT FINDINGS:
   
   Based on policy area (${policy_area}), assess:
   
   A. INCIDENT MANAGEMENT COMPLIANCE:
      - Incident response timeliness
      - Documentation completeness
      - Escalation procedure adherence
      - SLA compliance
   
   B. DETECTION & MONITORING COMPLIANCE:
      - Monitoring coverage adequacy
      - Threat detection effectiveness
      - Alert response procedures
      - False positive rates
   
   C. DATA PROTECTION & PRIVACY:
      - Data handling procedures
      - Access control compliance
      - Privacy incident handling
      - Breach notification readiness
   
   D. PHYSICAL SECURITY COMPLIANCE:
      - Access control enforcement
      - Facility security standards
      - Visitor management
      - Emergency response procedures

3. NON-COMPLIANCE INDICATORS:
   - Specific violations or gaps identified
   - Severity classification (Critical/High/Medium/Low)
   - Root cause analysis
   - Frequency/patterns of non-compliance

4. METRICS & KPIs:
   - Incident response time compliance
   - SLA achievement rates
   - Control effectiveness scores
   - Audit trail completeness

5. COMPLIANCE GAPS & REMEDIATION:
   For each identified gap:
   - Specific non-compliance issue
   - Regulatory/policy reference
   - Recommended remediation action
   - Priority (Immediate/30-day/90-day)
   - Responsible party

6. AUDIT RECOMMENDATIONS:
   - Immediate corrective actions required
   - Process improvements needed
   - Training/awareness gaps
   - Technology/tool enhancements
   - Follow-up audit requirements

7. EXECUTIVE SUMMARY:
   - Key findings
   - Critical issues requiring immediate attention
   - Overall compliance rating
   - Next audit date recommendation

Provide evidence-based findings derived from the operational data provided.`;

    const aiResult = await callAiGateway({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are an expert compliance auditor specializing in security and operational compliance assessments.' },
        { role: 'user', content: auditPrompt }
      ],
      functionName: 'audit-compliance-status',
      dlqOnFailure: true,
      dlqPayload: { client_id, policy_area },
    });

    if (aiResult.error) {
      throw new Error('AI Gateway error');
    }

    const auditReport = aiResult.content;

    if (!auditReport) {
      throw new Error('No audit report generated');
    }

    console.log('Compliance audit completed');

    return new Response(
      JSON.stringify({ 
        client_id,
        policy_area,
        audit_period_days,
        audit_report: auditReport,
        audited_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in audit-compliance-status:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
