import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Evidence level hierarchy
const EVIDENCE_LEVELS = ['E0', 'E1', 'E2', 'E3', 'E4'];

// ============= LINT RULES INLINE =============
type LintSeverity = 'BLOCK' | 'WARN' | 'INFO';

interface LintRule {
  id: string;
  name: string;
  severity: LintSeverity;
  trigger_patterns: RegExp[];
  message: string;
  suggested_fix: string;
  auto_fix: boolean | 'partial';
  auto_fix_fn?: (content: string) => string;
}

interface LintResult {
  rule_id: string;
  severity: LintSeverity;
  message: string;
  suggested_fix: string;
  match: string;
  position: number;
  auto_fixed: boolean;
}

interface LintGateResult {
  status: 'PASS' | 'WARN' | 'FAIL';
  results: LintResult[];
  fixed_content: string | null;
  block_count: number;
  warn_count: number;
  info_count: number;
}

// Auto-fix helper functions
const softenerReplacements: Record<string, string> = {
  'definitely': 'likely',
  'guaranteed': 'expected',
  'certainly': 'appears to',
  '100%': 'high confidence',
  'no doubt': 'based on available evidence',
  'without a doubt': 'with high confidence',
  'for sure': 'likely',
  'proven': 'strongly indicated',
};

function applySoftenerFixes(content: string): string {
  let fixed = content;
  for (const [phrase, replacement] of Object.entries(softenerReplacements)) {
    const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
    fixed = fixed.replace(regex, replacement);
  }
  return fixed;
}

function applyAccessClaimFixes(content: string): string {
  const patterns = [
    { pattern: /\bi checked\b/gi, replacement: 'If we check' },
    { pattern: /\bi reviewed\b/gi, replacement: 'If we review' },
    { pattern: /\bi pulled\b/gi, replacement: 'If we pull' },
    { pattern: /\bi queried\b/gi, replacement: 'If we query' },
    { pattern: /\bi accessed\b/gi, replacement: 'If we access' },
    { pattern: /\bi looked up\b/gi, replacement: 'If we look up' },
    { pattern: /\bi have updated\b/gi, replacement: 'Recommended action: update' },
    { pattern: /\bi changed\b/gi, replacement: 'Recommended action: change' },
    { pattern: /\bi disabled\b/gi, replacement: 'Recommended action: disable' },
    { pattern: /\bi blocked\b/gi, replacement: 'Recommended action: block' },
    { pattern: /\bi reset\b/gi, replacement: 'Recommended action: reset' },
  ];
  let fixed = content;
  for (const { pattern, replacement } of patterns) {
    fixed = fixed.replace(pattern, replacement);
  }
  return fixed;
}

function applyWeVoiceFixes(content: string): string {
  const patterns = [
    { pattern: /\bwe investigated\b/gi, replacement: 'The analysis investigated' },
    { pattern: /\bwe confirmed\b/gi, replacement: 'The task force analysis confirms' },
    { pattern: /\bour team found\b/gi, replacement: 'The analysis found' },
  ];
  let fixed = content;
  for (const { pattern, replacement } of patterns) {
    fixed = fixed.replace(pattern, replacement);
  }
  return fixed;
}

function appendUncertaintyBlock(content: string): string {
  const hasConfidence = /\bConfidence\b/i.test(content);
  const hasAssumptions = /\bAssumptions\b/i.test(content);
  const hasUnknowns = /\bUnknowns\b/i.test(content);
  const hasToConfirm = /\bTo confirm\b/i.test(content);
  
  if (hasConfidence && hasAssumptions && hasUnknowns && hasToConfirm) {
    return content;
  }
  
  let block = '\n\n---\n';
  if (!hasConfidence) block += '**Confidence:** [LOW|MEDIUM|HIGH]\n';
  if (!hasAssumptions) block += '**Assumptions:**\n- [List assumptions here]\n';
  if (!hasUnknowns) block += '**Unknowns:**\n- [List unknowns here]\n';
  if (!hasToConfirm) block += '**To confirm:**\n- [List validation steps here]\n';
  
  return content + block;
}

function injectDisclaimer(content: string): string {
  const disclaimer = '\n\n> **Disclaimer:** This information is for general guidance only. Consult qualified professionals for specific advice.\n';
  return content + disclaimer;
}

