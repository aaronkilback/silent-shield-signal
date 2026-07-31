// WO-GROUNDING-01 — Phase 1: types + constructor ONLY (no generator changes).
//
// Binding at derivation: a DerivedClaim carries its originating signal id(s) as an INTRINSIC property.
// There is no code path that accepts free prose and attaches ids afterward — the constructor rejects any
// claim that is not grounded in a verbatim span of its cited signal(s). Amendments 6 (multi-signal factual),
// 7 (entity-scope guard: alias-resolution OR Gate-3 asset link, not string match), 8 (Inference entailment —
// enforced in Phase 4) are honored here at the type + constructor layer.
//
// Dependencies are INJECTED (GroundingDeps) so the constructor is pure and testable; the real resolvers
// (signal text from DB, client aliases from the client entity, asset link from Gate-3 PostGIS) wire in Phase 2.

// ─────────────────────────────── Types ───────────────────────────────

export interface SourceSpan {
  /** uuid of the signal this excerpt is taken from — MUST be one of the claim's source_signal_ids. */
  signal_id: string;
  /** verbatim excerpt of that signal's normalized_text (proven a substring at construction). */
  text: string;
}

export interface DerivedClaim {
  readonly kind: "derived_claim";
  readonly text: string;
  /** ≥ 1 signal id (Amendment 6: N ids all bound; the claim stays FACTUAL, never an Inference). */
  readonly source_signal_ids: string[];
  /** ≥ 1 span; each span.signal_id ∈ source_signal_ids and each text is a verbatim signal excerpt. */
  readonly source_spans: SourceSpan[];
}

export interface Inference {
  readonly kind: "inference";
  readonly text: string;
  /** ≥ 1 DerivedClaim id this inference is drawn OVER (Phase 4 adds the entailment check). */
  readonly over: string[];
}

/** Injected resolvers — real implementations land in Phase 2 (DB / client entity / Gate-3 PostGIS). */
export interface GroundingDeps {
  /** verbatim normalized_text of a signal by id, or null if unknown. Used to prove a span is real. */
  getSignalText(signalId: string): string | null;
  /** resolved client alias set (e.g. Petronas Canada Ltd / PECL / PCL / Progress Energy) via the client
   *  entity's alias set — NOT raw string equality (Amendment 7a). */
  clientAliases: string[];
  /** Amendment 7b: does this signal resolve to a client asset/operator link via Gate-3 PostGIS asset points
   *  (spatial contains / distance to a client-operated asset)? NOT string search. */
  resolveAssetLink(signalId: string): boolean;
}

export type ConstructResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; detail: string };

const reject = (reason: string, detail: string): { ok: false; reason: string; detail: string } =>
  ({ ok: false, reason, detail });

// ─────────────────────────────── Helpers ───────────────────────────────

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Verbatim-excerpt check under normalization (whitespace/punctuation-insensitive). */
function isVerbatimExcerpt(signalText: string, span: string): boolean {
  const n = norm(span);
  return n.length > 0 && norm(signalText).includes(n);
}

const COMMON_CAPS = new Set([
  "the", "a", "an", "action", "coordinate", "review", "confirm", "monitor", "ensure", "note", "including",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
]);

/**
 * Salient terms a claim ASSERTS — all-caps acronyms (LNG, PCL) + Capitalized words that are NOT sentence-initial
 * and not common. These are the terms whose absence from every span means the claim is not grounded in its signal.
 * Client-alias tokens are removed here — client scope is governed by the entity-scope guard (R4), not R3.
 */
function salientTerms(text: string, clientAliasTokens: Set<string>): string[] {
  const terms = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z]{2,}\b/g)) terms.add(m[0].toLowerCase()); // acronyms
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/);
    for (let i = 1; i < words.length; i++) { // skip index 0 (sentence-initial capital is not a proper noun)
      const w = words[i].replace(/[^A-Za-z]/g, "");
      if (/^[A-Z][a-z]+$/.test(w) && !COMMON_CAPS.has(w.toLowerCase())) terms.add(w.toLowerCase());
    }
  }
  return [...terms].filter((t) => !clientAliasTokens.has(t));
}

