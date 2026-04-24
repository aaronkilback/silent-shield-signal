import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { getAntiHallucinationPrompt, getCriticalDateContext, calculateIncidentAge } from "../_shared/anti-hallucination.ts";
import { buildMemoryContext, storeAgentMemory } from "../_shared/agent-memory.ts";
import { buildGraphContext, discoverIncidentConnections } from "../_shared/knowledge-graph.ts";
import { getIntelligenceUpgradePrompt, buildCrossAgentContext, runAdversarialReview, generateHypothesisTree, recordAgentPrediction, getAgentCalibration, getAnalystPreferences, buildPersonalizationPrompt } from "../_shared/agent-intelligence.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Task Force Name Generation
const TASK_FORCE_PREFIXES = [
  'Task Force', 'Operation', 'Project', 'Initiative', 'Response Team'
];

const TASK_FORCE_ADJECTIVES = [
  'Iron', 'Steel', 'Shadow', 'Silent', 'Swift', 'Crimson', 'Azure', 'Obsidian',
  'Phantom', 'Thunder', 'Arctic', 'Desert', 'Coastal', 'Mountain', 'Urban',
  'Tactical', 'Strategic', 'Rapid', 'Vigilant', 'Resolute', 'Steadfast',
  'Valiant', 'Guardian', 'Sentinel', 'Vanguard', 'Apex', 'Prime', 'Alpha'
];

const TASK_FORCE_NOUNS = [
  'Shield', 'Spear', 'Sword', 'Eagle', 'Falcon', 'Wolf', 'Lion', 'Bear',
  'Storm', 'Thunder', 'Lightning', 'Fortress', 'Bastion', 'Citadel', 'Rampart',
  'Horizon', 'Dawn', 'Dusk', 'Meridian', 'Zenith', 'Apex', 'Summit',
  'Trident', 'Hammer', 'Arrow', 'Phoenix', 'Dragon', 'Titan', 'Colossus'
];

const SEVERITY_THEMED_NAMES: Record<string, string[]> = {
  'critical': ['Firestorm', 'Thunderbolt', 'Red Alert', 'Crisis Response', 'Defcon'],
  'high': ['Rapid Strike', 'Storm Watch', 'High Tide', 'Alert Force'],
  'medium': ['Steady Watch', 'Patrol', 'Recon', 'Survey'],
  'low': ['Sentinel', 'Observer', 'Monitor', 'Overwatch']
};

function generateTaskForceName(incident: any, signal: any): string {
  const severity = signal?.severity?.toLowerCase() || incident.priority || 'medium';
  
  // 30% chance to use severity-themed name
  if (Math.random() < 0.3 && SEVERITY_THEMED_NAMES[severity]) {
    const themedNames = SEVERITY_THEMED_NAMES[severity];
    const themedName = themedNames[Math.floor(Math.random() * themedNames.length)];
    const prefix = TASK_FORCE_PREFIXES[Math.floor(Math.random() * TASK_FORCE_PREFIXES.length)];
    return `${prefix} ${themedName}`;
  }
  
  // Standard generation
  const prefix = TASK_FORCE_PREFIXES[Math.floor(Math.random() * TASK_FORCE_PREFIXES.length)];
  const adjective = TASK_FORCE_ADJECTIVES[Math.floor(Math.random() * TASK_FORCE_ADJECTIVES.length)];
  const noun = TASK_FORCE_NOUNS[Math.floor(Math.random() * TASK_FORCE_NOUNS.length)];
  
  return `${prefix} ${adjective} ${noun}`;
}

