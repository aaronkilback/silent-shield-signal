/**
 * speculative-dispatch
 *
 * Receives a signal flagged as high-severity or anomalous and pre-dispatches it
 * to the 3 most semantically relevant agents for proactive analysis BEFORE human review.
 * Uses agent-router for semantic routing and agent-chat for analysis.
 * Results are stored in the `signal_agent_analyses` table.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json();
    const {
      signal_id,
      signal_text,
      category,
      severity,
      client_id,
      trigger_reason,
      z_score,
    } = body;

    if (!signal_id) return errorResponse('signal_id required', 400);

    const supabase = createServiceClient();

    // 1. Call agent-router to find the 3 best-matched agents for this signal
    const routerResponse = await supabase.functions.invoke('agent-router', {
      body: {
        question: `${category} signal: ${signal_text}`,
        top_k: 3,
      },
    });

    const routedAgents: Array<{ call_sign: string }> = routerResponse.data?.agents || [];

    // Fall back to a default set if routing returns nothing
    const callSigns = routedAgents.length > 0
      ? routedAgents.slice(0, 3).map((a) => a.call_sign)
      : ['NEO', 'ORACLE', 'SPECTER'];

    // 2. Resolve call_signs → UUIDs (agent-chat requires agent_id as UUID)
    const { data: agentRows } = await supabase
      .from('ai_agents')
      .select('id, call_sign')
      .in('call_sign', callSigns);

    if (!agentRows || agentRows.length === 0) {
      console.warn('[speculative-dispatch] No agents resolved for call_signs:', callSigns);
      return errorResponse('No matching agents found', 404);
    }

    const userMessage =
      `SIGNAL REQUIRING PRE-ANALYSIS:\n\n` +
      `Category: ${category}\nSeverity: ${severity}\nTrigger: ${trigger_reason}` +
      (z_score ? `\nAnomaly Z-score: ${z_score}` : '') +
      `\n\nSignal text: ${signal_text}\n\n` +
      `Provide a concise 3-5 sentence specialist assessment. Include: threat actor assessment, ` +
      `PECL-specific implications, recommended immediate action, and your confidence level (0-100%).`;

    // 3. For each agent, invoke agent-chat with the signal as context
    const analyses = await Promise.allSettled(
      agentRows.map(async (agent: { id: string; call_sign: string }) => {
        const chatResponse = await supabase.functions.invoke('agent-chat', {
          body: {
            agent_id: agent.id,
            message: userMessage,
            client_id: client_id || null,
          },
        });
        const responseData = chatResponse.data as any;
        return {
          call_sign: agent.call_sign,
          analysis: responseData?.response || responseData?.message || '',
          confidence_score: responseData?.confidence || null,
        };
      })
    );

    // 4. Store each analysis in signal_agent_analyses
    for (const result of analyses) {
      if (result.status === 'fulfilled' && result.value.analysis) {
        await supabase.from('signal_agent_analyses').insert({
          signal_id,
          agent_call_sign: result.value.call_sign,
          analysis: result.value.analysis,
          confidence_score: result.value.confidence_score,
          trigger_reason: trigger_reason || null,
        });
      }
    }

    const stored = analyses.filter((r) => r.status === 'fulfilled' && (r as any).value.analysis).length;
    console.log(`[speculative-dispatch] ${stored} pre-analyses stored for signal ${signal_id}`);

    return successResponse({ dispatched: stored, signal_id });

  } catch (err) {
    console.error('[speculative-dispatch] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
