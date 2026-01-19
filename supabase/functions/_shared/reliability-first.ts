// ═══════════════════════════════════════════════════════════════════════════
//                    FORTRESS RELIABILITY FIRST MODE
// ═══════════════════════════════════════════════════════════════════════════
// Every claim must have a source artifact. No simulated, placeholder, invented,
// or assumed data. If data cannot be verified, say "Not verified".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// ═══════════════════════════════════════════════════════════════════════════
//                         TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface SourceArtifact {
  id: string;
  source_type: 'url' | 'html_snapshot' | 'pdf' | 'screenshot' | 'feed_event' | 
               'incident_record' | 'log_excerpt' | 'satellite_feed' | 'financial_quote' |
               'internal_document' | 'client_report' | 'osint_scan';
  url?: string;
  title?: string;
  content_hash: string;
  storage_path?: string;
  retrieved_at: string;
  metadata?: Record<string, any>;
  is_verified: boolean;
}

export interface BriefingClaim {
  claim_text: string;
  claim_type: 'fact' | 'statistic' | 'quote' | 'date' | 'location' | 'entity_mention' | 'assessment';
  provenance: 'internal' | 'external' | 'derived' | 'unverified';
  confidence_level: 'high' | 'medium' | 'low' | 'unverified';
  confidence_rationale?: string;
  citation_key: string;
  source_ids: string[];
  is_verified: boolean;
}

export interface VerificationTask {
  claim_text: string;
  verification_type: 'source_missing' | 'source_outdated' | 'conflicting_sources' | 'low_confidence' | 'unverified_claim';
  where_to_check?: string;
  deadline?: string;
}

export interface EvidenceGateResult {
  passed: boolean;
  verified_claims: BriefingClaim[];
  unverified_claims: BriefingClaim[];
  verification_tasks: VerificationTask[];
  sources_used: SourceArtifact[];
  qa_issues: string[];
  reliability_score: number;
}

