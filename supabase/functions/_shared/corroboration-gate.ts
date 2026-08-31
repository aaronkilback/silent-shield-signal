// Corroboration gate (WO-EXPOSURE-CORROBORATION, architecture B, 2026-08-31).
//
// SINGLE SOURCE OF TRUTH for whether a captured location corroborates its finding. Runs in TS only,
// at scan time (subject-retrieval persist) and in the backfill. The DB trigger fn_sel_reclassify()
// contains NO regex — it merely counts locations where corroborates=true. So the gate can never
// drift between the two paths: there is only one path.
//
// VERIFICATION (is the finding real) is decided elsewhere (isRealLegal etc.). This module decides
// CORROBORATION (does THIS source independently confirm it), via two gates on the location's own
// snippet+title:
//   Gate 1 — subject identity: the subject's FULL name is present (not a bare surname token).
//   Gate 2 — finding entity: the finding's distinguishing element is present (category-specific).
// A location passes only if BOTH gates pass. Failures are retained (unverified), never dropped.

export type GateFailed = "gate1_subject" | "gate2_entity" | null; // null = gated AND passed
export interface GateVerdict { corroborates: boolean; gate_failed: GateFailed }

const STOPWORDS = new Set([
  "the", "and", "for", "with", "into", "from", "that", "this", "his", "her", "she", "him", "their",
  "b.c", "bc", "app", "new", "out", "who", "how", "why", "was", "are", "has", "had", "will", "can",
]);

