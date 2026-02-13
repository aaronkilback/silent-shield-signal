import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

interface ClientPolicyRequest {
  client_id?: string;
  client_name?: string;
  policy_name?: string;
  policy_type?: 'security' | 'hr' | 'operational' | 'safety' | 'a&d' | 'all';
  analysis_type?: 'summary' | 'compliance_check' | 'gap_analysis' | 'full';
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    const { 
      client_id,
      client_name,
      policy_name,
      policy_type = 'all',
      analysis_type = 'summary'
    } = await req.json();

    if (!client_id && !client_name) {
      return errorResponse('Either client_id or client_name is required', 400);
    }

    // Fetch client information
    let clientQuery = supabase.from('clients').select('*');
    if (client_id) {
      clientQuery = clientQuery.eq('id', client_id);
    } else if (client_name) {
      clientQuery = clientQuery.ilike('name', `%${client_name}%`);
    }
    
    const { data: clients, error: clientError } = await clientQuery.limit(1);
    
    if (clientError || !clients || clients.length === 0) {
      return errorResponse(`Client not found: ${clientError?.message}`, 404);
    }

    const client = clients[0];

    // Fetch client documents/policies from archival_documents
    let docsQuery = supabase
      .from('archival_documents')
      .select('id, filename, summary, content_text, tags, keywords, metadata, date_of_document, created_at')
      .eq('client_id', client.id);

    if (policy_name) {
      docsQuery = docsQuery.or(`filename.ilike.%${policy_name}%,summary.ilike.%${policy_name}%`);
    }

    if (policy_type !== 'all') {
      docsQuery = docsQuery.or(`tags.cs.{${policy_type}},filename.ilike.%${policy_type}%`);
    }

    const { data: documents } = await docsQuery.order('created_at', { ascending: false });

    // Also check for any policies stored in onboarding_data or monitoring_config
    const clientPolicies = {
      from_onboarding: (client.onboarding_data as Record<string, unknown>)?.policies || {},
      monitoring_config: client.monitoring_config || {},
      high_value_assets: client.high_value_assets || [],
      threat_profile: client.threat_profile || {},
      risk_assessment: client.risk_assessment || {},
    };

    // Build analysis prompt
    const analysisPrompt = `You are a policy analysis expert reviewing client policies for a security services company.

Client Information:
- Name: ${client.name}
- Industry: ${client.industry || 'Not specified'}
- Locations: ${client.locations?.join(', ') || 'Not specified'}
- Employee Count: ${client.employee_count || 'Not specified'}

Policy Request:
- Specific Policy: ${policy_name || 'All policies'}
- Policy Type Filter: ${policy_type}
- Analysis Type: ${analysis_type}

Client Configuration Data:
${JSON.stringify(clientPolicies, null, 2)}

Documents Found (${documents?.length || 0}):
${documents && documents.length > 0 
  ? documents.map(doc => `
Document: ${doc.filename}
Summary: ${doc.summary || 'No summary available'}
Tags: ${doc.tags?.join(', ') || 'None'}
Keywords: ${doc.keywords?.join(', ') || 'None'}
Date: ${doc.date_of_document || doc.created_at}
Content Preview: ${doc.content_text?.substring(0, 500) || 'No content'}
---`).join('\n')
  : 'No policy documents found for this client.'}

Please provide ${analysis_type === 'summary' ? 'a summary' : 
               analysis_type === 'compliance_check' ? 'a compliance assessment' :
               analysis_type === 'gap_analysis' ? 'a gap analysis' : 
               'a comprehensive analysis'} including:

${analysis_type === 'summary' ? `
1. **Policy Overview**: Summary of all identified policies
2. **Key Policy Areas**: Main areas covered
3. **Notable Provisions**: Important clauses or requirements
4. **Recommendations**: Suggested focus areas
` : ''}

${analysis_type === 'compliance_check' ? `
1. **Regulatory Compliance**: Assessment against applicable regulations
2. **Industry Standards**: Alignment with industry best practices
3. **Gap Identification**: Areas where policies may be insufficient
4. **Risk Assessment**: Potential compliance risks
5. **Remediation Priorities**: Recommended actions
` : ''}

${analysis_type === 'gap_analysis' ? `
1. **Current State**: What policies exist and cover
2. **Required State**: What policies should exist based on industry/regulations
3. **Gaps Identified**: Missing or incomplete policies
4. **Priority Matrix**: Urgency and importance of addressing gaps
5. **Implementation Roadmap**: Steps to close gaps
` : ''}

${analysis_type === 'full' ? `
1. **Complete Policy Inventory**
2. **Detailed Analysis of Each Policy**
3. **Compliance Assessment**
4. **Gap Analysis**
5. **Risk Evaluation**
6. **Recommendations and Roadmap**
` : ''}

Format as structured JSON:
{
  "client": {
    "name": "string",
    "industry": "string",
    "policy_maturity": "basic|developing|mature|advanced"
  },
  "policies_found": [
    {
      "name": "string",
      "type": "string",
      "status": "current|outdated|draft",
      "summary": "string",
      "key_provisions": ["string"],
      "last_updated": "string"
    }
  ],
  "analysis": {
    "strengths": ["string"],
    "weaknesses": ["string"],
    "opportunities": ["string"],
    "threats": ["string"]
  },
  "compliance_status": {
    "overall_score": "number (0-100)",
    "by_area": [{"area": "string", "score": "number", "notes": "string"}]
  },
  "gaps": [
    {
      "area": "string",
      "description": "string",
      "priority": "critical|high|medium|low",
      "recommendation": "string"
    }
  ],
  "recommendations": [
    {
      "action": "string",
      "priority": "string",
      "timeline": "string",
      "resources_needed": "string"
    }
  ]
}`;

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-pro',
      messages: [
        { role: 'system', content: 'You are a policy analysis expert specializing in security, HR, and operational policies. Provide thorough, actionable analysis while maintaining confidentiality.' },
        { role: 'user', content: analysisPrompt }
      ],
      functionName: 'review-client-policy',
      dlqOnFailure: true,
      dlqPayload: { client_id: client.id, policy_type, analysis_type },
      extraBody: { temperature: 0.3, max_tokens: 4000 },
    });

    const responseContent = aiResult.content;

    // Parse response
    let analysisResults;
    try {
      const jsonMatch = responseContent.match(/```json\n?([\s\S]*?)\n?```/) || 
                        responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResults = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        analysisResults = { raw_response: responseContent };
      }
    } catch {
      analysisResults = { raw_response: responseContent };
    }

    return successResponse({
      success: true,
      client: {
        id: client.id,
        name: client.name,
        industry: client.industry,
      },
      request: { policy_name, policy_type, analysis_type },
      documents_found: documents?.length || 0,
      document_list: documents?.map(d => ({ 
        id: d.id, 
        filename: d.filename, 
        summary: d.summary,
        tags: d.tags 
      })) || [],
      policy_analysis: analysisResults,
      reviewed_at: new Date().toISOString(),
      disclaimer: 'This analysis is based on available documentation and should be verified against current client policies. Recommendations should be validated with appropriate stakeholders.'
    });

  } catch (error) {
    console.error('Error in review-client-policy:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
