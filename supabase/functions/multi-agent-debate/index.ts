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

/**
 * AEGIS-CMD as judge — used when debate_type === 'command_synthesis'.
 * Loads AEGIS's real system_prompt from ai_agents and appends the
 * 5-part Command Synthesis structural directive that AEGIS's persona
 * already prescribes. This makes AEGIS the actual commander it claims
 * to be in the persona, rather than just another participant.
 *
 * Falls back to the generic JUDGE_PROMPT if AEGIS's row can't be
 * loaded — pipeline must not fail because of a missing agent record.
 */
async function loadAegisJudgePrompt(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from('ai_agents')
      .select('system_prompt')
      .eq('call_sign', 'AEGIS-CMD')
      .maybeSingle();
    const persona = data?.system_prompt;
    if (!persona) return JUDGE_PROMPT;

    return `${persona}

═══ COMMAND SYNTHESIS DIRECTIVE ═══

You are operating as the JUDGE for this multi-agent debate. Multiple specialists have produced independent analyses without seeing each other's work. Your role is to integrate, not duplicate.

Required output structure (use the submit_synthesis tool):
1. SITUATION SUMMARY: Multi-domain integrated view of what's happening. 2-3 sentences. Plain language with domain terms only when essential for precision.
2. AGENT ASSESSMENTS SYNTHESIZED: For each specialist, ONE LINE summarizing what they found. Name the specialist and their finding.
3. COMMAND JUDGMENT: The integrated bottom-line. Where specialists agreed, state the consensus. Where they disagreed, state both views with their basis. Do not impose your own view over a specialist's domain expertise.
4. RECOMMENDED ACTIONS: Prioritized, assigned. Each action names the responsible party and a rough timeline.
5. ONGOING COORDINATION: Which agents stay tasked, for what specific question, by when.

Voice: clear common language so a non-specialist client can follow, but use domain terminology when precision requires it. Do not over-simplify away substance.

Precision rules:
- The command layer integrates; it does not overrule specialists in their lane.
- If specialists disagree, present both views — do not pick a winner unless one has clearly stronger evidence.
- Cite which specialist said what; attribution is part of the audit trail.`;
  } catch {
    return JUDGE_PROMPT;
  }
}

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
            // gpt-5.2 is a reasoning model and rejects custom
            // temperature / max_completion_tokens / forced
            // tool_choice. Earlier calls passed all three, which is
            // why every call failed — the working `ai-decision-engine`
            // gpt-5.2 invocation only passes `tools`. Match that
            // shape; let the model decide whether to call the tool
            // (it does in practice because the tool is the only one
            // exposed and the user prompt explicitly asks for it).
            extraBody: {
              tools: STRUCTURED_DEBATE_TOOLS,
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
        // gpt-5.2 reasoning model: tools-only payload, no
        // temperature/max_completion_tokens/forced tool_choice.
        extraBody: {
          tools: STRUCTURED_SYNTHESIS_TOOLS,
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

    // ── Specialty routing (Day 2 of plan) ─────────────────────────
    // Domain-specific routing map, keyed off signal.category and
    // keyword patterns in signal text + entity_tags. Replaces the
    // earlier word-overlap selector which fell back to generic
    // THREAT/PATTERN/STRATEGIC analysts for any signal not matching
    // an agent's specialty by literal word — which was almost every
    // signal because corporate intelligence terminology rarely
    // overlaps verbatim with persona specialty descriptions.
    //
    // The map below routes by signal type:
    //   - financial / corporate / capex → FININT, CHAIN-WATCH, MERIDIAN
    //   - wildfire / fire → WILDFIRE, GUARDIAN
    //   - cyber → NEO, VECTOR
    //   - activism / protest → ECHO-WATCH, INSIDE-EYE
    //   - etc.
    //
    // Each route picks 3 specialists. AEGIS-CMD is the judge (set via
    // command_synthesis debate_type), so 3 specialists + AEGIS = a
    // 4-agent analysis with specialty-curated participants. Falls
    // back to generic analysts only when no route matches AND no
    // active agents have any relevance score — that's the genuinely-
    // unclassifiable case.
    const SPECIALTY_ROUTES: Array<{
      label: string;
      categoryMatch?: RegExp;
      keywordMatch?: RegExp;
      entityMatch?: RegExp;
      agents: string[];
    }> = [
      // Wildfire / fire
      { label: 'wildfire',
        categoryMatch: /^(wildfire|natural_disaster)$/i,
        keywordMatch: /\b(wildfire|hotspot|thermal anomaly|VIIRS|FBP|FWI|fire perimeter|BCWS)\b/i,
        agents: ['WILDFIRE', 'GUARDIAN', 'CHAIN-WATCH'],
      },
      // Cyber threats
      { label: 'cyber',
        categoryMatch: /^(malware|phishing|intrusion|data_exfil|ddos|ransomware)$/i,
        keywordMatch: /\b(CVE-|exploit|payload|C2|backdoor|credential dump|TTP|MITRE|APT|IOC)\b/i,
        agents: ['NEO', 'VECTOR', 'GUARDIAN'],
      },
      // Activism / protest / Indigenous land defense
      { label: 'activism',
        categoryMatch: /^(activism|protest)$/i,
        keywordMatch: /\b(blockade|protest|land defender|encampment|direct action|Wet'suwet'en|Coastal GasLink|Stand\.earth|pipeline opposition)\b/i,
        agents: ['ECHO-WATCH', 'INSIDE-EYE', 'MERIDIAN'],
      },
      // Insider threat / counterintel
      { label: 'insider',
        categoryMatch: /^(insider_threat|surveillance)$/i,
        keywordMatch: /\b(insider|employee|contractor|privileged access|data exfil|HUMINT|counterintel)\b/i,
        agents: ['INSIDE-EYE', 'SPECTER', 'GUARDIAN'],
      },
      // Active / physical threat
      { label: 'physical_threat',
        categoryMatch: /^(active_threat|physical_threat|sabotage|crime)$/i,
        keywordMatch: /\b(weapon|active shooter|kidnap|bomb|sabotage|breach attempt|prowler|trespass)\b/i,
        agents: ['GUARDIAN', 'INSIDE-EYE', 'VERIDIAN-TANGO'],
      },
      // Regulatory / litigation / legal
      { label: 'legal_regulatory',
        categoryMatch: /^(regulatory|litigation|compliance|injunction)$/i,
        keywordMatch: /\b(regulator|injunction|FINTRAC|sanctions|treaty|consultation duty|environmental review)\b/i,
        agents: ['PEARSON', 'MERIDIAN', 'CERBERUS'],
      },
      // Financial / corporate intelligence — covers TC Energy capex,
      // earnings, M&A, investor relations, capital allocation news.
      // The TC Energy Columbia Gas signal that exposed this gap fits
      // here. Keyword match catches corporate signals that arrive
      // categorized as 'other'.
      { label: 'financial_corporate',
        categoryMatch: /^(other|social_sentiment)$/i,
        keywordMatch: /\b(TC Energy|Coastal GasLink|CGL|Petronas|LNG Canada|capital decision|capex|investment decision|earnings|FID|approved\s+the\s+\$|billion project|acquisition|M&A|FINTRAC|beneficial owner|sanction)\b/i,
        agents: ['FININT', 'CHAIN-WATCH', 'MERIDIAN'],
      },
      // Hazmat / environmental incident
      { label: 'hazmat_environmental',
        categoryMatch: /^(hazmat|flood)$/i,
        keywordMatch: /\b(hazmat|spill|release|toxic|contamination|flood|storm surge)\b/i,
        agents: ['WILDFIRE', 'GUARDIAN', 'PEARSON'],
      },
      // Civil emergency — broad category covering NAAD alerts that
      // don't cleanly fit weather/wildfire/flood: missing persons,
      // RCMP operations, evacuation orders, ice jams, civil unrest.
      // GUARDIAN handles protective intel, MERIDIAN handles regional
      // policy/jurisdictional context, MCM-ICS handles incident
      // command for evacuation/response coordination.
      { label: 'civil_emergency',
        categoryMatch: /^civil_emergency$/i,
        keywordMatch: /\b(NAAD|emergency alert|evacuation|missing person|RCMP|ice jam|amber alert|civil unrest)\b/i,
        agents: ['GUARDIAN', 'MERIDIAN', 'MCM-ICS'],
      },
    ];

    let selectedAgents: string[];
    let routeLabel = 'unrouted';
    if (agents) {
      selectedAgents = agents;
      routeLabel = 'caller-supplied';
    } else {
      const sigCategory = String(incident.signals?.category || '').toLowerCase();
      const sigText = String(incident.signals?.normalized_text || '');
      const sigEntityTags = Array.isArray(incident.signals?.entity_tags)
        ? incident.signals.entity_tags.join(' ')
        : '';
      const matchSurface = `${sigText} ${sigEntityTags}`;

      // Find first matching route. Order matters — more specific
      // matches (cyber, insider) come before broader ones
      // (financial_corporate, which can match category='other').
      let route: typeof SPECIALTY_ROUTES[number] | null = null;
      for (const r of SPECIALTY_ROUTES) {
        const catHit = r.categoryMatch ? r.categoryMatch.test(sigCategory) : false;
        const kwHit = r.keywordMatch ? r.keywordMatch.test(matchSurface) : false;
        // Route fires if EITHER category matches OR keyword fires.
        // Both is stronger but either is sufficient — keywords often
        // catch signals miscategorized as 'other'.
        if (catHit || kwHit) {
          route = r;
          break;
        }
      }

      if (route) {
        selectedAgents = route.agents;
        routeLabel = route.label;
        console.log(`[Debate] Routed signal to specialty: ${route.label} → ${route.agents.join(', ')}`);
      } else {
        // No specialty route matched — fall back to generic. This
        // should be rare after the routing table is tuned for the
        // operator's actual signal mix.
        selectedAgents = ['THREAT-ANALYST', 'PATTERN-ANALYST', 'STRATEGIC-ANALYST'];
        console.log(`[Debate] No specialty route matched (category=${sigCategory}); falling back to generic analysts`);
      }
    }
    const incidentAge = calculateIncidentAge({ id: incident.id, opened_at: incident.opened_at });

    // ── Client brief construction (Day 2 of plan) ─────────────────
    // Inject the client's operational profile so specialists can
    // connect a generic-looking signal (e.g. "TC Energy approves
    // $1.5B project") to client-specific implications (TC Energy is
    // Petronas's pipeline transporter via CGL, capital decisions at
    // TC Energy affect Petronas's transport capacity, etc.). Without
    // this, even FININT can't make the connection because nothing in
    // the signal text says "this matters to Petronas because…".
    //
    // The clients table already stores monitoring_keywords (entity
    // names + topics they care about), locations (operational areas),
    // and high_value_assets (specific HVAs to protect). All three
    // are already maintained per-client.
    const cli: any = incident.clients || {};
    const clientKeywords = Array.isArray(cli.monitoring_keywords) ? cli.monitoring_keywords : [];
    const clientLocations = Array.isArray(cli.locations) ? cli.locations : [];
    const clientHVAs = Array.isArray(cli.high_value_assets) ? cli.high_value_assets : [];

    const clientBriefBlock = (cli.name)
      ? `
CLIENT BRIEF — ${cli.name}${cli.industry ? ` (${cli.industry})` : ''}
${cli.description ? `Profile: ${String(cli.description).substring(0, 300)}` : ''}
${clientLocations.length > 0 ? `Operational Locations: ${clientLocations.slice(0, 8).join('; ')}` : ''}
${clientHVAs.length > 0 ? `High-Value Assets: ${clientHVAs.slice(0, 8).map((a: any) => typeof a === 'string' ? a : a?.name || JSON.stringify(a).substring(0, 50)).join('; ')}` : ''}
${clientKeywords.length > 0 ? `Monitoring Scope (key terms / entities they track): ${clientKeywords.slice(0, 12).join(', ')}` : ''}

When analyzing the signal below, frame your assessment in terms of THIS client's operational reality. A signal that looks generic on the surface may have direct implications for ${cli.name} via supply-chain dependencies, regulatory exposure, asset proximity, or competitive positioning. Connect the dots between signal content and client interests — that's the analytical value the operator is paying for.
`
      : '';

    const incidentContext = `${clientBriefBlock}
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

    // The auto-selection path above can return DB roster call_signs
    // (e.g. NEO, OUROBOROS, MERIDIAN) that aren't keys in the
    // hardcoded DEBATE_AGENTS map. Until May 2026 those roster
    // agents fell straight through to "Agent not found", which
    // collapsed every debate run with "All agents failed to produce
    // analyses". Fetch the DB rows for any non-hardcoded call_sign
    // and build named agent definitions on the fly — same approach
    // as the Task Force branch.
    const missingFromMap = selectedAgents.filter((cs: string) => !DEBATE_AGENTS[cs]);
    const dynamicAgents: Record<string, { model: string; specialty: string; prompt: string }> = {};
    if (missingFromMap.length > 0) {
      const { data: rosterRows } = await supabase
        .from('ai_agents')
        .select('call_sign, codename, persona, specialty, system_prompt')
        .in('call_sign', missingFromMap)
        .eq('is_active', true);
      for (const row of rosterRows || []) {
        dynamicAgents[row.call_sign] = buildNamedAgentDefinition(row);
      }
    }

    // Phase 1: Independent analyses in parallel
    const analysisPromises = selectedAgents.map(async (agentKey: string, idx: number) => {
      const agent = DEBATE_AGENTS[agentKey] ?? dynamicAgents[agentKey];
      if (!agent) return { agent: agentKey, analysis: 'Agent not found in roster', error: true };

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
          // gpt-5.2 reasoning model: tools-only payload.
          extraBody: {
            tools: STRUCTURED_DEBATE_TOOLS,
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

    // command_synthesis debate type: AEGIS-CMD adjudicates with its
    // real persona + 5-part Command Synthesis structural directive.
    // For all other types, the generic JUDGE-SYNTHESIZER persona runs.
    const isCommandSynthesis = debate_type === 'command_synthesis';
    const judgePromptText = isCommandSynthesis
      ? await loadAegisJudgePrompt(supabase)
      : JUDGE_PROMPT;
    const judgeCallSign = isCommandSynthesis ? 'AEGIS-CMD' : 'JUDGE-SYNTHESIZER';

    const judgeResult = await callAiGateway({
      model: 'openai/gpt-5.2',
      messages: [
        { role: 'system', content: `${judgePromptText}\n\n${antiHallucination}\nCurrent date: ${dateContext.currentDateISO}` },
        { role: 'user', content: `Incident Context:\n${incidentContext}\n\n--- STRUCTURED ANALYSES ---\n${debateInput}` },
      ],
      functionName: `multi-agent-debate/judge/${judgeCallSign}`,
      // gpt-5.2 reasoning model: tools-only payload.
      extraBody: {
        tools: STRUCTURED_SYNTHESIS_TOOLS,
      },
      dlqOnFailure: true,
      dlqPayload: { incident_id, agents: selectedAgents, judge: judgeCallSign },
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
      judge_agent: judgeCallSign,
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