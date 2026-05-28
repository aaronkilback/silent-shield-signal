/**
 * Agent Memory Module — RAG-enhanced investigation memory
 * Gives agents retrievable memory of past investigations via pgvector
 *
 * INC-OMCR: every memory is tenant-owned. Writes fail closed (refuse ownerless);
 * reads are tenant-scoped (no tenant → no rows). Backstopped by the DB trigger
 * trg_aim_require_tenant and the tenant-scoped match RPCs.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Recorder } from "./flight-recorder.ts";

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
 * Resolve the owning tenant for a memory from its client/incident, or an explicit tenant.
 * Returns null when no owner is derivable (caller must then refuse the write / read).
 */
async function resolveMemoryTenant(
  supabase: SupabaseClient,
  opts: { tenantId?: string; clientId?: string; incidentId?: string },
): Promise<string | null> {
  if (opts.tenantId) return opts.tenantId;
  if (opts.clientId) {
    const { data } = await supabase.from('clients').select('tenant_id').eq('id', opts.clientId).maybeSingle();
    if (data?.tenant_id) return data.tenant_id;
  }
  if (opts.incidentId) {
    const { data } = await supabase.from('incidents').select('tenant_id').eq('id', opts.incidentId).maybeSingle();
    if (data?.tenant_id) return data.tenant_id;
  }
  return null;
}

/**
 * Store a memory from an agent investigation.
 * INC-OMCR: fails closed — if no owning tenant is derivable, the memory is NOT written
 * (an ownerless embedding-backed memory is a cross-tenant retrieval hazard).
 */
export async function storeAgentMemory(
  supabase: SupabaseClient,
  agentCallSign: string,
  content: string,
  options: {
    incidentId?: string;
    clientId?: string;
    tenantId?: string;
    memoryType?: string;
    entities?: string[];
    tags?: string[];
    confidence?: number;
  } = {}
): Promise<void> {
  // INC-OMCR — resolve ownership BEFORE doing any work; refuse ownerless writes.
  const tenantId = await resolveMemoryTenant(supabase, options);
  if (!tenantId) {
    console.error(
      `[AgentMemory] REFUSED ownerless write (INC-OMCR): agent=${agentCallSign} type=${options.memoryType ?? 'investigation'} — no tenant derivable from client_id/incident_id/tenantId.`,
    );
    return;
  }

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
    tenant_id: tenantId,
    memory_type: options.memoryType || 'investigation',
    content,
    entities: options.entities || [],
    tags: options.tags || [],
    confidence: options.confidence || 0.5,
    embedding: embedding ? JSON.stringify(embedding) : null,
  });
}

/**
 * Retrieve relevant memories for an agent given a query context.
 * INC-OMCR: tenant-scoped. No tenant → no rows (fail closed).
 */
export async function retrieveAgentMemories(
  supabase: SupabaseClient,
  agentCallSign: string,
  queryText: string,
  tenantId: string | null | undefined,
  maxResults: number = 5,
  rec?: Recorder
): Promise<AgentMemory[]> {
  const t0 = Date.now();
  if (!tenantId) {
    rec?.retrieval({ surface: 'match_agent_memories', query: queryText, tenantScope: null,
      returnedObjectIds: [], fallbackPath: 'none', timingMs: Date.now() - t0, provenance: { fail_closed: 'no_tenant', agent: agentCallSign } });
    return []; // INC-OMCR fail closed
  }
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

    // Search via pgvector RPC — tenant-scoped (INC-OMCR)
    const { data: memories, error } = await supabase.rpc('match_agent_memories', {
      p_agent: agentCallSign,
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_match_threshold: 0.65,
      p_match_count: maxResults,
      p_tenant_id: tenantId,
    });

    if (error) {
      console.error('[AgentMemory] Retrieval error:', error);
      return [];
    }

    // Flight recorder: same-agent vector retrieval trace.
    rec?.retrieval({
      surface: 'match_agent_memories', query: queryText, tenantScope: tenantId,
      returnedObjectIds: (memories || []).map((m: AgentMemory) => m.id),
      vectorHits: (memories || []).map((m: AgentMemory) => ({ id: m.id, similarity: m.similarity })),
      fallbackPath: 'rpc', timingMs: Date.now() - t0,
      provenance: { rpc: 'match_agent_memories', threshold: 0.65, agent: agentCallSign },
    });

    return (memories || []) as AgentMemory[];
  } catch (err) {
    console.error('[AgentMemory] Retrieval failed:', err);
    return [];
  }
}

/**
 * Build a memory context block for injection into agent prompts.
 * INC-OMCR: tenant-scoped — pass the tenant the conversation/incident belongs to.
 */
export async function buildMemoryContext(
  supabase: SupabaseClient,
  agentCallSign: string,
  incidentContext: string,
  tenantId: string | null | undefined,
  rec?: Recorder
): Promise<string> {
  const memories = await retrieveAgentMemories(supabase, agentCallSign, incidentContext, tenantId, 5, rec);

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
