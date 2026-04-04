/**
 * thread-weaver — Nightly Investigation Thread Weaver
 *
 * Clusters recent agent memories into investigation threads (narrative arcs).
 * Runs as a scheduled nightly job.
 *
 * Algorithm:
 *  1. Load significant/high-confidence memories from the last 48h not yet in any thread.
 *  2. Group by agent_call_sign.
 *  3. For each agent with 2+ new memories: cluster by semantic similarity.
 *  4. Per cluster: find or create an investigation_thread, link memories, add timeline events.
 *  5. Mark threads idle for 14+ days as 'cold'.
 *  6. Return summary stats.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawMemory {
  id: string;
  agent_call_sign: string;
  content: string;
  memory_type: string;
  entities: string[];
  tags: string[];
  confidence: number;
  client_id: string | null;
  incident_id: string | null;
  embedding: number[] | null;
  created_at: string;
}

interface MemoryCluster {
  memories: RawMemory[];
  keyTerms: string[];
}

interface WeaverResult {
  threads_created: number;
  threads_updated: number;
  memories_linked: number;
  cold_threads: number;
}

// ─── Cosine Similarity ───────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Cluster memories by embedding similarity ────────────────────────────────

/**
 * Simple greedy clustering: memories with cosine similarity >= threshold are
 * merged into the same cluster. Falls back to entity/content overlap when
 * embeddings are absent.
 */
function clusterMemories(memories: RawMemory[], threshold = 0.72): MemoryCluster[] {
  const clusters: MemoryCluster[] = [];
  const assigned = new Set<string>();

  for (const mem of memories) {
    if (assigned.has(mem.id)) continue;

    const cluster: RawMemory[] = [mem];
    assigned.add(mem.id);

    for (const other of memories) {
      if (assigned.has(other.id)) continue;

      let similar = false;

      if (mem.embedding && other.embedding) {
        similar = cosineSimilarity(mem.embedding, other.embedding) >= threshold;
      } else {
        // Fallback: entity overlap or shared tags
        const memEntities = new Set([...mem.entities, ...mem.tags]);
        const otherEntities = [...other.entities, ...other.tags];
        const overlap = otherEntities.filter(e => memEntities.has(e)).length;
        similar = overlap >= 2;
      }

      if (similar) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    // Collect key terms from entities and tags across cluster members
    const termFreq: Record<string, number> = {};
    for (const m of cluster) {
      for (const t of [...m.entities, ...m.tags]) {
        termFreq[t] = (termFreq[t] ?? 0) + 1;
      }
    }
    const keyTerms = Object.entries(termFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term]) => term);

    clusters.push({ memories: cluster, keyTerms });
  }

  return clusters;
}

// ─── Extract key terms for ILIKE search ─────────────────────────────────────

function buildIlikePattern(keyTerms: string[]): string {
  // Use the two most-common terms as a loose search
  return keyTerms.slice(0, 2).map(t => `%${t}%`).join('|');
}

// ─── AI helpers ──────────────────────────────────────────────────────────────

