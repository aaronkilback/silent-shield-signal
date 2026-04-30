/**
 * apply-feedback-to-agent
 *
 * Closes the operator-feedback → agent-improvement loop.
 *
 * Input: a feedback_event id (operator marked a signal as relevant/irrelevant
 * with a reason). The function:
 *   1. Loads the feedback row + the signal
 *   2. Finds the AI-DECISION-ENGINE row that classified this signal
 *      (its analysis explains why the agent thought it was important)
 *   3. Forms a one-line learning note grounded in this concrete case:
 *      "Signal '<title>' (you classified as <reasoning>) was dismissed by
 *      analyst as <correction>. Adjust your relevance pattern for <category>."
 *   4. Appends to that agent's system_prompt as ## OPERATOR FEEDBACK
 *   5. Records the application in self_improvement_log so we can audit
 *      cumulative drift to each agent's prompt.
 *
 * Triggered by:
 *   - Direct invoke from process-feedback after a feedback_event is written
 *   - Or via the queue (enqueueJob('apply-feedback-to-agent', {feedback_id}))
 *
 * The previous gap (2026-04-30 audit): operators dismissed 26 signals/day
 * but learning_profiles updated once. The feedback never reached the agents
 * that made the original calls. This function fixes that.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface ApplyInput {
  feedback_id: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  try {
    const body = await req.json().catch(() => ({})) as ApplyInput;
    if (!body?.feedback_id) {
      return errorResponse('feedback_id is required', 400);
    }

    // 1. Load feedback row
    const { data: feedback, error: fbError } = await supabase
      .from('feedback_events')
      .select('id, object_type, object_id, feedback, correction, notes')
      .eq('id', body.feedback_id)
      .maybeSingle();
    if (fbError || !feedback) return errorResponse('Feedback not found', 404);
    if (feedback.object_type !== 'signal') {
      return successResponse({ skipped: true, reason: `object_type=${feedback.object_type} not handled` });
    }

    // 2. Load signal + the AI-DECISION-ENGINE analysis row
    const [{ data: signal }, { data: analysis }] = await Promise.all([
      supabase.from('signals').select('id, title, category, severity, normalized_text').eq('id', feedback.object_id).maybeSingle(),
      supabase.from('signal_agent_analyses')
        .select('agent_call_sign, analysis, confidence_score')
        .eq('signal_id', feedback.object_id)
        .eq('agent_call_sign', 'AI-DECISION-ENGINE')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!signal) return errorResponse('Signal not found', 404);
    if (!analysis) {
      return successResponse({ skipped: true, reason: 'No AI-DECISION-ENGINE row for signal — nothing to attribute feedback to' });
    }

    // 3. Form a learning note. The structure mirrors how human coaches give
    // feedback: specific case, what was decided, what should change.
    const correction = (feedback.correction || feedback.notes || feedback.feedback || 'irrelevant').toString().substring(0, 200);
    const learningNote = [
      `## OPERATOR FEEDBACK (${new Date().toISOString().split('T')[0]})`,
      `Signal "${(signal.title || '').substring(0, 100)}" (category: ${signal.category}, severity: ${signal.severity})`,
      `Your reasoning at the time: ${(analysis.analysis || '').substring(0, 300)}`,
      `Operator marked this ${feedback.feedback}: "${correction}".`,
      `Update your pattern recognition for category=${signal.category}: ${feedback.feedback === 'irrelevant' ? 'this PATTERN should score lower for client relevance' : 'this PATTERN was correctly flagged'}.`,
    ].join('\n');

    // 4. Append to agent's system_prompt — only for AI-DECISION-ENGINE since
    // that's the agent whose call we're correcting. NOTE: the existing
    // self-improvement-orchestrator pattern at line ~150 also appends to
    // system_prompt — same mechanism, but this fires per-feedback in real time
    // rather than waiting for the weekly cycle.
    // AI-DECISION-ENGINE is a function, not a registered agent persona — when
    // that's the source, route the feedback to AEGIS-CMD instead. AEGIS-CMD
    // is the command-tier agent that already drives the broader reasoning
    // narrative; growing its prompt with operator corrections is the closest
    // thing to "teach the engine" since the function code itself is static.
    const targetCallSign = analysis.agent_call_sign === 'AI-DECISION-ENGINE'
      ? 'AEGIS-CMD'
      : analysis.agent_call_sign;
    const { data: agentRow } = await supabase
      .from('ai_agents')
      .select('id, system_prompt')
      .eq('call_sign', targetCallSign)
      .maybeSingle();
    if (!agentRow) {
      return successResponse({ skipped: true, reason: `Agent ${targetCallSign} not in ai_agents (original source: ${analysis.agent_call_sign})` });
    }
    const newPrompt = ((agentRow.system_prompt || '') + '\n\n' + learningNote).substring(0, 16000); // cap prompt growth
    const { error: updateError } = await supabase
      .from('ai_agents')
      .update({ system_prompt: newPrompt, updated_at: new Date().toISOString() })
      .eq('id', agentRow.id);
    if (updateError) {
      return errorResponse(`Prompt update failed: ${updateError.message}`, 500);
    }

    // 5. Audit row in self_improvement_log
    await supabase.from('self_improvement_log').insert({
      improvement_type: 'operator_feedback',
      target_agent: targetCallSign,
      title: `Feedback on signal ${signal.id}`,
      description: learningNote,
      proposed_change: learningNote,
      applied: true,
      applied_at: new Date().toISOString(),
    });

    return successResponse({
      applied: true,
      target_agent: targetCallSign,
      original_source: analysis.agent_call_sign,
      signal_id: signal.id,
      feedback: feedback.feedback,
      prompt_growth_chars: learningNote.length,
    });
  } catch (error) {
    console.error('[apply-feedback-to-agent] Fatal:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
