/**
 * agent-router
 *
 * Standalone routing endpoint. The UI calls this to get the best agents
 * for a given question or topic using semantic similarity.
 *
 * Falls back to keyword-based matching if embeddings are unavailable.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { routeToAgents } from "../_shared/semantic-rag.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const { question, top_k = 5 } = body;

    if (!question || typeof question !== 'string') {
      return errorResponse('question is required', 400);
    }

    const supabase = createServiceClient();
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

    // Attempt semantic routing via pgvector embeddings
    const routeResults = await routeToAgents(supabase, question, openAiApiKey, top_k);

    if (routeResults.length > 0) {
      // Load full agent records for matched call_signs
      const callSigns = routeResults.map((r) => r.call_sign);
      const { data: agentRows, error: agentsErr } = await supabase
        .from('ai_agents')
        .select('call_sign, codename, specialty, avatar_color')
        .in('call_sign', callSigns);

      if (agentsErr) {
        console.error('[agent-router] Failed to load agent records:', agentsErr);
        return errorResponse('Failed to load agents', 500);
      }

      // Merge similarity scores into agent records, preserving ranking order
      const agentMap = new Map((agentRows || []).map((a: any) => [a.call_sign, a]));
      const agents = routeResults
        .filter((r) => agentMap.has(r.call_sign))
        .map((r) => {
          const a = agentMap.get(r.call_sign)!;
          return {
            call_sign: a.call_sign,
            codename: a.codename,
            specialty: a.specialty,
            avatar_color: a.avatar_color,
            similarity_score: r.similarity,
          };
        });

      return successResponse({ agents });
    }

    // Fallback: keyword-based match against specialty
    console.warn('[agent-router] Semantic routing unavailable, falling back to keyword match');

    const { data: allAgents, error: allErr } = await supabase
      .from('ai_agents')
      .select('call_sign, codename, specialty, avatar_color')
      .eq('is_active', true);

    if (allErr || !allAgents) {
      return errorResponse('Failed to load agents for fallback', 500);
    }

    const questionLower = question.toLowerCase();
    const keywords = questionLower.split(/\s+/).filter((w: string) => w.length > 3);

    const scored = (allAgents as any[]).map((agent) => {
      const specialtyLower = (agent.specialty || '').toLowerCase();
      const matchCount = keywords.filter((kw: string) => specialtyLower.includes(kw)).length;
      return { agent, matchCount };
    });

    scored.sort((a, b) => b.matchCount - a.matchCount);

    const fallbackAgents = scored.slice(0, top_k).map(({ agent }) => ({
      call_sign: agent.call_sign,
      codename: agent.codename,
      specialty: agent.specialty,
      avatar_color: agent.avatar_color,
      similarity_score: null,
    }));

    return successResponse({ agents: fallbackAgents });

  } catch (err) {
    console.error('[agent-router] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