export interface ReliabilitySettings {
  reliability_first_enabled: boolean;
  require_min_sources: number;
  require_snapshot_for_external: boolean;
  auto_create_verification_tasks: boolean;
  block_unverified_claims: boolean;
  max_source_age_hours: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         FORBIDDEN PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const FORBIDDEN_PATTERNS = [
  // Placeholder indicators
  /example\s+(external\s+)?link/gi,
  /example\.com/gi,
  /placeholder/gi,
  /\[insert\s+\w+\s+here\]/gi,
  /lorem\s+ipsum/gi,
  
  // Invented data indicators
  /simulated\s+(data|scenario|event)/gi,
  /for\s+(this\s+)?demonstration/gi,
  /hypothetical(ly)?/gi,
  /let('s)?\s+imagine/gi,
  /as\s+an\s+example/gi,
  
  // Fake identifiers
  /INC-\d{3,4}(?![0-9])/g,  // Short incident IDs that look fake
  /PROJECT-\d+/gi,
  /TASK-\d+/gi,
  
  // Invented specifics
  /John\s+Doe/gi,
  /Jane\s+Doe/gi,
  /ACME\s+(Corp|Company|Inc)/gi,
  /ABC\s+Company/gi,
  /XYZ\s+(Corp|Company|Inc)/gi,
  
  // Training/demo language
  /in\s+this\s+training/gi,
  /for\s+this\s+exercise/gi,
  /demo\s+mode/gi,
  /test\s+scenario/gi,
];

// NEW: Geopolitical/News fabrication patterns - CRITICAL
const FABRICATED_NEWS_PATTERNS = [
  // Fabricated geopolitical claims
  /\[UNVERIFIED\]\s*(Reports|Sources|Intelligence)/gi,
  /unverified.*?reports\s+(of|indicate|suggest)/gi,
  /reports\s+of\s+renewed\s+maritime\s+friction/gi,
  /increased\s+naval\s+activity\s+in\s+the/gi,
  /tensions\s+in\s+the\s+(strait|sea|gulf)/gi,
  /sovereignty\s+tensions/gi,
  /global\s+energy\s+policy\s+shift/gi,
  /rumors\s+of\s+a\s+major/gi,
  
  // Fabricated threat assessments
  /professional\s+adversary/gi,
  /coordinated\s+campaign/gi,
  /sustained\s+.*?\s+multi-site\s+campaign/gi,
  /dry\s+runs?\s+for\s+a\s+larger/gi,
  /high-tempo\s+operational\s+environment/gi,
  
  // Fabricated HUMINT/collection requirements
  /humint\s+requirement/gi,
  /source\s+typology/gi,
  /collection\s+priorities?\s*\(PIR/gi,
  /priority\s+intelligence\s+requirements?/gi,
  /access\s+vectors?\s+within/gi,
  /identified?\s+"access\s+vectors"/gi,
  
  // Speculative language
  /may\s+lead\s+to\s+(a\s+)?spike/gi,
  /could\s+exacerbate/gi,
  /likely\s+being\s+used\s+as\s+social\s+cover/gi,
  /more\s+radical\s+elements\s+to\s+operate/gi,
  /foreign\s+influence\s+operations/gi,
  /state\s+or\s+non-state\s+actor/gi,
  
  // Invented impacts
  /impact:\s+could\s+lead/gi,
  /impact:\s+may\s+lead/gi,
  /impact:\s+directly\s+threatens/gi,
  /increasing\s+the\s+strategic\s+value.*?target\s+profile/gi,
];

const VAGUE_QUANTIFIERS = [
  /several\s+(incidents?|signals?|threats?|entities?)/gi,
  /numerous\s+(incidents?|signals?|threats?|entities?)/gi,
  /multiple\s+(incidents?|signals?|threats?|entities?)/gi,
  /approximately\s+\d+/gi,
  /around\s+\d+\s+(incidents?|signals?|threats?)/gi,
  /about\s+\d+\s+(incidents?|signals?|threats?)/gi,
  /a\s+cluster\s+of/gi,
];

// ═══════════════════════════════════════════════════════════════════════════
//                         QA CHECKS
// ═══════════════════════════════════════════════════════════════════════════

export function runQAChecks(content: string, knownIds: { 
  incidentIds?: string[], 
  signalIds?: string[], 
  entityIds?: string[] 
}): string[] {
  const issues: string[] = [];
  
  // Check for forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      issues.push(`Forbidden pattern detected: "${matches[0]}"`);
    }
  }
  
  // NEW: Check for fabricated news/geopolitical patterns - CRITICAL
  for (const pattern of FABRICATED_NEWS_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      issues.push(`⛔ FABRICATED CONTENT DETECTED: "${matches[0]}" - This appears to be invented geopolitical/news content`);
    }
  }
  
  // Check for vague quantifiers
  for (const pattern of VAGUE_QUANTIFIERS) {
    const matches = content.match(pattern);
    if (matches) {
      issues.push(`Vague quantifier: "${matches[0]}" - use exact counts from database`);
    }
  }
  
  // Check for future dates (potential fabrication)
  const datePattern = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+202[7-9]/gi;
  const futureMatches = content.match(datePattern);
  if (futureMatches) {
    issues.push(`Future date detected: "${futureMatches[0]}" - verify this is accurate`);
  }
  
  // Check for incident IDs that don't exist in known IDs
  const incidentIdPattern = /\b[A-Z]{2,4}-\d{4,8}\b/g;
  const mentionedIds = content.match(incidentIdPattern) || [];
  if (knownIds.incidentIds) {
    for (const id of mentionedIds) {
      if (!knownIds.incidentIds.includes(id)) {
        issues.push(`Referenced ID "${id}" not found in database - may be fabricated`);
      }
    }
  }
  
