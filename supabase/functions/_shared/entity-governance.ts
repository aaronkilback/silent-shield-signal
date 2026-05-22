// #171 — Entity Governance Module
//
// Centralized validation + verdict routing for every code path that persists
// an entity or entity_suggestion. Replaces per-writer ad-hoc thresholds.
//
// DOCTRINE
//   1. Entity ontology is a closed set. If a candidate does not fit, it is rejected.
//   2. Three verdicts only: auto_link | suggestion_queue | auto_reject.
//      There is NO auto_create. Weak extraction never persists directly to `entities`.
//   3. Regex extraction is heuristic. LLM extraction is heuristic. Neither is authoritative.
//   4. Every attempted persistence (success OR rejection) is logged to
//      entity_governance_events with rejection_reasons.
//
// SHAPE
//   - validateAndClassify(supabase, tenantId, candidate) → EntityGovernanceResult
//   - recordGovernanceEvent(supabase, payload) → fire-and-forget telemetry
//
// CONTRACT
//   - All callers MUST pass a non-empty tenantId. Module returns auto_reject otherwise.
//   - Module never writes to `entities` or `entity_suggestions`.
//   - Callers handle persistence based on the returned verdict.

// deno-lint-ignore-file no-explicit-any

// ════════════════════════════════════════════════════════════════════════════
// ONTOLOGY — what IS a valid entity
// ════════════════════════════════════════════════════════════════════════════

/**
 * Canonical entity types accepted by the platform.
 * Maps Aaron's #171 ontology to existing `entities.type` taxonomy:
 *   - executive → person + attributes.role='executive'
 *   - threat_actor → organization + attributes.role='threat_actor'
 *   - facility → location + attributes.kind='facility'
 *   - named_account → person|organization + attributes.handle
 *   - named_domain → domain
 */
export const VALID_ENTITY_TYPES = new Set<string>([
  'person',
  'organization',
  'location',
  'domain',
  'email',
  'phone',
  'ip_address',
  'vehicle',
  'cryptocurrency_wallet',
  'infrastructure', // legacy — present in 124 prod rows
]);

/**
 * Subset of types that require a meaningful description for SUGGESTION_QUEUE.
 * Identifier types (domain/email/phone/ip) carry their own self-evidence.
 */
export const TYPES_REQUIRING_DESCRIPTION = new Set<string>([
  'person',
  'organization',
  'location',
  'vehicle',
  'infrastructure',
]);

export const MIN_DESCRIPTION_LENGTH = 20;
export const MIN_NAME_LENGTH = 3;
export const MAX_NAME_LENGTH = 120;
export const MIN_PERSISTENCE_CONFIDENCE = 0.55;

// ════════════════════════════════════════════════════════════════════════════
// ORIGIN POLICY — explicit per-origin rules
//
// Each known extraction origin gets a policy row. Adding a new origin (e.g.,
// 'agent_proposed') WITHOUT updating this table causes intentional failure
// via the DEFAULT_RESTRICTIVE_POLICY fallback AND an `unknown_origin:X` rejection
// reason. This is deliberate — future origins must declare their stance.
//
// require_description:
//   - true  → candidate.description must be ≥ MIN_DESCRIPTION_LENGTH for
//             TYPES_REQUIRING_DESCRIPTION. Use for origins where the proposer
//             is expected to supply explanatory text (AEGIS tool calls).
//   - false → description optional. Use for origins where extraction is
//             passive and the surrounding context carries the evidence
//             (regex on signal text, LLM on signal text).
// ════════════════════════════════════════════════════════════════════════════

export interface OriginPolicy {
  require_description: boolean;
}

export const ORIGIN_POLICY: Record<'human' | 'regex' | 'llm' | 'curated', OriginPolicy> = {
  human:   { require_description: true  },  // AEGIS tool call — operator-mediated; must explain why
  regex:   { require_description: false },  // passive extraction from signal/document text
  llm:     { require_description: false },  // LLM extraction; context field carries evidence
  curated: { require_description: false },  // high-trust structured feed (e.g., IOC import)
};

