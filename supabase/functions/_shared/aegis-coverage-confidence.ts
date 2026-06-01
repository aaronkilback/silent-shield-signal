// supabase/functions/_shared/aegis-coverage-confidence.ts
//
// Per-RESPONSE Coverage Confidence — measures the information environment
// of a single Aegis response (distinct from per-CLAIM confidence in
// aegis-confidence.ts which scores Workstream D claim-frames).
//
// Doctrine references:
//   - Coverage Confidence Measurement Model (Task #164, frozen design artifact)
//   - Aegis Communication Doctrine + HONEST_LIMIT amendment (Task #159 + Option A)
//   - Default-to-Historical-when-unknown (ratified 2026-05-31)
//
// HARD RULES (binding):
//   • Class is DERIVED FROM EVIDENCE. Caller computes contributors from
//     retrieval results; this module classifies. The LLM is NEVER allowed
//     to choose the class or reverse-engineer reasons.
//   • Reason bullets emerge from measured contributors — they are NOT
//     paraphrased post-hoc by the LLM.
//   • UNKNOWN ≠ LOW. UNKNOWN means "we didn't collect"; LOW means
//     "we collected, evidence is thin." Prohibited to collapse.
//   • Unknown vs Unknowable distinction is mandatory in both SHORT and
//     EXPANDED modes (HONEST_LIMIT amendment).
//   • EXPANDED mode triggers automatically on LOW/UNKNOWN class, on
//     operator-requested detail, or on material-risk claims.
//   • Pure functions only. No mutation, no side effects, no persistence.

// ─────────────────────────────────────────────────────────────────────────────
// §1 — Public types
// ─────────────────────────────────────────────────────────────────────────────

export type CoverageClass = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/**
 * Citation for a single signal that the response will rely upon.
 * Caller harvests these from retrieval results before computation.
 */
export interface CitedSignal {
  signal_id: string;
  /** Source taxonomy class — operator-tunable; see normalizeSourceClass below. */
  source_class: string;
  /** Independent-publisher identity for corroboration dedup (host(URL) is a reasonable default). */
  publisher_lineage: string;
  /** ISO timestamp of when the signal's underlying event occurred (or null). */
  event_date: string | null;
  /** ISO timestamp of when the signal was ingested. */
  created_at: string;
  /**
   * Optional temporal_grounding column (T-3 chain). When the column is not
   * populated yet (today's production state), pass undefined; the module
   * falls back to structural detection (NULL event_date or cosmetic
   * midnight = at-risk).
   */
  temporal_grounding?:
    | "unknown"
    | "current_grounded"
    | "historical_grounded"
    | "current_inferred"
    | "historical_inferred";
  /** Operator-side: is this signal currently quarantined? (Excluded from coverage if so.) */
  is_quarantined: boolean;
}

export interface CoverageInput {
  /** Signals the response cites. Empty array is a legitimate input (signals the UNKNOWN case). */
  cited_signals: CitedSignal[];

  /**
   * Whether the user's question requires signal-grounded factual claims.
   * If false (e.g., the user asked a pure tradecraft question with no
   * tenant facts), Coverage Confidence is NOT EMITTED — caller renders
   * without the Coverage Confidence section.
   */
  question_requires_signal_grounding: boolean;

  /**
   * Whether the question is inherently Unknowable in this tenant context
   * (private DMs / future events / cross-tenant data / subjective intent /
   * etc.). HONEST_LIMIT amendment: such questions should be answered as
   * "Coverage Confidence: UNKNOWN, Unknowable" — not classified as LOW.
   */
  is_unknowable_question: boolean;

  /**
   * Count of open mission_health critical findings affecting monitors
   * that would cover the question's primary entities/source-classes.
   * Caller queries platform_findings before passing this in.
   * If not measurable at call time, pass 0 (do not penalize).
   */
  open_mission_health_critical_count: number;

  /**
   * Operator-explicit request for detail in their prompt
   * (e.g., "show me detail", "why", "explain"). When true, EXPANDED mode
   * is forced regardless of class.
   */
  operator_requested_detail: boolean;

  /**
   * Material-risk flag: is the response going to make an active-threat
   * claim, a customer-facing artifact recommendation, or a similar
   * consequential claim? When true, EXPANDED mode is forced.
   */
  material_risk: boolean;

  /** Optional override clock for deterministic tests. */
  now?: Date;
}