async function generateThreadName(contents: string[]): Promise<string> {
  const prompt = `You are a security intelligence analyst. Given these memory snippets from an ongoing investigation, produce a concise thread name (max 10 words) that captures the core subject. Reply with ONLY the thread name, no punctuation at the ends.\n\n${contents.slice(0, 3).join('\n---\n')}`;

  const result = await callAiGateway({
    model: 'openai/gpt-5.2',
    messages: [{ role: 'user', content: prompt }],
    functionName: 'thread-weaver/generate-name',
    extraBody: { max_completion_tokens: 40 },
  });

  return (result.content ?? '').trim().replace(/^["']|["']$/g, '') || 'Unnamed Investigation Thread';
}

async function generateThreadSummary(contents: string[], existingSummary?: string): Promise<string> {
  const context = existingSummary
    ? `Existing summary:\n${existingSummary}\n\nNew intelligence:\n${contents.join('\n---\n')}`
    : contents.join('\n---\n');

  const prompt = `Summarize this investigation thread in 2 sentences. Be factual and concise. Do not fabricate details not present in the content.\n\n${context.substring(0, 3000)}`;

  const result = await callAiGateway({
    model: 'openai/gpt-5.2',
    messages: [{ role: 'user', content: prompt }],
    functionName: 'thread-weaver/generate-summary',
    extraBody: { max_completion_tokens: 200 },
  });

  return (result.content ?? '').trim() || existingSummary || 'Investigation thread summary pending.';
}

// ─── Infer domain from memory content/tags ──────────────────────────────────

function inferDomain(memories: RawMemory[]): string {
  const allTags = memories.flatMap(m => [...m.tags, ...m.entities]).map(t => t.toLowerCase());
  const domainKeywords: Record<string, string[]> = {
    cyber: ['malware', 'apt', 'c2', 'exploit', 'vulnerability', 'phishing', 'ransomware', 'cyber', 'network', 'endpoint'],
    geopolitical: ['geopolitical', 'nation-state', 'sanctions', 'election', 'government', 'military', 'conflict'],
    physical: ['physical', 'surveillance', 'personnel', 'facility', 'travel', 'threat actor'],
    financial: ['financial', 'fraud', 'money', 'crypto', 'laundering', 'wire'],
  };

  const scores: Record<string, number> = {};
  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    scores[domain] = allTags.filter(t => keywords.some(k => t.includes(k))).length;
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : 'general';
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  try {
    const supabase = createServiceClient();

    await supabase.from('cron_heartbeat').upsert({
      job_name: 'thread-weaver-2am',
      started_at: new Date().toISOString(),
      status: 'running',
    }, { onConflict: 'job_name' });

    const result: WeaverResult = {
      threads_created: 0,
      threads_updated: 0,
      memories_linked: 0,
      cold_threads: 0,
    };

    // ── Step 1: Load recent unthreaded significant memories (last 48h) ──────

    const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: rawMemories, error: memError } = await supabase
      .from('agent_investigation_memory')
      .select('id, agent_call_sign, content, memory_type, entities, tags, confidence, client_id, incident_id, embedding, created_at')
      .gte('created_at', since48h)
      .or('is_significant.eq.true,confidence.gt.0.75')
      .not('id', 'in', `(SELECT memory_id FROM thread_memories)`);

    if (memError) {
      console.error('[ThreadWeaver] Failed to load memories:', memError);
      return errorResponse(`Failed to load memories: ${memError.message}`, 500);
    }

    const memories: RawMemory[] = (rawMemories ?? []) as RawMemory[];
    console.log(`[ThreadWeaver] Loaded ${memories.length} unthreaded memories`);

    if (memories.length === 0) {
      // Still run the cold-thread sweep even if no new memories
    } else {
      // ── Step 2: Group by agent ────────────────────────────────────────────

      const byAgent: Record<string, RawMemory[]> = {};
      for (const mem of memories) {
        (byAgent[mem.agent_call_sign] ??= []).push(mem);
      }

      // ── Steps 3-4: Cluster and weave threads per agent ────────────────────

      for (const [agentCallSign, agentMemories] of Object.entries(byAgent)) {
        if (agentMemories.length < 2) {
          console.log(`[ThreadWeaver] Agent ${agentCallSign} has only 1 memory — skipping`);
          continue;
        }

        const clusters = clusterMemories(agentMemories);

        for (const cluster of clusters) {
          if (cluster.memories.length < 2) continue;

          const contents = cluster.memories.map(m => m.content);
          const domain = inferDomain(cluster.memories);
          const clientId = cluster.memories.find(m => m.client_id)?.client_id ?? null;
          const incidentId = cluster.memories.find(m => m.incident_id)?.incident_id ?? null;

          // ── Step 4a: Check for existing active thread by key term ILIKE ──

          let existingThreadId: string | null = null;
          let existingSummary: string | undefined;

          if (cluster.keyTerms.length > 0) {
            // Build individual ILIKE filters for the top key terms
            const topTerms = cluster.keyTerms.slice(0, 3);
            let query = supabase
              .from('investigation_threads')
              .select('id, thread_summary')
              .eq('primary_agent', agentCallSign)
              .eq('status', 'active');

            // Chain OR-style ILIKE conditions
            const ilikeConditions = topTerms.map(t => `thread_summary.ilike.%${t}%,thread_name.ilike.%${t}%`).join(',');
            query = query.or(ilikeConditions);

            const { data: matchingThreads } = await query.limit(1).maybeSingle();

            if (matchingThreads) {
              existingThreadId = matchingThreads.id;
              existingSummary = matchingThreads.thread_summary ?? undefined;
            }
          }

          // ── Step 4b/4c: Update existing or create new thread ─────────────

          const newSummary = await generateThreadSummary(contents, existingSummary);

          if (existingThreadId) {
            // Update existing thread
            const { error: updateErr } = await supabase
              .from('investigation_threads')
              .update({
                thread_summary: newSummary,
                last_activity_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingThreadId);

            if (updateErr) {
              console.error(`[ThreadWeaver] Failed to update thread ${existingThreadId}:`, updateErr);
              continue;
            }

            result.threads_updated++;

            // Link memories to existing thread
            const memoryLinks = cluster.memories.map((m, idx) => ({
              thread_id: existingThreadId!,
              memory_id: m.id,
              sequence_position: idx + 1,
              is_pivotal: m.confidence >= 0.9,
            }));

            const { error: linkErr } = await supabase
              .from('thread_memories')
              .upsert(memoryLinks, { onConflict: 'thread_id,memory_id', ignoreDuplicates: true });

            if (linkErr) {
              console.error(`[ThreadWeaver] Failed to link memories to thread ${existingThreadId}:`, linkErr);
            } else {
              result.memories_linked += cluster.memories.length;
            }

            // Add timeline event for new intelligence
            await supabase.from('thread_timeline').insert({
              thread_id: existingThreadId,
              event_type: 'confirmation',
              event_description: `${cluster.memories.length} new memory fragment(s) linked — thread narrative updated.`,
              occurred_at: new Date().toISOString(),
            });

          } else {
            // Create new thread
            const threadName = await generateThreadName(contents);

            const { data: newThread, error: createErr } = await supabase
              .from('investigation_threads')
              .insert({
                thread_name: threadName,
                thread_summary: newSummary,
                primary_agent: agentCallSign,
                participating_agents: [agentCallSign],
                domain,
                client_id: clientId,
                related_incident_id: incidentId,
                status: 'active',
                confidence: cluster.memories.reduce((sum, m) => sum + m.confidence, 0) / cluster.memories.length,
                started_at: cluster.memories[0].created_at,
                last_activity_at: new Date().toISOString(),
              })
              .select('id')
              .single();

            if (createErr || !newThread) {
              console.error('[ThreadWeaver] Failed to create thread:', createErr);
              continue;
            }

            result.threads_created++;

            // Link memories
            const memoryLinks = cluster.memories.map((m, idx) => ({
              thread_id: newThread.id,
              memory_id: m.id,
              sequence_position: idx + 1,
              is_pivotal: m.confidence >= 0.9,
            }));

            const { error: linkErr } = await supabase
              .from('thread_memories')
              .insert(memoryLinks);

            if (linkErr) {
              console.error(`[ThreadWeaver] Failed to link memories to new thread ${newThread.id}:`, linkErr);
            } else {
              result.memories_linked += cluster.memories.length;
            }

            // Seed timeline with a discovery event
            await supabase.from('thread_timeline').insert({
              thread_id: newThread.id,
              event_type: 'discovery',
              event_description: `Investigation thread opened with ${cluster.memories.length} founding memory fragment(s).`,
              occurred_at: new Date().toISOString(),
            });

            console.log(`[ThreadWeaver] Created thread "${threadName}" (${newThread.id}) for agent ${agentCallSign}`);
          }
        }
      }
    }

    // ── Step 5: Mark stale threads as cold ───────────────────────────────────

    const staleThreshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: coldUpdated, error: coldErr } = await supabase
      .from('investigation_threads')
      .update({ status: 'cold', updated_at: new Date().toISOString() })
      .eq('status', 'active')
      .lt('last_activity_at', staleThreshold)
      .select('id');

    if (coldErr) {
      console.error('[ThreadWeaver] Failed to mark cold threads:', coldErr);
    } else {
      result.cold_threads = coldUpdated?.length ?? 0;
      if (result.cold_threads > 0) {
        console.log(`[ThreadWeaver] Marked ${result.cold_threads} thread(s) as cold`);
      }
    }

    console.log('[ThreadWeaver] Run complete:', result);

    await supabase.from('cron_heartbeat').upsert({
      job_name: 'thread-weaver-2am',
      completed_at: new Date().toISOString(),
      status: 'succeeded',
      result_summary: { threads_created: result.threads_created, threads_updated: result.threads_updated, memories_linked: result.memories_linked, cold_threads: result.cold_threads },
    }, { onConflict: 'job_name' });

    return successResponse({
      success: true,
      ...result,
      run_at: new Date().toISOString(),
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ThreadWeaver] Fatal error:', err);
    try {
      const supabase = createServiceClient();
      await supabase.from('cron_heartbeat').upsert({
        job_name: 'thread-weaver-2am',
        completed_at: new Date().toISOString(),
        status: 'failed',
        result_summary: { error: message },
      }, { onConflict: 'job_name' });
    } catch (_) {}
    return errorResponse(`Thread weaver failed: ${message}`, 500);
  }
});
