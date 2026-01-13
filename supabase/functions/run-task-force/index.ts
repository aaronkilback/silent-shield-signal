import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mission_id } = await req.json();
    console.log('Running task force mission:', mission_id);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch mission details
    const { data: mission, error: missionError } = await supabase
      .from('task_force_missions')
      .select('*')
      .eq('id', mission_id)
      .single();

    if (missionError || !mission) {
      throw new Error('Mission not found');
    }

    // Fetch assigned agents
    const { data: assignedAgents, error: agentsError } = await supabase
      .from('task_force_agents')
      .select('*, ai_agents(*)')
      .eq('mission_id', mission_id);

    if (agentsError) throw agentsError;

    // Find the leader
    const leader = assignedAgents?.find(a => a.role === 'leader');
    if (!leader) {
      throw new Error('No Task Force Leader assigned');
    }

    // Update mission phase to briefing
    await supabase
      .from('task_force_missions')
      .update({ phase: 'briefing', started_at: new Date().toISOString() })
      .eq('id', mission_id);

    // Phase 1: Leader generates Commander's Intent
    const briefingPrompt = `You are ${leader.ai_agents.codename}, the Task Force Leader for this mission.

MISSION: ${mission.name}
TYPE: ${mission.mission_type}
PRIORITY: ${mission.priority}
TIME HORIZON: ${mission.time_horizon}

DESCRIPTION: ${mission.description || 'No description provided'}
DESIRED OUTCOME: ${mission.desired_outcome || 'Not specified'}
CONSTRAINTS: ${mission.constraints || 'None specified'}

YOUR TASK:
Generate a Commander's Intent briefing that includes:
1. **End State** - What success looks like
2. **Key Assumptions** - What we're assuming to be true
3. **Task Breakdown** - Specific tasks for each team member
4. **Critical Information Requirements** - What we need to know

Team Members:
${assignedAgents?.map(a => `- ${a.ai_agents.call_sign} (${a.role})`).join('\n')}

Be decisive, clear, and actionable. This briefing will guide the entire operation.`;

    const briefingResponse = await callAI(LOVABLE_API_KEY, leader.ai_agents.system_prompt || '', briefingPrompt);
    
    // Save leader's briefing
    await supabase.from('task_force_contributions').insert({
      mission_id,
      agent_id: leader.agent_id,
      role: 'leader',
      content: briefingResponse,
      content_type: 'briefing',
      confidence_score: 0.95,
      phase: 'briefing',
    });

    // Update phase to execution
    await supabase
      .from('task_force_missions')
      .update({ 
        phase: 'execution',
        commanders_intent: briefingResponse,
      })
      .eq('id', mission_id);

    // Phase 2: Each agent contributes
    const otherAgents = assignedAgents?.filter(a => a.role !== 'leader') || [];
    
    for (const agent of otherAgents) {
      const agentPrompt = buildAgentPrompt(agent, mission, briefingResponse);
      
      await supabase
        .from('task_force_agents')
        .update({ status: 'working' })
        .eq('id', agent.id);

      const agentResponse = await callAI(
        LOVABLE_API_KEY, 
        agent.ai_agents.system_prompt || '', 
        agentPrompt
      );

      await supabase.from('task_force_contributions').insert({
        mission_id,
        agent_id: agent.agent_id,
        role: agent.role,
        content: agentResponse,
        content_type: 'analysis',
        confidence_score: 0.85,
        phase: 'execution',
      });

      await supabase
        .from('task_force_agents')
        .update({ status: 'completed' })
        .eq('id', agent.id);
    }

    // Phase 3: Synthesis by leader
    await supabase
      .from('task_force_missions')
      .update({ phase: 'synthesis' })
      .eq('id', mission_id);

    // Fetch all contributions
    const { data: allContributions } = await supabase
      .from('task_force_contributions')
      .select('*, ai_agents(call_sign)')
      .eq('mission_id', mission_id)
      .order('created_at');

    const synthesisPrompt = `You are ${leader.ai_agents.codename}, Task Force Leader.

The team has completed their analysis. Your job is to synthesize all contributions into a single, unified final output.

MISSION: ${mission.name}
TYPE: ${mission.mission_type}

TEAM CONTRIBUTIONS:
${allContributions?.map(c => `
### ${c.ai_agents?.call_sign} (${c.role})
${c.content}
---`).join('\n')}

CREATE A UNIFIED FINAL OUTPUT that includes:

1. **Executive Summary** - 2-3 sentences
2. **What We Know** - Key findings from the team
3. **What We Don't Know** - Gaps and uncertainties
4. **Key Assumptions** - What we're assuming
5. **Immediate Actions** - Top 5 actions with owners
6. **If-Then Triggers** - Contingency responses
7. **Next Review** - When to reassess

Remove duplication, resolve conflicts, and create a single coherent deliverable.
Format for ${mission.mission_type === 'executive_brief' ? 'executive consumption' : 'operational use'}.`;

    const finalOutput = await callAI(LOVABLE_API_KEY, leader.ai_agents.system_prompt || '', synthesisPrompt);

    // Save final output and complete mission
    await supabase.from('task_force_contributions').insert({
      mission_id,
      agent_id: leader.agent_id,
      role: 'leader',
      content: finalOutput,
      content_type: 'synthesis',
      confidence_score: 0.9,
      phase: 'synthesis',
    });

    await supabase
      .from('task_force_missions')
      .update({ 
        phase: 'completed',
        final_output: finalOutput,
        completed_at: new Date().toISOString(),
      })
      .eq('id', mission_id);

    await supabase
      .from('task_force_agents')
      .update({ status: 'completed' })
      .eq('mission_id', mission_id);

    console.log('Mission completed successfully');

    return new Response(
      JSON.stringify({ success: true, phase: 'completed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in run-task-force:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('AI error:', response.status, errorText);
    throw new Error('AI request failed');
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function buildAgentPrompt(agent: any, mission: any, briefing: string): string {
  const roleInstructions: Record<string, string> = {
    intelligence_analyst: `Analyze the intelligence landscape for this mission. Identify:
- Relevant signals and threats
- Pattern analysis
- Threat momentum indicators
- Information gaps
- Confidence levels for each finding`,
    
    operations_officer: `Develop operational response for this mission. Provide:
- Tactical actions and protocols
- Timeline and sequencing
- Resource requirements
- Risk mitigation measures
- Contingency procedures`,
    
    client_liaison: `Prepare client-facing elements for this mission. Include:
- Simplified action steps for the client
- Communication templates
- FAQ preparation
- Escalation contacts
- Progress checkpoints`,
  };

  return `You are ${agent.ai_agents.codename} (${agent.ai_agents.call_sign}).

MISSION: ${mission.name}
YOUR ROLE: ${agent.role}

COMMANDER'S INTENT:
${briefing}

YOUR TASK:
${roleInstructions[agent.role] || 'Provide your specialized analysis and recommendations for this mission.'}

Stay in character. Be concise but thorough. Include confidence levels and assumptions.`;
}
