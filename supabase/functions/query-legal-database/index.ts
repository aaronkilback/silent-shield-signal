import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface LegalQueryRequest {
  jurisdiction: string;
  topic: string;
  keywords?: string[];
  include_case_law?: boolean;
  include_statutes?: boolean;
  max_results?: number;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    const { 
      jurisdiction, 
      topic, 
      keywords = [], 
      include_case_law = true,
      include_statutes = true,
      max_results = 10 
    }: LegalQueryRequest = await req.json();

    if (!jurisdiction || !topic) {
      return errorResponse('jurisdiction and topic are required', 400);
    }

    // First, check knowledge base for any stored legal documents
    const { data: kbResults } = await supabase
      .from('archival_documents')
      .select('id, filename, summary, keywords, content_text, tags')
      .or(`summary.ilike.%${topic}%,content_text.ilike.%${topic}%`)
      .limit(5);

    // Build comprehensive legal research prompt
    const legalPrompt = `You are a specialized legal research assistant with expertise in Canadian law, particularly British Columbia and Alberta jurisdictions.

Research Request:
- Jurisdiction: ${jurisdiction}
- Topic: ${topic}
- Keywords: ${keywords.length > 0 ? keywords.join(', ') : 'None specified'}
- Include Case Law: ${include_case_law}
- Include Statutes: ${include_statutes}

${kbResults && kbResults.length > 0 ? `
Internal Knowledge Base Results Found:
${kbResults.map(doc => `- ${doc.filename}: ${doc.summary || 'No summary'}`).join('\n')}
` : ''}

Please provide a comprehensive legal research summary including:

1. **Relevant Legislation**:
   - Primary acts and regulations governing this topic in ${jurisdiction}
   - Key sections and provisions
   - Recent amendments or changes

2. **Key Legal Principles**:
   - Established legal doctrines applicable to this topic
   - Standard of care or compliance requirements
   - Liability considerations

3. **Notable Case Law** (if requested):
   - Leading cases in ${jurisdiction} jurisdiction
   - Key holdings and precedents
   - How courts have interpreted relevant provisions

4. **Regulatory Framework**:
   - Governing bodies and their authority
   - Licensing or certification requirements
   - Compliance obligations

5. **Practical Implications**:
   - Common compliance challenges
   - Best practices for adherence
   - Risk mitigation strategies

6. **Cross-Jurisdictional Considerations**:
   - Differences between federal, provincial, and municipal requirements
   - Inter-provincial recognition or conflicts

Format your response as structured JSON with the following schema:
{
  "jurisdiction": "string",
  "topic": "string",
  "legislation": [{"name": "string", "sections": ["string"], "summary": "string"}],
  "legal_principles": [{"principle": "string", "description": "string", "source": "string"}],
  "case_law": [{"case_name": "string", "citation": "string", "year": "number", "key_holding": "string", "relevance": "string"}],
  "regulatory_framework": {"governing_bodies": ["string"], "requirements": ["string"]},
  "practical_implications": {"challenges": ["string"], "best_practices": ["string"], "risk_factors": ["string"]},
  "citations": ["string"],
  "last_updated": "string",
  "disclaimer": "string"
}`;

    if (!lovableApiKey) {
      return errorResponse('LOVABLE_API_KEY not configured', 500);
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: 'You are a legal research AI with deep knowledge of Canadian law, particularly security, employment, and regulatory matters in BC and Alberta. Always provide accurate, well-sourced information with appropriate legal disclaimers.' },
          { role: 'user', content: legalPrompt }
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      return errorResponse(`Failed to query legal database: ${errorText}`, 500);
    }

    const aiData = await aiResponse.json();
    const responseContent = aiData.choices?.[0]?.message?.content || '';

    // Try to parse as JSON, fallback to structured response
    let legalResults;
    try {
      // Extract JSON from response if wrapped in markdown
      const jsonMatch = responseContent.match(/```json\n?([\s\S]*?)\n?```/) || 
                        responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        legalResults = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        legalResults = { raw_response: responseContent };
      }
    } catch {
      legalResults = { raw_response: responseContent };
    }

    // Log the query for audit purposes
    await supabase.from('intelligence_config').upsert({
      key: `legal_query_${Date.now()}`,
      value: {
        jurisdiction,
        topic,
        keywords,
        timestamp: new Date().toISOString(),
        results_count: legalResults.legislation?.length || 0
      },
      description: 'Legal database query audit log'
    });

    return successResponse({
      success: true,
      query: { jurisdiction, topic, keywords },
      results: legalResults,
      knowledge_base_matches: kbResults || [],
      queried_at: new Date().toISOString(),
      disclaimer: 'This information is for reference purposes only and does not constitute legal advice. Always consult with a qualified legal professional for specific legal matters.'
    });

  } catch (error) {
    console.error('Error in query-legal-database:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
