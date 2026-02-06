import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse, getUserFromRequest } from "../_shared/supabase-client.ts";

/**
 * Semantic search across all embedded documents and signals.
 * Uses OpenAI text-embedding-3-small to embed the query,
 * then performs cosine similarity search via match_documents().
 */

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

    // Generate query embedding
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query.trim(),
      }),
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

    // Call the match_documents function
    const { data: matches, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: threshold || 0.5,
      match_count: max_results || 15,
    });

    if (matchError) {
      console.error('Match error:', matchError);
      throw new Error(`Search failed: ${matchError.message}`);
    }

    // Enrich results with source document info
    const docIds = [...new Set((matches || []).map((m: any) => m.doc_id))];
    
    let docs: any[] = [];
    if (docIds.length > 0) {
      const { data: docData } = await supabase
        .from('global_docs')
        .select('id, title, source_type, source_id, metadata, created_at')
        .in('id', docIds);
      docs = docData || [];
    }

    const docMap = new Map(docs.map(d => [d.id, d]));

    // Filter by source_type if specified
    let enrichedResults = (matches || []).map((match: any) => {
      const doc = docMap.get(match.doc_id);
      return {
        chunk_id: match.id,
        content: match.content,
        similarity: Math.round(match.similarity * 1000) / 1000,
        source: {
          doc_id: match.doc_id,
          title: doc?.title || 'Unknown',
          type: doc?.source_type || 'unknown',
          source_id: doc?.source_id,
          metadata: doc?.metadata,
          created_at: doc?.created_at,
        },
      };
    });

    if (source_type) {
      enrichedResults = enrichedResults.filter((r: any) => r.source.type === source_type);
    }

    // Optionally generate AI summary of search results
    let summary = null;
    if (generate_summary && enrichedResults.length > 0) {
      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      if (LOVABLE_API_KEY) {
        const contextText = enrichedResults
          .slice(0, 5)
          .map((r: any) => `[${r.source.title}] ${r.content}`)
          .join('\n\n');

        try {
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                {
                  role: 'system',
                  content: 'You are a concise intelligence analyst. Synthesize the provided document excerpts into a brief, actionable summary answering the user\'s query. Cite source document titles. Keep under 200 words. Use measured, professional tone.',
                },
                {
                  role: 'user',
                  content: `Query: "${query}"\n\nRelevant excerpts:\n${contextText}`,
                },
              ],
            }),
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            summary = aiData.choices?.[0]?.message?.content || null;
          } else if (aiResponse.status === 429) {
            summary = 'Summary unavailable: rate limited. Try again shortly.';
          } else if (aiResponse.status === 402) {
            summary = 'Summary unavailable: credits exhausted.';
          }
        } catch (e) {
          console.error('Summary generation error:', e);
        }
      }
    }

    return successResponse({
      query,
      results: enrichedResults,
      total_results: enrichedResults.length,
      summary,
      embedding_model: 'text-embedding-3-small',
    });
  } catch (error) {
    console.error('Error in semantic-search:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
