// WO-GROUNDING-01 Phase 2 — the derivation pass. ONE signal in, claims out, BOUND at construction.
//
// The model is handed EXACTLY one signal's normalized_text and answers only "what does this signal support about
// the client?", quoting the exact span for each claim. Every candidate is immediately passed through
// createDerivedClaim, bound to THAT signal's id — there is no step where prose is written and ids attached after.
// A candidate that is not grounded in a verbatim span, or that asserts client impact without an alias-in-span or a
// Gate-3 asset link, is rejected here (and logged via deps.onReject). R3 stays a PRIMARY independent check — the
// derivation is NOT trusted to have behaved (the model can still emit terms from context/training).
//
// Amendment 6 (multi-signal factual): the derivation pass is per-signal, so it produces single-signal DerivedClaims;
// when the SAME fact is derived from N signals, the assembly/dedup pass (Phase 3) merges them into one DerivedClaim
// binding all N ids — it stays FACTUAL, never an Inference.

import { createDerivedClaim, type DerivedClaim, type GroundingDeps } from "./derived-claim.ts";

export interface CandidateClaim {
  text: string;
  /** the exact span the model quotes from THIS signal in support of the claim. */
  span: string;
  /** the model's assertion that the claim is about the client (validated by the entity-scope guard). */
  asserts_client_impact?: boolean;
}

/** The model call, injected so the constructor loop is testable without a live LLM. */
export type DeriveCandidates = (signalId: string, signalText: string) => Promise<CandidateClaim[]>;

/** The derivation prompt. Single signal, span-quoting required, silence-is-correct, no outside knowledge. */
export function derivationPrompt(clientName: string, signalText: string): string {
  return [
    `You are given EXACTLY ONE intelligence signal. Answer ONLY: what does THIS signal support about ${clientName}?`,
    ``,
    `Rules:`,
    `- Every claim MUST be supported by a VERBATIM span you quote from the signal text below. Quote it exactly.`,
    `- Use ONLY the signal text. Do NOT use outside/world knowledge, prior reports, or training facts.`,
    `- If the signal supports nothing about ${clientName}, return an empty list. Silence is correct.`,
    `- Do NOT assert ${clientName} involvement, stakes, ownership, or impact unless the signal's own text says so`,
    `  OR the signal concerns the client's operating area. Never infer a connection the signal does not state.`,
    `- Set "asserts_client_impact" true only when the claim asserts something about ${clientName} specifically.`,
    ``,
    `Return JSON only: {"claims":[{"text":"<claim>","span":"<exact quote from the signal>","asserts_client_impact":<true|false>}]}`,
    ``,
    `SIGNAL TEXT:`,
    `"""${signalText}"""`,
  ].join("\n");
}

export interface DerivationResult {
  signal_id: string;
  accepted: DerivedClaim[];
  rejected: Array<{ text: string; reason: string; detail: string }>;
}

/**
 * Derive claims from ONE signal. Each candidate is constructed (bound to signalId) — accepted only if it passes
 * every invariant; rejected candidates are returned with their reason (and logged via deps.onReject in R3).
 */
export async function deriveClaimsFromSignal(
  signalId: string,
  signalText: string,
  deps: GroundingDeps,
  derive: DeriveCandidates,
): Promise<DerivationResult> {
  const candidates = await derive(signalId, signalText);
  const accepted: DerivedClaim[] = [];
  const rejected: DerivationResult["rejected"] = [];
  for (const c of candidates) {
    const res = createDerivedClaim({
      text: c.text,
      source_signal_ids: [signalId],
      source_spans: [{ signal_id: signalId, text: c.span }],
      asserts_client_impact: c.asserts_client_impact,
    }, deps);
    if (res.ok) accepted.push(res.value);
    else rejected.push({ text: c.text, reason: res.reason, detail: res.detail });
  }
  return { signal_id: signalId, accepted, rejected };
}

/** Client-relevance filter: the claims that survive AND assert client impact (what a client report may use). */
export function clientClaims(result: DerivationResult, clientAliases: string[]): DerivedClaim[] {
  const norm = (s: string) => s.toLowerCase();
  return result.accepted.filter((c) => clientAliases.some((a) => norm(c.text).includes(norm(a))));
}