function stripInternalReferences(content: string): string {
  const internalPatterns = [
    /\[internal only\][^\n]*/gi,
    /\[do not share\][^\n]*/gi,
    /agent feed[^\n]*/gi,
    /lint gate[^\n]*/gi,
    /validation errors[^\n]*/gi,
    /system prompt[^\n]*/gi,
  ];
  let fixed = content;
  for (const pattern of internalPatterns) {
    fixed = fixed.replace(pattern, '');
  }
  return fixed.replace(/\n{3,}/g, '\n\n');
}

// Define all 14 lint rules
const LINT_RULES: LintRule[] = [
  {
    id: 'LINT-CERT-ABS',
    name: 'Absolute Certainty Language',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(definitely|guaranteed|certainly|100%|no doubt|without a doubt|for sure|proven)\b/i,
    ],
    message: 'Absolute certainty language is not allowed in STRICT mode.',
    suggested_fix: "Replace with confidence label + conditional phrasing.",
    auto_fix: true,
    auto_fix_fn: applySoftenerFixes,
  },
  {
    id: 'LINT-ATTR-ACTOR',
    name: 'Unverified Attribution / Actor Claims',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(it was|this was|we know it was)\s+(russia|china|iran|north korea|criminals|hackers|insiders|activists)\b/i,
      /\b(attributed to|linked to|carried out by|perpetrator)\b/i,
    ],
    message: 'Actor attribution requires evidence >= E3 and explicit source citation.',
    suggested_fix: "Move to hypothesis section: 'Possible actor sets include…'",
    auto_fix: false,
  },
  {
    id: 'LINT-ACCESS-CLAIM',
    name: 'Claiming System Access / Actions Taken',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(i checked|i reviewed|i pulled|i queried|i accessed|i looked up)\b.*\b(logs|camera feeds|email|database|internal system|SIEM|3Si|Fortress)\b/i,
      /\b(i have updated|i changed|i disabled|i blocked|i reset)\b/i,
    ],
    message: 'Model must not claim system access or actions taken.',
    suggested_fix: "Rephrase as: 'If we check X (owner: ___), we can confirm…'",
    auto_fix: true,
    auto_fix_fn: applyAccessClaimFixes,
  },
  {
    id: 'LINT-METRIC-INVENT',
    name: 'Invented Metrics / Telemetry',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(\d+(\.\d+)?)\s*(minutes|min|hours|hrs|days)\b.*\b(MTTD|MTTR|MTTA|MTTI|MTTC|SLA|SLO|SLI)\b/i,
      /\b(we observed|telemetry shows|logs show|metrics show)\b/i,
    ],
    message: 'Metrics or telemetry must be sourced from allowed inputs.',
    suggested_fix: "If target: say 'Target: MTTD < 10 min'. If observation: cite source.",
    auto_fix: 'partial',
  },
  {
    id: 'LINT-FACT-INVENT',
    name: 'Invented Incident Counts / Dates / Locations',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(on|as of|since)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},\s+\d{4}\b/i,
      /\b(\d+)\s+(incidents|events|alerts|breaches|attempts)\b/i,
    ],
    message: 'Specific facts must come from provided sources or be labeled as assumptions.',
    suggested_fix: 'Ask for the missing facts OR label as assumption/hypothesis.',
    auto_fix: false,
  },
  {
    id: 'LINT-EVIDENCE-NEEDED',
    name: 'Sourceless Strong Claims',
    severity: 'WARN',
    trigger_patterns: [
      /\b(this indicates|this confirms|root cause is|the reason is|we know)\b/i,
    ],
    message: 'Strong claims require an evidence tag (E2+) and cited input source.',
    suggested_fix: "Add 'Based on [source]' + evidence level, or downgrade to hypothesis.",
    auto_fix: false,
  },
  {
    id: 'LINT-SCOPE-CREEP',
    name: 'Scope Creep / Outside Mission Objective',
    severity: 'WARN',
    trigger_patterns: [
      /\b(also|in addition|by the way|another thing|separately)\b.*\b(unrelated|different topic|side note)\b/i,
    ],
    message: 'Potential scope creep detected.',
    suggested_fix: "Move extra items to 'Optional Next Missions' section.",
    auto_fix: true,
  },
  {
    id: 'LINT-PROHIBITED',
    name: 'Prohibited Content Areas',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(build a weapon|make a bomb|explosive|poison|malware|phishing kit|bypass|break in)\b/i,
    ],
    message: 'Prohibited content request detected.',
    suggested_fix: 'Refuse + provide safety-aligned alternatives.',
    auto_fix: false,
  },
  {
    id: 'LINT-REGULATED',
    name: 'Legal / Medical Final Advice',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(legal advice|lawyer|sue|liability)\b.*\b(should|must|recommend)\b/i,
      /\b(diagnose|treatment|prescription)\b.*\b(you have|you should)\b/i,
    ],
    message: 'Regulated advice must be framed as general info.',
    suggested_fix: 'Add disclaimer + recommend professional review.',
    auto_fix: true,
    auto_fix_fn: injectDisclaimer,
  },
  {
    id: 'LINT-TRADEOFFS',
    name: 'Overconfident Recommendations',
    severity: 'WARN',
    trigger_patterns: [
      /\b(do this now|you must|you should always|never do)\b/i,
    ],
    message: 'Directive language needs tradeoffs and owner/time horizon.',
    suggested_fix: "Add 'Owner', 'Time horizon', 'Constraints', 'Risks/Tradeoffs'.",
    auto_fix: 'partial',
  },
  {
    id: 'LINT-MISSING-FIELDS',
    name: 'Missing Required Uncertainty Fields',
    severity: 'BLOCK',
    trigger_patterns: [],
    message: 'Output missing required fields (Confidence, Assumptions, Unknowns, To confirm).',
    suggested_fix: 'Append the 4-field block.',
    auto_fix: true,
    auto_fix_fn: appendUncertaintyBlock,
  },
  {
    id: 'LINT-INTERNAL-LEAK',
    name: 'Client-Facing Internal Leaks',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(internal only|do not share|secret|confidential sources|red team notes|exploit)\b/i,
      /\b(agent feed|lint gate|validation errors|system prompt)\b/i,
    ],
    message: 'Internal mechanics must not appear in client-facing output.',
    suggested_fix: 'Remove internal references.',
    auto_fix: true,
    auto_fix_fn: stripInternalReferences,
  },
  {
    id: 'LINT-FAKE-SOURCES',
    name: 'Fake Citations / Fabricated Sources',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(according to|as reported by|source:)\s+(?!(user_input|uploaded_files|internal_incident_logs|approved_osint_feeds|the client|the user|mission inputs))/i,
    ],
    message: 'Citations must reference allowed source tags only.',
    suggested_fix: 'Replace with allowed source tag or remove claim.',
    auto_fix: false,
  },
  {
    id: 'LINT-WE-VOICE',
    name: '"We" Language Misrepresenting a Team',
    severity: 'INFO',
    trigger_patterns: [
      /\bwe investigated|we confirmed|our team found\b/i,
    ],
    message: "Avoid implying human investigation. Use 'The task force analysis suggests…'",
    suggested_fix: "Replace 'we' with 'analysis' phrasing.",
    auto_fix: true,
    auto_fix_fn: applyWeVoiceFixes,
  },
];