// Fallback for unrecognized origins. Restrictive on purpose — forces explicit
// policy declaration when new origin types are introduced.
const DEFAULT_RESTRICTIVE_POLICY: OriginPolicy = { require_description: true };

// ════════════════════════════════════════════════════════════════════════════
// NOT-ENTITY PATTERNS — what is explicitly NOT a valid entity
// ════════════════════════════════════════════════════════════════════════════

/**
 * Generic ideologies / movements / categories.
 * Examples blocked: "Militant Far-Left", "Anarchist Direct Action Networks",
 *                   "Nationalist Movement", "Eco-Terrorism Cells"
 */
const IDEOLOGY_PATTERNS: RegExp[] = [
  /^(militant|nationalist|extremist|anarchist|jihadi|radical|separatist|insurgent|reactionary)\b/i,
  /\b(far[- ]?(left|right)|extreme[- ]?(left|right)|alt[- ]?(left|right))\b/i,
  /\b(eco[- ]?terror|cyber[- ]?terror|narco[- ]?terror)/i,
  /\b(direct action|grassroots)\s+(networks?|groups?|cells?|movement|coalition)\b/i,
  /\s+(networks?|movement|cells?|coalitions?|groupings?)\s*$/i, // suffix-only ("X Networks")
];

/**
 * Vulnerability classes (CVE noise, security report fragments).
 * Examples blocked: "Directory Traversal Vulnerability", "Error Vulnerability",
 *                   "SQL Injection", "Buffer Overflow"
 */
const VULNERABILITY_CLASS_PATTERNS: RegExp[] = [
  /\bvulnerabilit(y|ies)\b/i,
  /\b(directory\s+traversal|path\s+traversal|sql\s+injection|command\s+injection|buffer\s+overflow|stack\s+overflow|heap\s+overflow|use[- ]after[- ]free|race\s+condition|deserialization)\b/i,
  /\b(xss|csrf|ssrf|rce|lfi|rfi|xxe)\b/i,
  /\bcve[-\s]\d/i,
  /\b(origin\s+validation|authentication\s+bypass|privilege\s+escalation|information\s+disclosure)\s+(error|flaw|issue)?\b/i,
];

/**
 * Abstract events, fixtures, and concepts (Twitter/news fragment noise).
 * Examples blocked: "World Cup", "Games Draw", "The Olympics", "Election Day"
 */
const ABSTRACT_EVENT_PATTERNS: RegExp[] = [
  /^(the\s+)?(world\s+cup|olympics?|paralympics?|championship|tournament|games?\s+draw|grand\s+final|super\s+bowl)$/i,
  /\b(games?\s+draw|opening\s+ceremony|closing\s+ceremony|medal\s+ceremony)\b/i,
  /^(election|referendum)\s+(day|night|results?)$/i,
];

/**
 * Common-noun phrases (NER mis-extractions from titles/snippets).
 * Maintained as an exact-match set (lowercase).
 */
const COMMON_NOUN_DENYLIST = new Set<string>([
  'cloud services',
  'social intelligence',
  'social media',
  'made in canada',
  'made in usa',
  'breaking news',
  'cyber threats',
  'national security',
  'public safety',
  'law enforcement',
  'first responders',
  'mental health',
  'climate change',
  'foreign policy',
  'global affairs',
  'human rights',
  'civil society',
  'best practice',
  'best practices',
  'industry standard',
  'industry standards',
  'risk management',
  'crisis management',
  'incident response',
  'directory traversal',
  'error vulnerability',
  'canada official',
  'games draw',
  'made in canada 0fficial',
  'the world cup',
  'world cup',
]);

/**
 * Vague-category openers / placeholders.
 * Examples blocked: "Unknown Group", "Various Actors", "Multiple Suspects", "Other"
 */
