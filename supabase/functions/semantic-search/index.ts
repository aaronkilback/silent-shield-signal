import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse, getUserFromRequest } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { userId, error: authError } = await getUserFromRequest(req);
    if (!userId) {
      return errorResponse(authError || 'Authentication required', 401);
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const { query, threshold, max_results, source_type, generate_summary } = await req.json();

    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      return errorResponse('Query must be at least 3 characters', 400);
    }

    // Generate query embedding (OpenAI embeddings API - not AI gateway)
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: query.trim() }),
    });

    if (!embeddingResponse.ok) {
      const errText = await embeddingResponse.text();
      console.error('Embedding API error:', embeddingResponse.status, errText);
      if (embeddingResponse.status === 429) {
        return errorResponse('Rate limited. Please try again shortly.', 429);
      }
      throw new Error('Failed to generate query embedding');
    }

    const embData = await embeddingResponse.json();
    const queryEmbedding = embData.data[0].embedding;

    const supabase = createServiceClient();

    const { data: matches, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: threshold || 0.5,
      match_count: max_results || 15,
    });

    if (matchError) throw new Error(`Search failed: ${matchError.message}`);

    const docIds = [...new Set((matches || []).map((m: any) => m.doc_id))];
    
    let docs: any[] = [];
    if (docIds.length > 0) {
      const { data: docData } = await supabase.from('global_docs').select('id, title, source_type, source_id, metadata, created_at').in('id', docIds);
      docs = docData || [];
    }

    const docMap = new Map(docs.map(d => [d.id, d]));

    let enrichedResults = (matches || []).map((match: any) => {
      const doc = docMap.get(match.doc_id);
      return {
        chunk_id: match.id, content: match.content,
        similarity: Math.round(match.similarity * 1000) / 1000,
        source: { doc_id: match.doc_id, title: doc?.title || 'Unknown', type: doc?.source_type || 'unknown', source_id: doc?.source_id, metadata: doc?.metadata, created_at: doc?.created_at },
      };
    });

    if (source_type) {
      enrichedResults = enrichedResults.filter((r: any) => r.source.type === source_type);
    }

    // Optionally generate AI summary
    let summary = null;
    if (generate_summary && enrichedResults.length > 0) {
      const contextText = enrichedResults.slice(0, 5).map((r: any) => `[${r.source.title}] ${r.content}`).join('\n\n');

      const summaryResult = await callAiGateway({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a concise intelligence analyst. Synthesize the provided document excerpts into a brief, actionable summary answering the user\'s query. Cite source document titles. Keep under 200 words.' },
          { role: 'user', content: `Query: "${query}"\n\nRelevant excerpts:\n${contextText}` },
        ],
        functionName: 'semantic-search',
      });

      if (summaryResult.content) {
        summary = summaryResult.content;
      } else if (summaryResult.error?.includes('429')) {
        summary = 'Summary unavailable: rate limited. Try again shortly.';
      } else if (summaryResult.error?.includes('402')) {
        summary = 'Summary unavailable: credits exhausted.';
      }
    }

    return successResponse({
      query, results: enrichedResults, total_results: enrichedResults.length,
      summary, embedding_model: 'text-embedding-3-small',
    });
  } catch (error) {
    console.error('Error in semantic-search:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});