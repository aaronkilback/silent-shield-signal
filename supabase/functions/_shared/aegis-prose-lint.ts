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

// ─────────────────────────────────────────────────────────────────────────────
// R7 — tradecraft must never be cited as observation (P4, 2026-05-29).
//
// When tradecraft items have been injected into a prompt, the model's response
// must EITHER include the bracketed `[TRADECRAFT REFERENCE — methodology, not
// observation]` label at any point it paraphrases or cites the tradecraft,
// OR not cite tradecraft content at all.
//
// The structural defense is the prompt instruction. This lint is the backstop:
// if the response contains substring evidence of tradecraft content AND
// uses assertive-evidence framing (R2 / R4 patterns) WITHOUT a tradecraft
// framing word ("tradecraft", "methodology", "framework", "reference",
// "doctrine", or the bracketed label), it's an R7 violation.
//
// This rule is class-aware: it doesn't need a ClaimFrame. It accepts the
// injected tradecraft items directly so it can match substring overlap.
// ─────────────────────────────────────────────────────────────────────────────

export interface TradecraftInjectionItem {
  id: string;
  hypothesis: string;
  domain?: string;
}

const TRADECRAFT_FRAMING_PATTERNS = [
  /\btradecraft\b/i,
  /\bmethodology\b/i,
  /\bmethodologies\b/i,
  /\bframework(?:s)?\b/i,
  /\bdoctrine\b/i,
  /\breference(?:s)?\b/i,
  /\[TRADECRAFT REFERENCE/i,
];

const ASSERTIVE_OBSERVATION_PATTERNS = [
  /\breports indicate\b/i,
  /\bsources say\b/i,
  /\baccording to (?:reports|sources)\b/i,
  /\bevidence shows\b/i,
  /\bdata confirms\b/i,
  /\bobserved (?:that|in|to)\b/i,
  /\bdemonstrates? that\b/i,
];

export function lintTradecraftCitation(
  prose: string,
  injectedTradecraft: TradecraftInjectionItem[],
): ProseLintViolation[] {
  const violations: ProseLintViolation[] = [];
  if (!injectedTradecraft || injectedTradecraft.length === 0) return violations;

  // Has the response used a framing word anywhere?
  const hasFramingWord = TRADECRAFT_FRAMING_PATTERNS.some((p) => p.test(prose));

  // Substring overlap between prose and any injected tradecraft hypothesis.
  // Look for any contiguous 30+ char fragment from a tradecraft hypothesis
  // appearing verbatim in the prose. Conservative — paraphrasing won't match
  // but verbatim borrowing will.
  const findOverlap = (proseText: string, items: TradecraftInjectionItem[]): TradecraftInjectionItem | null => {
    const pLower = proseText.toLowerCase();
    for (const item of items) {
      const hLower = (item.hypothesis ?? "").toLowerCase();
      if (hLower.length < 30) continue;
      // Walk the hypothesis in 30-char windows; if any window appears verbatim in prose, that's overlap.
      for (let i = 0; i + 30 <= hLower.length; i += 10) {
        const window = hLower.slice(i, i + 30);
        if (pLower.includes(window)) return item;
      }
    }
    return null;
  };

  const overlap = findOverlap(prose, injectedTradecraft);
  if (!overlap) return violations;  // no tradecraft borrowed — nothing to flag.

  // Tradecraft was borrowed. Check whether the response is using
  // observation-voice without framing.
  const assertiveHits = ASSERTIVE_OBSERVATION_PATTERNS.flatMap((p) => {
    const m = prose.match(p);
    return m ? [m[0]] : [];
  });
  if (assertiveHits.length > 0 && !hasFramingWord) {
    violations.push({
      rule_id: "R7_tradecraft_must_not_be_observation",
      matched_phrase: assertiveHits[0],
      required_phrase_class: "tradecraft framing (e.g. '[TRADECRAFT REFERENCE]', 'the platform's methodology says…', 'as a framework…')",
      details: `Prose contains content overlap with tradecraft item ${overlap.id} and uses observation-voice framing without the methodology label.`,
    });
  }

  // Also flag strong certainty + borrowed tradecraft without framing.
  const certaintyHits = STRONG_CERTAINTY_PATTERNS.flatMap((p) => {
    const m = prose.match(p);
    return m ? [m[0]] : [];
  });
  if (certaintyHits.length > 0 && !hasFramingWord) {
    violations.push({
      rule_id: "R7_tradecraft_must_not_be_observation",
      matched_phrase: certaintyHits[0],
      required_phrase_class: "tradecraft framing (methodology, not observation)",
      details: `Prose claims certainty over content borrowed from tradecraft item ${overlap.id} without framing it as methodology.`,
    });
  }

  return violations;
}

export function tradecraftLintReport(
  prose: string,
  injectedTradecraft: TradecraftInjectionItem[],
): { passed: boolean; violations: ProseLintViolation[] } {
  const violations = lintTradecraftCitation(prose, injectedTradecraft);
  return { passed: violations.length === 0, violations };
}