// Agent specializations for incident investigation
const AGENT_CAPABILITIES: Record<string, {
  specialty: string;
  investigationFocus: string[];
  promptTemplate: string;
}> = {
  'LOCUS-INTEL': {
    specialty: 'Location-based threat monitoring and geographic intelligence',
    investigationFocus: ['location analysis', 'geographic patterns', 'regional threats', 'proximity assessment'],
    promptTemplate: `As LOCUS-INTEL (Pathfinder), analyze this incident for geographic and location-based intelligence:
- Identify geographic patterns or clusters
- Assess regional threat landscape
- Evaluate proximity to client assets
- Map potential threat vectors by location
- Identify escape routes or staging areas if applicable`
  },
  'LEX-MAGNA': {
    specialty: 'Legal analysis and regulatory compliance',
    investigationFocus: ['legal implications', 'regulatory requirements', 'compliance', 'liability assessment'],
    promptTemplate: `As LEX-MAGNA (Legion), analyze this incident for legal and regulatory implications:
- Identify applicable laws and regulations
- Assess potential liability exposure
- Recommend compliance actions
- Highlight reporting obligations
- Evaluate legal risk factors`
  },
  'GLOBE-SAGE': {
    specialty: 'Geopolitical analysis and strategic forecasting',
    investigationFocus: ['geopolitical context', 'strategic implications', 'political intelligence', 'sector impact'],
    promptTemplate: `As GLOBE-SAGE (Oracle), analyze this incident for geopolitical and strategic context:
- Place incident in broader geopolitical landscape
- Identify potential state or non-state actor involvement
- Assess strategic implications for the client
- Evaluate sector-wide impacts
- Forecast potential escalation scenarios`
  },
  'BIRD-DOG': {
    specialty: 'Pattern detection and behavioral analysis',
    investigationFocus: ['pattern detection', 'behavioral indicators', 'threat tracking', 'anomaly identification'],
    promptTemplate: `As BIRD-DOG (Ignis), analyze this incident for patterns and behavioral indicators:
- Identify suspicious patterns or anomalies
- Track behavioral indicators of threat
- Cross-reference with known threat patterns
- Detect potential coordinated activity
- Recommend surveillance priorities`
  },
  'TIME-WARP': {
    specialty: 'Chronology reconstruction and temporal analysis',
    investigationFocus: ['timeline reconstruction', 'temporal patterns', 'sequence analysis', 'historical context'],
    promptTemplate: `As TIME-WARP (Chronos), analyze this incident for temporal patterns:
- Reconstruct chronological sequence of events
- Identify temporal patterns or anomalies
- Place incident in historical context
- Analyze timing relevance
- Project potential future developments`
  },
  'PATTERN-SEEKER': {
    specialty: 'Pattern detection and investigative correlation',
    investigationFocus: ['correlation', 'connections', 'network analysis', 'link investigation'],
    promptTemplate: `As PATTERN-SEEKER (Nexus), analyze this incident for connections and correlations:
- Identify links between entities and events
- Map relationship networks
- Detect hidden connections
- Correlate with other intelligence
- Recommend investigation paths`
  },
  'AEGIS-CMD': {
    specialty: 'Incident response and protocol execution',
    investigationFocus: ['containment', 'response protocols', 'mitigation', 'tactical recommendations'],
    promptTemplate: `As AEGIS-CMD (Aegis), develop tactical response recommendations:
- Recommend immediate containment actions
- Define response protocols
- Prioritize mitigation steps
- Assign response responsibilities
- Establish success criteria`
  }
};

