import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Evidence level hierarchy
const EVIDENCE_LEVELS = ['E0', 'E1', 'E2', 'E3', 'E4'];

interface RoE {
  mode: 'STRICT' | 'STANDARD';
  audience: string;
  classification: string;
  permissions: Record<string, boolean>;
  evidence_policy: {
    require_evidence_for_claims: boolean;
    minimum_evidence_for_client_output: string;
    minimum_evidence_for_directive: string;
    forbidden_without_evidence: string[];
  };
  uncertainty_protocol: {
    required_fields: string[];
    must_label_hypotheses: boolean;
    ban_phrases: string[];
  };
  scope_control: {
    must_stay_within_mission_objective: boolean;
    must_not_invent_data: boolean;
    max_questions_before_proceeding: number;
  };
  validation_gate: {
    run_before_publish: boolean;
    checks: string[];
    on_fail: string;
  };
}

interface ValidationResult {
  status: 'PASS' | 'WARN' | 'FAIL';
  errors: string[];
  warnings: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mission_id } = await req.json();
    console.log('Running task force mission with RoE:', mission_id);

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
      .select('*, rules_of_engagement(*)')
      .eq('id', mission_id)
      .single();

    if (missionError || !mission) {
      throw new Error('Mission not found');
    }

    // Get RoE (mission override > global default)
    let roe: RoE;
    if (mission.roe_override) {
      roe = mission.roe_override as RoE;
    } else if (mission.rules_of_engagement) {
      roe = buildRoEFromRecord(mission.rules_of_engagement);
    } else {
      // Fetch global default
      const { data: globalRoe } = await supabase
        .from('rules_of_engagement')
        .select('*')
        .eq('is_global_default', true)
        .single();
      
      roe = globalRoe ? buildRoEFromRecord(globalRoe) : getDefaultRoE();
    }

    // Fetch assigned agents
    const { data: assignedAgents, error: agentsError } = await supabase
      .from('task_force_agents')
      .select('*, ai_agents(*)')
      .eq('mission_id', mission_id);

    if (agentsError) throw agentsError;

    const leader = assignedAgents?.find(a => a.role === 'leader');
    if (!leader) {
      throw new Error('No Task Force Leader assigned');
    }

    // Update mission phase to briefing
    await supabase
      .from('task_force_missions')
      .update({ phase: 'briefing', started_at: new Date().toISOString() })
      .eq('id', mission_id);

    // Phase 1: Leader generates Commander's Intent with RoE context
    const briefingPrompt = buildBriefingPrompt(leader, mission, assignedAgents, roe);
    const briefingResponse = await callAIWithRoE(LOVABLE_API_KEY, leader.ai_agents, briefingPrompt, roe);
    
    // Validate briefing
    const briefingValidation = validateOutput(briefingResponse, roe, 'briefing');
    
    // Save leader's briefing
    await supabase.from('task_force_contributions').insert({
      mission_id,
      agent_id: leader.agent_id,
      role: 'leader',
      content: briefingResponse.content,
      content_type: 'briefing',
      confidence_score: briefingResponse.confidence,
      assumptions: briefingResponse.assumptions,
      unknowns: briefingResponse.unknowns,
      next_validation_steps: briefingResponse.next_validation_steps,
      evidence_level: briefingResponse.evidence_level,
      phase: 'briefing',
      validation_status: briefingValidation.status,
      validation_errors: briefingValidation.errors,
    });

    // Update phase to execution
    await supabase
      .from('task_force_missions')
      .update({ 
        phase: 'execution',
        commanders_intent: briefingResponse.content,
      })
      .eq('id', mission_id);

    // Phase 2: Each agent contributes with RoE enforcement
    const otherAgents = assignedAgents?.filter(a => a.role !== 'leader') || [];
    
    for (const agent of otherAgents) {
      await supabase
        .from('task_force_agents')
        .update({ status: 'working' })
        .eq('id', agent.id);

      const agentPrompt = buildAgentPromptWithRoE(agent, mission, briefingResponse.content, roe);
      const agentResponse = await callAIWithRoE(LOVABLE_API_KEY, agent.ai_agents, agentPrompt, roe);
      
      const agentValidation = validateOutput(agentResponse, roe, 'analysis');

      await supabase.from('task_force_contributions').insert({
        mission_id,
        agent_id: agent.agent_id,
        role: agent.role,
        content: agentResponse.content,
        content_type: 'analysis',
        confidence_score: agentResponse.confidence,
        assumptions: agentResponse.assumptions,
        unknowns: agentResponse.unknowns,
        next_validation_steps: agentResponse.next_validation_steps,
        evidence_level: agentResponse.evidence_level,
        phase: 'execution',
        validation_status: agentValidation.status,
        validation_errors: agentValidation.errors,
      });

      await supabase
        .from('task_force_agents')
        .update({ status: 'completed' })
        .eq('id', agent.id);
    }

    // Phase 3: Synthesis with RoE
    await supabase
      .from('task_force_missions')
      .update({ phase: 'synthesis' })
      .eq('id', mission_id);

    const { data: allContributions } = await supabase
      .from('task_force_contributions')
      .select('*, ai_agents(call_sign)')
      .eq('mission_id', mission_id)
      .order('created_at');

    const synthesisPrompt = buildSynthesisPromptWithRoE(leader, mission, allContributions || [], roe);
    const finalResponse = await callAIWithRoE(LOVABLE_API_KEY, leader.ai_agents, synthesisPrompt, roe);
    
    const finalValidation = validateOutput(finalResponse, roe, 'synthesis');

    // Determine overall mission validation status
    const allValidations = [briefingValidation, finalValidation];
    const missionValidationStatus = allValidations.some(v => v.status === 'FAIL') 
      ? 'FAIL' 
      : allValidations.some(v => v.status === 'WARN') 
        ? 'WARN' 
        : 'PASS';

    const allErrors = allValidations.flatMap(v => v.errors);

    // Save final output
    await supabase.from('task_force_contributions').insert({
      mission_id,
      agent_id: leader.agent_id,
      role: 'leader',
      content: finalResponse.content,
      content_type: 'synthesis',
      confidence_score: finalResponse.confidence,
      assumptions: finalResponse.assumptions,
      unknowns: finalResponse.unknowns,
      evidence_level: finalResponse.evidence_level,
      phase: 'synthesis',
      validation_status: finalValidation.status,
      validation_errors: finalValidation.errors,
    });

    await supabase
      .from('task_force_missions')
      .update({ 
        phase: 'completed',
        final_output: finalResponse.content,
        completed_at: new Date().toISOString(),
        validation_status: missionValidationStatus,
        validation_errors: allErrors,
      })
      .eq('id', mission_id);

    await supabase
      .from('task_force_agents')
      .update({ status: 'completed' })
      .eq('mission_id', mission_id);

    console.log('Mission completed with validation status:', missionValidationStatus);

    return new Response(
      JSON.stringify({ 
        success: true, 
        phase: 'completed',
        validation_status: missionValidationStatus,
        validation_errors: allErrors,
      }),
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

function buildRoEFromRecord(record: any): RoE {
  return {
    mode: record.mode || 'STRICT',
    audience: record.audience || 'INTERNAL',
    classification: record.classification || 'CONFIDENTIAL',
    permissions: record.permissions || {},
    evidence_policy: record.evidence_policy || {},
    uncertainty_protocol: record.uncertainty_protocol || {},
    scope_control: record.scope_control || {},
    validation_gate: record.validation_gate || {},
  };
}

function getDefaultRoE(): RoE {
  return {
    mode: 'STRICT',
    audience: 'INTERNAL',
    classification: 'CONFIDENTIAL',
    permissions: {
      can_read_sources: true,
      can_use_external_web: false,
      can_generate_recommendations: true,
      can_issue_directives: false,
    },
    evidence_policy: {
      require_evidence_for_claims: true,
      minimum_evidence_for_client_output: 'E2',
      minimum_evidence_for_directive: 'E3',
      forbidden_without_evidence: ['attribution of specific actors', 'specific timeline certainty'],
    },
    uncertainty_protocol: {
      required_fields: ['confidence', 'assumptions', 'unknowns'],
      must_label_hypotheses: true,
      ban_phrases: ['definitely', 'guaranteed', 'certainly', '100%'],
    },
    scope_control: {
      must_stay_within_mission_objective: true,
      must_not_invent_data: true,
      max_questions_before_proceeding: 3,
    },
    validation_gate: {
      run_before_publish: true,
      checks: ['ScopeCheck', 'EvidenceCheck', 'UncertaintyFieldsCheck'],
      on_fail: 'REVISE_AND_FLAG',
    },
  };
}

function buildBriefingPrompt(leader: any, mission: any, agents: any[], roe: RoE): string {
  return `You are ${leader.ai_agents.codename}, the Task Force Leader.

RULES OF ENGAGEMENT (${roe.mode} MODE):
- Classification: ${roe.classification}
- Audience: ${roe.audience}
- Must stay within mission scope
- Must not invent data or claim certainty without evidence
- Evidence requirement for outputs: ${roe.evidence_policy.minimum_evidence_for_client_output}
- Banned phrases: ${roe.uncertainty_protocol.ban_phrases?.join(', ') || 'none'}

MISSION: ${mission.name}
TYPE: ${mission.mission_type}
PRIORITY: ${mission.priority}
TIME HORIZON: ${mission.time_horizon}

DESCRIPTION: ${mission.description || 'No description provided'}
DESIRED OUTCOME: ${mission.desired_outcome || 'Not specified'}
CONSTRAINTS: ${mission.constraints || 'None specified'}

Team Members:
${agents?.map(a => `- ${a.ai_agents.call_sign} (${a.role})`).join('\n')}

YOUR OUTPUT MUST INCLUDE:
1. **Commander's Intent** - What we're trying to achieve
2. **End State** - Success criteria
3. **Assumptions** - What we're assuming (be explicit)
4. **Unknowns** - What we don't know
5. **Task Breakdown** - Assignments for each team member
6. **Evidence Level** - Rate your confidence (E0-E4)
7. **Confidence** - LOW/MEDIUM/HIGH
8. **Next Validation Steps** - How to verify claims

Format your response with clear headers. Label any hypotheses explicitly.`;
}

function buildAgentPromptWithRoE(agent: any, mission: any, briefing: string, roe: RoE): string {
  const roleInstructions: Record<string, string> = {
    intelligence_analyst: `Analyze available intelligence. You MUST:
- Tag each finding with evidence level (E0-E4)
- List assumptions explicitly
- Identify unknowns
- NOT attribute specific actors without E3+ evidence
- Label hypotheses clearly`,
    
    operations_officer: `Develop operational response. You MUST:
- Ground recommendations in available evidence
- State assumptions for each action
- Identify gaps requiring validation
- NOT claim certainty without E3+ evidence`,
    
    client_liaison: `Prepare client-facing elements. You MUST:
- Use clear, non-technical language
- Include only verified information (E2+)
- Mark any unverified items as "To Confirm"
- Provide confidence levels`,
  };

  return `You are ${agent.ai_agents.codename} (${agent.ai_agents.call_sign}).

RULES OF ENGAGEMENT (${roe.mode} MODE):
- Mode: ${roe.mode}
- Classification: ${roe.classification}
- Must not invent data
- Must label all hypotheses
- Evidence minimum: ${roe.evidence_policy.minimum_evidence_for_client_output}
- Banned phrases: ${roe.uncertainty_protocol.ban_phrases?.join(', ') || 'none'}

MISSION: ${mission.name}
YOUR ROLE: ${agent.role}

COMMANDER'S INTENT:
${briefing}

YOUR TASK:
${roleInstructions[agent.role] || 'Provide analysis within your specialty.'}

YOUR OUTPUT MUST INCLUDE:
1. **Analysis/Findings** - Your contribution
2. **Evidence Level** - E0 to E4
3. **Confidence** - LOW/MEDIUM/HIGH
4. **Assumptions** - Bulleted list
5. **Unknowns** - What you don't know
6. **Next Validation Steps** - How to verify

Stay in character. Do NOT invent facts. Label hypotheses explicitly.`;
}

function buildSynthesisPromptWithRoE(leader: any, mission: any, contributions: any[], roe: RoE): string {
  return `You are ${leader.ai_agents.codename}, Task Force Leader.

RULES OF ENGAGEMENT (${roe.mode} MODE):
- Audience: ${roe.audience}
- Classification: ${roe.classification}
- Final output evidence minimum: ${roe.evidence_policy.minimum_evidence_for_client_output}
- Must include: confidence, assumptions, unknowns
- Banned phrases: ${roe.uncertainty_protocol.ban_phrases?.join(', ') || 'none'}

MISSION: ${mission.name}
TYPE: ${mission.mission_type}

TEAM CONTRIBUTIONS:
${contributions?.map(c => `
### ${c.ai_agents?.call_sign} (${c.role}) - Evidence: ${c.evidence_level || 'E0'}, Confidence: ${c.confidence_score ? Math.round(c.confidence_score * 100) + '%' : 'Unknown'}
${c.content}
Assumptions: ${c.assumptions?.join(', ') || 'None stated'}
Unknowns: ${c.unknowns?.join(', ') || 'None stated'}
---`).join('\n')}

SYNTHESIZE INTO A UNIFIED OUTPUT with these sections:

1. **Executive Summary** (2-3 sentences)
2. **What We Know** (Evidence E2+)
3. **What We Don't Know** (Gaps & uncertainties)
4. **Key Assumptions** (Consolidated from team)
5. **Confidence Assessment** (Overall: LOW/MEDIUM/HIGH with rationale)
6. **Immediate Actions** (Top 5 with owners)
7. **If-Then Triggers** (Contingencies)
8. **Next Validation Steps** (To improve evidence levels)

Remove duplication. Resolve conflicts. DO NOT include any claim below E2 as fact.
Label hypotheses. Do not use banned phrases.`;
}

interface StructuredResponse {
  content: string;
  evidence_level: string;
  confidence: number;
  assumptions: string[];
  unknowns: string[];
  next_validation_steps: string[];
}

async function callAIWithRoE(apiKey: string, agent: any, prompt: string, roe: RoE): Promise<StructuredResponse> {
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: agent.system_prompt || '' },
        { role: 'user', content: prompt }
      ],
    }),
  });

  if (!response.ok) {
    throw new Error('AI request failed');
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Parse structured fields from response
  const parsed = parseStructuredResponse(content);
  
  return parsed;
}