const VAGUE_CATEGORY_PATTERNS: RegExp[] = [
  /^(unknown|various|multiple|miscellaneous|misc|other|the\s+other|certain|some|several|n\/?a|none|null|undefined)\b/i,
  /^(group|organization|individual|person|entity|target|subject)\s+(a|b|c|x|y|z|\d+)$/i,
];

/**
 * Single-word common nouns. We require entity names to be either:
 *   - identifier-typed (domain/email/phone/ip — self-evidently specific), OR
 *   - multi-word OR a recognizable acronym (≤5 uppercase chars) OR a proper noun
 */
const SINGLE_WORD_COMMON_NOUNS = new Set<string>([
  'protest', 'rally', 'march', 'demonstration', 'riot',
  'threat', 'attack', 'incident', 'event', 'situation',
  'group', 'organization', 'company', 'corporation', 'agency',
  'person', 'individual', 'suspect', 'witness', 'victim',
  'building', 'facility', 'location', 'site', 'venue',
  'vehicle', 'aircraft', 'vessel', 'drone',
  'document', 'report', 'briefing', 'statement', 'announcement',
  'twitter', 'facebook', 'instagram', 'tiktok', 'youtube', 'reddit',
]);

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

export type EntityVerdict = 'auto_link' | 'suggestion_queue' | 'auto_reject';

export type GovernanceSourceWriter =
  | 'aegis_create_entity'      // dashboard-ai-assistant create_entity tool
  | 'correlate_entities'        // regex-based NER in correlate-entities
  | 'extract_signal_insights'   // LLM extractor on signal text
  | 'other';

export interface EntityCandidate {
  name: string;
  type: string;
  description?: string | null;
  aliases?: string[] | null;
  confidence?: number | null;
  /**
   * Originator of the candidate. Informs source-aware sanity checks.
   * 'regex'  → never authoritative (req #4)
   * 'llm'    → confidence alone is insufficient (req #5)
   * 'human'  → manual entry (e.g., AEGIS tool call mediated by operator dialog)
   * 'curated' → from a high-trust structured feed (e.g., approved IOC import)
   */
  origin: 'regex' | 'llm' | 'human' | 'curated';
  /**
   * Optional surrounding text used for source-aware checks (e.g., does
   * a "person"-typed candidate appear next to a Mr/Dr/said-style cue?).
   */
  context?: string | null;
  /**
   * Source identifier (signal_id, document_id, etc.). Passed through to
   * the audit event for forensic traceability.
   */
  sourceRef?: { kind: 'signal' | 'document' | 'investigation' | 'conversation' | 'other'; id: string } | null;
}

export interface EntityGovernanceResult {
  verdict: EntityVerdict;
  rejectionReasons: string[];                 // empty when verdict != auto_reject
  normalizedName: string;                     // trimmed + collapsed whitespace
  resolvedType: string;                       // may differ from candidate.type (e.g. demoted person→other)
  matchedEntityId?: string;                   // populated when verdict='auto_link'
  duplicateSuggestionId?: string;             // populated when verdict='auto_reject' due to dedupe
  effectiveConfidence: number;                // post-validation confidence (caller persists this)
  warnings: string[];                         // non-fatal observations (e.g. "person classification demoted")
}

