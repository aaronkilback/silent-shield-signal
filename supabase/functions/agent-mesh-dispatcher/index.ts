/**
 * Agent Mesh Dispatcher
 *
 * Proactive inter-agent intelligence routing.
 * Called after agent learning events and significant memory storage.
 *
 * POST body:
 *   {
 *     from_agent: string,
 *     insight: string,
 *     insight_type: string,
 *     domain: string,
 *     relevance_context: string,
 *     related_signal_id?: string,
 *     client_id?: string
 *   }
 *
 * Returns: { dispatched_to: string[], skipped: string[] }
 */

import {
  createServiceClient,
  corsHeaders,
  handleCors,
  successResponse,
  errorResponse,
  getEnv,
} from '../_shared/supabase-client.ts';
import { routeToAgents } from '../_shared/semantic-rag.ts';

// ═══════════════════════════════════════════════════════════════════════════
//  RATE LIMIT CHECK
//  Max 3 mesh messages from same sender to same recipient in last 6 hours.
// ═══════════════════════════════════════════════════════════════════════════

async function isRateLimited(
  supabase: any,
  fromAgent: string,
  toAgent: string
): Promise<boolean> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('agent_mesh_messages')
    .select('id', { count: 'exact', head: true })
    .eq('from_agent', fromAgent)
    .eq('to_agent', toAgent)
    .gte('created_at', sixHoursAgo);

  if (error) {
    console.warn(`[agent-mesh-dispatcher] Rate limit check error for ${fromAgent}→${toAgent}:`, error.message);
    // Default to not rate-limiting on error to avoid blocking all messages
    return false;
  }

  return (count ?? 0) >= 3;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return errorResponse('Invalid JSON body', 400);
    }

    const {
      from_agent,
      insight,
      insight_type,
      domain,
      relevance_context,
      related_signal_id,
      client_id,
    } = body;

    if (!from_agent || typeof from_agent !== 'string') {
      return errorResponse('from_agent is required', 400);
    }
    if (!insight || typeof insight !== 'string') {
      return errorResponse('insight is required', 400);
    }

    const supabase = createServiceClient();
    const openAiKey = getEnv('OPENAI_API_KEY');

    // Build the routing query from insight + context
    const routingText = [insight, relevance_context, domain].filter(Boolean).join(' ');

    // Find top 4 semantically related agents
    const candidates = await routeToAgents(supabase, routingText, openAiKey, 4);

    console.log(`[agent-mesh-dispatcher] ${from_agent} → candidates: ${candidates.map(c => `${c.call_sign}(${c.similarity.toFixed(2)})`).join(', ')}`);

    const dispatchedTo: string[] = [];
    const skipped: string[] = [];

    for (const candidate of candidates) {
      const toAgent = candidate.call_sign;

      // Exclude the sending agent
      if (toAgent === from_agent) {
        skipped.push(toAgent);
        continue;
      }

      // Require similarity above threshold
      if (candidate.similarity <= 0.55) {
        skipped.push(toAgent);
        continue;
      }

      // Check rate limit
      const rateLimited = await isRateLimited(supabase, from_agent, toAgent);
      if (rateLimited) {
        console.log(`[agent-mesh-dispatcher] Rate limited: ${from_agent}→${toAgent}`);
        skipped.push(toAgent);
        continue;
      }

      // Compose message
      const subject = insight.substring(0, 100);
      const messageRow: any = {
        from_agent,
        to_agent: toAgent,
        message_type: 'insight_share',
        subject,
        content: insight,
        relevance_score: Math.round(candidate.similarity * 1000) / 1000,
        is_read: false,
      };

      if (related_signal_id) messageRow.related_signal_id = related_signal_id;
      if (client_id) messageRow.client_id = client_id;

      const { error: insertErr } = await supabase
        .from('agent_mesh_messages')
        .insert(messageRow);

      if (insertErr) {
        console.error(`[agent-mesh-dispatcher] Failed to insert message to ${toAgent}:`, insertErr.message);
        skipped.push(toAgent);
        continue;
      }

      dispatchedTo.push(toAgent);
      console.log(`[agent-mesh-dispatcher] Dispatched ${from_agent}→${toAgent} (${Math.round(candidate.similarity * 100)}% relevance)`);
    }

    return successResponse({
      dispatched_to: dispatchedTo,
      skipped,
      from_agent,
      insight_type: insight_type ?? null,
      domain: domain ?? null,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent-mesh-dispatcher] Error:', message);
    return errorResponse(message, 500);
  }
});