function parseStructuredResponse(content: string): StructuredResponse {
  // Extract evidence level
  const evidenceMatch = content.match(/Evidence\s*(?:Level)?[:\s]*([EÉ][0-4])/i);
  const evidenceLevel = evidenceMatch ? evidenceMatch[1].toUpperCase().replace('É', 'E') : 'E1';

  // Extract confidence
  let confidence = 0.5;
  if (/confidence[:\s]*(high|haut)/i.test(content)) confidence = 0.85;
  else if (/confidence[:\s]*(medium|moyen)/i.test(content)) confidence = 0.65;
  else if (/confidence[:\s]*(low|bas)/i.test(content)) confidence = 0.35;

  // Extract assumptions
  const assumptionsMatch = content.match(/\*?\*?Assumptions\*?\*?[:\s]*\n?([\s\S]*?)(?=\n\*?\*?[A-Z]|$)/i);
  const assumptions = assumptionsMatch 
    ? assumptionsMatch[1].split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•')).map(line => line.replace(/^[-•]\s*/, '').trim())
    : [];

  // Extract unknowns
  const unknownsMatch = content.match(/\*?\*?Unknowns\*?\*?[:\s]*\n?([\s\S]*?)(?=\n\*?\*?[A-Z]|$)/i);
  const unknowns = unknownsMatch 
    ? unknownsMatch[1].split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•')).map(line => line.replace(/^[-•]\s*/, '').trim())
    : [];

  // Extract next validation steps
  const validationMatch = content.match(/\*?\*?(?:Next )?Validation\s*Steps?\*?\*?[:\s]*\n?([\s\S]*?)(?=\n\*?\*?[A-Z]|$)/i);
  const nextValidationSteps = validationMatch 
    ? validationMatch[1].split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().match(/^\d+\./)).map(line => line.replace(/^[-•\d.]\s*/, '').trim())
    : [];

  return {
    content,
    evidence_level: evidenceLevel,
    confidence,
    assumptions: assumptions.filter(a => a.length > 0),
    unknowns: unknowns.filter(u => u.length > 0),
    next_validation_steps: nextValidationSteps.filter(s => s.length > 0),
  };
}

