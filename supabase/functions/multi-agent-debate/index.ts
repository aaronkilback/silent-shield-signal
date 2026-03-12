/**
 * Multi-Agent Debate Protocol — Fortress Specialists Edition
 *
 * Upgrades over previous version:
 * 1. Real Fortress agents (0DAY, CERBERUS, MERIDIAN, etc.) selected by incident domain
 * 2. Expert knowledge (expert_knowledge table) injected into each agent — perfect recall
 * 3. Adversarial self-review pass on every agent analysis before synthesis
 * 4. Recommended actions written to autonomous_actions_log + entity risk updates
 * 5. Hard anti-hallucination: claims must reference KB entries, signals, or DB facts
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getAntiHallucinationPrompt, getCriticalDateContext, calculateIncidentAge } from "../_shared/anti-hallucination.ts";
import { buildMemoryContext, storeAgentMemory } from "../_shared/agent-memory.ts";
import { buildGraphContext, discoverIncidentConnections } from "../_shared/knowledge-graph.ts";
import { buildExpertKnowledgeContext, runAdversarialReview } from "../_shared/agent-intelligence.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";
import { STRUCTURED_DEBATE_TOOLS, STRUCTURED_SYNTHESIS_TOOLS, storeStructuredArguments } from "../_shared/structured-debate.ts";

// ─── FORTRESS AGENT ROSTER ────────────────────────────────────────────────────

const FORTRESS_AGENTS: Record<string, { model: string; specialty: string; prompt: string }> = {
  'AEGIS-CMD': {
    model: 'openai/gpt-5.2',
    specialty: 'Strategic command, threat response coordination',
    prompt: `You are AEGIS-CMD, Senior Security Operations Commander.

Analyze this incident for:
- Overall threat level and response priority
- Command-level escalation decisions (who acts, what, when)
- Resource and capability requirements
- Inter-agency or cross-team coordination needs
- Risk to the client and acceptable response timeline

Every recommendation must be command-ready: WHO does WHAT by WHEN with WHAT authority.
Cite knowledge entries as [KB-N] and signal data as [EVD: field = "value"].`,
  },

  '0DAY': {
    model: 'openai/gpt-5.2',
    specialty: 'Offensive security, cyber threat intelligence, vulnerability exploitation',
    prompt: `You are 0DAY, Elite Offensive Security Specialist.

Analyze this incident for ALL cyber dimensions:
- Attack vectors and exploitation paths (cite MITRE ATT&CK where applicable)
- Digital footprint exposure and OSINT indicators
- Network/system vulnerabilities and lateral movement potential
- Indicators of Compromise (IoCs) present or predictable
- Defensive countermeasures and detection opportunities

Be technically specific. Vague cyber analysis is mission failure.
Cite knowledge entries as [KB-N] and signal data as [EVD: field = "value"].`,
  },

  'CERBERUS': {
    model: 'openai/gpt-5.2',
    specialty: 'Financial crime, AML/CFT, fraud, sanctions',
    prompt: `You are CERBERUS, Financial Crime Investigator.

Analyze this incident for financial threat dimensions:
- Money flow indicators and suspicious transaction patterns
- AML red flags (FATF typologies applicable)
- Sanctions exposure (OFAC, UN, EU designations)
- Beneficial ownership obscuration attempts
- Financial institution reporting obligations

Reference specific FATF typologies, FinCEN advisories, or regulatory standards where applicable.
Cite knowledge entries as [KB-N] and signal data as [EVD: field = "value"].`,
  },

  'SPECTER': {
    model: 'openai/gpt-5.2',
    specialty: 'Insider threats, behavioral analysis, deception indicators',
    prompt: `You are SPECTER, Insider Threat and Behavioral Analyst.

Analyze this incident for behavioral and insider threat dimensions:
- Behavioral baseline deviations and anomaly indicators
- Deception and concealment patterns
- Access, privilege, and information handling anomalies
- Motivation assessment (MICE framework: Money, Ideology, Compromise, Ego)
- Psychological precursors and escalation indicators

Apply CERT insider threat indicators and PERSEREC behavioral research.
Cite knowledge entries as [KB-N] and signal data as [EVD: field = "value"].`,
  },

  'MERIDIAN': {
    model: 'openai/gpt-5.2',
    specialty: 'Geopolitical intelligence, political risk, regional stability',
    prompt: `You are MERIDIAN, Geopolitical Intelligence Analyst.

Analyze this incident for geopolitical dimensions:
- State actor involvement or attribution indicators
- Regional stability context and conflict dynamics
- Sanctions regimes and diplomatic implications
- Political risk to client operations in affected region
- Government travel advisory alignment

Reference country risk assessments, OSAC advisories, and geopolitical risk frameworks.
Cite knowledge entries as [KB-N] and signal data as [EVD: field = "value"].`,
  },

  'ARGUS': {
    model: 'openai/gpt-5.2',
    specialty: 'Physical security, surveillance, executive protection',
    prompt: `You are ARGUS, Physical Security and Surveillance Specialist.

Analyze this incident for physical threat dimensions:
- Physical access vulnerabilities and surveillance indicators
- Executive protection risk to named individuals
- Facility security posture and perimeter weaknesses
- CPTED (Crime Prevention Through Environmental Design) factors
- Protective intelligence requirements

Apply ASIS International standards, CPP best practices, and CPTED principles.
Cite knowledge entries as [KB-N] and signal data as [EVD: field = "value"].`,
  },

  'NEO': {
    model: 'openai/gpt-5.2',
    specialty: 'Pattern recognition, anomaly detection, predictive analysis',
    prompt: `You are NEO, Pattern Detection Specialist.

Analyze this incident for hidden patterns and predictive signals:
- Temporal clustering — what is the signal frequency trend?
- Entity relationship patterns — who/what co-appears with what frequency?
- Behavioral baseline deviations — what doesn't fit?
- Leading indicators for escalation
- What is notably ABSENT that should be present?

Identify what the pattern predicts. Apply statistical reasoning.
Cite knowledge entries as [KB-N] and signal data as [EVD: field = "value"].`,
  },

  'WARDEN': {
    model: 'openai/gpt-5.2',
    specialty: 'Online threats, radicalization, digital platform exploitation',
    prompt: `You are WARDEN, Digital Threat and Content Intelligence Specialist.

Analyze this incident for online and social threat dimensions:
- Radicalization pathway indicators (ISD, RAND frameworks)
- Platform exploitation and coordinated inauthentic behavior
- Disinformation or influence operation signatures
- Online-to-offline violence escalation indicators
- Digital community threat intelligence

Reference Moonshot CVE, ISD methodology, and platform threat intelligence.
Cite knowledge entries as [KB-N] and signal data as [EVD: field = "value"].`,
  },
};

// ─── DOMAIN → AGENT MAPPING ───────────────────────────────────────────────────

function selectAgentsForIncident(incident: any): string[] {
  const category = (incident.signals?.category || '').toLowerCase();
  const title = (incident.title || '').toLowerCase();
  const text = `${category} ${title}`;

  // Lead analyst is always AEGIS-CMD
  const agents: string[] = ['AEGIS-CMD'];

  // INSIDER THREAT: hard-coded specialist trio — SPECTER leads, 0DAY on data breach, WARDEN on public exposure
  if (category === 'insider_threat' || /insider.threat|leaked.internal|confidential.*public|internal.*document.*leak/.test(text)) {
    agents.push('SPECTER'); // Behavioral analysis: motivation, indicators, access patterns
    agents.push('0DAY');    // Data breach: what was exposed, digital forensics, remediation
    agents.push('WARDEN');  // Public exposure: platform spread, content amplification, takedown options
    return agents.slice(0, 4); // AEGIS-CMD + 3 specialists — insider threat warrants full panel
  }

  // Domain specialist 1 — based on primary category
  if (/cyber|hack|malware|ransom|phish|vuln|exploit|breach|data.expo/.test(text)) {
    agents.push('0DAY');
  } else if (/fraud|financ|money|aml|sanction|wire|crypt|bank/.test(text)) {
    agents.push('CERBERUS');
  } else if (/geopol|protest|politic|election|state.actor|region|war|conflict/.test(text)) {
    agents.push('MERIDIAN');
  } else if (/insider|behav|access|privilege|employee|personnel/.test(text)) {
    agents.push('SPECTER');
  } else if (/physical|surveillance|execut|facility|campus|perimeter/.test(text)) {
    agents.push('ARGUS');
  } else if (/online|social|radical|extremi|content|platform|disinform/.test(text)) {
    agents.push('WARDEN');
  } else {
    agents.push('NEO'); // Default: pattern analyst catches what others miss
  }

  // Third seat — pattern analyst for P1/P2, or a second domain specialist
  const priority = incident.priority?.toLowerCase();
  if (priority === 'p1' || priority === 'p2') {
    // Add a counter-perspective: if we used a technical specialist, add a behavioral one
    if (agents.includes('0DAY') || agents.includes('CERBERUS')) {
      agents.push('SPECTER');
    } else if (!agents.includes('NEO')) {
      agents.push('NEO');
    } else {
      agents.push('MERIDIAN');
    }
  }

  return agents.slice(0, 3);
}

// ─── JUDGE PROMPT ─────────────────────────────────────────────────────────────

const JUDGE_PROMPT = `You are JUDGE-SYNTHESIZER, a senior intelligence director.

You have received ADVERSARIALLY-REVIEWED analyses from multiple Fortress specialist agents.
Each analysis was independently produced then subjected to a red-team critique pass.
Each claim must be traceable to [KB-N] knowledge citations or [EVD: field = "value"] evidence citations.

Your mandate:
1. CONSENSUS: Where do specialists agree? State combined confidence.
2. CONFLICTS: Where do they contradict? Rule on which is better-evidenced.
3. UNIQUE INSIGHTS: What did one specialist catch that others missed?
4. HARD REJECTION: Flag any claim that lacks a citation — these are potential hallucinations.
5. UNIFIED ASSESSMENT: Produce the authoritative intelligence picture.
6. ACTIONABLE RECOMMENDATIONS: Each recommendation must specify:
   - Specific action (not vague guidance)
   - Responsible party or agent
   - Priority (IMMEDIATE / 24H / 72H / ONGOING)
   - Success criterion

You MUST use the submit_synthesis tool. Vague synthesis = intelligence failure.`;

// ─── RECOMMENDATION EXECUTOR ──────────────────────────────────────────────────

async function executeRecommendedActions(
  supabase: any,
  incidentId: string,
  clientId: string | null,
  recommendations: any[],
  consensusScore: number
): Promise<number> {
  if (!recommendations || recommendations.length === 0) return 0;
  let executed = 0;

  for (const rec of recommendations) {
    const actionText = typeof rec === 'string' ? rec : (rec.action || rec.description || JSON.stringify(rec));
    const priority = rec.priority || 'ONGOING';

    // Log every recommendation as an autonomous action for the audit trail
    await supabase.from('autonomous_actions_log').insert({
      action_type: 'agent_recommendation',
      description: actionText.substring(0, 500),
      incident_id: incidentId,
      client_id: clientId || null,
      metadata: {
        priority,
        source: 'multi-agent-debate',
        consensus_score: consensusScore,
        recommendation: rec,
      },
    }).then(() => { executed++; }).catch((err: Error) =>
      console.error('[DebateActions] Log failed:', err)
    );

    // If recommendation references an entity risk level change, apply it
    const riskMatch = actionText.match(/entity[:\s]+([A-Za-z0-9\s\-_]{3,40})[^\n]*risk[:\s]+(critical|high|medium|low)/i);
    if (riskMatch) {
      const entityName = riskMatch[1].trim();
      const newRiskLevel = riskMatch[2].toLowerCase();
      const { data: entity } = await supabase
        .from('entities')
        .select('id, risk_level')
        .ilike('name', `%${entityName}%`)
        .limit(1)
        .maybeSingle();

      if (entity && entity.risk_level !== newRiskLevel) {
        await supabase.from('entities').update({
          risk_level: newRiskLevel,
          updated_at: new Date().toISOString(),
        }).eq('id', entity.id);
        console.log(`[DebateActions] Updated entity "${entityName}" risk: ${entity.risk_level} → ${newRiskLevel}`);
      }
    }
  }

  return executed;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { incident_id, agents, debate_type } = await req.json();
    if (!incident_id) throw new Error('incident_id is required');

    const supabase = createServiceClient();

    const { data: incident, error: incErr } = await supabase
      .from('incidents')
      .select('*, signals!incidents_signal_id_fkey(*), clients(*)')
      .eq('id', incident_id)
      .single();

    if (incErr || !incident) {
      console.error('[Debate] Incident query error:', JSON.stringify(incErr), 'incident_id:', incident_id);
      throw new Error(`Incident not found: ${incErr?.message || 'no data returned'}`);
    }

    // Select real Fortress specialists based on incident domain (or use caller-provided list)
    const selectedAgents: string[] = agents || selectAgentsForIncident(incident);
    const dateContext = getCriticalDateContext();
    const incidentAge = calculateIncidentAge({ id: incident.id, opened_at: incident.opened_at });
    const antiHallucination = getAntiHallucinationPrompt();

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

    console.log(`[Debate] Incident ${incident_id} (${incident.priority}) — Selected specialists: ${selectedAgents.join(', ')}`);

    // Load all context in parallel: memories + expert knowledge + graph
    const [memoryContexts, expertKnowledgeContexts, graphContext, graphEdges] = await Promise.all([
      Promise.all(selectedAgents.map((a: string) => buildMemoryContext(supabase, a, incidentContext))),
      Promise.all(selectedAgents.map((a: string) => buildExpertKnowledgeContext(supabase, a, incidentContext))),
      buildGraphContext(supabase, incident_id),
      discoverIncidentConnections(supabase, incident_id, 'debate-protocol'),
    ]);

    console.log(`[Debate] Context loaded: ${graphEdges.length} graph connections, expert knowledge loaded for all agents`);

    // ── Phase 1: Independent analyses in parallel ───────────────────────────
    const analysisPromises = selectedAgents.map(async (agentKey: string, idx: number) => {
      const agent = FORTRESS_AGENTS[agentKey];
      if (!agent) {
        console.warn(`[Debate] Unknown agent: ${agentKey}`);
        return { agent: agentKey, analysis: 'Agent configuration not found', error: true };
      }

      const systemPrompt = `${agent.prompt}

${antiHallucination}

${memoryContexts[idx]}
${expertKnowledgeContexts[idx]}
${graphContext}

ANTI-HALLUCINATION REQUIREMENT: Every factual claim MUST cite either:
  - [KB-N] for expert knowledge entries above
  - [EVD: field = "value"] for signal/incident data above
  - [EVD: NO DATA] if the information is genuinely absent
Claims without citations will be flagged as hallucinations and discarded by the Judge.

Current date: ${dateContext.currentDateISO}`;

      try {
        const agentResult = await callAiGateway({
          model: agent.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze this incident using the submit_structured_analysis tool:\n${incidentContext}` },
          ],
          functionName: `multi-agent-debate/${agentKey}`,
          extraBody: {
            max_completion_tokens: 3000,
            temperature: 0.4,
            tools: STRUCTURED_DEBATE_TOOLS,
            tool_choice: { type: 'function', function: { name: 'submit_structured_analysis' } },
          },
        });

        if (agentResult.error) {
          console.error(`[Debate] ${agentKey} analysis failed:`, agentResult.error);
          return { agent: agentKey, specialty: agent.specialty, analysis: `Analysis failed: ${agentResult.error}`, structured: null, error: true };
        }

        let structured: any = null;
        const toolCalls = agentResult.raw?.choices?.[0]?.message?.tool_calls;
        if (toolCalls?.[0]?.function?.arguments) {
          try { structured = JSON.parse(toolCalls[0].function.arguments); } catch { /* fall through */ }
        }

        const rawAnalysis = structured
          ? `${structured.overall_assessment}\n\nHypotheses: ${structured.hypotheses?.length || 0} | Counter-arguments: ${structured.counter_arguments?.length || 0}`
          : agentResult.content || 'No analysis produced';

        return { agent: agentKey, specialty: agent.specialty, model: agent.model, rawAnalysis, structured, error: false };
      } catch (err) {
        console.error(`[Debate] ${agentKey} error:`, err);
        return { agent: agentKey, specialty: agent.specialty, analysis: `Error: ${err}`, structured: null, error: true };
      }
    });

    const rawAnalyses = await Promise.all(analysisPromises);
    const successfulRaw = rawAnalyses.filter((a: any) => !a.error);

    if (successfulRaw.length === 0) throw new Error('All agents failed to produce analyses');

    console.log(`[Debate] Phase 1 complete: ${successfulRaw.length}/${selectedAgents.length} agents produced analyses`);

    // ── Phase 2: Adversarial self-review in parallel (hard anti-hallucination) ─
    const reviewPromises = successfulRaw.map(async (a: any) => {
      const agent = FORTRESS_AGENTS[a.agent];
      if (!agent || !a.rawAnalysis) return { ...a, analysis: a.rawAnalysis, reviewNotes: 'Skipped', weaknesses: 0 };

      const { reviewedAnalysis, weaknessesFound, reviewNotes } = await runAdversarialReview(
        a.rawAnalysis,
        a.agent,
        agent.specialty,
        incidentContext,
        agent.model
      );

      console.log(`[Debate] ${a.agent} adversarial review: ${weaknessesFound} weaknesses fixed`);
      return { ...a, analysis: reviewedAnalysis, reviewNotes, weaknesses: weaknessesFound };
    });

    const reviewedAnalyses = await Promise.all(reviewPromises);
    const successfulAnalyses = reviewedAnalyses.filter((a: any) => !a.error);

    // Store agent memories from reviewed analyses
    await Promise.all(successfulAnalyses.map((a: any) =>
      storeAgentMemory(supabase, a.agent, a.analysis.substring(0, 1500), {
        incidentId: incident_id,
        clientId: incident.client_id,
        memoryType: 'investigation',
        entities: incident.signals?.entity_tags || [],
        confidence: a.structured?.confidence_level || 0.7,
      })
    ));

    console.log(`[Debate] Phase 2 complete: adversarial review done for ${successfulAnalyses.length} agents`);

    // ── Phase 3: Judge synthesis ────────────────────────────────────────────
    const debateInput = successfulAnalyses.map((a: any) => {
      const structuredStr = a.structured
        ? `Hypotheses: ${JSON.stringify(a.structured.hypotheses, null, 1)}\nCounter-Arguments: ${JSON.stringify(a.structured.counter_arguments || [], null, 1)}\nAssessment: ${a.structured.overall_assessment}\nConfidence: ${a.structured.confidence_level}`
        : a.analysis;
      return `=== ${a.agent} — ${a.specialty} ===\nAdversarial Review: ${a.weaknesses || 0} weaknesses corrected\n\n${structuredStr}`;
    }).join('\n\n---\n\n');

    const judgeResult = await callAiGateway({
      model: 'openai/gpt-5.2',
      messages: [
        { role: 'system', content: `${JUDGE_PROMPT}\n\n${antiHallucination}\nCurrent date: ${dateContext.currentDateISO}` },
        { role: 'user', content: `Incident:\n${incidentContext}\n\n--- REVIEWED SPECIALIST ANALYSES ---\n${debateInput}` },
      ],
      functionName: 'multi-agent-debate/judge',
      extraBody: {
        max_completion_tokens: 4000,
        temperature: 0.2, // Low temperature: judge must be precise
        tools: STRUCTURED_SYNTHESIS_TOOLS,
        tool_choice: { type: 'function', function: { name: 'submit_synthesis' } },
      },
      dlqOnFailure: true,
      dlqPayload: { incident_id, agents: selectedAgents },
    });

    let synthesisStructured: any = null;
    const judgeToolCalls = judgeResult.raw?.choices?.[0]?.message?.tool_calls;
    if (judgeToolCalls?.[0]?.function?.arguments) {
      try { synthesisStructured = JSON.parse(judgeToolCalls[0].function.arguments); } catch { /* fallback */ }
    }

    const synthesis = synthesisStructured?.final_assessment || judgeResult.content || 'Judge synthesis unavailable';
    const consensusScore = synthesisStructured?.consensus_score || 50;

    console.log(`[Debate] Phase 3 complete: synthesis done, consensus ${consensusScore}%`);

    // ── Phase 4: Write actionable outputs to the system ────────────────────
    const actionsExecuted = await executeRecommendedActions(
      supabase,
      incident_id,
      incident.client_id,
      synthesisStructured?.recommended_actions || [],
      consensusScore
    );

    // Store debate record
    const { data: debateRecord } = await supabase.from('agent_debate_records').insert({
      incident_id,
      debate_type: debate_type || 'fortress-specialists',
      participating_agents: selectedAgents,
      individual_analyses: successfulAnalyses.map((a: any) => ({
        agent: a.agent,
        specialty: a.specialty,
        structured: a.structured,
        adversarial_weaknesses: a.weaknesses || 0,
        analysis_preview: a.analysis?.substring(0, 500),
      })),
      synthesis: synthesisStructured || { content: synthesis, consensus_score: consensusScore },
      judge_agent: 'JUDGE-SYNTHESIZER',
      consensus_score: consensusScore / 100,
      final_assessment: synthesis,
    }).select('id').single();

    // Store structured arguments for full audit trail
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
      event: 'Fortress Multi-Agent Debate Complete',
      details: `${successfulAnalyses.length} specialists debated with adversarial review. Consensus: ${consensusScore}%. Agents: ${selectedAgents.join(', ')}. ${actionsExecuted} recommendations logged.`,
      actor: 'FORTRESS-DEBATE-V3',
    });

    await supabase.from('incidents').update({
      timeline_json: timeline,
      investigation_status: 'in_progress',
      updated_at: new Date().toISOString(),
    }).eq('id', incident_id);

    console.log(`[Debate] Complete: ${actionsExecuted} actions logged, debate record ${debateRecord?.id}`);

    return successResponse({
      success: true,
      incident_id,
      debate_type: 'fortress-specialists',
      agents_selected: selectedAgents,
      agents_participated: successfulAnalyses.length,
      individual_analyses: successfulAnalyses.map((a: any) => ({
        agent: a.agent,
        specialty: a.specialty,
        adversarial_weaknesses_corrected: a.weaknesses || 0,
        hypotheses_count: a.structured?.hypotheses?.length || 0,
        counter_arguments_count: a.structured?.counter_arguments?.length || 0,
        confidence: a.structured?.confidence_level,
        analysis_preview: a.analysis?.substring(0, 300),
      })),
      synthesis: synthesisStructured || { content: synthesis },
      consensus_score: consensusScore,
      consensus_hypotheses: synthesisStructured?.consensus_hypotheses || [],
      contested_findings: synthesisStructured?.contested_findings || [],
      unique_insights: synthesisStructured?.unique_insights || [],
      recommended_actions: synthesisStructured?.recommended_actions || [],
      actions_executed: actionsExecuted,
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