  // Check for missing citations in factual sentences
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const factualIndicators = [
    /\d+\s+(incidents?|signals?|threats?|people|employees|casualties)/i,
    /confirmed|verified|reported|occurred|identified/i,
    /on\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i,
  ];
  
  for (const sentence of sentences) {
    const isFactual = factualIndicators.some(p => p.test(sentence));
    const hasCitation = /\[S\d+\]|\[Source:|\(Source:|\bsource:\s/i.test(sentence);
    
    if (isFactual && !hasCitation) {
      const preview = sentence.trim().substring(0, 80);
      issues.push(`Factual claim without citation: "${preview}..."`);
    }
  }
  
  // NEW: Check for "Breaking" news without web search evidence
  const breakingNewsPatterns = [
    /breaking.*?geopolitical/gi,
    /breaking.*?news/gi,
    /global.*?instability/gi,
    /maritime\s+friction/gi,
    /arctic.*?tensions/gi,
    /resource\s+nationalism/gi,
  ];
  
  for (const pattern of breakingNewsPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      issues.push(`⛔ EXTERNAL NEWS WITHOUT SOURCE: "${matches[0]}" - Must use perform_external_web_search first`);
    }
  }
  
  return issues;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         CONFIDENCE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

export function calculateConfidence(sources: SourceArtifact[]): {
  level: 'high' | 'medium' | 'low' | 'unverified';
  rationale: string;
} {
  if (sources.length === 0) {
    return { level: 'unverified', rationale: 'No source artifacts available' };
  }
  
  const verifiedSources = sources.filter(s => s.is_verified);
  const internalSources = sources.filter(s => 
    ['incident_record', 'internal_document', 'client_report', 'log_excerpt'].includes(s.source_type)
  );
  const externalSources = sources.filter(s => 
    ['url', 'html_snapshot', 'pdf', 'osint_scan', 'feed_event'].includes(s.source_type)
  );
  
  // High confidence: 2+ independent sources OR 1 authoritative internal + 1 external
  if (sources.length >= 2 && (internalSources.length >= 1 || verifiedSources.length >= 1)) {
    return {
      level: 'high',
      rationale: `${sources.length} sources (${internalSources.length} internal, ${externalSources.length} external)`
    };
  }
  
  // Medium confidence: 1 solid source
  if (sources.length === 1 && (verifiedSources.length === 1 || internalSources.length === 1)) {
    return {
      level: 'medium',
      rationale: `Single ${sources[0].source_type} source, limited corroboration`
    };
  }
  
  // Low confidence: weak or unverified sources
  if (sources.length >= 1) {
    return {
      level: 'low',
      rationale: `${sources.length} unverified external source(s)`
    };
  }
  
  return { level: 'unverified', rationale: 'Insufficient evidence' };
}

// ═══════════════════════════════════════════════════════════════════════════
//                         SOURCE ARTIFACT CREATION
// ═══════════════════════════════════════════════════════════════════════════

export async function createSourceArtifact(
  supabase: any,
  data: {
    source_type: SourceArtifact['source_type'];
    url?: string;
    title?: string;
    content: string;
    client_id?: string;
    tenant_id?: string;
    metadata?: Record<string, any>;
  }
): Promise<SourceArtifact | null> {
  // Generate content hash for tamper evidence
  const encoder = new TextEncoder();
  const data_buffer = encoder.encode(data.content);
  const hash_buffer = await crypto.subtle.digest('SHA-256', data_buffer);
  const hash_array = Array.from(new Uint8Array(hash_buffer));
  const content_hash = hash_array.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Check if this exact content already exists
  const { data: existing } = await supabase
    .from('source_artifacts')
    .select('*')
    .eq('content_hash', content_hash)
    .single();
  
  if (existing) {
    return existing as SourceArtifact;
  }
  
  const { data: artifact, error } = await supabase
    .from('source_artifacts')
    .insert({
      source_type: data.source_type,
      url: data.url,
      title: data.title,
      content_hash,
      client_id: data.client_id,
      tenant_id: data.tenant_id,
      metadata: {
        ...data.metadata,
        content_preview: data.content.substring(0, 500),
      },
      retrieved_at: new Date().toISOString(),
    })
    .select()
    .single();
  
  if (error) {
    console.error('Failed to create source artifact:', error);
    return null;
  }
  
  return artifact as SourceArtifact;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         VERIFICATION TASK CREATION
// ═══════════════════════════════════════════════════════════════════════════

export async function createVerificationTask(
  supabase: any,
  task: VerificationTask & { client_id?: string; tenant_id?: string }
): Promise<string | null> {
  const { data, error } = await supabase
    .from('verification_tasks')
    .insert({
      claim_text: task.claim_text,
      verification_type: task.verification_type,
      where_to_check: task.where_to_check,
      deadline: task.deadline || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      client_id: task.client_id,
      tenant_id: task.tenant_id,
      status: 'pending',
    })
    .select('id')
    .single();
  
  if (error) {
    console.error('Failed to create verification task:', error);
    return null;
  }
  
  return (data as any).id;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         EVIDENCE GATE
// ═══════════════════════════════════════════════════════════════════════════

export async function runEvidenceGate(
  supabase: any,
  briefingContent: string,
  sources: SourceArtifact[],
  settings: ReliabilitySettings,
  knownIds: { incidentIds?: string[], signalIds?: string[], entityIds?: string[] } = {}
): Promise<EvidenceGateResult> {
  const qa_issues = runQAChecks(briefingContent, knownIds);
  const verification_tasks: VerificationTask[] = [];
  
  // Calculate overall confidence
  const { level: overallConfidence } = calculateConfidence(sources);
  
  // Check source age
  const maxAgeMs = settings.max_source_age_hours * 60 * 60 * 1000;
  const now = Date.now();
  const staleSources = sources.filter(s => 
    now - new Date(s.retrieved_at).getTime() > maxAgeMs
  );
  
  if (staleSources.length > 0) {
    qa_issues.push(`${staleSources.length} source(s) exceed max age of ${settings.max_source_age_hours} hours`);
    staleSources.forEach(s => {
      verification_tasks.push({
        claim_text: `Source "${s.title || s.url}" is stale`,
        verification_type: 'source_outdated',
        where_to_check: s.url || 'Re-fetch from original source',
      });
    });
  }
  
  // Check minimum sources requirement
  if (sources.length < settings.require_min_sources) {
    qa_issues.push(`Only ${sources.length} source(s), minimum required is ${settings.require_min_sources}`);
  }
  
  // Calculate reliability score (0-100)
  let reliability_score = 100;
  reliability_score -= qa_issues.length * 10;
  reliability_score -= staleSources.length * 5;
  if (overallConfidence === 'low') reliability_score -= 20;
  if (overallConfidence === 'unverified') reliability_score -= 40;
  reliability_score = Math.max(0, Math.min(100, reliability_score));
  
  // Determine if gate passes
  const passed = settings.block_unverified_claims 
    ? (qa_issues.length === 0 && sources.length >= settings.require_min_sources)
    : true;
  
  return {
    passed,
    verified_claims: [],
    unverified_claims: [],
    verification_tasks,
    sources_used: sources,
    qa_issues,
    reliability_score,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//                         RELIABILITY FIRST PROMPT
// ═══════════════════════════════════════════════════════════════════════════

export function getReliabilityFirstPrompt(sources: SourceArtifact[]): string {
  const sourceList = sources.map((s, i) => 
    `[S${i + 1}] ${s.source_type}: ${s.title || s.url || 'Internal Record'} (retrieved: ${s.retrieved_at})`
  ).join('\n');
  
  return `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    🛡️ RELIABILITY FIRST MODE: ENABLED 🛡️                      ║
╚═══════════════════════════════════════════════════════════════════════════════╝

AVAILABLE VERIFIED SOURCES:
${sourceList || 'No pre-verified sources available. Use only database records.'}

CITATION REQUIREMENTS:
• Every factual claim MUST have an inline citation: [S1], [S2], etc.
• At the end, include a SOURCES section listing all cited sources
• Format: [S#] Title | URL | Retrieved: timestamp

CONFIDENCE RULES (MANDATORY):
• HIGH: 2+ independent sources OR 1 authoritative + corroboration
• MEDIUM: 1 solid source, limited corroboration  
• LOW: Weak source or partial evidence
• UNVERIFIED: No source artifacts → CANNOT state as fact

════════════════════════════════════════════════════════════════════════════════
                    ⛔ ABSOLUTE PROHIBITIONS (ZERO TOLERANCE) ⛔
════════════════════════════════════════════════════════════════════════════════

❌ INVENTED GEOPOLITICAL NEWS (e.g., "Strait of Hormuz tensions", "Arctic sovereignty")
❌ FABRICATED BREAKING NEWS or "reports indicate" without web search results
❌ INVENTED HUMINT REQUIREMENTS or "collection priorities (PIRs)"  
❌ SPECULATIVE THREAT NARRATIVES ("professional adversary", "coordinated campaign")
❌ EMBELLISHED INCIDENT DESCRIPTIONS - report exactly what the database says
❌ "[UNVERIFIED] Reports of..." - if unverified, DO NOT REPORT IT
❌ "May lead to..." / "Could exacerbate..." - NO SPECULATION
❌ Generic cyber threats (0-day exploits, APT groups) without DB evidence
❌ Invented names, IDs, quotes, numbers, dates, or events
❌ Simulated/hypothetical/demo language

FOR GEOPOLITICAL/EXTERNAL NEWS:
→ You MUST call perform_external_web_search FIRST
→ If tool unavailable or returns no results: State "No external intelligence available"
→ NEVER invent news - this is a production system with real consequences

IF INCIDENT DATA IS SPARSE:
→ Report the incident title and dates EXACTLY as stored
→ State: "Additional details not available in incident record"
→ DO NOT invent breach narratives, damage assessments, or attack vectors

BRIEFING SCHEMA (REQUIRED):
1. Executive Flash Banner (1-2 sentences, highest priority only)
2. Key Developments (bullet points with citations)
3. Incidents with IDs and evidence links
4. Impact Assessment (only if evidence supports)
5. External Intelligence (only if web search was performed)
6. Sources (full list with timestamps)

At the end, state: "Reliability Score: [X]% | Sources: [N] verified | External Intel: [YES/NO]"
`;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         DEFAULT SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_RELIABILITY_SETTINGS: ReliabilitySettings = {
  reliability_first_enabled: true,
  require_min_sources: 1,
  require_snapshot_for_external: true,
  auto_create_verification_tasks: true,
  block_unverified_claims: true, // CHANGED: Now blocking unverified claims by default
  max_source_age_hours: 48, // CHANGED: Stricter - 48 hours instead of 72
};

export async function getReliabilitySettings(
  supabase: any,
  clientId?: string
): Promise<ReliabilitySettings> {
  if (!clientId) {
    return DEFAULT_RELIABILITY_SETTINGS;
  }
  
  const { data } = await supabase
    .from('reliability_settings')
    .select('*')
    .eq('client_id', clientId)
    .single();
  
  if (data) {
    const d = data as any;
    return {
      reliability_first_enabled: d.reliability_first_enabled ?? true,
      require_min_sources: d.require_min_sources ?? 1,
      require_snapshot_for_external: d.require_snapshot_for_external ?? true,
      auto_create_verification_tasks: d.auto_create_verification_tasks ?? true,
      block_unverified_claims: d.block_unverified_claims ?? false,
      max_source_age_hours: d.max_source_age_hours ?? 72,
    };
  }
  
  return DEFAULT_RELIABILITY_SETTINGS;
}