function validateOutput(response: StructuredResponse, roe: RoE, outputType: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check evidence level
  const minEvidence = roe.evidence_policy.minimum_evidence_for_client_output;
  const evidenceIndex = EVIDENCE_LEVELS.indexOf(response.evidence_level);
  const minIndex = EVIDENCE_LEVELS.indexOf(minEvidence);

  if (roe.audience === 'CLIENT' && evidenceIndex < minIndex) {
    errors.push(`Evidence too low for client output. Got ${response.evidence_level}, minimum is ${minEvidence}.`);
  }

  // Check required fields
  if (roe.uncertainty_protocol.required_fields?.includes('assumptions') && response.assumptions.length === 0) {
    warnings.push('Missing required field: assumptions');
  }

  if (roe.uncertainty_protocol.required_fields?.includes('unknowns') && response.unknowns.length === 0) {
    warnings.push('Missing required field: unknowns');
  }

  // Check banned phrases
  const bannedPhrases = roe.uncertainty_protocol.ban_phrases || [];
  for (const phrase of bannedPhrases) {
    if (response.content.toLowerCase().includes(phrase.toLowerCase())) {
      warnings.push(`Contains banned phrase: "${phrase}"`);
    }
  }

  // Check for unverified attributions
  if (roe.evidence_policy.forbidden_without_evidence?.includes('attribution of specific actors')) {
    const attributionPatterns = /(?:is responsible for|was caused by|perpetrated by|attributed to)\s+[A-Z][a-z]+/;
    if (attributionPatterns.test(response.content) && evidenceIndex < 3) {
      errors.push('Contains actor attribution without E3+ evidence');
    }
  }

  // Determine status
  let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  if (errors.length > 0) status = 'FAIL';
  else if (warnings.length > 0) status = 'WARN';

  return { status, errors, warnings };
}
