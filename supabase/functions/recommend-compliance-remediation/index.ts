import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { client_id, compliance_gap_description, risk_score } = await req.json();
    console.log('Recommending compliance remediation for client:', client_id);

    const supabase = createServiceClient();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Fetch client data
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      throw new Error('Client not found');
    }

    const remediationPrompt = `
You are a compliance remediation specialist designing actionable plans to close identified compliance gaps.

CLIENT PROFILE:
- Name: ${client.name}
- Industry: ${client.industry || 'Unknown'}
- Current Risk Assessment: ${JSON.stringify(client.risk_assessment || {})}

COMPLIANCE GAP:
${compliance_gap_description}

RISK SCORE: ${risk_score || 'Not specified'}

TASK:
Design a comprehensive remediation plan to close this compliance gap. Provide:

1. GAP ANALYSIS:
   - Root cause of the compliance gap
   - Regulatory/policy requirement not being met
   - Potential consequences if unaddressed
   - Timeline urgency (Immediate/30-day/90-day)

2. REMEDIATION STRATEGY:
   - Primary remediation approach
   - Alternative approaches (if applicable)
   - Expected outcomes

3. DETAILED REMEDIATION PLAN:
   
   A. TECHNICAL CONTROLS:
      - Specific technologies/tools to implement
      - Configuration/deployment requirements
      - Integration considerations
   
   B. PROCEDURAL CONTROLS:
      - Process changes required
      - Policy updates needed
      - Documentation requirements
   
   C. ADMINISTRATIVE CONTROLS:
      - Roles and responsibilities
      - Training requirements
      - Awareness programs
   
   D. MONITORING & ENFORCEMENT:
      - Compliance monitoring mechanisms
      - Audit/review procedures
      - Enforcement protocols

4. IMPLEMENTATION ROADMAP:
   - Phase 1: Immediate actions (0-30 days)
   - Phase 2: Strategic implementation (30-90 days)
   - Phase 3: Optimization & validation (90-180 days)
   
   For each phase:
   - Specific tasks/milestones
   - Responsible parties
   - Dependencies
   - Success criteria

5. RESOURCE REQUIREMENTS:
   - Budget estimate
   - Personnel requirements (internal/external)
   - Technology/infrastructure needs
   - Training/communication resources

6. RISK MITIGATION:
   - Implementation risks
   - Mitigation strategies
   - Contingency plans

7. VALIDATION & EFFECTIVENESS:
   - Compliance metrics to track
   - Testing/validation procedures
   - Audit/certification requirements
   - Continuous improvement mechanisms

8. EXECUTIVE SUMMARY:
   - Recommended approach
   - Timeline and budget
   - Expected compliance outcome
   - Risk reduction impact

Provide a practical, implementable remediation plan prioritized by risk reduction impact.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert compliance remediation specialist designing actionable plans to close compliance gaps and reduce regulatory risk.' },
          { role: 'user', content: remediationPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const remediationPlan = data.choices?.[0]?.message?.content;

    if (!remediationPlan) {
      throw new Error('No remediation plan generated');
    }

    console.log('Compliance remediation plan generated');

    return successResponse({ 
      client_id,
      compliance_gap: compliance_gap_description,
      risk_score,
      remediation_plan: remediationPlan,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in recommend-compliance-remediation:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