// Select best agent for initial investigation based on incident characteristics
function selectInitialAgent(incident: any, signal: any): { agentCallSign: string; agentId: string } | null {
  const text = (signal?.normalized_text || '').toLowerCase();
  const category = (signal?.category || '').toLowerCase();
  const location = signal?.location || '';
  
  // Priority-based agent selection
  if (location && (text.includes('location') || text.includes('area') || text.includes('site'))) {
    return { agentCallSign: 'LOCUS-INTEL', agentId: '4fffd95a-c603-4f9d-857c-21de38e78747' };
  }
  if (category.includes('legal') || text.includes('lawsuit') || text.includes('regulation') || text.includes('compliance')) {
    return { agentCallSign: 'LEX-MAGNA', agentId: 'd0d43def-fec5-4ae5-a32c-34980097b1c1' };
  }
  if (category.includes('geopolitical') || text.includes('government') || text.includes('political') || text.includes('state')) {
    return { agentCallSign: 'GLOBE-SAGE', agentId: '664916cb-9395-47e1-b581-70dccad01f7c' };
  }
  if (text.includes('pattern') || text.includes('repeated') || text.includes('coordinated')) {
    return { agentCallSign: 'BIRD-DOG', agentId: 'b304c547-ab87-41a6-805c-e65330ee0f05' };
  }
  if (text.includes('timeline') || text.includes('sequence') || text.includes('when')) {
    return { agentCallSign: 'TIME-WARP', agentId: '4b6a18d1-d249-410a-b333-3d7c3b28b49e' };
  }
  
  // Default to BIRD-DOG for general pattern analysis
  return { agentCallSign: 'BIRD-DOG', agentId: 'b304c547-ab87-41a6-805c-e65330ee0f05' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { incident_id, agent_call_sign, prompt } = await req.json();
    
    if (!incident_id) {
      throw new Error('incident_id is required');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch incident with related data
    const { data: incident, error: incidentError } = await supabase
      .from('incidents')
      .select('*, signals!incidents_signal_id_fkey(*), clients(*)')
      .eq('id', incident_id)
      .single();

    if (incidentError || !incident) {
      console.error('[Orchestrator] Incident query error:', JSON.stringify(incidentError), 'incident_id:', incident_id);
      throw new Error(`Incident not found: ${incidentError?.message || 'no data returned'}`);
    }

    // Determine which agent to use
    let agentConfig = agent_call_sign ? AGENT_CAPABILITIES[agent_call_sign] : null;
    let selectedAgent = agent_call_sign;
    
    if (!agentConfig) {
      // Auto-select based on incident characteristics
      const autoSelection = selectInitialAgent(incident, incident.signals);
      if (autoSelection) {
        selectedAgent = autoSelection.agentCallSign;
        agentConfig = AGENT_CAPABILITIES[selectedAgent];
      }
    }

    if (!agentConfig) {
      throw new Error('No suitable agent found for this incident');
    }

    // Fetch agent record for metadata
    const { data: agentRecord } = await supabase
      .from('ai_agents')
      .select('*')
      .eq('call_sign', selectedAgent)
      .single();

    // Calculate updated agent list
    const updatedAgentIds = incident.assigned_agent_ids 
      ? [...new Set([...incident.assigned_agent_ids, agentRecord?.id])]
      : [agentRecord?.id];
    
    // Generate task force name if this is the second agent (multi-agent investigation)
    let taskForceName = incident.task_force_name;
    if (!taskForceName && updatedAgentIds.length > 1) {
      taskForceName = generateTaskForceName(incident, incident.signals);
      console.log(`Generated Task Force name: ${taskForceName} for incident ${incident_id}`);
    }

    // Update incident status
    await supabase
      .from('incidents')
      .update({
        investigation_status: 'in_progress',
        assigned_agent_ids: updatedAgentIds,
        task_force_name: taskForceName
      })
      .eq('id', incident_id);

    // Build investigation context with anti-hallucination measures
    const dateContext = getCriticalDateContext();
    const incidentAge = calculateIncidentAge({ id: incident.id, opened_at: incident.opened_at });
    const antiHallucinationBlock = getAntiHallucinationPrompt();

    // Extract requesting user ID from auth header for preference learning
    const authHeader = req.headers.get('Authorization');
    let requestingUserId: string | null = null;
    if (authHeader) {
      try {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
        requestingUserId = user?.id || null;
      } catch { /* service call, no user */ }
    }

    // Tier 2: Retrieve agent memory, knowledge graph, cross-agent insights, calibration, preferences, and mesh inbox in parallel
    const [memoryContext, graphContext, graphEdges, crossAgentContext, agentCalibration, analystPrefs, meshInboxContext] = await Promise.all([
      buildMemoryContext(supabase, selectedAgent, incident.signals?.normalized_text || incident.title || ''),
      buildGraphContext(supabase, incident_id),
      discoverIncidentConnections(supabase, incident_id, selectedAgent),
      buildCrossAgentContext(supabase, selectedAgent, incident.signals?.normalized_text || incident.title || ''),
      getAgentCalibration(supabase, selectedAgent),
      requestingUserId ? getAnalystPreferences(supabase, requestingUserId) : Promise.resolve({}),
      // Read unread mesh messages sent to this agent by peers, then mark them read
      (async () => {
        try {
          const { data: msgs } = await supabase
            .from('agent_mesh_messages')
            .select('from_agent, subject, content, relevance_score, created_at')
            .eq('to_agent', selectedAgent)
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(5);
          if (!msgs || msgs.length === 0) return '';
          // Mark as read (fire-and-forget)
          supabase.from('agent_mesh_messages')
            .update({ is_read: true })
            .eq('to_agent', selectedAgent)
            .eq('is_read', false)
            .then(() => {}, () => {});
          const lines = msgs.map((m: any) =>
            `[${m.from_agent} → ${selectedAgent}] (${(m.relevance_score * 100).toFixed(0)}% relevance) ${m.content.substring(0, 300)}`
          ).join('\n');
          return `\n=== PEER INTELLIGENCE (${msgs.length} unread messages from fellow agents) ===\n${lines}\nNOTE: These insights were shared by peer agents. Integrate relevant findings into your analysis.\n`;
        } catch { return ''; }
      })(),
    ]);
    
    if (graphEdges.length > 0) {
      console.log(`[Orchestrator] ${selectedAgent} found ${graphEdges.length} knowledge graph connections for incident ${incident_id}`);
    }
    
    const investigationContext = `
=== VERIFIED INCIDENT DETAILS (as of ${dateContext.currentDateTimeISO}) ===
Incident ID: ${incident.id}
Priority: ${incident.priority?.toUpperCase()}
Status: ${incident.status}
Title: ${incident.title || 'N/A'}
Opened At (EXACT): ${incident.opened_at}
Incident Age: ${incidentAge.ageLabel} (${incidentAge.ageDays} days)
Is Stale (>7 days): ${incidentAge.isStale ? 'YES' : 'NO'}

=== ORIGINATING SIGNAL ===
Signal Text: ${incident.signals?.normalized_text || 'N/A'}
Category: ${incident.signals?.category || 'N/A'}
Severity: ${incident.signals?.severity || 'N/A'}
Location: ${incident.signals?.location || 'N/A'}
Entity Tags: ${incident.signals?.entity_tags?.join(', ') || 'None'}
Confidence: ${incident.signals?.confidence || 'N/A'}

=== CLIENT CONTEXT ===
Client: ${incident.clients?.name || 'N/A'}
Industry: ${incident.clients?.industry || 'N/A'}
Locations: ${incident.clients?.locations?.join(', ') || 'N/A'}
High-Value Assets: ${incident.clients?.high_value_assets?.join(', ') || 'N/A'}

=== AI DECISION DATA ===
${incident.signals?.raw_json?.ai_decision ? JSON.stringify(incident.signals.raw_json.ai_decision, null, 2) : 'No AI decision data'}

=== TIMELINE ===
${incident.timeline_json?.map((t: any) => `[${t.timestamp}] ${t.event}: ${t.details}`).join('\n') || 'No timeline entries'}

${memoryContext}
${meshInboxContext}
${graphContext}
${crossAgentContext}

=== AGENT CALIBRATION ===
${selectedAgent} historical accuracy: ${(agentCalibration.accuracy * 100).toFixed(0)}% (${agentCalibration.totalPredictions} predictions tracked)
Confidence calibration factor: ${agentCalibration.calibration.toFixed(2)}x
${agentCalibration.totalPredictions > 10 ? `IMPORTANT: Adjust your confidence levels by factor ${agentCalibration.calibration.toFixed(2)} based on your track record.` : ''}

${buildPersonalizationPrompt(analystPrefs)}
`;

    // Tier 1: Use upgraded models based on agent specialization
    const AGENT_MODELS: Record<string, string> = {
      'GLOBE-SAGE': 'gpt-4o-mini',
      'AEGIS-CMD': 'openai/gpt-5.2',
      'LEX-MAGNA': 'openai/gpt-5.2',
      'BIRD-DOG': 'gpt-4o-mini',
      'LOCUS-INTEL': 'gpt-4o-mini',
      'TIME-WARP': 'gpt-4o-mini',
      'PATTERN-SEEKER': 'openai/gpt-5.2',
    };
    const agentModel = AGENT_MODELS[selectedAgent] || 'gpt-4o-mini';

    // Intelligence upgrades: CoT + Evidence Citations
    const intelligenceUpgrade = getIntelligenceUpgradePrompt();

    const systemPrompt = `You are ${selectedAgent}, a specialized AI security analyst within the Fortress AI Task Force.
Your specialty: ${agentConfig.specialty}
Investigation focus areas: ${agentConfig.investigationFocus.join(', ')}

${antiHallucinationBlock}

${intelligenceUpgrade}

${agentConfig.promptTemplate}

CRITICAL RULES:
1. Base all findings on provided evidence only - NEVER fabricate data
2. Clearly label assumptions vs. confirmed facts using [EVD:] citations
3. Use conditional language for uncertain conclusions
4. Provide specific, actionable recommendations traced to findings
5. Include confidence levels for each finding (backed by citation density)
6. Identify gaps in information that need human follow-up
7. ALWAYS use exact dates from the data (e.g., "opened on ${incident.opened_at}")
8. NEVER claim the incident is "new" if it is stale (${incidentAge.ageDays} days old)
9. Reference actual field values, not approximations
10. Follow the Chain-of-Thought reasoning protocol — show ALL steps
11. When cross-agent intelligence is available, corroborate or challenge it

OUTPUT FORMAT:
Structure your analysis with the Chain-of-Thought steps:
- **Step 1 — Observations**: Raw data points with [EVD:] citations
- **Step 2 — Decomposition**: Sub-questions raised
- **Step 3 — Hypotheses**: Competing explanations
- **Step 4 — Evidence Mapping**: Supporting/contradicting evidence per hypothesis
- **Step 5 — Assessment**: Synthesized findings with confidence levels
- **Step 6 — Recommendations**: Actions traced to specific findings
- **Unknowns**: Information gaps requiring investigation`;

    const userPrompt = prompt || `Conduct a thorough investigation of this incident within your specialty area:

${investigationContext}

Provide your specialized analysis following the output format specified.`;

    console.log(`Dispatching ${selectedAgent} for incident ${incident_id}`);

    const aiResult = await callAiGateway({
      model: agentModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      functionName: 'incident-agent-orchestrator',
      extraBody: {
        ...(agentModel.startsWith('openai/') ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }),
        temperature: 0.7
      },
    });

    if (aiResult.error) {
      console.error('AI API error:', aiResult.error);
      if (aiResult.circuitOpen) {
        throw new Error('AI Gateway circuit is open. Please try again later.');
      }
      throw new Error(`AI API error: ${aiResult.error}`);
    }

    let analysisContent = aiResult.content;

    if (!analysisContent) {
      throw new Error('No analysis content received from AI');
    }

    // ─── ADVERSARIAL SELF-REVIEW ───
    // Agent re-reads its own output as a critic and strengthens weak reasoning
    const { reviewedAnalysis, weaknessesFound, reviewNotes } = await runAdversarialReview(
      analysisContent,
      selectedAgent,
      agentConfig.specialty,
      investigationContext,
      agentModel
    );
    analysisContent = reviewedAnalysis;
    console.log(`[Orchestrator] ${selectedAgent} self-review: ${weaknessesFound} weaknesses found and addressed`);

    // ─── HYPOTHESIS TREE (for ambiguous cases) ───
    // Detect ambiguity markers in the analysis and generate competing hypotheses
    let hypothesisData: { treeId: string; branches: any[] } = { treeId: '', branches: [] };
    const ambiguityIndicators = ['unclear', 'ambiguous', 'multiple possible', 'could be', 'alternatively', 'uncertain'];
    const hasAmbiguity = ambiguityIndicators.some(ind => analysisContent.toLowerCase().includes(ind));
    
    if (hasAmbiguity && incident.signals) {
      const ambiguityQuestion = `What is the most likely explanation for: ${incident.signals.normalized_text?.substring(0, 200) || incident.title}?`;
      hypothesisData = await generateHypothesisTree(
        supabase, selectedAgent, ambiguityQuestion, investigationContext,
        incident_id, incident.signal_id, agentModel
      );
    }

    // ─── AGENT ACCURACY: Record predictions for later calibration ───
    // Extract severity/priority predictions from analysis to track accuracy
    const predictionPromises: Promise<any>[] = [];
    if (incident.signals?.severity) {
      predictionPromises.push(
        recordAgentPrediction(supabase, selectedAgent, 'threat_assessment',
          incident.priority || 'p3', agentCalibration.calibration * 0.7,
          incident_id, incident.signal_id)
      );
    }
    if (hypothesisData.branches.length > 0) {
      const topHypothesis = hypothesisData.branches.sort((a: any, b: any) => b.probability - a.probability)[0];
      predictionPromises.push(
        recordAgentPrediction(supabase, selectedAgent, 'hypothesis',
          topHypothesis.hypothesis.substring(0, 200), topHypothesis.probability,
          incident_id, incident.signal_id)
      );
    }
    await Promise.all(predictionPromises);

    // Extract a 0-100 severity score from the CoT analysis text, adjusted by calibration
    function extractWeightedSeverityScore(analysisText: string, calibration: number): number | null {
      // Look for explicit confidence percentage in Step 5 output
      const confMatch = analysisText.match(/(?:confidence|certainty)[:\s]+(\d{1,3})%/i)
        || analysisText.match(/(\d{1,3})%\s+(?:confidence|certainty)/i);
      if (confMatch) {
        const base = Math.min(100, Math.max(0, parseInt(confMatch[1])));
        return Math.round(base * calibration);
      }
      // Fallback: map HIGH/MEDIUM/LOW confidence keywords to numeric scores
      if (/\bHIGH\s+CONFIDENCE\b/i.test(analysisText)) return Math.round(80 * calibration);
      if (/\bMEDIUM\s+CONFIDENCE\b/i.test(analysisText)) return Math.round(55 * calibration);
      if (/\bLOW\s+CONFIDENCE\b/i.test(analysisText)) return Math.round(30 * calibration);
      return null;
    }

    const weightedScore = extractWeightedSeverityScore(analysisContent, agentCalibration.calibration);

    // Create analysis log entry
    const analysisEntry = {
      timestamp: new Date().toISOString(),
      agent_id: agentRecord?.id,
      agent_call_sign: selectedAgent,
      agent_specialty: agentConfig.specialty,
      analysis: analysisContent,
      investigation_focus: agentConfig.investigationFocus,
      prompt_used: userPrompt.substring(0, 500) + '...',
      self_review: {
        weaknesses_found: weaknessesFound,
        review_notes: reviewNotes,
        review_applied: weaknessesFound > 0,
      },
      hypothesis_tree: hypothesisData.treeId ? {
        tree_id: hypothesisData.treeId,
        branch_count: hypothesisData.branches.length,
        top_hypothesis: hypothesisData.branches[0]?.hypothesis || null,
      } : null,
      agent_calibration: {
        accuracy: agentCalibration.accuracy,
        calibration_factor: agentCalibration.calibration,
        total_tracked: agentCalibration.totalPredictions,
      },
      // Accuracy-weighted severity: only applied when agent has sufficient history
      weighted_severity_score: weightedScore,
      agent_reliability: {
        accuracy_pct: Math.round(agentCalibration.accuracy * 100),
        calibration_factor: agentCalibration.calibration,
        total_predictions: agentCalibration.totalPredictions,
        weight_applied: agentCalibration.totalPredictions >= 5,
      },
    };

    // Tier 2: Store agent memory from this investigation
    await storeAgentMemory(supabase, selectedAgent, analysisContent.substring(0, 1500), {
      incidentId: incident_id,
      clientId: incident.client_id,
      memoryType: 'investigation',
      entities: incident.signals?.entity_tags || [],
      tags: [incident.priority, incident.signals?.category].filter(Boolean),
      confidence: 0.7,
    });

    // Update incident with analysis
    const currentLog = incident.ai_analysis_log || [];
    const updatedLog = [...currentLog, analysisEntry];

    // Update timeline with agent contribution
    const currentTimeline = incident.timeline_json || [];
    const updatedTimeline = [
      ...currentTimeline,
      {
        timestamp: new Date().toISOString(),
        event: `${selectedAgent} Investigation Complete`,
        details: `Agent ${selectedAgent} completed specialized analysis focusing on: ${agentConfig.investigationFocus.join(', ')}`,
        actor: selectedAgent
      }
    ];

    await supabase
      .from('incidents')
      .update({
        ai_analysis_log: updatedLog,
        timeline_json: updatedTimeline,
        investigation_status: 'in_progress',
        updated_at: new Date().toISOString()
      })
      .eq('id', incident_id);

    console.log(`${selectedAgent} analysis complete for incident ${incident_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        agent: selectedAgent,
        analysis: analysisContent,
        investigation_focus: agentConfig.investigationFocus,
        incident_id,
        log_entry_count: updatedLog.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in incident agent orchestrator:', error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('402') || errorMessage.includes('credits')) {
      return new Response(
        JSON.stringify({ error: 'AI credits exhausted. Please add credits in Settings → Workspace → Usage.' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