export interface CoverageContributors {
  /** Distinct source classes among cited signals (after normalization). */
  source_diversity_count: number;
  /** Ratio (0..1) of cited signals with defensible temporal grounding. */
  temporal_grounding_rate: number;
  /** Distinct publisher lineages among cited signals (corroboration proxy). */
  corroboration_strength: number;
  /** Open mission_health critical count from caller. */
  mission_integrity_critical_count: number;
  /** Total cited signals (after quarantine filtering). */
  cited_signal_count: number;
  /** Whether all cited signals were quarantined (a structural failure case). */
  all_signals_quarantined: boolean;
}

export interface CoverageResult {
  /** The classification — DERIVED from contributors, not chosen by LLM. */
  class: CoverageClass;

  /**
   * Concise reason bullets explaining the classification (2-4 bullets,
   * each ≤80 chars). These emerge directly from contributors. The LLM
   * MUST render them verbatim; it cannot paraphrase or substitute.
   */
  reason_bullets: string[];

  /** Whether EXPANDED mode is active (LOW/UNKNOWN auto, operator request, material risk). */
  expanded_mode: boolean;

  /** Reason EXPANDED was triggered (for telemetry + operator transparency). */
  expanded_trigger: "low_or_unknown_class" | "operator_request" | "material_risk" | null;

  /** Measured contributors (for the EXPANDED Why section). */
  contributors: CoverageContributors;

  /** Specific missing-information classes (for EXPANDED Blind Spots section). */
  blind_spots: string[];

  /** Operator-actionable items (for EXPANDED What Would Increase Confidence section). */
  what_would_increase_confidence: string[];

