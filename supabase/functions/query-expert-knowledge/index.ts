import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

/**
 * On-Demand Expert Knowledge Query
 * 
 * Agents and users can query world-class expertise in real-time.
 * First checks the local expert_knowledge database, then augments
 * with live Perplexity search if needed for cutting-edge intelligence.
 */

interface QueryRequest {
  question: string;
  domain?: string;
  include_live_search?: boolean;  // Also query Perplexity in real-time
  context?: string;               // Additional context for better results
  max_results?: number;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { question, domain, include_live_search, context, max_results } = await req.json() as QueryRequest;

    if (!question) {
      return errorResponse('Question is required', 400);
    }

    const supabase = createServiceClient();
    const limit = max_results || 10;

    console.log(`[query-expert-knowledge] Query: "${question}", Domain: ${domain || 'all'}, Live: ${include_live_search}`);

    // Step 1: Search local expert knowledge database
    const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    let knowledgeQuery = supabase
      .from('expert_knowledge')
      .select('id, domain, subdomain, knowledge_type, title, content, applicability_tags, confidence_score, citation, last_validated_at')
      .eq('is_active', true)
      .order('confidence_score', { ascending: false })
      .limit(limit);

    if (domain) {
      knowledgeQuery = knowledgeQuery.eq('domain', domain);
    }

    if (keywords.length > 0) {
      const orConditions = keywords
        .slice(0, 5) // Limit to avoid overly complex queries
        .map(k => `title.ilike.%${k}%,content.ilike.%${k}%`)
        .join(',');
      knowledgeQuery = knowledgeQuery.or(orConditions);
    }

    const { data: localKnowledge, error: localError } = await knowledgeQuery;
    if (localError) {
      console.error('[query-expert-knowledge] Local query error:', localError);
    }

    // Step 2: Also pull from global learning insights
    let insightsQuery = supabase
      .from('global_learning_insights')
      .select('id, insight_type, category, insight_content, confidence_score')
      .eq('is_active', true)
      .eq('insight_type', 'world_expertise')
      .gte('confidence_score', 0.5)
      .order('confidence_score', { ascending: false })
      .limit(5);

    if (domain) {
      insightsQuery = insightsQuery.eq('category', domain);
    }

    const { data: globalInsights } = await insightsQuery;

    // Step 3: Live Perplexity search for cutting-edge knowledge
    let liveExpertise: any = null;
    if (include_live_search !== false) { // Default to true
      const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
      if (PERPLEXITY_API_KEY) {
        try {
          liveExpertise = await queryPerplexityExpert(PERPLEXITY_API_KEY, question, domain, context);
        } catch (err) {
          console.error('[query-expert-knowledge] Live search error:', err);
        }
      }
    }

    // Step 4: Synthesize all knowledge into a unified expert briefing
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    let synthesizedBriefing: string | null = null;

    if (GEMINI_API_KEY && (localKnowledge?.length || liveExpertise)) {
      synthesizedBriefing = await synthesizeExpertBriefing(
        GEMINI_API_KEY,
        question,
        localKnowledge || [],
        globalInsights || [],
        liveExpertise,
        context
      );
    }

    const response = {
      question,
      domain: domain || 'all',
      synthesized_briefing: synthesizedBriefing,
      local_knowledge: localKnowledge || [],
      global_insights: globalInsights || [],
      live_expertise: liveExpertise,
      sources_consulted: {
        local_entries: localKnowledge?.length || 0,
        global_insights: globalInsights?.length || 0,
        live_search: liveExpertise ? true : false,
      },
      timestamp: new Date().toISOString(),
    };

    console.log(`[query-expert-knowledge] Returned ${response.sources_consulted.local_entries} local + ${response.sources_consulted.global_insights} global entries`);

    return successResponse(response);
  } catch (error) {
    console.error('[query-expert-knowledge] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function queryPerplexityExpert(
  apiKey: string,
  question: string,
  domain?: string,
  context?: string
): Promise<{ answer: string; citations: string[] } | null> {
  const domainContext = domain ? ` Focus on the ${domain.replace('_', ' ')} domain.` : '';
  const additionalContext = context ? ` Additional context: ${context}` : '';

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: `You are a world-class security advisor with expertise spanning physical security, cybersecurity, executive protection, crisis management, threat intelligence, and regulatory compliance. You have deep knowledge of MITRE ATT&CK, NIST frameworks, ASIS standards, ISO 27001, and real-world security operations.

Provide authoritative, actionable intelligence. Cite specific frameworks, standards, and methodologies. Include metrics, thresholds, and procedures where applicable. Your audience is senior security professionals at Fortune 500 companies.${domainContext}`
        },
        {
          role: 'user',
          content: `${question}${additionalContext}`
        }
      ],
      temperature: 0.1,
      search_recency_filter: 'month',
    }),
  });

  if (!response.ok) {
    console.error(`[query-expert-knowledge] Perplexity error: ${response.status}`);
    return null;
  }

  const data = await response.json();
  return {
    answer: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
}

async function synthesizeExpertBriefing(
  apiKey: string,
  question: string,
  localKnowledge: any[],
  globalInsights: any[],
  liveExpertise: any,
  context?: string
): Promise<string> {
  const knowledgeContext = localKnowledge
    .slice(0, 5)
    .map(k => `[${k.knowledge_type}] ${k.title}: ${k.content.substring(0, 300)}`)
    .join('\n\n');

  const insightContext = globalInsights
    .slice(0, 3)
    .map(i => i.insight_content.substring(0, 200))
    .join('\n');

  const liveContext = liveExpertise?.answer?.substring(0, 1000) || '';

  const prompt = `Synthesize a concise expert briefing answering this question:
"${question}"

${context ? `Context: ${context}\n` : ''}
INTERNAL KNOWLEDGE BASE:
${knowledgeContext || 'No internal knowledge available.'}

GLOBAL INTELLIGENCE:
${insightContext || 'No global insights available.'}

LIVE WORLD INTELLIGENCE:
${liveContext || 'No live data available.'}

Provide a unified, authoritative answer that:
1. Directly addresses the question with specific, actionable intelligence
2. Cites relevant frameworks and standards (MITRE, NIST, ASIS, etc.)
3. Includes specific metrics, thresholds, or procedures where applicable
4. Notes any conflicting information between sources
5. Ends with 2-3 immediate actionable recommendations

Write in a direct, authoritative tone suitable for senior security leadership.`;

  try {
    const aiResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are AEGIS, a senior security intelligence advisor. Synthesize multiple knowledge sources into unified, authoritative expert briefings.' },
        { role: 'user', content: prompt }
      ],
      functionName: 'query-expert-knowledge',
    });

    if (aiResult.error) {
      console.error('[query-expert-knowledge] Synthesis error:', aiResult.error);
      return '';
    }

    return aiResult.content || '';
  } catch (err) {
    console.error('[query-expert-knowledge] Synthesis failed:', err);
    return '';
  }
}
