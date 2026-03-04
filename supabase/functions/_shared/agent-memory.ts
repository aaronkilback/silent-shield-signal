/**
 * Agent Memory Module — RAG-enhanced investigation memory
 * Gives agents retrievable memory of past investigations via pgvector
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface AgentMemory {
  id: string;
  content: string;
  memory_type: string;
  entities: string[];
  confidence: number;
  incident_id: string | null;
  similarity: number;
}

/**
 * Store a memory from an agent investigation
 */
export async function storeAgentMemory(
  supabase: SupabaseClient,
  agentCallSign: string,
  content: string,
  options: {
    incidentId?: string;
    clientId?: string;
    memoryType?: string;
    entities?: string[];
    tags?: string[];
    confidence?: number;
  } = {}
): Promise<void> {
  // Generate embedding for the memory
  let embedding: number[] | null = null;
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

  if (OPENAI_API_KEY) {
    try {
      const embResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: content.substring(0, 8000),
        }),
      });

      if (embResponse.ok) {
        const embData = await embResponse.json();
        embedding = embData.data?.[0]?.embedding || null;
      }
    } catch (err) {
      console.error('[AgentMemory] Embedding generation failed:', err);
    }
  }

  await supabase.from('agent_investigation_memory').insert({
    agent_call_sign: agentCallSign,
    incident_id: options.incidentId || null,
    client_id: options.clientId || null,
    memory_type: options.memoryType || 'investigation',
    content,
    entities: options.entities || [],
    tags: options.tags || [],
    confidence: options.confidence || 0.5,
    embedding: embedding ? JSON.stringify(embedding) : null,
  });
}

/**
 * Retrieve relevant memories for an agent given a query context
 */
export async function retrieveAgentMemories(
  supabase: SupabaseClient,
  agentCallSign: string,
  queryText: string,
  maxResults: number = 5
): Promise<AgentMemory[]> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) return [];

  try {
    // Generate query embedding
    const embResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: queryText.substring(0, 8000),
      }),
    });

    if (!embResponse.ok) return [];

    const embData = await embResponse.json();
    const queryEmbedding = embData.data?.[0]?.embedding;
    if (!queryEmbedding) return [];

    // Search via pgvector RPC
    const { data: memories, error } = await supabase.rpc('match_agent_memories', {
      p_agent: agentCallSign,
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_match_threshold: 0.65,
      p_match_count: maxResults,
    });

    if (error) {
      console.error('[AgentMemory] Retrieval error:', error);
      return [];
    }

    return (memories || []) as AgentMemory[];
  } catch (err) {
    console.error('[AgentMemory] Retrieval failed:', err);
    return [];
  }
}

/**
 * Build a memory context block for injection into agent prompts
 */
export async function buildMemoryContext(
  supabase: SupabaseClient,
  agentCallSign: string,
  incidentContext: string
): Promise<string> {
  const memories = await retrieveAgentMemories(supabase, agentCallSign, incidentContext);

  if (memories.length === 0) {
    return '\n=== AGENT MEMORY ===\nNo relevant past investigations found.\n';
  }

  const memoryLines = memories.map((m, i) => {
    const entityStr = m.entities.length > 0 ? ` | Entities: ${m.entities.join(', ')}` : '';
    return `[${i + 1}] (${(m.similarity * 100).toFixed(0)}% match, ${m.memory_type}) ${m.content.substring(0, 300)}${entityStr}`;
  });

  return `\n=== AGENT MEMORY (${memories.length} relevant past investigations) ===
${memoryLines.join('\n')}
NOTE: Use these memories to identify patterns and connections. Reference them when relevant.
`;
}