  /** Caller-emit guidance: should this response include the Coverage Confidence section? */
  emit_coverage_section: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Operator-tunable thresholds (all in this file for auditable changes)
// ─────────────────────────────────────────────────────────────────────────────

export const THRESHOLDS = {
  /** Temporal grounding ratio at which output qualifies for HIGH. */
  TEMPORAL_HIGH: 0.80,
  /** Temporal grounding ratio at which output drops to LOW. */
  TEMPORAL_LOW_FLOOR: 0.50,
  /** Source classes required for HIGH. */
  SOURCE_DIVERSITY_HIGH: 3,
  /** Source classes below which single-source dependency flag fires. */
  SOURCE_DIVERSITY_LOW_FLOOR: 2,
  /** Corroboration strength (distinct lineages) required for HIGH. */
  CORROBORATION_HIGH: 3,
  /** Corroboration strength below which single-source dependency fires. */
  CORROBORATION_LOW_FLOOR: 2,
  /** Cosmetic-midnight detection: event_date at midnight UTC of created_at day. */
  COSMETIC_MIDNIGHT_MS_TOLERANCE: 1000, // < 1s deviation = cosmetic
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Source-class normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize free-form source labels into operator-tunable taxonomy classes.
 * Coarse on purpose — counting distinct news outlets as one "news" class
 * prevents syndicated coverage from inflating Source Diversity.
 */
export function normalizeSourceClass(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (!s || s === "<no_source>") return "unknown_source";
  if (/cisa|nist|cve|nvd|kev/.test(s)) return "government_cyber";
  if (/csis|public.safety|rcmp|gov\.|gc\.ca/.test(s)) return "government";
  if (/court|justice|tribunal/.test(s)) return "court";
  if (/reddit/.test(s)) return "social_reddit";
  if (/twitter|x\.com/.test(s)) return "social_x";
  if (/facebook|meta/.test(s)) return "social_facebook";
  if (/instagram/.test(s)) return "social_instagram";
  if (/linkedin/.test(s)) return "social_linkedin";
  if (/youtube|tiktok/.test(s)) return "video";
  if (/community|energetic|alaska.highway/.test(s)) return "community_local";
  if (/rss|feed/.test(s)) return "rss";
  if (/cwfis|firms|wildfire/.test(s)) return "wildfire";
  if (/naad|alert.ready/.test(s)) return "emergency_alert";
  if (/blog|substack|medium/.test(s)) return "blog";
  return "news"; // default fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Per-signal temporal-grounding determination
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the signal has DEFENSIBLE temporal grounding for
 * Coverage Confidence purposes. Defensible = explicit temporal_grounding
 * column ∈ {current_grounded, historical_grounded}, OR (when column not
 * yet populated) structural check that event_date is not NULL and not
 * cosmetic-midnight-of-created_at.
 */
export function isTemporallyGrounded(s: CitedSignal): boolean {
  // Prefer the explicit column (post-T-3) when available
  if (s.temporal_grounding === "current_grounded") return true;
  if (s.temporal_grounding === "historical_grounded") return true;
  if (
    s.temporal_grounding === "current_inferred" ||
    s.temporal_grounding === "historical_inferred" ||
    s.temporal_grounding === "unknown"
  ) {
    return false;
  }

  // Column not populated (today's prod state) — fall back to structural check
  if (!s.event_date) return false;

  const eventMs = Date.parse(s.event_date);
  const createdMs = Date.parse(s.created_at);
  if (!Number.isFinite(eventMs) || !Number.isFinite(createdMs)) return false;

  // Cosmetic-midnight detection: event_date set to midnight UTC of
  // created_at's day is a write-time artifact, not a real event time
  const eventDate = new Date(eventMs);
  const createdDate = new Date(createdMs);
  const sameDay =
    eventDate.getUTCFullYear() === createdDate.getUTCFullYear() &&
    eventDate.getUTCMonth() === createdDate.getUTCMonth() &&
    eventDate.getUTCDate() === createdDate.getUTCDate();
  if (sameDay) {
    // Check if event_date is at midnight UTC (cosmetic) — diff from
    // start-of-day < tolerance
    const startOfDay = Date.UTC(
      eventDate.getUTCFullYear(),
      eventDate.getUTCMonth(),
      eventDate.getUTCDate(),
    );
    if (Math.abs(eventMs - startOfDay) < THRESHOLDS.COSMETIC_MIDNIGHT_MS_TOLERANCE) {
      return false; // cosmetic-midnight = at-risk
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Contributor computation (deterministic over evidence)
// ─────────────────────────────────────────────────────────────────────────────

export function computeContributors(input: CoverageInput): CoverageContributors {
  // Filter out quarantined signals — these are not visible to analyst coverage
  const visible = input.cited_signals.filter((s) => !s.is_quarantined);
  const all_signals_quarantined =
    input.cited_signals.length > 0 && visible.length === 0;

  // Source Diversity — distinct normalized source classes
  const classSet = new Set<string>();
  for (const s of visible) classSet.add(normalizeSourceClass(s.source_class));
  const source_diversity_count = classSet.size;

  // Temporal Grounding rate
  let grounded = 0;
  for (const s of visible) if (isTemporallyGrounded(s)) grounded++;
  const temporal_grounding_rate = visible.length === 0 ? 0 : grounded / visible.length;

  // Corroboration Strength — distinct publisher lineages
  const lineageSet = new Set<string>();
  for (const s of visible) lineageSet.add(s.publisher_lineage);
  const corroboration_strength = lineageSet.size;

  return {
    source_diversity_count,
    temporal_grounding_rate,
    corroboration_strength,
    mission_integrity_critical_count: input.open_mission_health_critical_count,
    cited_signal_count: visible.length,
    all_signals_quarantined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 — Class derivation (predicate-based, no opaque weighting)
// ─────────────────────────────────────────────────────────────────────────────

export function deriveClass(
  input: CoverageInput,
  contributors: CoverageContributors,
): CoverageClass {
  // UNKNOWN — explicit honest-limit cases first
  if (input.is_unknowable_question) return "UNKNOWN";
  if (input.question_requires_signal_grounding && contributors.cited_signal_count === 0) {
    return "UNKNOWN";
  }
  if (contributors.all_signals_quarantined) {
    // Quarantined signals exist but are not analyst-visible — treat as UNKNOWN
    return "UNKNOWN";
  }

  // LOW — any required-threshold fails (predicates from Coverage Confidence Measurement Model §3)
  const t = contributors;
  if (t.temporal_grounding_rate < THRESHOLDS.TEMPORAL_LOW_FLOOR) return "LOW";
  if (t.mission_integrity_critical_count > 0) return "LOW";
  if (t.corroboration_strength < THRESHOLDS.CORROBORATION_LOW_FLOOR) return "LOW";
  if (t.source_diversity_count < THRESHOLDS.SOURCE_DIVERSITY_LOW_FLOOR) return "LOW";

  // HIGH — all thresholds met
  const high =
    t.temporal_grounding_rate >= THRESHOLDS.TEMPORAL_HIGH &&
    t.mission_integrity_critical_count === 0 &&
    t.corroboration_strength >= THRESHOLDS.CORROBORATION_HIGH &&
    t.source_diversity_count >= THRESHOLDS.SOURCE_DIVERSITY_HIGH;
  if (high) return "HIGH";

  // Otherwise MEDIUM
  return "MEDIUM";
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 — Reason bullets (derived from measured contributors, NOT paraphrased)
// ─────────────────────────────────────────────────────────────────────────────

export function buildReasonBullets(
  klass: CoverageClass,
  input: CoverageInput,
  contributors: CoverageContributors,
): string[] {
  const bullets: string[] = [];

  // UNKNOWN cases — honest about why we have nothing
  if (klass === "UNKNOWN") {
    if (input.is_unknowable_question) {
      bullets.push("Question concerns information Fortress cannot collect (Unknowable)");
    }
    if (contributors.cited_signal_count === 0 && !input.is_unknowable_question) {
      bullets.push("No signals retrieved for this question");
      bullets.push("Cannot determine whether evidence exists without collection");
    }
    if (contributors.all_signals_quarantined) {
      bullets.push("All matching signals are quarantined (operator-visibility excluded)");
    }
    return bullets.slice(0, 4);
  }

  // Non-UNKNOWN — describe the measured state honestly
  // Source diversity
  if (contributors.source_diversity_count >= THRESHOLDS.SOURCE_DIVERSITY_HIGH) {
    bullets.push(`${contributors.source_diversity_count} source classes cited`);
  } else if (contributors.source_diversity_count >= 2) {
    bullets.push(`${contributors.source_diversity_count} source classes cited (below HIGH threshold of ${THRESHOLDS.SOURCE_DIVERSITY_HIGH})`);
  } else {
    bullets.push(`Single source class — single-source-dependency`);
  }

  // Corroboration
  if (contributors.corroboration_strength >= THRESHOLDS.CORROBORATION_HIGH) {
    bullets.push(`${contributors.corroboration_strength} independent publisher lineages corroborating`);
  } else if (contributors.corroboration_strength >= 2) {
    bullets.push(`${contributors.corroboration_strength} independent lineages (below HIGH threshold of ${THRESHOLDS.CORROBORATION_HIGH})`);
  } else {
    bullets.push(`Single publisher lineage — corroboration insufficient`);
  }

  // Temporal grounding
  const pct = Math.round(contributors.temporal_grounding_rate * 100);
  if (contributors.temporal_grounding_rate >= THRESHOLDS.TEMPORAL_HIGH) {
    bullets.push(`${pct}% of cited signals temporally grounded`);
  } else if (contributors.temporal_grounding_rate >= THRESHOLDS.TEMPORAL_LOW_FLOOR) {
    bullets.push(`${pct}% temporally grounded (below HIGH threshold of ${Math.round(THRESHOLDS.TEMPORAL_HIGH * 100)}%)`);
  } else {
    bullets.push(`${pct}% temporally grounded — below floor of ${Math.round(THRESHOLDS.TEMPORAL_LOW_FLOOR * 100)}%`);
  }

  // Mission integrity (only mention when failing)
  if (contributors.mission_integrity_critical_count > 0) {
    bullets.push(`${contributors.mission_integrity_critical_count} open mission_health critical(s) on covering monitor(s)`);
  }

  return bullets.slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — Blind spots + What Would Increase Confidence (EXPANDED sections)
// ─────────────────────────────────────────────────────────────────────────────

export function buildBlindSpots(
  klass: CoverageClass,
  input: CoverageInput,
  contributors: CoverageContributors,
): string[] {
  const out: string[] = [];

  // Universal blind spots that apply when class is below HIGH
  if (klass === "UNKNOWN") {
    if (input.is_unknowable_question) {
      out.push("This question is inherently Unknowable — collection cannot close it");
    }
    if (contributors.cited_signal_count === 0 && !input.is_unknowable_question) {
      out.push("No retrieval surface returned matching signals for this query");
    }
    if (contributors.all_signals_quarantined) {
      out.push("Matching signals exist but are quarantined (not visible to analyst surface)");
    }
    return out;
  }

  if (contributors.source_diversity_count < THRESHOLDS.SOURCE_DIVERSITY_LOW_FLOOR) {
    out.push("Single-source dependency for this response");
  }
  if (contributors.corroboration_strength < THRESHOLDS.CORROBORATION_LOW_FLOOR) {
    out.push("Single publisher lineage — independent corroboration absent");
  }
  if (contributors.temporal_grounding_rate < THRESHOLDS.TEMPORAL_LOW_FLOOR) {
    out.push("Most cited signals lack defensible temporal anchors");
  }
  if (contributors.mission_integrity_critical_count > 0) {
    out.push("Active mission_health critical(s) on monitors covering this question");
  }

  // Note structural limits Fortress can't currently observe
  out.push("Image content extraction not yet available (Information Fidelity contributor stubbed)");
  if (contributors.cited_signal_count > 0) {
    out.push("Original-content snapshotting not yet operational (Preservation Fidelity stubbed)");
  }

  return out;
}

export function buildWhatWouldIncreaseConfidence(
  klass: CoverageClass,
  input: CoverageInput,
  contributors: CoverageContributors,
): string[] {
  if (klass === "UNKNOWN" && input.is_unknowable_question) {
    return [
      "This question cannot be answered by collection (Unknowable; HONEST_LIMIT applies)",
    ];
  }

  const out: string[] = [];

  if (contributors.source_diversity_count < THRESHOLDS.SOURCE_DIVERSITY_HIGH) {
    out.push("Restoring social acquisition (Meta token reactivation) would broaden source classes");
  }
  if (contributors.corroboration_strength < THRESHOLDS.CORROBORATION_HIGH) {
    out.push("Additional independent sources covering the same events would strengthen corroboration");
  }
  if (contributors.temporal_grounding_rate < THRESHOLDS.TEMPORAL_HIGH) {
    out.push("Completion of Temporal Integrity chain (T-0 → T-3) would lift grounding rate");
  }
  if (contributors.mission_integrity_critical_count > 0) {
    out.push("Resolving open mission_health critical(s) on covering monitors");
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// §9 — End-to-end compute
// ─────────────────────────────────────────────────────────────────────────────

export function computeCoverageConfidence(input: CoverageInput): CoverageResult {
  // If the question doesn't require signal-grounded claims (e.g., pure
  // tradecraft / methodology), Coverage Confidence is not applicable.
  if (!input.question_requires_signal_grounding && !input.is_unknowable_question) {
    return {
      class: "HIGH", // not emitted; emit_coverage_section=false
      reason_bullets: [],
      expanded_mode: false,
      expanded_trigger: null,
      contributors: computeContributors(input),
      blind_spots: [],
      what_would_increase_confidence: [],
      emit_coverage_section: false,
    };
  }

  const contributors = computeContributors(input);
  const klass = deriveClass(input, contributors);
  const reason_bullets = buildReasonBullets(klass, input, contributors);

  // EXPANDED triggers
  let expanded_trigger: CoverageResult["expanded_trigger"] = null;
  if (klass === "LOW" || klass === "UNKNOWN") expanded_trigger = "low_or_unknown_class";
  else if (input.operator_requested_detail) expanded_trigger = "operator_request";
  else if (input.material_risk) expanded_trigger = "material_risk";
  const expanded_mode = expanded_trigger !== null;

  const blind_spots = expanded_mode ? buildBlindSpots(klass, input, contributors) : [];
  const what_would_increase_confidence = expanded_mode
    ? buildWhatWouldIncreaseConfidence(klass, input, contributors)
    : [];

  return {
    class: klass,
    reason_bullets,
    expanded_mode,
    expanded_trigger,
    contributors,
    blind_spots,
    what_would_increase_confidence,
    emit_coverage_section: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §10 — Prohibited-phrase guard (post-emission validator)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Communication Doctrine prohibits "no evidence found" as a false-negative
 * pattern. This guard scans emitted prose for the prohibited phrasing and
 * returns the offending substrings; caller decides whether to refuse, regen,
 * or rewrite.
 *
 * Triggers ONLY when the prohibited phrase appears WITHOUT explicit Coverage
 * Confidence: UNKNOWN qualification nearby. A response that says "Coverage
 * Confidence: UNKNOWN — no evidence found in collected sources" is acceptable
 * because the UNKNOWN class makes the limit explicit.
 */
export const PROHIBITED_PHRASES = [
  /\bno\s+evidence\s+found\b/i,
  /\bno\s+evidence\s+of\b/i,
  /\bnot\s+known\s+to\s+be\s+linked\b/i,
  /\bthere\s+are\s+no\s+signals\s+indicating\b/i,
];

export interface ProhibitedPhraseFinding {
  match: string;
  index: number;
  /** Was the phrase used WITH explicit UNKNOWN/Unknowable qualification nearby? If so, allowed. */
  excused_by_unknown_qualifier: boolean;
}

export function scanProhibitedPhrases(text: string): ProhibitedPhraseFinding[] {
  const findings: ProhibitedPhraseFinding[] = [];
  for (const re of PROHIBITED_PHRASES) {
    const match = re.exec(text);
    if (!match) continue;
    const idx = match.index;
    // Excuse window: 200 chars around the match — does it contain "Coverage Confidence: UNKNOWN" or "Unknowable"?
    const windowStart = Math.max(0, idx - 200);
    const windowEnd = Math.min(text.length, idx + 200);
    const window = text.slice(windowStart, windowEnd);
    const excused =
      /coverage\s+confidence\s*:\s*unknown/i.test(window) ||
      /\bunknowable\b/i.test(window);
    findings.push({
      match: match[0],
      index: idx,
      excused_by_unknown_qualifier: excused,
    });
  }
  return findings.filter((f) => !f.excused_by_unknown_qualifier);
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 — Prompt-injection block builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the system-prompt block that tells the LLM:
 *   - the COMPUTED Coverage Confidence class
 *   - the COMPUTED reason bullets (verbatim, not paraphraseable)
 *   - the required output structure (SHORT or EXPANDED)
 *   - the prohibited patterns
 *
 * The LLM is given the values; it cannot choose them. This is the structural
 * safeguard against reverse-engineering evidence to justify a chosen class.
 */
export function buildPromptInjectionBlock(result: CoverageResult): string {
  if (!result.emit_coverage_section) {
    return ""; // Question doesn't require signal-grounding; no Coverage Confidence section
  }

  const reasonList = result.reason_bullets.map((b) => `- ${b}`).join("\n");
  const mode = result.expanded_mode ? "EXPANDED" : "SHORT";

  const expandedBlock = result.expanded_mode
    ? `

EXPANDED SECTIONS (MUST emit because: ${result.expanded_trigger}):

Why:
${formatContributorBreakdown(result.contributors)}

Blind Spots:
${result.blind_spots.map((b) => `- ${b}`).join("\n")}

What Would Increase Confidence:
${result.what_would_increase_confidence.map((b) => `- ${b}`).join("\n")}
`
    : "";

  return `═══ COVERAGE CONFIDENCE (SYSTEM-COMPUTED — DO NOT MODIFY) ═══

The following Coverage Confidence values were computed DETERMINISTICALLY
from retrieval evidence. You MUST render them VERBATIM in your response.
You may NOT change the class. You may NOT paraphrase the reason bullets.

CLASS: ${result.class}

REASON BULLETS (emit verbatim under "Reason:"):
${reasonList}

OUTPUT MODE: ${mode}

REQUIRED RESPONSE STRUCTURE (emit exactly this template):

Coverage Confidence: ${result.class}
Reason:
${reasonList}

Known:
<your grounded factual claims here. Each claim cites: source, timestamp.
 If you cannot ground a specific factual claim, do NOT write it.>

Unknown (could collect):
- <items Fortress could collect but hasn't — be specific about which
   source class is missing, e.g. "Reddit not collected for this entity">

Unknowable:
- <items Fortress cannot collect: private communications, future events,
   subjective intent, cross-tenant data outside Aegis Ops seam>

Operator Impact: <emit EXACTLY ONE of:
  Can act now
  Can act cautiously (with caveats: <brief list>)
  Additional collection recommended before acting
  Insufficient information — do not act on this assessment>
${expandedBlock}

═══ PROHIBITED PATTERNS — DO NOT EMIT ═══

• "No evidence found" — replace with "Coverage Confidence: UNKNOWN — <source class> not collected"
• "No evidence of X" — replace with explicit Unknown or Unknowable framing
• Bare numeric scores (e.g. "Threat: 82") without reasoning trail
• Collapsing Unknown and Unknowable into one section
• Skipping the Operator Impact line
• Modifying the Coverage Confidence class or Reason bullets above

The class and reason were computed from measured evidence. If you disagree
with the classification, you may add a single line "Author note: <reason>"
AFTER the Operator Impact line, but you must STILL emit the system-computed
class and reasons verbatim.`;
}

function formatContributorBreakdown(c: CoverageContributors): string {
  const lines: string[] = [];
  lines.push(`- Source Diversity: ${c.source_diversity_count} distinct class(es)`);
  lines.push(`- Temporal Grounding: ${Math.round(c.temporal_grounding_rate * 100)}% of ${c.cited_signal_count} cited signal(s)`);
  lines.push(`- Corroboration Strength: ${c.corroboration_strength} independent lineage(s)`);
  lines.push(`- Mission Integrity: ${c.mission_integrity_critical_count} open critical(s)`);
  lines.push(`- Information Fidelity: not yet operational (stubbed at 0%)`);
  lines.push(`- Preservation Fidelity: not yet operational (probe not built)`);
  return lines.join("\n");
}
