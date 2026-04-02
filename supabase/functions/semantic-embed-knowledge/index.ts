/**
 * semantic-embed-knowledge
 *
 * Batch-embeds all unembedded expert_knowledge entries using OpenAI text-embedding-3-small.
 * Also embeds agent specialties for semantic routing.
 *
 * Call after agent-knowledge-seeker runs, or on-demand with force=true.
 * Runs on a schedule (nightly after knowledge seeker).
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { embedText } from "../_shared/semantic-rag.ts";

const BATCH_SIZE = 20;
const DELAY_MS = 200; // stay under rate limits

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json().catch(() => ({}));
    const { force = false, embed_agents = true, batch_limit = 500 } = body;

    const supabase = createServiceClient();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) return errorResponse('OPENAI_API_KEY not configured', 500);

    let knowledgeEmbedded = 0;
    let knowledgeSkipped = 0;
    let agentsEmbedded = 0;

    // ── 1. Embed expert_knowledge entries ─────────────────────────────────
    const query = supabase
      .from('expert_knowledge')
      .select('id, title, content, applicability_tags')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(batch_limit);

    if (!force) {
      query.is('embedding', null);
    }

    const { data: entries, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    console.log(`[semantic-embed] ${entries?.length || 0} entries to embed`);

    for (let i = 0; i < (entries?.length || 0); i += BATCH_SIZE) {
      const batch = entries!.slice(i, i + BATCH_SIZE);

      // Batch embed using OpenAI batch endpoint for efficiency
      const texts = batch.map(e => `${e.title}\n\n${e.content.substring(0, 2000)}`);

      try {
        const resp = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: texts,
            dimensions: 1536,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!resp.ok) {
          console.error(`[semantic-embed] Batch ${i} OpenAI error ${resp.status}`);
          knowledgeSkipped += batch.length;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const data = await resp.json();
        const embeddings = data.data as Array<{ index: number; embedding: number[] }>;

        // Update each entry
        for (const emb of embeddings) {
          const entry = batch[emb.index];
          const { error: upErr } = await supabase
            .from('expert_knowledge')
            .update({ embedding: emb.embedding })
            .eq('id', entry.id);

          if (upErr) {
            console.error(`[semantic-embed] Update error for ${entry.id}:`, upErr.message);
            knowledgeSkipped++;
          } else {
            knowledgeEmbedded++;
          }
        }
      } catch (e) {
        console.error(`[semantic-embed] Batch ${i} error:`, e);
        knowledgeSkipped += batch.length;
      }

      if (i + BATCH_SIZE < (entries?.length || 0)) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    // ── 2. Embed agent specialties for routing ─────────────────────────────
    if (embed_agents) {
      const { data: agents } = await supabase
        .from('ai_agents')
        .select('id, call_sign, specialty, mission_scope, persona')
        .eq('is_active', true);

      if (agents?.length) {
        const agentTexts = agents.map(a =>
          `${a.call_sign}: ${a.specialty}. ${a.mission_scope}. ${a.persona}`
        );

        try {
          const resp = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'text-embedding-3-small',
              input: agentTexts,
              dimensions: 1536,
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (resp.ok) {
            const data = await resp.json();
            for (const emb of data.data) {
              const agent = agents[emb.index];
              await supabase
                .from('agent_specialty_embeddings')
                .upsert({
                  agent_id: agent.id,
                  call_sign: agent.call_sign,
                  embedding: emb.embedding,
                  specialty_text: agentTexts[emb.index],
                  last_embedded_at: new Date().toISOString(),
                }, { onConflict: 'call_sign' });
              agentsEmbedded++;
            }
          }
        } catch (e) {
          console.error('[semantic-embed] Agent embedding error:', e);
        }
      }
    }

    console.log(`[semantic-embed] Done: ${knowledgeEmbedded} knowledge embedded, ${agentsEmbedded} agents embedded, ${knowledgeSkipped} skipped`);

    return successResponse({
      knowledge_embedded: knowledgeEmbedded,
      knowledge_skipped: knowledgeSkipped,
      agents_embedded: agentsEmbedded,
    });

  } catch (err) {
    console.error('[semantic-embed] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
