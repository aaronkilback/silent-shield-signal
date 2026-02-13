import { handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { jurisdiction, industry_sector } = await req.json();
    console.log('[RegulatoryChanges] Monitoring for:', jurisdiction, industry_sector);

    // LOVABLE_API_KEY handled by callAiGateway

    const analysisPrompt = `You are a regulatory compliance analyst tracking security, privacy, and environmental regulations for a specific industry and jurisdiction.

JURISDICTION: ${jurisdiction || 'Canada (Federal, BC, Alberta)'}
INDUSTRY SECTOR: ${industry_sector || 'Energy/Critical Infrastructure'}

TASK:
Identify and analyze recent regulatory changes and upcoming requirements that impact security operations and compliance obligations. Provide:

1. RECENT REGULATORY CHANGES (Last 12 months):
   - Security & data protection regulations
   - Privacy laws (PIPEDA, provincial laws)
   - Environmental regulations affecting operations
   - Critical infrastructure protection requirements
   
   For each regulation:
   - Regulation name and reference
   - Effective date
   - Key security/privacy requirements
   - Compliance deadlines
   - Penalties for non-compliance

2. UPCOMING REGULATORY CHANGES (Next 12-24 months):
   - Proposed regulations in legislative process
   - Expected implementation timelines
   - Anticipated compliance requirements

3. INDUSTRY-SPECIFIC REQUIREMENTS:
   - Energy sector security standards
   - Pipeline protection regulations
   - Indigenous consultation requirements
   - Environmental monitoring mandates

4. CROSS-BORDER CONSIDERATIONS:
   - International data transfer restrictions
   - Multi-jurisdictional compliance requirements

5. COMPLIANCE IMPACT ASSESSMENT:
   - New security controls required
   - Policy/procedure updates needed
   - Technology/infrastructure investments
   - Training and awareness programs
   - Audit and reporting obligations

6. REGULATORY MONITORING STRATEGY:
   - Key regulatory bodies to track
   - Industry associations and guidance sources
   - Recommended monitoring cadence

Focus on regulations with direct security, privacy, or operational risk implications.`;

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are an expert regulatory compliance analyst specializing in security, privacy, and environmental regulations.' },
        { role: 'user', content: analysisPrompt }
      ],
      functionName: 'monitor-regulatory-changes',
      dlqOnFailure: true,
      dlqPayload: { jurisdiction, industry_sector },
    });

    if (aiResult.error) {
      return errorResponse('AI Gateway error', 500);
    }

    const analysis = aiResult.content;

    if (!analysis) {
      return errorResponse('No analysis generated', 500);
    }

    console.log('[RegulatoryChanges] Analysis completed');

    return successResponse({ 
      jurisdiction: jurisdiction || 'Canada',
      industry_sector: industry_sector || 'Energy',
      regulatory_analysis: analysis,
      analyzed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[RegulatoryChanges] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