function checkMissingFields(content: string): boolean {
  const hasConfidence = /\bConfidence\b/i.test(content);
  const hasAssumptions = /\bAssumptions\b/i.test(content);
  const hasUnknowns = /\bUnknowns\b/i.test(content);
  const hasToConfirm = /\b(To confirm|Validation Steps?)\b/i.test(content);
  return !(hasConfidence && hasAssumptions && hasUnknowns && hasToConfirm);
}

function runLintChecker(
  content: string,
  options: {
    mode: 'STRICT' | 'STANDARD';
    audience: 'INTERNAL' | 'CLIENT';
    evidenceLevel: string;
    applyAutoFix: boolean;
  }
): LintGateResult {
  const results: LintResult[] = [];
  let fixedContent = content;
  
  for (const rule of LINT_RULES) {
    if (rule.id === 'LINT-INTERNAL-LEAK' && options.audience !== 'CLIENT') continue;
    if (rule.id === 'LINT-EVIDENCE-NEEDED' && options.mode === 'STANDARD') continue;
    
    if (rule.id === 'LINT-MISSING-FIELDS') {
      if (checkMissingFields(content)) {
        const result: LintResult = {
          rule_id: rule.id,
          severity: rule.severity,
          message: rule.message,
          suggested_fix: rule.suggested_fix,
          match: 'Missing: Confidence, Assumptions, Unknowns, To confirm',
          position: content.length,
          auto_fixed: false,
        };
        if (options.applyAutoFix && rule.auto_fix && rule.auto_fix_fn) {
          fixedContent = rule.auto_fix_fn(fixedContent);
          result.auto_fixed = true;
        }
        results.push(result);
      }
      continue;
    }
    
    for (const pattern of rule.trigger_patterns) {
      const matches = content.matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const result: LintResult = {
          rule_id: rule.id,
          severity: rule.severity,
          message: rule.message,
          suggested_fix: rule.suggested_fix,
          match: match[0],
          position: match.index ?? 0,
          auto_fixed: false,
        };
        if (options.applyAutoFix && rule.auto_fix === true && rule.auto_fix_fn) {
          fixedContent = rule.auto_fix_fn(fixedContent);
          result.auto_fixed = true;
        }
        results.push(result);
      }
    }
  }
  
  const blockCount = results.filter(r => r.severity === 'BLOCK' && !r.auto_fixed).length;
  const warnCount = results.filter(r => r.severity === 'WARN').length;
  const infoCount = results.filter(r => r.severity === 'INFO').length;
  
  let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  if (blockCount > 0) {
    status = 'FAIL';
  } else if (warnCount > 0 && options.audience === 'CLIENT') {
    const evidenceNum = parseInt(options.evidenceLevel.replace('E', '')) || 0;
    status = evidenceNum < 2 ? 'FAIL' : 'WARN';
  } else if (warnCount > 0) {
    status = 'WARN';
  }
  
  return {
    status,
    results,
    fixed_content: fixedContent !== content ? fixedContent : null,
    block_count: blockCount,
    warn_count: warnCount,
    info_count: infoCount,
  };
}

