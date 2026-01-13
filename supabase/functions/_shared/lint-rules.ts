// RoE Lint Rules - Regex-based hallucination prevention

export type LintSeverity = 'BLOCK' | 'WARN' | 'INFO';

export interface LintRule {
  id: string;
  name: string;
  severity: LintSeverity;
  trigger_patterns: RegExp[];
  message: string;
  suggested_fix: string;
  auto_fix: boolean | 'partial';
  auto_fix_fn?: (content: string) => string;
}

export interface LintResult {
  rule_id: string;
  severity: LintSeverity;
  message: string;
  suggested_fix: string;
  match: string;
  position: number;
  auto_fixed: boolean;
}

export interface LintGateResult {
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
  const disclaimer = '\n\n> **Disclaimer:** This information is provided for general guidance only and should not be considered as professional legal or medical advice. Please consult qualified professionals for specific advice.\n';
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
export const LINT_RULES: LintRule[] = [
  {
    id: 'LINT-CERT-ABS',
    name: 'Absolute Certainty Language',
    severity: 'BLOCK',
    trigger_patterns: [
      /\b(definitely|guaranteed|certainly|100%|no doubt|without a doubt|for sure|proven)\b/i,
    ],
    message: 'Absolute certainty language is not allowed in STRICT mode.',
    suggested_fix: "Replace with confidence label + conditional phrasing (e.g., 'Likely', 'Based on available inputs').",
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
    suggested_fix: "Move to hypothesis section: 'Possible actor sets include…' + add validation steps.",
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
    message: 'Model must not claim system access or actions taken unless explicitly enabled and logged.',
    suggested_fix: "Rephrase as: 'If we check X (owner: ___), we can confirm…' or 'Recommended action: … (owner).'",
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
    message: 'Metrics or telemetry must be sourced from allowed inputs or labeled as targets (not observations).',
    suggested_fix: "If target: say 'Target: MTTD < 10 min'. If observation: cite internal source and timestamp.",
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
    message: 'Specific facts (counts/dates/locations) must come from provided sources or be moved to assumptions.',
    suggested_fix: 'Ask for the missing facts OR label as assumption/hypothesis with validation steps.',
    auto_fix: false,
  },
  {
    id: 'LINT-EVIDENCE-NEEDED',
    name: 'Sourceless Strong Claims',
    severity: 'WARN',
    trigger_patterns: [
      /\b(this indicates|this confirms|root cause is|the reason is|we know)\b/i,
    ],
    message: 'Strong claims require an evidence tag (E2+) and at least one cited input source.',
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
    message: 'Potential scope creep detected. Ensure content maps to mission objective.',
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
    message: 'Regulated advice must be framed as general info + refer to qualified professional.',
    suggested_fix: 'Add disclaimer + recommend professional review.',
    auto_fix: true,
    auto_fix_fn: injectDisclaimer,
  },
  {
    id: 'LINT-TRADEOFFS',
    name: 'Overconfident Recommendations Without Tradeoffs',
    severity: 'WARN',
    trigger_patterns: [
      /\b(do this now|you must|you should always|never do)\b/i,
    ],
    message: 'Directive language needs tradeoffs, constraints, and owner/time horizon.',
    suggested_fix: "Add 'Owner', 'Time horizon', 'Constraints', 'Risks/Tradeoffs'.",
    auto_fix: 'partial',
  },
  {
    id: 'LINT-MISSING-FIELDS',
    name: 'Missing Required Uncertainty Fields',
    severity: 'BLOCK',
    trigger_patterns: [], // Checked separately via logic
    message: 'Output missing required uncertainty fields (Confidence, Assumptions, Unknowns, To confirm).',
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
    suggested_fix: 'Remove internal references; keep only clean deliverable.',
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
    message: "Avoid implying human investigation unless it occurred. Use 'The task force analysis suggests…'",
    suggested_fix: "Replace 'we' with 'analysis' phrasing.",
    auto_fix: true,
    auto_fix_fn: applyWeVoiceFixes,
  },
];

// Check for missing required fields (special logic, not regex)
function checkMissingFields(content: string): boolean {
  const hasConfidence = /\bConfidence\b/i.test(content);
  const hasAssumptions = /\bAssumptions\b/i.test(content);
  const hasUnknowns = /\bUnknowns\b/i.test(content);
  const hasToConfirm = /\b(To confirm|Validation Steps?)\b/i.test(content);
  
  return !(hasConfidence && hasAssumptions && hasUnknowns && hasToConfirm);
}

export function runLintChecker(
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
    // Skip LINT-INTERNAL-LEAK for internal audience
    if (rule.id === 'LINT-INTERNAL-LEAK' && options.audience !== 'CLIENT') {
      continue;
    }
    
    // Skip LINT-EVIDENCE-NEEDED for STANDARD mode
    if (rule.id === 'LINT-EVIDENCE-NEEDED' && options.mode === 'STANDARD') {
      continue;
    }
    
    // Special handling for LINT-MISSING-FIELDS
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
    
    // Check each pattern
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
  
  // Count by severity
  const blockCount = results.filter(r => r.severity === 'BLOCK' && !r.auto_fixed).length;
  const warnCount = results.filter(r => r.severity === 'WARN').length;
  const infoCount = results.filter(r => r.severity === 'INFO').length;
  
  // Determine overall status
  let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  if (blockCount > 0) {
    status = 'FAIL';
  } else if (warnCount > 0 && options.audience === 'CLIENT') {
    // In CLIENT mode, WARN with insufficient evidence also blocks
    const evidenceNum = parseInt(options.evidenceLevel.replace('E', '')) || 0;
    if (evidenceNum < 2) {
      status = 'FAIL';
    } else {
      status = 'WARN';
    }
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

// Helper to format lint results for display
export function formatLintResultsForDisplay(gateResult: LintGateResult): string[] {
  const messages: string[] = [];
  
  for (const result of gateResult.results) {
    const prefix = result.severity === 'BLOCK' ? '🚫' : result.severity === 'WARN' ? '⚠️' : 'ℹ️';
    const fixedTag = result.auto_fixed ? ' [AUTO-FIXED]' : '';
    messages.push(
      `${prefix} [${result.rule_id}] ${result.message}${fixedTag}\n   Match: "${result.match.substring(0, 50)}..."\n   Fix: ${result.suggested_fix}`
    );
  }
  
  return messages;
}
