/**
 * Semantic RAG (Retrieval-Augmented Generation)
 *
 * Provides semantic search over expert_knowledge using pgvector.
 * Replaces keyword-based domain matching with actual semantic similarity.
 */

export interface RagEntry {
  id: string;
  title: string;
  content: string;
  domain: string;
  knowledge_type: string;
  citation: string | null;
  similarity: number;
}

/**
 * Embed a text string using OpenAI text-embedding-3-small.
 * Returns a 1536-dimensional vector.
 */
export async function embedText(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000), // truncate to token limit
        dimensions: 1536,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      console.error(`[semantic-rag] Embedding API error ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    return data.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error('[semantic-rag] embedText error:', err);
    return null;
  }
}

/**
 * Retrieve the top-k most semantically relevant expert_knowledge entries
 * for a given query, optionally filtered by agent call_sign.
 */
export async function retrieveRelevantKnowledge(
  supabase: any,
  queryText: string,
  apiKey: string,
  options: {
    callSign?: string;
    threshold?: number;
    limit?: number;
  } = {}
): Promise<RagEntry[]> {
  const embedding = await embedText(queryText, apiKey);
  if (!embedding) return [];

  const { data, error } = await supabase.rpc('search_expert_knowledge_semantic', {
    query_embedding: embedding,
    call_sign_filter: options.callSign ?? null,
    match_threshold: options.threshold ?? 0.68,
    match_count: options.limit ?? 8,
  });

  if (error) {
    console.error('[semantic-rag] search_expert_knowledge_semantic error:', error);
    return [];
  }

  return (data || []) as RagEntry[];
}

/**
 * Format RAG results into a system prompt injection block.
 */
export function formatRagContext(entries: RagEntry[], agentCallSign: string): string {
  if (entries.length === 0) return '';

  const lines = entries.map(e => {
    const sim = Math.round(e.similarity * 100);
    return `▸ [${e.knowledge_type.toUpperCase()} | ${e.domain} | ${sim}% match] ${e.title}\n${e.content.substring(0, 500)}${e.content.length > 500 ? '...' : ''}\n  Source: ${e.citation || 'Fortress knowledge base'}`;
  });

  return `\n\n═══ SEMANTIC KNOWLEDGE RETRIEVAL (${entries.length} entries matched your query) ═══\nThe following knowledge was retrieved because it is semantically relevant to this conversation. Apply it to your analysis:\n\n${lines.join('\n\n')}\n`;
}

/**
 * Route a question to the most relevant agents using semantic similarity.
 */
export async function routeToAgents(
  supabase: any,
  question: string,
  apiKey: string,
  topK: number = 5
): Promise<Array<{ call_sign: string; similarity: number }>> {
  const embedding = await embedText(question, apiKey);
  if (!embedding) return [];

  const { data, error } = await supabase.rpc('route_to_agents', {
    query_embedding: embedding,
    top_k: topK,
  });

  if (error) {
    console.error('[semantic-rag] route_to_agents error:', error);
    return [];
  }

  return data || [];
}