// ============= END LINT RULES =============

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
  lint_results?: LintResult[];
  fixed_content?: string | null;
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

  // Run lint checker first
  const lintResult = runLintChecker(response.content, {
    mode: roe.mode as 'STRICT' | 'STANDARD',
    audience: (roe.audience as 'INTERNAL' | 'CLIENT') || 'INTERNAL',
    evidenceLevel: response.evidence_level,
    applyAutoFix: true, // Apply auto-fixes
  });

  // Collect lint errors/warnings
  for (const lint of lintResult.results) {
    const msg = `[${lint.rule_id}] ${lint.message}${lint.auto_fixed ? ' [AUTO-FIXED]' : ''}`;
    if (lint.severity === 'BLOCK' && !lint.auto_fixed) {
      errors.push(msg);
    } else if (lint.severity === 'WARN') {
      warnings.push(msg);
    }
  }

  // Check evidence level
  const minEvidence = roe.evidence_policy.minimum_evidence_for_client_output;
  const evidenceIndex = EVIDENCE_LEVELS.indexOf(response.evidence_level);
  const minIndex = EVIDENCE_LEVELS.indexOf(minEvidence);

  if (roe.audience === 'CLIENT' && evidenceIndex < minIndex) {
    errors.push(`Evidence too low for client output. Got ${response.evidence_level}, minimum is ${minEvidence}.`);
  }

  // Check required fields (beyond lint)
  if (roe.uncertainty_protocol.required_fields?.includes('assumptions') && response.assumptions.length === 0) {
    warnings.push('Missing required field: assumptions');
  }

  if (roe.uncertainty_protocol.required_fields?.includes('unknowns') && response.unknowns.length === 0) {
    warnings.push('Missing required field: unknowns');
  }

  // Determine status
  let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  if (errors.length > 0 || lintResult.status === 'FAIL') status = 'FAIL';
  else if (warnings.length > 0 || lintResult.status === 'WARN') status = 'WARN';

  return { 
    status, 
    errors, 
    warnings,
    lint_results: lintResult.results,
    fixed_content: lintResult.fixed_content,
  };
}