const norm = (s: string) => (s || "").toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Gate 1 evaluates the STORED snippet+title only — never found_by_query (that is our own search input;
// trusting it would let the gate confirm what we asked for). WO-CAPTURE-EXCERPT-WINDOW (open, do not fix
// here): a short capture excerpt can omit a full name that IS on the page (e.g. wiselaw) — widening the
// excerpt at capture time may let such a location pass Gate 1 legitimately. Capture-time change.
/** Gate 1 — the subject's full name (first + last, allowing a middle initial, or "Last, First"). */
export function subjectNamePresent(subjectName: string, text: string): boolean {
  const parts = (subjectName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;             // need at least first + last to demand a FULL name
  const first = escapeRe(parts[0].toLowerCase());
  const last = escapeRe(parts[parts.length - 1].toLowerCase());
  const t = norm(text);
  // "first [middle-initial] last"  OR  "last, first"
  const forward = new RegExp(`\\b${first}\\s+(?:[a-z]\\.?\\s+)?${last}\\b`, "i");
  const reversed = new RegExp(`\\b${last},\\s+${first}\\b`, "i");
  return forward.test(t) || reversed.test(t);
}

// Legal context / judgment vocabulary — mirror of subject-retrieval's LEGAL_CONTEXT_CLASSIFY (+ charged/proceeding).
const LEGAL_CONTEXT = /\b(court|ruling|judg(?:e|ment|ement)|tribunal|bcsc|bcca|scc|onsc|onca|abqb|justice|plaintiff|defendant|prosecution|lawsuit|litigation|appeal|liable|sued|charged|proceedings?)\b/i;

/** Other party in "Legal case: X v. Y" — the side that isn't the subject's surname. */
export function otherLegalParty(findingTitle: string, subjectName: string): string {
  const surname = ((subjectName || "").trim().split(/\s+/).pop() || "").toLowerCase();
  const body = (findingTitle || "").replace(/^Legal case:\s*/i, "").trim();
  const m = body.match(/^(.+?)\s+v\.?s?\.?\s+(.+?)$/i);
  if (!m) return "";
  const sides = [m[1].trim(), m[2].trim()];
  return (surname ? sides.find((s) => !s.toLowerCase().includes(surname)) : sides[1]) || "";
}

/** Distinctive tokens of a non-legal finding title: content words minus stopwords and the subject's own name tokens. */
export function distinctiveTokens(findingTitle: string, subjectName: string): string[] {
  const nameTokens = new Set((subjectName || "").toLowerCase().split(/\s+/).filter(Boolean));
  return [...new Set(
    (findingTitle || "").toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !nameTokens.has(w)),
  )];
}

/** Gate 2 — the finding's distinguishing element is present, category-specific and never optional. */
export function findingEntityPresent(category: string, findingTitle: string, subjectName: string, text: string): boolean {
  const t = norm(text);
  if (category === "legal") {
    // case name / other party in legal context / judgment-court-proceeding language. Gate 1 already
    // guaranteed the subject's full name, so legal-context vocabulary is the distinguishing signal.
    const other = otherLegalParty(findingTitle, subjectName).toLowerCase();
    if (other && t.includes(other) && LEGAL_CONTEXT.test(t)) return true;
    return LEGAL_CONTEXT.test(t);
  }
  // non-legal (mention / professional / media / financial): the finding's distinctive title tokens.
  const toks = distinctiveTokens(findingTitle, subjectName);
  if (toks.length === 0) return false;            // title is only the subject's name -> not a distinguishing entity
  const need = Math.min(2, toks.length);
  const hit = toks.filter((tok) => t.includes(tok)).length;
  return hit >= need;
}

/** The gate. Evaluated on ONE location's snippet+title. */
export function gateLocation(params: {
  subjectName: string; category: string; findingTitle: string; snippet?: string | null; title?: string | null;
}): GateVerdict {
  const text = `${params.snippet || ""} ${params.title || ""}`;
  if (!subjectNamePresent(params.subjectName, text)) return { corroborates: false, gate_failed: "gate1_subject" };
  if (!findingEntityPresent(params.category, params.findingTitle, params.subjectName, text)) {
    return { corroborates: false, gate_failed: "gate2_entity" };
  }
  return { corroborates: true, gate_failed: null };
}

// Anchor assignment from gated locations — the ONLY corroboration counting logic. The DB trigger
// mirrors this by counting corroborates=true (scoped by category); both are identical because neither
// contains a gate.
export const CORROBORATION_MIN_DOMAINS = 2;
// single_source (1 passing domain) applies ONLY to adverse finding categories — a real adverse event
// with one solid source is still worth flagging. NON-adverse mentions get NO single_source promotion
// (WO-EXPOSURE-CORROBORATION Problem 2 ruling, 2026-08-31): a mention needs >=2 passing independent
// domains for verified_presence, else it stays noise.
//
// KNOWN-LIMITATION (do not describe as fixed): this SUPPRESSES the self-published mass-promotion symptom.
// Two open WOs sit under it:
//   WO-GATE2-NONLEGAL — Gate 2 tests a location against a finding title derived from that same location's
//     page title, so for every non-legal category the test is self-satisfying and contributes nothing.
//     Until fixed, non-legal findings rest on Gate 1 + domain count alone.
//   WO-SELF-PUBLISHED-CLASS — self-published content (own LinkedIn/Instagram/X) is currently classed as
//     third-party mention; it is neither exposure nor corroboration and needs its own class, not a
//     suppression rule. (Same defect family as the Appendix A segmentation issue in report e7f8af9c.)
export const SINGLE_SOURCE_CATEGORIES = new Set(["legal", "media", "financial", "professional"]);
export function anchorFromGated(
  category: string,
  locations: { domain?: string | null; corroborates?: boolean | null }[],
): { anchor_type: "source_corroboration" | "single_source" | "name_match_only"; passing_domains: string[] } {
  const passing_domains = [...new Set(
    (locations || []).filter((l) => l.corroborates === true)
      .map((l) => (l.domain || "").toLowerCase().replace(/^www\./, "")).filter(Boolean),
  )];
  const n = passing_domains.length;
  const anchor_type = n >= CORROBORATION_MIN_DOMAINS
    ? "source_corroboration"
    : (n === 1 && SINGLE_SOURCE_CATEGORIES.has(category)) ? "single_source" : "name_match_only";
  return { anchor_type, passing_domains };
}
