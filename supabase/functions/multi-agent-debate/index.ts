/**
 * Multi-Agent Debate Protocol (Tier 1)
 * 
 * 2-3 agents independently analyze the same incident, then a judge agent
 * synthesizes conflicting assessments into a higher-confidence conclusion.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getAntiHallucinationPrompt, getCriticalDateContext, calculateIncidentAge } from "../_shared/anti-hallucination.ts";
import { buildMemoryContext, storeAgentMemory } from "../_shared/agent-memory.ts";
import { buildGraphContext, discoverIncidentConnections } from "../_shared/knowledge-graph.ts";

const DEBATE_AGENTS: Record<string, { model: string; specialty: string; prompt: string }> = {
  'THREAT-ANALYST': {
    model: 'google/gemini-3-pro-preview',
    specialty: 'Threat assessment and risk quantification',
    prompt: `You are THREAT-ANALYST, a senior threat assessment specialist. Analyze this incident for:
- Threat actor capability and intent assessment
- Attack surface and vulnerability exposure
- Risk quantification (likelihood × impact)
- Threat trajectory prediction
Provide a structured threat assessment with confidence levels.`,
  },
  'PATTERN-ANALYST': {
    model: 'openai/gpt-5.2',
    specialty: 'Pattern recognition and behavioral analysis',
    prompt: `You are PATTERN-ANALYST, specializing in behavioral pattern recognition. Analyze this incident for:
- Behavioral indicators of compromise
- Historical pattern matches
- Anomaly detection results
- Coordinated activity indicators
Provide pattern-based findings with evidence strength ratings.`,
  },
  'STRATEGIC-ANALYST': {
    model: 'google/gemini-3-pro-preview',
    specialty: 'Strategic implications and response planning',
    prompt: `You are STRATEGIC-ANALYST, focused on strategic response planning. Analyze this incident for:
- Strategic implications for the organization
- Response priority and resource allocation
- Escalation criteria and triggers
- Long-term mitigation recommendations
Provide actionable strategic recommendations with priority levels.`,
  },
};

const JUDGE_PROMPT = `You are JUDGE-SYNTHESIZER, a senior intelligence officer. You have received independent analyses from multiple specialist agents who examined the same incident WITHOUT seeing each other's work.

Your role:
1. IDENTIFY CONSENSUS: Where do the analysts agree? These are HIGH CONFIDENCE findings.
2. IDENTIFY CONFLICTS: Where do they disagree? Analyze WHY and determine which assessment is more credible.
3. IDENTIFY GAPS: What did one analyst catch that others missed?
4. SYNTHESIZE: Produce a unified assessment that is stronger than any individual analysis.
5. RATE CONSENSUS: Score 0-100 how much the analysts agreed.

Output format:
**CONSENSUS FINDINGS** (all analysts agree):
**CONTESTED FINDINGS** (analysts disagree — your ruling):
**UNIQUE INSIGHTS** (caught by only one analyst):
**UNIFIED ASSESSMENT**:
**CONFIDENCE LEVEL**: HIGH/MEDIUM/LOW
**CONSENSUS SCORE**: X/100
**RECOMMENDED ACTIONS** (prioritized):`;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { incident_id, agents } = await req.json();
    if (!incident_id) throw new Error('incident_id is required');

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const supabase = createServiceClient();

    // Fetch incident with related data
    const { data: incident, error: incErr } = await supabase
      .from('incidents')
      .select('*, signals!incidents_signal_id_fkey(*), clients(*)')
      .eq('id', incident_id)
      .single();

    if (incErr || !incident) {
      console.error('[Debate] Incident query error:', JSON.stringify(incErr), 'incident_id:', incident_id);
      throw new Error(`Incident not found: ${incErr?.message || 'no data returned'}`);
    }

    const selectedAgents = agents || ['THREAT-ANALYST', 'PATTERN-ANALYST', 'STRATEGIC-ANALYST'];
    const dateContext = getCriticalDateContext();
    const incidentAge = calculateIncidentAge({ id: incident.id, opened_at: incident.opened_at });
    const antiHallucination = getAntiHallucinationPrompt();

    // Build incident context
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

    // Fetch memory and graph context in parallel
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
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: agent.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Analyze this incident independently:\n${incidentContext}` },
            ],
            ...(agent.model.startsWith('openai/') ? { max_completion_tokens: 3000 } : { max_tokens: 3000 }),
            temperature: 0.5,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error(`[Debate] ${agentKey} failed:`, response.status, errText);
          return { agent: agentKey, analysis: `Analysis failed: ${response.status}`, error: true };
        }

        const data = await response.json();
        const analysis = data.choices?.[0]?.message?.content || 'No analysis produced';

        // Store memory of this analysis
        await storeAgentMemory(supabase, agentKey, analysis.substring(0, 1500), {
          incidentId: incident_id,
          clientId: incident.client_id,
          memoryType: 'investigation',
          entities: incident.signals?.entity_tags || [],
          confidence: 0.7,
        });

        return { agent: agentKey, specialty: agent.specialty, model: agent.model, analysis, error: false };
      } catch (err) {
        console.error(`[Debate] ${agentKey} error:`, err);
        return { agent: agentKey, analysis: `Error: ${err}`, error: true };
      }
    });

    const individualAnalyses = await Promise.all(analysisPromises);
    const successfulAnalyses = individualAnalyses.filter(a => !a.error);

    if (successfulAnalyses.length === 0) {
      throw new Error('All agents failed to produce analyses');
    }

    console.log(`[Debate] ${successfulAnalyses.length}/${selectedAgents.length} agents completed analysis`);

    // Phase 2: Judge synthesizes
    const debateInput = successfulAnalyses.map(a =>
      `=== ${a.agent} (${a.specialty}) ===\nModel: ${a.model}\n${a.analysis}`
    ).join('\n\n---\n\n');

    const judgeResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5.2',
        messages: [
          { role: 'system', content: `${JUDGE_PROMPT}\n\n${antiHallucination}\nCurrent date: ${dateContext.currentDateISO}` },
          { role: 'user', content: `Incident Context:\n${incidentContext}\n\n--- INDEPENDENT ANALYSES ---\n${debateInput}` },
        ],
        max_completion_tokens: 4000,
        temperature: 0.3,
      }),
    });

    let synthesis = 'Judge synthesis unavailable';
    let consensusScore = 0;

    if (judgeResponse.ok) {
      const judgeData = await judgeResponse.json();
      synthesis = judgeData.choices?.[0]?.message?.content || synthesis;

      // Extract consensus score from synthesis
      const scoreMatch = synthesis.match(/CONSENSUS SCORE[:\s]*(\d+)/i);
      consensusScore = scoreMatch ? parseInt(scoreMatch[1]) : 50;
    }

    // Store debate record
    await supabase.from('agent_debate_records').insert({
      incident_id,
      debate_type: 'investigation',
      participating_agents: selectedAgents,
      individual_analyses: individualAnalyses,
      synthesis: { content: synthesis, consensus_score: consensusScore },
      judge_agent: 'JUDGE-SYNTHESIZER',
      consensus_score: consensusScore / 100,
      final_assessment: synthesis,
    });

    // Update incident timeline
    const { data: currentIncident } = await supabase
      .from('incidents')
      .select('timeline_json')
      .eq('id', incident_id)
      .single();

    const timeline = currentIncident?.timeline_json || [];
    timeline.push({
      timestamp: new Date().toISOString(),
      event: 'Multi-Agent Debate Complete',
      details: `${successfulAnalyses.length} agents debated. Consensus: ${consensusScore}%. Judge: GPT-5.2`,
      actor: 'DEBATE-PROTOCOL',
    });

    await supabase.from('incidents').update({
      timeline_json: timeline,
      investigation_status: 'in_progress',
      updated_at: new Date().toISOString(),
    }).eq('id', incident_id);

    return successResponse({
      success: true,
      incident_id,
      agents_participated: successfulAnalyses.length,
      individual_analyses: individualAnalyses.map(a => ({
        agent: a.agent,
        specialty: a.specialty,
        model: a.model,
        analysis_preview: a.analysis?.substring(0, 500),
        error: a.error,
      })),
      synthesis,
      consensus_score: consensusScore,
      graph_connections: graphEdges.length,
    });
  } catch (error) {
    console.error('[Debate] Error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('402') || msg.includes('credits')) {
      return errorResponse('AI credits exhausted. Please add credits in Settings → Workspace → Usage.', 402);
    }
    return errorResponse(msg, 500);
  }
});
