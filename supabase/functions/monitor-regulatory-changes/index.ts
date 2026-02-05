import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { jurisdiction, industry_sector } = await req.json();
    console.log('Monitoring regulatory changes for:', jurisdiction, industry_sector);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const analysisPrompt = `
You are a regulatory compliance analyst tracking security, privacy, and environmental regulations for a specific industry and jurisdiction.

JURISDICTION: ${jurisdiction}
INDUSTRY SECTOR: ${industry_sector}

TASK:
Identify and analyze recent regulatory changes and upcoming requirements that impact security operations and compliance obligations. Provide:

1. RECENT REGULATORY CHANGES (Last 12 months):
   - Security & data protection regulations
   - Privacy laws (e.g., GDPR, PIPEDA, state privacy laws)
   - Environmental regulations affecting operations
   - Critical infrastructure protection requirements
   - Industry-specific security standards
   
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
   - Conflicting regulatory frameworks

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

Focus on regulations with direct security, privacy, or operational risk implications for ${industry_sector} organizations operating in ${jurisdiction}.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert regulatory compliance analyst specializing in security, privacy, and environmental regulations.' },
          { role: 'user', content: analysisPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content;

    if (!analysis) {
      throw new Error('No analysis generated');
    }

    console.log('Regulatory change monitoring completed');

    return successResponse({ 
      jurisdiction,
      industry_sector,
      regulatory_analysis: analysis,
      analyzed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in monitor-regulatory-changes:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
