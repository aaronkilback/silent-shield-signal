/**
 * Multi-Agent Debate Protocol (Tier 1) — Structured Edition
 * 
 * Agents submit typed Hypothesis, CounterArgument, and EvidenceCitation
 * objects via tool calling, creating an auditable analytical record.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getAntiHallucinationPrompt, getCriticalDateContext, calculateIncidentAge } from "../_shared/anti-hallucination.ts";
import { buildMemoryContext, storeAgentMemory } from "../_shared/agent-memory.ts";
import { buildGraphContext, discoverIncidentConnections } from "../_shared/knowledge-graph.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";
import { STRUCTURED_DEBATE_TOOLS, STRUCTURED_SYNTHESIS_TOOLS, storeStructuredArguments } from "../_shared/structured-debate.ts";

const DEBATE_AGENTS: Record<string, { model: string; specialty: string; prompt: string }> = {
  'THREAT-ANALYST': {
    model: 'openai/gpt-5.2',
    specialty: 'Threat assessment and risk quantification',
    prompt: `You are THREAT-ANALYST, a senior threat assessment specialist. You MUST use the submit_structured_analysis tool to provide your findings.

Analyze this incident for:
- Threat actor capability and intent assessment
- Attack surface and vulnerability exposure
- Risk quantification (likelihood × impact)
- Threat trajectory prediction

Submit formal hypotheses with confidence levels and evidence citations. Every claim must reference specific data points.`,
  },
  'PATTERN-ANALYST': {
    model: 'openai/gpt-5.2',
    specialty: 'Pattern recognition and behavioral analysis',
    prompt: `You are PATTERN-ANALYST, specializing in behavioral pattern recognition. You MUST use the submit_structured_analysis tool to provide your findings.

Analyze this incident for:
- Behavioral indicators of compromise
- Historical pattern matches
- Anomaly detection results
- Coordinated activity indicators

Submit formal hypotheses with evidence strength ratings. Challenge assumptions with counter-arguments where evidence is ambiguous.`,
  },
  'STRATEGIC-ANALYST': {
    model: 'openai/gpt-5.2',
    specialty: 'Strategic implications and response planning',
    prompt: `You are STRATEGIC-ANALYST, focused on strategic response planning. You MUST use the submit_structured_analysis tool to provide your findings.

Analyze this incident for:
- Strategic implications for the organization
- Response priority and resource allocation
- Escalation criteria and triggers
- Long-term mitigation recommendations

Submit formal hypotheses with priority levels. Include counter-arguments to test the robustness of your own recommendations.`,
  },
};

// Build a debate agent definition from a named ai_agents DB record
function buildNamedAgentDefinition(agent: {
  call_sign: string;
  codename: string;
  persona: string;
  specialty: string;
  system_prompt: string | null;
}): { model: string; specialty: string; prompt: string } {
  return {
    model: 'openai/gpt-5.2',
    specialty: agent.specialty,
    prompt: `${agent.system_prompt || `You are ${agent.codename}, ${agent.persona}`}

You are participating in a structured multi-agent debate. Analyze the question or scenario from the perspective of your unique specialty: ${agent.specialty}.

You MUST use the submit_structured_analysis tool to provide your findings. Structure your response as formal hypotheses with confidence levels. Include counter-arguments where your analysis reveals competing interpretations. Draw on your specific expertise — do not give generic answers. Speak in your established voice and persona.`,
  };
}

const JUDGE_PROMPT = `You are JUDGE-SYNTHESIZER, a senior intelligence officer using GPT-5.2 reasoning. You have received STRUCTURED analyses from multiple specialist agents who examined the same incident WITHOUT seeing each other's work.

Each agent submitted formal hypotheses with confidence levels, counter-arguments, and evidence citations.

Your role:
1. IDENTIFY CONSENSUS: Where do the agents' hypotheses align? Rate combined confidence.
2. IDENTIFY CONFLICTS: Where do hypotheses contradict? Determine which is more credible based on evidence strength.
3. IDENTIFY GAPS: What did one analyst catch that others missed? Assess importance.
4. SYNTHESIZE: Produce a unified assessment with prioritized actions.

You MUST use the submit_synthesis tool to provide your structured ruling.`;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { incident_id, agents, debate_type, call_signs, question } = await req.json();

    // Must have either incident_id (existing mode) or call_signs + question (task force mode)
    if (!incident_id && (!call_signs?.length || !question)) {
      throw new Error('Provide either incident_id, or call_signs[] + question for a task force debate');
    }

    const supabase = createServiceClient();
    const dateContext = getCriticalDateContext();
    const antiHallucination = getAntiHallucinationPrompt();

    // ── Task Force Mode: named agents + free-form question ────────────────
    if (!incident_id && call_signs?.length && question) {
      const { data: agentRows, error: agentErr } = await supabase
        .from('ai_agents')
        .select('id, call_sign, codename, persona, specialty, system_prompt')
        .in('call_sign', call_signs)
        .eq('is_active', true);

      if (agentErr || !agentRows?.length) {
        throw new Error(`No active agents found for call signs: ${call_signs.join(', ')}`);
      }

      // Build agent definitions from DB records
      const namedAgentDefs: Record<string, ReturnType<typeof buildNamedAgentDefinition> & { id: string; call_sign: string }> = {};
      for (const row of agentRows) {
        namedAgentDefs[row.call_sign] = { ...buildNamedAgentDefinition(row), id: row.id, call_sign: row.call_sign };
      }

      const orderedCallSigns = agentRows.map(r => r.call_sign);
      const questionContext = `DEBATE QUESTION:\n${question}\n\nDate: ${dateContext.currentDateISO}`;

      console.log(`[Debate] Task force mode — ${orderedCallSigns.length} named agents debating: "${question.substring(0, 80)}"`);

      // Phase 1: Independent analyses in parallel
      const [memoryContexts] = await Promise.all([
        Promise.all(orderedCallSigns.map(cs => buildMemoryContext(supabase, cs, questionContext))),
      ]);

      const analysisPromises = orderedCallSigns.map(async (callSign: string, idx: number) => {
        const agent = namedAgentDefs[callSign];
        if (!agent) return { agent: callSign, analysis: 'Agent definition not found', error: true };

        const systemPrompt = `${agent.prompt}

${antiHallucination}

${memoryContexts[idx]}

Current date: ${dateContext.currentDateISO}`;

        try {
          const agentResult = await callAiGateway({
            model: agent.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Analyze this question from your specialist perspective using the submit_structured_analysis tool:\n\n${questionContext}` },
            ],
            functionName: `multi-agent-debate/${callSign}`,
            extraBody: {
              max_completion_tokens: 3000,
              temperature: 0.5,
              tools: STRUCTURED_DEBATE_TOOLS,
              tool_choice: { type: 'function', function: { name: 'submit_structured_analysis' } },
            },
          });

          if (agentResult.error) {
            return { agent: callSign, analysis: `Analysis failed: ${agentResult.error}`, structured: null, error: true };
          }

          let structured = null;
          const toolCalls = agentResult.raw?.choices?.[0]?.message?.tool_calls;
          if (toolCalls?.[0]?.function?.arguments) {
            try { structured = JSON.parse(toolCalls[0].function.arguments); } catch { /* fall through */ }
          }

          const analysis = structured
            ? `${structured.overall_assessment}\n\nHypotheses: ${structured.hypotheses?.length || 0}, Counter-arguments: ${structured.counter_arguments?.length || 0}`
            : agentResult.content || 'No analysis produced';

          await storeAgentMemory(supabase, callSign, analysis.substring(0, 1500), {
            memoryType: 'debate',
            confidence: structured?.confidence_level || 0.7,
          });

          return { agent: callSign, specialty: agent.specialty, model: agent.model, analysis, structured, error: false };
        } catch (err) {
          console.error(`[Debate] ${callSign} error:`, err);
          return { agent: callSign, analysis: `Error: ${err}`, structured: null, error: true };
        }
      });

      const individualAnalyses = await Promise.all(analysisPromises);
      const successfulAnalyses = individualAnalyses.filter(a => !a.error);
      if (successfulAnalyses.length === 0) throw new Error('All agents failed to produce analyses');

      // Phase 2: Judge synthesis
      const debateInput = successfulAnalyses.map(a => {
        if (a.structured) {
          return `=== ${a.agent} (${a.specialty}) ===\nHypotheses: ${JSON.stringify(a.structured.hypotheses, null, 1)}\nCounter-Arguments: ${JSON.stringify(a.structured.counter_arguments || [], null, 1)}\nOverall: ${a.structured.overall_assessment}\nConfidence: ${a.structured.confidence_level}`;
        }
        return `=== ${a.agent} (${a.specialty}) ===\n${a.analysis}`;
      }).join('\n\n---\n\n');

      const judgePrompt = `You are JUDGE-SYNTHESIZER, a senior intelligence officer. ${orderedCallSigns.length} specialist agents have each independently analyzed the same question from their unique domain expertise WITHOUT seeing each other's work.

Your role:
1. IDENTIFY CONSENSUS: Where do agents agree? Rate combined confidence.
2. IDENTIFY CONFLICTS: Where do they contradict? Determine which position is more credible based on the strength of reasoning.
3. IDENTIFY GAPS: What did one analyst catch that others missed?
4. SYNTHESIZE: Produce a unified assessment that integrates the best of each perspective.

You MUST use the submit_synthesis tool.`;

      const judgeResult = await callAiGateway({
        model: 'openai/gpt-5.2',
        messages: [
          { role: 'system', content: `${judgePrompt}\n\n${antiHallucination}\nCurrent date: ${dateContext.currentDateISO}` },
          { role: 'user', content: `Question:\n${question}\n\n--- STRUCTURED ANALYSES ---\n${debateInput}` },
        ],
        functionName: 'multi-agent-debate/task-force-judge',
        extraBody: {
          max_completion_tokens: 4000,
          temperature: 0.3,
          tools: STRUCTURED_SYNTHESIS_TOOLS,
          tool_choice: { type: 'function', function: { name: 'submit_synthesis' } },
        },
      });

      let synthesisStructured = null;
      const judgeToolCalls = judgeResult.raw?.choices?.[0]?.message?.tool_calls;
      if (judgeToolCalls?.[0]?.function?.arguments) {
        try { synthesisStructured = JSON.parse(judgeToolCalls[0].function.arguments); } catch { /* fallback */ }
      }

      const synthesis = synthesisStructured?.final_assessment || judgeResult.content || 'Judge synthesis unavailable';
      const consensusScore = synthesisStructured?.consensus_score || 50;

      // Store debate record
      const { data: debateRecord } = await supabase.from('agent_debate_records').insert({
        incident_id: null,
        debate_type: 'task_force',
        participating_agents: orderedCallSigns,
        individual_analyses: individualAnalyses.map(a => ({ agent: a.agent, structured: a.structured, analysis_preview: a.analysis?.substring(0, 500) })),
        synthesis: synthesisStructured || { content: synthesis, consensus_score: consensusScore },
        judge_agent: 'JUDGE-SYNTHESIZER',
        consensus_score: consensusScore / 100,
        final_assessment: synthesis,
        metadata: { question },
      }).select('id').single();

      if (debateRecord?.id) {
        for (const a of successfulAnalyses) {
          if (a.structured) await storeStructuredArguments(supabase, debateRecord.id, a.agent, a.structured);
        }
      }

      return successResponse({
        success: true,
        mode: 'task_force',
        question,
        agents_participated: successfulAnalyses.length,
        individual_analyses: individualAnalyses.map(a => ({
          agent: a.agent,
          specialty: a.specialty,
          has_structured_output: !!a.structured,
          hypotheses_count: a.structured?.hypotheses?.length || 0,
          counter_arguments_count: a.structured?.counter_arguments?.length || 0,
          confidence: a.structured?.confidence_level,
          overall_assessment: a.structured?.overall_assessment || a.analysis,
          hypotheses: a.structured?.hypotheses || [],
          counter_arguments: a.structured?.counter_arguments || [],
          error: a.error,
        })),
        synthesis: synthesisStructured || { content: synthesis },
        consensus_score: consensusScore,
        consensus_hypotheses: synthesisStructured?.consensus_hypotheses || [],
        contested_findings: synthesisStructured?.contested_findings || [],
        unique_insights: synthesisStructured?.unique_insights || [],
        recommended_actions: synthesisStructured?.recommended_actions || [],
        debate_record_id: debateRecord?.id,
      });
    }

    // ── Original Incident Mode ────────────────────────────────────────────
    if (!incident_id) throw new Error('incident_id is required');

    const { data: incident, error: incErr } = await supabase
      .from('incidents')
      .select('*, signals!incidents_signal_id_fkey(*), clients(*)')
      .eq('id', incident_id)
      .single();

    if (incErr || !incident) {
      console.error('[Debate] Incident query error:', JSON.stringify(incErr), 'incident_id:', incident_id);
      throw new Error(`Incident not found: ${incErr?.message || 'no data returned'}`);
    }

    // Auto-select named roster agents when no specific agents are requested.
    // Build a relevance query from the incident category + signal text, then pick
    // 3 agents whose specialty best matches. Fall back to generic analysts if DB
    // lookup fails or returns fewer than 2 named agents.
    let selectedAgents: string[];
    if (agents) {
      selectedAgents = agents;
    } else {
      try {
        const matchText = [incident.signals?.category, incident.signals?.normalized_text?.substring(0, 200)].filter(Boolean).join(' ');
        const { data: rosterAgents } = await supabase
          .from('ai_agents')
          .select('call_sign, specialty')
          .eq('is_active', true)
          .not('system_prompt', 'is', null)
          .limit(50);

        if (rosterAgents && rosterAgents.length >= 2) {
          // Score each agent by word-overlap between specialty and incident context
          const matchWords = new Set((matchText.toLowerCase().match(/\w{4,}/g) || []));
          const scored = rosterAgents
            .map((a: any) => {
              const specWords = (a.specialty || '').toLowerCase().match(/\w{4,}/g) || [];
              const hits = specWords.filter((w: string) => matchWords.has(w)).length;
              return { call_sign: a.call_sign, score: hits };
            })
            .sort((a: any, b: any) => b.score - a.score)
            .slice(0, 3);

          // Only use named agents if we got at least 2 with any relevance; otherwise fallback
          const relevant = scored.filter((a: any) => a.score > 0);
          selectedAgents = relevant.length >= 2
            ? scored.map((a: any) => a.call_sign)
            : ['THREAT-ANALYST', 'PATTERN-ANALYST', 'STRATEGIC-ANALYST'];
        } else {
          selectedAgents = ['THREAT-ANALYST', 'PATTERN-ANALYST', 'STRATEGIC-ANALYST'];
        }
      } catch {
        selectedAgents = ['THREAT-ANALYST', 'PATTERN-ANALYST', 'STRATEGIC-ANALYST'];
      }
    }
    const incidentAge = calculateIncidentAge({ id: incident.id, opened_at: incident.opened_at });

    const incidentContext = `
INCIDENT: ${incident.id}
Priority: ${incident.priority?.toUpperCase()} | Status: ${incident.status}
Title: ${incident.title || 'N/A'}
Opened: ${incident.opened_at} (${incidentAge.ageLabel})
Signal: ${incident.signals?.normalized_text || 'N/A'}
Category: ${incident.signals?.category || 'N/A'}
Severity: ${incident.signals?.severity || 'N/A'}
Location: ${incident.signals?.location || 'N/A'}
Client: ${incident.clients?.name || 'N/A'} (${incident.clients?.industry || 'N/A'})
Entity Tags: ${incident.signals?.entity_tags?.join(', ') || 'None'}
`;

    const [memoryContexts, graphContext, graphEdges] = await Promise.all([
      Promise.all(selectedAgents.map((a: string) => buildMemoryContext(supabase, a, incidentContext))),
      buildGraphContext(supabase, incident_id),
      discoverIncidentConnections(supabase, incident_id, 'debate-protocol'),
    ]);

    console.log(`[Debate] Starting ${selectedAgents.length}-agent debate for incident ${incident_id} (${graphEdges.length} graph connections found)`);

    // Phase 1: Independent analyses in parallel
    const analysisPromises = selectedAgents.map(async (agentKey: string, idx: number) => {
      const agent = DEBATE_AGENTS[agentKey];
      if (!agent) return { agent: agentKey, analysis: 'Agent not found', error: true };

      const systemPrompt = `${agent.prompt}

${antiHallucination}

${memoryContexts[idx]}
${graphContext}

CRITICAL: Base ALL findings on provided evidence. Label assumptions vs confirmed facts. Include confidence levels.
Current date: ${dateContext.currentDateISO}`;

      try {
        const agentResult = await callAiGateway({
          model: agent.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze this incident independently using the submit_structured_analysis tool:\n${incidentContext}` },
          ],
          functionName: `multi-agent-debate/${agentKey}`,
          extraBody: {
            max_completion_tokens: 3000,
            temperature: 0.5,
            tools: STRUCTURED_DEBATE_TOOLS,
            tool_choice: { type: 'function', function: { name: 'submit_structured_analysis' } },
          },
        });

        if (agentResult.error) {
          console.error(`[Debate] ${agentKey} failed:`, agentResult.error);
          return { agent: agentKey, analysis: `Analysis failed: ${agentResult.error}`, structured: null, error: true };
        }

        // Extract structured tool call
        let structured = null;
        const toolCalls = agentResult.raw?.choices?.[0]?.message?.tool_calls;
        if (toolCalls?.[0]?.function?.arguments) {
          try {
            structured = JSON.parse(toolCalls[0].function.arguments);
          } catch { /* fall back to content */ }
        }

        const analysis = structured 
          ? `${structured.overall_assessment}\n\nHypotheses: ${structured.hypotheses?.length || 0}, Counter-arguments: ${structured.counter_arguments?.length || 0}`
          : agentResult.content || 'No analysis produced';

        await storeAgentMemory(supabase, agentKey, analysis.substring(0, 1500), {
          incidentId: incident_id,
          clientId: incident.client_id,
          memoryType: 'investigation',
          entities: incident.signals?.entity_tags || [],
          confidence: structured?.confidence_level || 0.7,
        });

        return { agent: agentKey, specialty: agent.specialty, model: agent.model, analysis, structured, error: false };
      } catch (err) {
        console.error(`[Debate] ${agentKey} error:`, err);
        return { agent: agentKey, analysis: `Error: ${err}`, structured: null, error: true };
      }
    });

    const individualAnalyses = await Promise.all(analysisPromises);
    const successfulAnalyses = individualAnalyses.filter(a => !a.error);

    if (successfulAnalyses.length === 0) {
      throw new Error('All agents failed to produce analyses');
    }

    console.log(`[Debate] ${successfulAnalyses.length}/${selectedAgents.length} agents completed structured analysis`);

    // Phase 2: Judge synthesizes with structured tool
    const debateInput = successfulAnalyses.map(a => {
      if (a.structured) {
        return `=== ${a.agent} (${a.specialty}) ===\nModel: ${a.model}\nHypotheses: ${JSON.stringify(a.structured.hypotheses, null, 1)}\nCounter-Arguments: ${JSON.stringify(a.structured.counter_arguments || [], null, 1)}\nOverall: ${a.structured.overall_assessment}\nConfidence: ${a.structured.confidence_level}`;
      }
      return `=== ${a.agent} (${a.specialty}) ===\nModel: ${a.model}\n${a.analysis}`;
    }).join('\n\n---\n\n');

    const judgeResult = await callAiGateway({
      model: 'openai/gpt-5.2',
      messages: [
        { role: 'system', content: `${JUDGE_PROMPT}\n\n${antiHallucination}\nCurrent date: ${dateContext.currentDateISO}` },
        { role: 'user', content: `Incident Context:\n${incidentContext}\n\n--- STRUCTURED ANALYSES ---\n${debateInput}` },
      ],
      functionName: 'multi-agent-debate/judge',
      extraBody: {
        max_completion_tokens: 4000,
        temperature: 0.3,
        tools: STRUCTURED_SYNTHESIS_TOOLS,
        tool_choice: { type: 'function', function: { name: 'submit_synthesis' } },
      },
      dlqOnFailure: true,
      dlqPayload: { incident_id, agents: selectedAgents },
    });

    // Extract structured synthesis
    let synthesisStructured = null;
    const judgeToolCalls = judgeResult.raw?.choices?.[0]?.message?.tool_calls;
    if (judgeToolCalls?.[0]?.function?.arguments) {
      try { synthesisStructured = JSON.parse(judgeToolCalls[0].function.arguments); } catch { /* fallback */ }
    }

    const synthesis = synthesisStructured?.final_assessment || judgeResult.content || 'Judge synthesis unavailable';
    const consensusScore = synthesisStructured?.consensus_score || 50;

    // Store debate record
    const { data: debateRecord } = await supabase.from('agent_debate_records').insert({
      incident_id,
      debate_type: debate_type || 'structured',
      participating_agents: selectedAgents,
      individual_analyses: individualAnalyses.map(a => ({ agent: a.agent, structured: a.structured, analysis_preview: a.analysis?.substring(0, 500) })),
      synthesis: synthesisStructured || { content: synthesis, consensus_score: consensusScore },
      judge_agent: 'JUDGE-SYNTHESIZER',
      consensus_score: consensusScore / 100,
      final_assessment: synthesis,
    }).select('id').single();

    // Store structured arguments for audit trail
    if (debateRecord?.id) {
      for (const a of successfulAnalyses) {
        if (a.structured) {
          await storeStructuredArguments(supabase, debateRecord.id, a.agent, a.structured);
        }
      }
    }

    // Update incident timeline
    const { data: currentIncident } = await supabase
      .from('incidents')
      .select('timeline_json')
      .eq('id', incident_id)
      .single();

    const timeline = currentIncident?.timeline_json || [];
    timeline.push({
      timestamp: new Date().toISOString(),
      event: 'Structured Multi-Agent Debate Complete',
      details: `${successfulAnalyses.length} agents debated with structured tool-calling. Consensus: ${consensusScore}%. Judge: GPT-5.2. ${synthesisStructured?.consensus_hypotheses?.length || 0} consensus hypotheses, ${synthesisStructured?.contested_findings?.length || 0} contested findings.`,
      actor: 'DEBATE-PROTOCOL-V2',
    });

    await supabase.from('incidents').update({
      timeline_json: timeline,
      investigation_status: 'in_progress',
      updated_at: new Date().toISOString(),
    }).eq('id', incident_id);

    return successResponse({
      success: true,
      incident_id,
      debate_type: 'structured',
      agents_participated: successfulAnalyses.length,
      individual_analyses: individualAnalyses.map(a => ({
        agent: a.agent,
        specialty: a.specialty,
        model: a.model,
        has_structured_output: !!a.structured,
        hypotheses_count: a.structured?.hypotheses?.length || 0,
        counter_arguments_count: a.structured?.counter_arguments?.length || 0,
        confidence: a.structured?.confidence_level,
        analysis_preview: a.analysis?.substring(0, 500),
        error: a.error,
      })),
      synthesis: synthesisStructured || { content: synthesis },
      consensus_score: consensusScore,
      consensus_hypotheses: synthesisStructured?.consensus_hypotheses || [],
      contested_findings: synthesisStructured?.contested_findings || [],
      unique_insights: synthesisStructured?.unique_insights || [],
      recommended_actions: synthesisStructured?.recommended_actions || [],
      graph_connections: graphEdges.length,
      debate_record_id: debateRecord?.id,
    });
  } catch (error) {
    console.error('[Debate] Error:', error);
    await logError(error, { functionName: 'multi-agent-debate', severity: 'error' });
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('402') || msg.includes('credits')) {
      return errorResponse('AI credits exhausted. Please add credits in Settings → Workspace → Usage.', 402);
    }
    return errorResponse(msg, 500);
  }
});