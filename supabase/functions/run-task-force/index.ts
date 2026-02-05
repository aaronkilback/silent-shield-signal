import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

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

function buildRoEFromRecord(record: any): RoE {
  return {
    mode: record.mode || 'STANDARD',
    audience: record.audience || 'INTERNAL',
    classification: record.classification || 'TLP:AMBER',
    permissions: record.permissions || {},
    evidence_policy: record.evidence_policy || {
      require_evidence_for_claims: true,
      minimum_evidence_for_client_output: 'E2',
      minimum_evidence_for_directive: 'E3',
      forbidden_without_evidence: ['attribution', 'prediction', 'recommendation'],
    },
    uncertainty_protocol: record.uncertainty_protocol || {
      required_fields: ['Confidence', 'Assumptions', 'Unknowns', 'To confirm'],
      must_label_hypotheses: true,
      ban_phrases: ['definitely', 'certainly', 'guaranteed'],
    },
    scope_control: record.scope_control || {
      must_stay_within_mission_objective: true,
      must_not_invent_data: true,
      max_questions_before_proceeding: 3,
    },
    validation_gate: record.validation_gate || {
      run_before_publish: true,
      checks: ['lint', 'evidence', 'scope'],
      on_fail: 'block',
    },
  };
}

function getDefaultRoE(): RoE {
  return {
    mode: 'STANDARD',
    audience: 'INTERNAL',
    classification: 'TLP:AMBER',
    permissions: {},
    evidence_policy: {
      require_evidence_for_claims: true,
      minimum_evidence_for_client_output: 'E2',
      minimum_evidence_for_directive: 'E3',
      forbidden_without_evidence: ['attribution', 'prediction'],
    },
    uncertainty_protocol: {
      required_fields: ['Confidence', 'Assumptions', 'Unknowns', 'To confirm'],
      must_label_hypotheses: true,
      ban_phrases: ['definitely', 'certainly'],
    },
    scope_control: {
      must_stay_within_mission_objective: true,
      must_not_invent_data: true,
      max_questions_before_proceeding: 3,
    },
    validation_gate: {
      run_before_publish: true,
      checks: ['lint'],
      on_fail: 'warn',
    },
  };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { mission_id } = await req.json();
    console.log('Running task force mission with RoE:', mission_id);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createServiceClient();

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
    const commanderIntentPrompt = `You are the Task Force Leader for mission: "${mission.title}".

MISSION OBJECTIVE: ${mission.objective}

RULES OF ENGAGEMENT:
- Mode: ${roe.mode}
- Audience: ${roe.audience}
- Classification: ${roe.classification}
- Evidence Policy: ${JSON.stringify(roe.evidence_policy)}
- Uncertainty Protocol: ${JSON.stringify(roe.uncertainty_protocol)}
- Scope Control: ${JSON.stringify(roe.scope_control)}

AVAILABLE AGENTS:
${assignedAgents?.map(a => `- ${a.ai_agents?.codename} (${a.ai_agents?.specialty}): ${a.role}`).join('\n')}

Generate the Commander's Intent with:
1. PURPOSE: Why we are conducting this mission
2. KEY TASKS: 3-5 specific tasks for the team
3. END STATE: What success looks like
4. CONSTRAINTS: Based on RoE, what are we NOT allowed to do
5. AGENT ASSIGNMENTS: Which agent handles which task

Keep response concise and actionable.`;

    const intentResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: leader.ai_agents?.system_prompt || 'You are a tactical team leader.' },
          { role: 'user', content: commanderIntentPrompt }
        ],
      }),
    });

    if (!intentResponse.ok) {
      throw new Error('Failed to generate commander intent');
    }

    const intentData = await intentResponse.json();
    const commanderIntent = intentData.choices?.[0]?.message?.content || '';

    // Update mission with commander intent
    await supabase
      .from('task_force_missions')
      .update({ 
        phase: 'execution',
        commander_intent: commanderIntent
      })
      .eq('id', mission_id);

    // Phase 2: Execute agent tasks (simplified - in production would be parallel)
    const agentOutputs: Record<string, string> = {};
    
    for (const agent of assignedAgents?.filter(a => a.role !== 'leader') || []) {
      const agentPrompt = `You are ${agent.ai_agents?.codename}, specialist in ${agent.ai_agents?.specialty}.

MISSION: ${mission.title}
OBJECTIVE: ${mission.objective}

COMMANDER'S INTENT:
${commanderIntent}

YOUR ROLE: ${agent.role}

RULES OF ENGAGEMENT:
- Mode: ${roe.mode} (${roe.mode === 'STRICT' ? 'All claims require evidence, no speculation' : 'Standard analytical rigor'})
- Must include: ${roe.uncertainty_protocol.required_fields.join(', ')}
- Banned phrases: ${roe.uncertainty_protocol.ban_phrases.join(', ')}

Provide your analysis for this mission. Include Confidence, Assumptions, Unknowns, and validation steps.`;

      const agentResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: agent.ai_agents?.system_prompt || `You are ${agent.ai_agents?.codename}.` },
            { role: 'user', content: agentPrompt }
          ],
        }),
      });

      if (agentResponse.ok) {
        const agentData = await agentResponse.json();
        agentOutputs[agent.ai_agents?.codename || 'unknown'] = agentData.choices?.[0]?.message?.content || '';
      }
    }

    // Phase 3: Leader synthesizes final report
    const synthesisPrompt = `You are the Task Force Leader. Synthesize the team's findings into a final mission report.

MISSION: ${mission.title}
OBJECTIVE: ${mission.objective}

COMMANDER'S INTENT:
${commanderIntent}

AGENT CONTRIBUTIONS:
${Object.entries(agentOutputs).map(([name, output]) => `=== ${name} ===\n${output}`).join('\n\n')}

RULES OF ENGAGEMENT:
- Mode: ${roe.mode}
- Audience: ${roe.audience}
- Classification: ${roe.classification}

Create a consolidated mission report with:
1. EXECUTIVE SUMMARY
2. KEY FINDINGS (with evidence levels E0-E4)
3. RECOMMENDATIONS (with owner and timeline)
4. CONFIDENCE ASSESSMENT
5. ASSUMPTIONS AND UNKNOWNS
6. VALIDATION STEPS REQUIRED

Ensure compliance with RoE - no absolute certainty claims, proper evidence tagging.`;

    const synthesisResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: leader.ai_agents?.system_prompt || 'You are a tactical team leader.' },
          { role: 'user', content: synthesisPrompt }
        ],
      }),
    });

    let finalReport = '';
    if (synthesisResponse.ok) {
      const synthesisData = await synthesisResponse.json();
      finalReport = synthesisData.choices?.[0]?.message?.content || '';
    }

    // Phase 4: Run lint validation
    const lintResult = runLintChecker(finalReport, {
      mode: roe.mode,
      audience: roe.audience as 'INTERNAL' | 'CLIENT',
      evidenceLevel: 'E2',
      applyAutoFix: true,
    });

    // Use fixed content if available
    const publishedReport = lintResult.fixed_content || finalReport;

    // Update mission with final report
    await supabase
      .from('task_force_missions')
      .update({ 
        phase: 'completed',
        completed_at: new Date().toISOString(),
        final_report: publishedReport,
        validation_results: {
          lint_status: lintResult.status,
          block_count: lintResult.block_count,
          warn_count: lintResult.warn_count,
          info_count: lintResult.info_count,
          issues: lintResult.results.slice(0, 10),
        }
      })
      .eq('id', mission_id);

    return successResponse({
      success: true,
      mission_id,
      phase: 'completed',
      commander_intent: commanderIntent,
      agent_count: assignedAgents?.length || 0,
      final_report: publishedReport,
      validation: {
        status: lintResult.status,
        blocks: lintResult.block_count,
        warnings: lintResult.warn_count,
        auto_fixed: lintResult.fixed_content !== null,
      },
      roe_applied: {
        mode: roe.mode,
        audience: roe.audience,
        classification: roe.classification,
      }
    });

  } catch (error) {
    console.error('Error running task force:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
