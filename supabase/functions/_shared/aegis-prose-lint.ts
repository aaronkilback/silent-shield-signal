// supabase/functions/_shared/aegis-prose-lint.ts
//
// Workstream D — slim slice — anti-certainty-theater prose lint (§6 of ADR).
//
// Enforces language matching the claim type + confidence summary BEFORE the
// model's response is returned to the caller. Violations are surfaced to the
// caller (which may scrub, rewrite, or refuse). The lint never silently
// rewrites — surfacing the violation is the contract; remediation is the
// caller's responsibility (typically a re-prompt or refusal).
//
// HARD RULES:
//   • Never claim "Confirmed" / "Verified" on an unreviewed claim.
//   • Never claim "Multiple sources" / "Widely reported" when lineage_count < 2.
//   • Never use "Reports indicate" / "Sources say" for an ai_generated_hypothesis.
//   • Stale claims must carry an age qualifier; bare present-tense is a defect.
//   • Ungrounded claims must not appear at all (suppression is the caller's job;
//     this lint reports it as a violation if it sees one).

import type { ClaimFrame } from "./aegis-claim-frame.ts";

export interface ProseLintViolation {
  rule_id: string;
  matched_phrase: string;
  required_phrase_class: string;
  details: string;
}

// Phrase classes banned per profile.
const STRONG_CERTAINTY_PATTERNS = [
  /\bconfirmed\b/i,
  /\bverified\b/i,
  /\bwe (?:know|can confirm)\b/i,
  /\bdefinitive(?:ly)?\b/i,
];

const MULTI_SOURCE_PATTERNS = [
  /\bmultiple sources\b/i,
  /\bwidely reported\b/i,
  /\bnumerous reports\b/i,
  /\bseveral sources\b/i,
];

const REPORTING_VOICE_PATTERNS = [
  /\breports indicate\b/i,
  /\bsources say\b/i,
  /\baccording to (?:reports|sources)\b/i,
];

const AGE_QUALIFIER_PATTERNS = [
  /\b\d+\s*(?:day|week|month|year)s?\s*(?:ago|old)\b/i,
  /\bmost recent\b/i,
  /\bobserved (?:on|in)\b/i,
  /\bstale\b/i,
  /\baging\b/i,
];

function findMatches(text: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) hits.push(m[0]);
  }
  return hits;
}

export function lintAegisProse(prose: string, frame: ClaimFrame): ProseLintViolation[] {
  const violations: ProseLintViolation[] = [];
  const { what, how, confidence } = frame;

  // R1 — ungrounded claim should not appear at all.
  if (confidence.summary === "ungrounded") {
    violations.push({
      rule_id: "R1_ungrounded_must_be_suppressed",
      matched_phrase: what.label.slice(0, 80),
      required_phrase_class: "suppress (do not surface ungrounded claims)",
      details: "Caller must suppress ungrounded claims per ADR §3.6 (fail-closed grounding).",
    });
  }

  // R2 — "Confirmed"/"Verified" require validation_state === 'accepted'.
  const isAccepted = confidence.axes.validation_state === "accepted";
  if (!isAccepted) {
    const hits = findMatches(prose, STRONG_CERTAINTY_PATTERNS);
    for (const hit of hits) {
      violations.push({
        rule_id: "R2_strong_certainty_requires_accepted_validation",
        matched_phrase: hit,
        required_phrase_class: "weakened phrasing (e.g. 'Multiple sources report…')",
        details: `Claim validation_state=${confidence.axes.validation_state}; cannot claim certainty.`,
      });
    }
  }

  // R3 — "Multiple sources" requires lineage_count ≥ 2.
  if (how.lineage_count < 2) {
    const hits = findMatches(prose, MULTI_SOURCE_PATTERNS);
    for (const hit of hits) {
      violations.push({
        rule_id: "R3_multi_source_requires_2_lineages",
        matched_phrase: hit,
        required_phrase_class: "single-source phrasing (e.g. 'Single-source claim:…')",
        details: `lineage_count=${how.lineage_count} but prose implies multiple independent sources.`,
      });
    }
  }

  // R4 — AI hypothesis cannot use reporting-voice constructions.
  if (what.type === "ai_generated_hypothesis") {
    const hits = findMatches(prose, [...REPORTING_VOICE_PATTERNS, ...STRONG_CERTAINTY_PATTERNS]);
    for (const hit of hits) {
      violations.push({
        rule_id: "R4_ai_hypothesis_no_reporting_voice",
        matched_phrase: hit,
        required_phrase_class: "hypothesis phrasing (e.g. 'Aegis-generated hypothesis (not corroborated):…')",
        details: "ai_generated_hypothesis must never be presented as reported fact.",
      });
    }
  }

  // R5 — Stale confidence requires an age qualifier.
  if (confidence.summary === "stale") {
    const hasQualifier = findMatches(prose, AGE_QUALIFIER_PATTERNS).length > 0;
    if (!hasQualifier) {
      violations.push({
        rule_id: "R5_stale_requires_age_qualifier",
        matched_phrase: prose.slice(0, 80),
        required_phrase_class: "age-qualified phrasing (e.g. 'Most recent evidence is 47 days old.')",
        details: "Stale claim displayed without an age qualifier — banned by §6.",
      });
    }
  }

  // R6 — inferred_relationship must use inference voice.
  if (what.type === "inferred_relationship") {
    const hits = findMatches(prose, STRONG_CERTAINTY_PATTERNS);
    for (const hit of hits) {
      violations.push({
        rule_id: "R6_inferred_requires_inference_voice",
        matched_phrase: hit,
        required_phrase_class: "inference phrasing (e.g. 'Inferred from…' / 'Suggested by…')",
        details: "inferred_relationship must be presented as inference, not fact.",
      });
    }
  }

  return violations;
}

// Convenience wrapper for caller flows.
export function proseLintReport(prose: string, frame: ClaimFrame): {
  passed: boolean;
  violations: ProseLintViolation[];
} {
  const violations = lintAegisProse(prose, frame);
  return { passed: violations.length === 0, violations };
}
