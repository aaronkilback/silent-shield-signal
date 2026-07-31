// WO-GROUNDING-01 Phase 3 — assembly. Sections are composed ONLY from already-bound DerivedClaims. The narrative
// model orders and connects pre-bound claims; it may NOT introduce new factual sentences. Any assembled sentence
// not traceable to an input claim is REJECTED BEFORE render (not flagged after) — this is the original defect site
// (prose written first, ids attached after). Binding travels with the CLAIM, not the position: an assembled
// sentence's [SIG] ids are always its referenced claim's ids; the model cannot specify or move them.

import { salientTerms, numericTokens, type DerivedClaim } from "./derived-claim.ts";

/** An input claim, id-tagged so the assembly model can reference it. */
export interface TaggedClaim { claim_id: string; claim: DerivedClaim; }

/** The assembly model's output: for each rendered sentence, WHICH pre-bound claim it renders. It supplies a
 *  claim_id + a sentence only — it does NOT (and cannot) supply signal ids; those come from the claim. */
export interface AssemblyItem { claim_id: string; sentence: string; }

export interface AssembledSentence {
  sentence: string;
  from_claim_id: string;
  /** ALWAYS the referenced claim's ids — binding travels with the claim, not the position. */
  source_signal_ids: string[];
}

export interface AssemblyResult {
  rendered: AssembledSentence[];
  rejected: Array<{ sentence: string; claim_id: string; reason: string; detail: string }>;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Assemble rendered sentences from the model's ordering of PRE-BOUND claims. Rejects (before render):
 *   - unknown_claim_id       — the sentence references no input claim (assembly tried to introduce a sentence).
 *   - sentence_introduces_new_fact — the sentence asserts a salient/numeric term absent from its referenced
 *                                    claim (new fact, OR another claim's content pinned to this claim's id).
 * Accepted sentences carry the referenced claim's source_signal_ids — the model never supplies ids.
 */
export function assembleSections(items: AssemblyItem[], claims: TaggedClaim[]): AssemblyResult {
  const byId = new Map(claims.map((c) => [c.claim_id, c.claim]));
  const rendered: AssembledSentence[] = [];
  const rejected: AssemblyResult["rejected"] = [];

  for (const it of items) {
    const claim = byId.get(it.claim_id);
    if (!claim) {
      rejected.push({ sentence: it.sentence, claim_id: it.claim_id, reason: "unknown_claim_id",
        detail: `no input claim '${it.claim_id}' — assembly cannot introduce a sentence not from a bound claim` });
      continue;
    }
    // Traceability: the sentence may only restate/connect the claim — every salient/numeric term it asserts must
    // be present in the claim's text. Introducing a term the claim does not contain = a new fact (or another
    // claim's content attached to this id).
    const claimBlob = norm(claim.text);
    const claimNums = new Set(numericTokens(claim.text));
    const { textTerms, numericTerms } = salientTerms(it.sentence, new Set());
    const introduced = [
      ...textTerms.filter((t) => !claimBlob.includes(t)),
      ...numericTerms.filter((n) => !claimNums.has(n)),
    ];
    if (introduced.length) {
      rejected.push({ sentence: it.sentence, claim_id: it.claim_id, reason: "sentence_introduces_new_fact",
        detail: `sentence asserts term(s) not in claim '${it.claim_id}': ${introduced.join(", ")}` });
      continue;
    }
    // Binding travels with the claim — ids are the referenced claim's, never model- or position-supplied.
    rendered.push({ sentence: it.sentence, from_claim_id: it.claim_id, source_signal_ids: [...claim.source_signal_ids] });
  }
  return { rendered, rejected };
}

/**
 * Flash = the top-ranked bound claim, carrying its OWN ids (no free-writing summarizer).
 *
 * CURRENT ranking rule (PLACEHOLDER — WO-FLASH-RANK-01 is open + unbuilt; protective-intelligence-first ordering
 * is NOT part of this build):  corroboration DESC (number of distinct bound signal ids), then input order (stable).
 * i.e. the most-corroborated bound claim wins; ties keep the order they were given in.
 */
export function selectFlash(claims: TaggedClaim[]): TaggedClaim | null {
  if (!claims.length) return null;
  return claims
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (b.c.claim.source_signal_ids.length - a.c.claim.source_signal_ids.length) || (a.i - b.i))[0].c;
}

export const FLASH_RANKING_RULE =
  "corroboration desc (count of distinct bound signal ids), then input order — PLACEHOLDER pending WO-FLASH-RANK-01 (protective-intelligence-first)";
