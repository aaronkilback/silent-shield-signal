/**
 * foreign-alignment.ts — deterministic detection of state-media-aligned
 * content + interactions in incoming signals.
 *
 * Built 2026-05-11 in response to the Vashouk / @NeoIntel7 case where
 * a former employee's grievance was amplified by Iranian state-media
 * alignment. The 3Si 2024 report flagged the foreign-affiliation
 * concern; Fortress should automatically surface that signal pattern.
 *
 * Approach is deliberately deterministic (keyword + handle matching),
 * not AI-scored. False positives are explainable ("matched @PressTV
 * handle"). AI-augmented scoring is a follow-up — start with rules
 * we can defend.
 *
 * Score model:
 *   0.0  no indicators
 *   0.3  one rhetoric phrase or one state-media handle interaction
 *   0.5  two indicators OR a single high-confidence handle (state media)
 *   0.7  three+ indicators, includes mention of multiple state actors
 *   0.9  reserved for cases where AI agents confirm with content review
 *
 * Returns indicators list so the operator can see WHY a signal was
 * flagged.
 */

// State-media + foreign-state-aligned X handles. Conservative list —
// only handles that are CONFIRMED state-operated outlets. Excludes
// general nationalist accounts to avoid false-positive cascades.
const STATE_MEDIA_HANDLES: Record<string, string> = {
  // Iran
  "@presstv":          "iran_state_media",
  "@tasnimnews_en":    "iran_state_media",
  "@tehrantimes":      "iran_state_media",
  "@iribnews":         "iran_state_media",
  "@iuvmpress":        "iran_state_media",
  "@parstoday_en":     "iran_state_media",
  "@mehrnews_en":      "iran_state_media",

  // Russia
  "@rt_com":           "russia_state_media",
  "@sputnikint":       "russia_state_media",
  "@tass_agency":      "russia_state_media",
  "@ria_novosti":      "russia_state_media",

  // China
  "@globaltimesnews":  "china_state_media",
  "@chinadaily":       "china_state_media",
  "@xhnews":           "china_state_media",
  "@cgtnofficial":     "china_state_media",
  "@spokespersonchn":  "china_state_media",
};

// Rhetoric phrases — case-insensitive substring match. Conservative
// list. Multiple matches required to escalate score.
const RHETORIC_PHRASES: Array<{ pattern: RegExp; tag: string; weight: number }> = [
  // Iran-aligned rhetoric
  { pattern: /\bgreat satan\b/i,                             tag: "iran_rhetoric_great_satan",       weight: 0.4 },
  { pattern: /\bzionist (regime|entity|occupation)\b/i,      tag: "iran_rhetoric_zionist",           weight: 0.3 },
  { pattern: /\bisraeli? (terrorism|apartheid)\b/i,          tag: "anti_israel_state_rhetoric",      weight: 0.2 },
  { pattern: /\bdeath to (america|israel|trump)\b/i,         tag: "iran_rhetoric_death_to",          weight: 0.5 },
  // Russia-aligned rhetoric
  { pattern: /\b(nazi|fascist) ukraine\b/i,                  tag: "russia_rhetoric_denazify",        weight: 0.4 },
  { pattern: /\bkhokhol\b/i,                                 tag: "russia_anti_ukrainian_slur",      weight: 0.5 },
  { pattern: /\bspecial military operation\b/i,              tag: "russia_smo_framing",              weight: 0.3 },
  // China-aligned rhetoric
  { pattern: /\bone china (principle|policy)\b.{0,50}\b(taiwan|hk|xinjiang)\b/i,
                                                              tag: "china_one_china_framing",         weight: 0.3 },
  { pattern: /\b(re-education|vocational) (camp|center).{0,80}(necessary|misunderstood)\b/i,
                                                              tag: "china_xinjiang_denial",           weight: 0.4 },
  // Anti-western generic (lower weight — too common in legitimate critique)
  { pattern: /\b(nato|western) (warmonger|imperialis|hegemony)/i,
                                                              tag: "anti_western_framing",            weight: 0.2 },
  { pattern: /\b(soros|deep state|globalist) (puppet|backed|funded)\b/i,
                                                              tag: "conspiracy_framing",              weight: 0.2 },
];

export interface ForeignAlignmentResult {
  score: number;                    // 0-1
  indicators: string[];             // tags that fired
  matched_handles: string[];        // state-media handles found (for evidence)
  matched_phrases: string[];        // first 3 matching phrases (for evidence)
}

/**
 * Score a signal's text + (optional) author handle / mentioned handles
 * for foreign-alignment indicators.
 *
 * @param text          The signal's body / normalized text
 * @param mentions      Array of @handles mentioned in the content
 * @param authorHandle  Optional — the author's own X handle
 */
export function scoreForeignAlignment(
  text: string,
  mentions: string[] = [],
  authorHandle?: string | null,
): ForeignAlignmentResult {
  const indicators: string[] = [];
  const matched_handles: string[] = [];
  const matched_phrases: string[] = [];
  let score = 0;

  const lowerText = (text ?? "").toLowerCase();

  // Handle matching — check author + mentions
  const allHandles = [
    ...(authorHandle ? [authorHandle] : []),
    ...mentions,
  ].map((h) => (h ?? "").toLowerCase().trim());

  const seenStateActors = new Set<string>();
  for (const h of allHandles) {
    const tag = STATE_MEDIA_HANDLES[h];
    if (tag) {
      matched_handles.push(h);
      const stateActor = tag.split("_")[0]; // "iran", "russia", "china"
      if (!seenStateActors.has(stateActor)) {
        seenStateActors.add(stateActor);
        indicators.push(tag);
        // First handle from a new state-actor = 0.4; subsequent = 0.1
        score += 0.4;
      } else {
        score += 0.1;
      }
    }
  }

  // Rhetoric phrase matching
  for (const { pattern, tag, weight } of RHETORIC_PHRASES) {
    if (pattern.test(lowerText)) {
      if (!indicators.includes(tag)) {
        indicators.push(tag);
        if (matched_phrases.length < 3) {
          const match = lowerText.match(pattern);
          if (match) matched_phrases.push(match[0].substring(0, 100));
        }
        score += weight;
      }
    }
  }

  // Multi-state-actor boost: signals that align with 2+ adversary
  // narratives simultaneously are unusually high-signal (e.g. a
  // grievance amplifier interacting with both Iran + Russia outlets).
  if (seenStateActors.size >= 2) score += 0.2;

  // Cap at 0.9 — 1.0 is reserved for AI-confirmed cases
  score = Math.min(score, 0.9);
  // Round for stability
  score = Math.round(score * 100) / 100;

  return { score, indicators, matched_handles, matched_phrases };
}

/**
 * Extract @handles from arbitrary text. Used when the upstream monitor
 * doesn't pre-parse mentions (Reddit comments, news articles, etc.).
 */
export function extractMentions(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/@[a-zA-Z0-9_]{1,15}/g) ?? [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}
