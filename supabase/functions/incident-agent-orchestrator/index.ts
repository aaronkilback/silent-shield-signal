import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { incident_id, agent_call_sign, prompt } = await req.json();
    
    if (!incident_id) {
      throw new Error('incident_id is required');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch incident with related data
    const { data: incident, error: incidentError } = await supabase
      .from('incidents')
      .select('*, signals(*), clients(*)')
      .eq('id', incident_id)
      .single();

    if (incidentError || !incident) {
      throw new Error('Incident not found');
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

    // Update incident status
    await supabase
      .from('incidents')
      .update({
        investigation_status: 'in_progress',
        assigned_agent_ids: incident.assigned_agent_ids 
          ? [...new Set([...incident.assigned_agent_ids, agentRecord?.id])]
          : [agentRecord?.id]
      })
      .eq('id', incident_id);

    // Build investigation context
    const investigationContext = `
=== INCIDENT DETAILS ===
Incident ID: ${incident.id}
Priority: ${incident.priority?.toUpperCase()}
Status: ${incident.status}
Title: ${incident.title || 'N/A'}
Opened: ${incident.opened_at}

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
`;

    const systemPrompt = `You are ${selectedAgent}, a specialized AI security analyst within the Fortress AI Task Force.
Your specialty: ${agentConfig.specialty}
Investigation focus areas: ${agentConfig.investigationFocus.join(', ')}

${agentConfig.promptTemplate}

CRITICAL RULES:
1. Base all findings on provided evidence only
2. Clearly label assumptions vs. confirmed facts
3. Use conditional language for uncertain conclusions
4. Provide specific, actionable recommendations
5. Include confidence levels for each finding
6. Identify gaps in information that need human follow-up

OUTPUT FORMAT:
Structure your analysis with:
- **Key Findings**: List major discoveries with evidence levels
- **Assessment**: Your professional evaluation
- **Recommendations**: Prioritized action items with owners
- **Assumptions**: What you assumed (to be validated)
- **Unknowns**: Information gaps requiring investigation
- **Confidence Level**: Overall confidence (LOW/MEDIUM/HIGH)`;

    const userPrompt = prompt || `Conduct a thorough investigation of this incident within your specialty area:

${investigationContext}

Provide your specialized analysis following the output format specified.`;

    console.log(`Dispatching ${selectedAgent} for incident ${incident_id}`);

    // Call AI
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 4000,
        temperature: 0.7
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        throw new Error('Rate limited. Please try again later.');
      }
      if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted. Please add credits to continue.');
      }
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const analysisContent = aiData.choices?.[0]?.message?.content;

    if (!analysisContent) {
      throw new Error('No analysis content received from AI');
    }

    // Create analysis log entry
    const analysisEntry = {
      timestamp: new Date().toISOString(),
      agent_id: agentRecord?.id,
      agent_call_sign: selectedAgent,
      agent_specialty: agentConfig.specialty,
      analysis: analysisContent,
      investigation_focus: agentConfig.investigationFocus,
      prompt_used: userPrompt.substring(0, 500) + '...'
    };

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