export interface GovernanceEventPayload {
  tenantId: string;
  sourceWriter: GovernanceSourceWriter;
  candidate: EntityCandidate;
  result: EntityGovernanceResult;
  suggestionId?: string | null;               // populated by caller after INSERT (when queued)
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS — pure functions
// ════════════════════════════════════════════════════════════════════════════

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function hasIdeologyPattern(name: string): boolean {
  return IDEOLOGY_PATTERNS.some((re) => re.test(name));
}

function hasVulnerabilityClassPattern(name: string): boolean {
  return VULNERABILITY_CLASS_PATTERNS.some((re) => re.test(name));
}

function hasAbstractEventPattern(name: string): boolean {
  return ABSTRACT_EVENT_PATTERNS.some((re) => re.test(name));
}

function hasVagueCategoryPattern(name: string): boolean {
  return VAGUE_CATEGORY_PATTERNS.some((re) => re.test(name));
}

function isCommonNounDenylisted(name: string): boolean {
  return COMMON_NOUN_DENYLIST.has(name.toLowerCase());
}

function isLikelyAcronym(token: string): boolean {
  return /^[A-Z0-9]{2,5}$/.test(token);
}

function isSingleCommonNoun(name: string): boolean {
  const tokens = name.split(/\s+/);
  if (tokens.length !== 1) return false;
  const t = tokens[0].toLowerCase();
  if (isLikelyAcronym(tokens[0])) return false;
  return SINGLE_WORD_COMMON_NOUNS.has(t);
}

function looksLikeProperNoun(name: string): boolean {
  // At least one alphabetic + at least one capitalized token OR identifier-like
  if (!/[A-Za-z]/.test(name)) return false;
  if (/^[a-z0-9._-]+\.[a-z]{2,}$/i.test(name)) return true; // domain
  if (/@/.test(name)) return true; // email/handle
  if (/^\+?\d[\d\s().-]{6,}$/.test(name)) return true; // phone
  return /[A-Z]/.test(name);
}

/**
 * Source-aware sanity for `person` classification.
 * Returns true when surrounding context contains a recognizable person cue.
 */
function hasPersonContextCue(context: string | null | undefined): boolean {
  if (!context) return false;
  return /\b(mr|mrs|ms|dr|sir|madam|prof|professor|reverend|chief)\.?\b/i.test(context)
    || /\b(said|told|stated|claimed|denied|wrote|tweeted|posted|spoke|confirmed|added)\b/i.test(context)
    || /\b(he|she|they)\s+(said|told|posted|claimed)\b/i.test(context);
}

// ════════════════════════════════════════════════════════════════════════════
// DUPLICATE DETECTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Find an existing entity in this tenant by name or alias match (case-insensitive).
 * Tenant-scoped — never returns cross-tenant matches.
 */
async function findExistingEntity(
  supabase: any,
  tenantId: string,
  name: string,
  type: string,
): Promise<{ id: string; name: string } | null> {
  const lower = name.toLowerCase();
  // Name match (case-insensitive) within tenant
  const { data: byName } = await supabase
    .from('entities')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .ilike('name', name)
    .limit(1)
    .maybeSingle();
  if (byName) return byName;

  // Alias match within tenant + same type (alias overlap across types is ambiguous)
  const { data: byAlias } = await supabase
    .from('entities')
    .select('id, name, aliases')
    .eq('tenant_id', tenantId)
    .eq('type', type)
    .contains('aliases', [name])
    .limit(1)
    .maybeSingle();
  if (byAlias) return { id: byAlias.id, name: byAlias.name };

  // Lowercase alias match (case-insensitive alias check)
  const { data: aliasCandidates } = await supabase
    .from('entities')
    .select('id, name, aliases')
    .eq('tenant_id', tenantId)
    .eq('type', type)
    .not('aliases', 'is', null)
    .limit(50);
  for (const cand of (aliasCandidates || [])) {
    const aliases: string[] = cand.aliases || [];
    if (aliases.some((a) => a?.toLowerCase() === lower)) {
      return { id: cand.id, name: cand.name };
    }
  }
  return null;
}

/**
 * Find a pending suggestion with the same name (case-insensitive) within this tenant.
 */
async function findExistingSuggestion(
  supabase: any,
  tenantId: string,
  name: string,
): Promise<{ id: string; suggested_name: string } | null> {
  const { data } = await supabase
    .from('entity_suggestions')
    .select('id, suggested_name')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .ilike('suggested_name', name)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — validateAndClassify
// ════════════════════════════════════════════════════════════════════════════

/**
 * Apply ontology + duplicate checks + verdict routing.
 * Caller persists based on verdict; this function performs zero writes.
 */
export async function validateAndClassify(
  supabase: any,
  tenantId: string,
  candidate: EntityCandidate,
): Promise<EntityGovernanceResult> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const normalizedName = normalizeName(candidate.name ?? '');
  let resolvedType = candidate.type;
  let effectiveConfidence = typeof candidate.confidence === 'number' ? candidate.confidence : 0.5;

  // Guard: tenant context required
  if (!tenantId) {
    return {
      verdict: 'auto_reject',
      rejectionReasons: ['missing_tenant_context'],
      normalizedName,
      resolvedType,
      effectiveConfidence: 0,
      warnings,
    };
  }

  // ── Structural validation ───────────────────────────────────────────────
  if (!normalizedName) {
    reasons.push('empty_name');
  } else {
    if (normalizedName.length < MIN_NAME_LENGTH) reasons.push('name_too_short');
    if (normalizedName.length > MAX_NAME_LENGTH) reasons.push('name_too_long');
    if (!/[A-Za-z0-9]/.test(normalizedName)) reasons.push('no_alphanumeric_chars');
    if (!looksLikeProperNoun(normalizedName)) reasons.push('not_proper_noun_shape');
  }

  if (!VALID_ENTITY_TYPES.has(candidate.type)) {
    reasons.push(`unknown_type:${candidate.type}`);
  }

  // ── Ontology NOT-entity patterns ─────────────────────────────────────────
  if (normalizedName) {
    if (hasIdeologyPattern(normalizedName)) reasons.push('ideology_or_movement');
    if (hasVulnerabilityClassPattern(normalizedName)) reasons.push('vulnerability_class');
    if (hasAbstractEventPattern(normalizedName)) reasons.push('abstract_event');
    if (hasVagueCategoryPattern(normalizedName)) reasons.push('vague_category');
    if (isCommonNounDenylisted(normalizedName)) reasons.push('common_noun_denylisted');
    if (isSingleCommonNoun(normalizedName)) reasons.push('single_common_noun');
  }

  // ── Origin policy lookup ────────────────────────────────────────────────
  // Unknown origins are rejected explicitly + fall through to restrictive defaults,
  // forcing intentional declaration when new origin types are added.
  const declaredPolicy = (ORIGIN_POLICY as Record<string, OriginPolicy>)[candidate.origin];
  if (!declaredPolicy) {
    reasons.push(`unknown_origin:${candidate.origin}`);
  }
  const policy: OriginPolicy = declaredPolicy ?? DEFAULT_RESTRICTIVE_POLICY;

  // ── Type-specific requirements (per origin policy) ──────────────────────
  if (TYPES_REQUIRING_DESCRIPTION.has(candidate.type) && policy.require_description) {
    const desc = (candidate.description ?? '').trim();
    if (desc.length < MIN_DESCRIPTION_LENGTH) {
      reasons.push('description_required');
    }
  }

  // ── Source-aware sanity (req #4 + #5) ───────────────────────────────────
  if (candidate.origin === 'regex') {
    // Regex is heuristic only — never authoritative.
    // If person-typed without person cue in context, demote to 'other'.
    if (candidate.type === 'person' && !hasPersonContextCue(candidate.context)) {
      resolvedType = 'other';
      effectiveConfidence = Math.min(effectiveConfidence, 0.5);
      warnings.push('person_classification_demoted_no_context_cue');
    }
    // Regex confidence inflated past 0.85 is suspect — cap it.
    if (effectiveConfidence > 0.85) {
      effectiveConfidence = 0.85;
      warnings.push('regex_confidence_capped');
    }
  }

  if (candidate.origin === 'llm') {
    // LLM confidence alone is insufficient. Require corroborating signal:
    //   - either the name appears in the source context (truthy match), OR
    //   - the type is a structural identifier (domain/email/phone/ip).
    const isStructuralId = ['domain', 'email', 'phone', 'ip_address'].includes(candidate.type);
    const nameInContext = candidate.context
      ? candidate.context.toLowerCase().includes(normalizedName.toLowerCase())
      : false;
    if (!isStructuralId && !nameInContext) {
      reasons.push('llm_no_corroborating_context');
    }
  }

  if (effectiveConfidence < MIN_PERSISTENCE_CONFIDENCE) {
    reasons.push(`confidence_below_floor:${effectiveConfidence.toFixed(2)}`);
  }

  // ── Hard reject if any structural/ontology/source reason fired ───────────
  if (reasons.length > 0) {
    return {
      verdict: 'auto_reject',
      rejectionReasons: reasons,
      normalizedName,
      resolvedType,
      effectiveConfidence,
      warnings,
    };
  }

  // ── Duplicate detection ──────────────────────────────────────────────────
  // 1. Existing entity? → auto_link
  const existingEntity = await findExistingEntity(supabase, tenantId, normalizedName, resolvedType);
  if (existingEntity) {
    return {
      verdict: 'auto_link',
      rejectionReasons: [],
      normalizedName,
      resolvedType,
      matchedEntityId: existingEntity.id,
      effectiveConfidence,
      warnings,
    };
  }

  // 2. Existing pending suggestion? → auto_reject (dedupe)
  const existingSuggestion = await findExistingSuggestion(supabase, tenantId, normalizedName);
  if (existingSuggestion) {
    return {
      verdict: 'auto_reject',
      rejectionReasons: ['duplicate_pending_suggestion'],
      normalizedName,
      resolvedType,
      duplicateSuggestionId: existingSuggestion.id,
      effectiveConfidence,
      warnings,
    };
  }

  // ── Passed all gates → queue for human review ────────────────────────────
  return {
    verdict: 'suggestion_queue',
    rejectionReasons: [],
    normalizedName,
    resolvedType,
    effectiveConfidence,
    warnings,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// AUDIT TELEMETRY — recordGovernanceEvent
// ════════════════════════════════════════════════════════════════════════════

/**
 * Fire-and-forget insertion into entity_governance_events.
 * Failure is logged but does NOT propagate to the writer's critical path.
 */
export function recordGovernanceEvent(
  supabase: any,
  payload: GovernanceEventPayload,
): void {
  if (!payload.tenantId) {
    console.warn('[entity-governance] recordGovernanceEvent skipped — no tenantId');
    return;
  }
  const row = {
    tenant_id: payload.tenantId,
    source_writer: payload.sourceWriter,
    candidate_name: payload.candidate.name?.substring(0, 200) ?? '',
    candidate_type: payload.candidate.type,
    candidate_origin: payload.candidate.origin,
    verdict: payload.result.verdict,
    rejection_reasons: payload.result.rejectionReasons,
    warnings: payload.result.warnings,
    confidence: payload.result.effectiveConfidence,
    source_context: payload.candidate.sourceRef
      ? { kind: payload.candidate.sourceRef.kind, id: payload.candidate.sourceRef.id }
      : null,
    linked_entity_id: payload.result.matchedEntityId ?? null,
    suggestion_id: payload.suggestionId ?? payload.result.duplicateSuggestionId ?? null,
  };
  supabase
    .from('entity_governance_events')
    .insert(row)
    .then(({ error }: any) => {
      if (error) {
        console.warn('[entity-governance] event insert failed:', error.message);
      }
    });
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS FOR TESTING
// ════════════════════════════════════════════════════════════════════════════

export const __test_only = {
  hasIdeologyPattern,
  hasVulnerabilityClassPattern,
  hasAbstractEventPattern,
  hasVagueCategoryPattern,
  isCommonNounDenylisted,
  isSingleCommonNoun,
  isLikelyAcronym,
  looksLikeProperNoun,
  hasPersonContextCue,
  IDEOLOGY_PATTERNS,
  VULNERABILITY_CLASS_PATTERNS,
  ABSTRACT_EVENT_PATTERNS,
  COMMON_NOUN_DENYLIST,
  SINGLE_WORD_COMMON_NOUNS,
};
