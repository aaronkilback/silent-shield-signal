import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json().catch(() => ({}));
    const { dry_run = false } = body;

    const supabase = createServiceClient();
    const report: string[] = [];
    const actions: Array<{ type: string; agent?: string; detail: string }> = [];

    const hb = await startHeartbeat(supabase, 'self-improvement-nightly');

    console.log('[self-improvement] Starting improvement cycle...');

    // ── 1. Load calibration scores ─────────────────────────────────────────
    const { data: calibrations } = await supabase
      .from('agent_calibration_scores')
      .select('*')
      .order('calibration_score', { ascending: true });

    const underperformers = (calibrations || []).filter(
      (c: any) => c.total_predictions > 3 && c.calibration_score < 0.60
    );

    console.log(`[self-improvement] ${underperformers.length} underperforming agents found`);

    // ── 2. Find agents with no learning activity this week ────────────────
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: recentSessions } = await supabase
      .from('agent_learning_sessions')
      .select('agent_id')
      .gte('created_at', weekAgo);

    const activeAgentIds = new Set((recentSessions || []).map((s: any) => s.agent_id));

    const { data: allAgents } = await supabase
      .from('ai_agents')
      .select('id, call_sign, specialty')
      .eq('is_active', true);

    const dormantAgents = (allAgents || []).filter(
      (a: any) => !activeAgentIds.has(a.id)
    );
    console.log(`[self-improvement] ${dormantAgents.length} dormant agents (no learning this week)`);

    // ── 3. Find refuted predictions to learn from failures ────────────────
    const { data: refutedPredictions } = await supabase
      .from('debate_predictions')
      .select('call_sign, hypothesis, domain')
      .eq('outcome', 'refuted')
      .gte('created_at', weekAgo)
      .limit(20);

    // Group by agent
    const failuresByAgent: Record<string, string[]> = {};
    for (const pred of (refutedPredictions || [])) {
      if (!failuresByAgent[pred.call_sign]) failuresByAgent[pred.call_sign] = [];
      failuresByAgent[pred.call_sign].push(pred.hypothesis);
    }

    // ── 3b. Inject calibration bias corrections into system prompts ──────
    // This closes the loop: Brier scores → measured prompt adjustments
    const { data: brierScores } = await supabase
      .from('agent_calibration_scores')
      .select('call_sign, brier_score_mean, predictions_scored, last_updated_at')
      .not('brier_score_mean', 'is', null)
      .gte('predictions_scored', 5)
      .order('brier_score_mean', { ascending: false }); // worst (highest Brier) first

    const BRIER_THRESHOLD = 0.25; // scores above this indicate poor calibration
    const miscalibratedAgents = (brierScores || []).filter((s: any) => s.brier_score_mean > BRIER_THRESHOLD);

    for (const agent of miscalibratedAgents) {
      // Check if we've already injected a calibration note recently (last 7 days)
      const { data: existingAgent } = await supabase
        .from('ai_agents')
        .select('id, system_prompt, call_sign')
        .eq('call_sign', agent.call_sign)
        .maybeSingle();

      if (!existingAgent) continue;

      const hasRecentCalibration = (existingAgent.system_prompt || '').includes('CALIBRATION CORRECTION');
      if (hasRecentCalibration) continue;

      // Compute how overconfident they are
      // Brier = (p - outcome)^2, mean 0.25 = roughly 50% off on predictions
      // Brier 0.25-0.35 = moderate overconfidence, 0.35+ = severe
      const severity = agent.brier_score_mean > 0.35 ? 'severe' : 'moderate';
      const adjustmentPct = severity === 'severe' ? 20 : 12;

      const calibrationNote = `\n\n## CALIBRATION CORRECTION (applied ${new Date().toISOString().split('T')[0]})\n` +
        `Your historical prediction Brier score is ${(agent.brier_score_mean * 100).toFixed(1)}% — indicating ${severity} overconfidence in your assessments. ` +
        `You have been systematically claiming higher confidence than your predictions warrant.\n` +
        `MANDATORY ADJUSTMENT: Reduce all confidence estimates by approximately ${adjustmentPct}% from your initial assessment. ` +
        `If you would say "I am 85% confident", say "I am ${85 - adjustmentPct}% confident" instead. ` +
        `Use language like "suggests", "indicates", "likely" more frequently. ` +
        `Reserve "highly confident" and "near certain" for cases with multiple independent confirming sources only.`;

      if (!dry_run) {
        await supabase
          .from('ai_agents')
          .update({
            system_prompt: (existingAgent.system_prompt || '') + calibrationNote,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingAgent.id);
      }

      report.push(`📊 Injected calibration correction into ${agent.call_sign}: Brier=${(agent.brier_score_mean * 100).toFixed(1)}% (${severity}), -${adjustmentPct}% adjustment`);
      actions.push({ type: 'calibration_correction', agent: agent.call_sign, detail: `Brier ${(agent.brier_score_mean * 100).toFixed(1)}%, ${severity} overconfidence` });
    }

    // ── 4. Apply pending self-improvement proposals ───────────────────────
    const { data: pendingImprovements } = await supabase
      .from('self_improvement_log')
      .select('*')
      .eq('applied', false)
      .not('proposed_change', 'is', null)
      .not('target_agent', 'is', null)
      .limit(10);

    let promptsUpdated = 0;
    for (const improvement of (pendingImprovements || [])) {
      if (!improvement.target_agent || !improvement.proposed_change) continue;

      // Get current system prompt
      const { data: agentRow } = await supabase
        .from('ai_agents')
        .select('id, system_prompt')
        .eq('call_sign', improvement.target_agent)
        .maybeSingle();

      if (!agentRow) continue;

      const newPrompt = (agentRow.system_prompt || '') + '\n\n' +
        `## LEARNED IMPROVEMENT (${new Date().toISOString().split('T')[0]})\n${improvement.proposed_change}`;

      if (!dry_run) {
        await supabase
          .from('ai_agents')
          .update({ system_prompt: newPrompt, updated_at: new Date().toISOString() })
          .eq('id', agentRow.id);

        await supabase
          .from('self_improvement_log')
          .update({ applied: true, applied_at: new Date().toISOString() })
          .eq('id', improvement.id);
      }

      promptsUpdated++;
      actions.push({ type: 'prompt_update', agent: improvement.target_agent, detail: improvement.title });
      report.push(`✅ Applied improvement to ${improvement.target_agent}: "${improvement.title}"`);
    }

    // ── 5. Trigger targeted learning for underperformers ──────────────────
    let learningTriggered = 0;
    const learnTargets: Array<{ call_sign: string; reason: string }> = [
      ...underperformers.map((u: any) => ({ call_sign: u.call_sign, reason: `calibration ${Math.round(u.calibration_score * 100)}%` })),
      ...dormantAgents.slice(0, 3).map((a: any) => ({ call_sign: a.call_sign, reason: 'dormant' })),
    ];

    for (const target of learnTargets.slice(0, 5)) {
      const failures = failuresByAgent[target.call_sign] || [];
      const failureTopic = failures.length > 0
        ? `specifically improve accuracy on: ${failures[0].substring(0, 100)}`
        : '';

      console.log(`[self-improvement] Triggering learning for ${target.call_sign} (${target.reason})`);

      if (!dry_run) {
        await supabase.functions.invoke('agent-knowledge-seeker', {
          body: {
            agent_call_sign: target.call_sign,
            angles: ['frameworks', 'case_studies', 'emerging', 'practitioners'],
            force: false,
          },
        });
      }

      learningTriggered++;
      actions.push({ type: 'learning_triggered', agent: target.call_sign, detail: target.reason + (failureTopic ? ` — ${failureTopic}` : '') });
      report.push(`📚 Triggered learning for ${target.call_sign}: ${target.reason}`);
    }

    // ── 6. Use AI to identify systemic improvement opportunities ──────────
    const systemPromptContent = `You are the Fortress AI self-improvement coordinator. Analyze this week's operational data and identify the 3 most impactful improvements to make to the agent network.

Data:
- Underperforming agents: ${underperformers.map((u: any) => `${u.call_sign} (calibration: ${Math.round(u.calibration_score * 100)}%)`).join(', ') || 'none'}
- Dormant agents (no learning): ${dormantAgents.map((a: any) => a.call_sign).join(', ') || 'none'}
- Recent prediction failures: ${Object.entries(failuresByAgent).map(([k, v]) => `${k}: ${v.length} failures`).join(', ') || 'none'}
- System prompt updates applied: ${promptsUpdated}
- Knowledge hunts triggered: ${learningTriggered}

Return a JSON array of improvement recommendations:
[
  {
    "improvement_type": "routing|prompt|knowledge|calibration",
    "target_agent": "CALL_SIGN or null for global",
    "title": "short title",
    "description": "what to improve and why",
    "proposed_change": "specific text to add to agent system prompt, or null"
  }
]
Return ONLY the JSON array.`;

    const aiResult = await callAiGateway({
      model: 'openai/gpt-5.2',
      messages: [
        { role: 'system', content: systemPromptContent },
        { role: 'user', content: 'Generate improvement recommendations for this week.' },
      ],
      functionName: 'self-improvement-orchestrator/analyze',
      extraBody: { max_completion_tokens: 1500, temperature: 0.3 },
      skipGuardrails: true,
    });

    if (aiResult.content && !aiResult.error) {
      try {
        const cleaned = aiResult.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        const improvements = JSON.parse(cleaned);
        if (Array.isArray(improvements) && !dry_run) {
          const rows = improvements.map((imp: any) => ({
            improvement_type: imp.improvement_type || 'general',
            target_agent: imp.target_agent || null,
            title: imp.title || 'Untitled',
            description: imp.description || '',
            proposed_change: imp.proposed_change || null,
            applied: false,
          }));
          await supabase.from('self_improvement_log').insert(rows);
          report.push(`🧠 AI generated ${rows.length} new improvement proposals`);
          actions.push({ type: 'ai_proposals', detail: `${rows.length} proposals queued` });
        }
      } catch (_) {}
    }

    // ── 7. Trigger embedding of any new knowledge ──────────────────────────
    if (!dry_run) {
      supabase.functions.invoke('semantic-embed-knowledge', {
        body: { force: false, embed_agents: true }
      }).catch((e: Error) => console.error('[self-improvement] Embedding trigger failed:', e));
    }

    // ── 8. Store orchestration record ─────────────────────────────────────
    if (!dry_run) {
      await supabase.from('self_improvement_log').insert({
        improvement_type: 'orchestration_cycle',
        title: `Self-improvement cycle ${new Date().toISOString().split('T')[0]}`,
        description: report.join('\n'),
        applied: true,
        applied_at: new Date().toISOString(),
      });
    }

    await completeHeartbeat(supabase, hb, { prompts_updated: promptsUpdated, learning_triggered: learningTriggered, underperformers: underperformers.length, dormant_agents: dormantAgents.length });

    return successResponse({
      cycle_complete: true,
      dry_run,
      underperformers: underperformers.length,
      dormant_agents: dormantAgents.length,
      prompts_updated: promptsUpdated,
      learning_triggered: learningTriggered,
      actions,
      report,
    });

  } catch (err) {
    console.error('[self-improvement] Error:', err);
    await failHeartbeat(createServiceClient(), { id: null, jobName: 'self-improvement-nightly', startedAt: Date.now() }, err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