// ─────────────────────────────── Constructors ───────────────────────────────

export interface DerivedClaimInput {
  text: string;
  source_signal_ids: string[];
  source_spans: SourceSpan[];
  /** optional: the derivation pass may flag a claim as asserting client impact even without naming an alias. */
  asserts_client_impact?: boolean;
}

/**
 * The ONLY way to make a DerivedClaim. Rejects (never throws a half-built claim) unless every invariant holds.
 * A rejection means: this claim cannot be written — there is no prose-then-attach path.
 */
export function createDerivedClaim(input: DerivedClaimInput, deps: GroundingDeps): ConstructResult<DerivedClaim> {
  // R1 — ≥ 1 originating signal id (Amendment 6: N allowed, all bound).
  if (!input.source_signal_ids || input.source_signal_ids.length < 1)
    return reject("no_source_signal", "a DerivedClaim requires >= 1 source_signal_id");

  // R2 — ≥ 1 span; each bound to a cited signal AND a verbatim excerpt of that signal's text.
  if (!input.source_spans || input.source_spans.length < 1)
    return reject("no_source_span", "a DerivedClaim requires >= 1 source_span (the excerpt it is derived from)");
  for (const span of input.source_spans) {
    if (!input.source_signal_ids.includes(span.signal_id))
      return reject("span_signal_not_bound", `span.signal_id ${span.signal_id} is not in source_signal_ids`);
    const sigText = deps.getSignalText(span.signal_id);
    if (sigText == null) return reject("signal_text_unavailable", `no normalized_text for signal ${span.signal_id}`);
    if (!isVerbatimExcerpt(sigText, span.text))
      return reject("span_not_in_signal", `span text is not a verbatim excerpt of signal ${span.signal_id}`);
  }

  const spanBlob = norm(input.source_spans.map((s) => s.text).join("  "));
  const aliasTokens = new Set<string>(deps.clientAliases.flatMap((a) => norm(a).split(" ")).filter(Boolean));

  // R4 — entity-scope guard (Amendment 7). Run BEFORE R3 so a client-impact claim is judged by scope, not by
  //      generic term grounding. Client impact = a client alias appears in the CLAIM TEXT, or the caller flags it.
  const aliasInClaim = deps.clientAliases.some((a) => norm(input.text).includes(norm(a)));
  if (aliasInClaim || input.asserts_client_impact === true) {
    const aliasInSpan = deps.clientAliases.some((a) => spanBlob.includes(norm(a)));
    const assetLink = input.source_signal_ids.some((id) => deps.resolveAssetLink(id));
    if (!aliasInSpan && !assetLink)
      return reject(
        "client_scope_unbacked",
        "claim asserts client impact but NO source span names a client alias AND no Gate-3 asset/operator link resolves (Amendment 7)",
      );
  }

  // R3 — grounding: every salient term the claim asserts must appear in the union of its spans. A claim cannot
  //      assert a subject its supporting spans do not contain (this is what makes a wildfire signal structurally
  //      incapable of grounding a "Uniper LNG" claim).
  const ungrounded = salientTerms(input.text, aliasTokens).filter((t) => !spanBlob.includes(t));
  if (ungrounded.length > 0)
    return reject("claim_not_grounded_in_span", `claim asserts term(s) absent from every source span: ${ungrounded.join(", ")}`);

  return {
    ok: true,
    value: {
      kind: "derived_claim",
      text: input.text,
      source_signal_ids: [...input.source_signal_ids],
      source_spans: input.source_spans.map((s) => ({ ...s })),
    },
  };
}

/** The ONLY way to make an Inference. Phase 1 enforces the non-empty `over` rule; Phase 4 adds entailment. */
export function createInference(input: { text: string; over: string[] }): ConstructResult<Inference> {
  if (!input.over || input.over.length < 1)
    return reject("empty_over", "an Inference requires >= 1 claim id in `over` (no anchorless analysis)");
  return { ok: true, value: { kind: "inference", text: input.text, over: [...input.over] } };
}
