# Phase B — Admission Controller Extraction (implementation design)

**Status:** DESIGN for review. No implementation. No mutations. No schema/DGIC/trigger enforcement.
**Goal:** extract today's `ingest-signal` admission behavior into a shared `admitSignal(candidate, classification, ctx)` such that the **external/crawled** path is **behavior-equivalent** to current `ingest-signal` — provably inert.

---

## 1. The seam (what moves, what stays)

```
ingest-signal (edge fn = external/crawled CALLER)         admitSignal (shared CONTROLLER)
─────────────────────────────────────────────            ───────────────────────────────────
HTTP entry / CORS / auth                                   profile = profileFor(classification)
request validation (zod)                          ──►      preGates(candidate)      (external: F-034 + #256 contract)
build SignalCandidate from validated body                  classify(candidate)      (external: gpt-4o-mini classifier + fallback + unknown-reject)
call admitSignal(candidate, {external,crawled})            dedup(candidate)         (external: content_hash, CVE, url-30d, title-24h, near-dup→signal_updates)
map AdmissionResult → HTTP response (unchanged shapes)     relevanceGate(candidate) (external: AI gate, threshold, filtered_signals, rejected_content_hashes, fail-closed)
                                                           [dgic stage — ABSENT in Phase B]
                                                           insert(signals)         + telemetry
                                                           return AdmissionResult
```

**Stays in `ingest-signal`:** HTTP/CORS, auth, zod request validation, candidate construction, response mapping. **Moves to the controller:** the entire post-validation admission pipeline (today's body from ~`#256 reject` through the `signals` insert). The external/crawled *profile* IS the current sequence, unchanged.

Rationale: the controller must own the admission **decision** so synthetic/asserted/supplied reuse it; the per-mode differences are expressed as **profile stages** (pre-gates, classify, dedup, relevance), not as forks in caller code.

---

## 2. Function signature
```ts
async function admitSignal(
  candidate: SignalCandidate,
  classification: Classification,
  ctx: AdmissionContext,
): Promise<AdmissionResult>;
```

```ts
interface AdmissionContext {
  supabase: SupabaseClient;        // service-role client (as today)
  caller: { kind: string; id?: string };  // preserves current caller-scope semantics
  requestStartedAt: number;        // for duration_ms parity
  config: DgicConfig;              // loaded once (cached); unused by external/crawled in Phase B
  logger?: (line: string) => void; // wrap console.* so log lines are preserved
}
```

## 3. Candidate shape (mode-agnostic; external/crawled subset = today's validated payload)
```ts
interface SignalCandidate {
  // content
  title?: string | null;
  text?: string | null;            // → normalized_text pipeline
  event?: unknown;
  location?: string | null;
  image_url?: string | null;
  // source / provenance hints
  source_url?: string | null;
  source_key?: string | null;      // raw_json.source
  platform?: string | null;
  // tenancy
  client_id?: string | null;       // validated upstream; profile re-checks linkage
  tenant_id?: string | null;
  tenant_broadcast?: unknown;       // #256 contract
  // control flags (external/crawled)
  skip_relevance_gate?: boolean;
  fallback_category?: string | null;
  fallback_severity?: string | null;
  is_test?: boolean;
  // carrier
  raw_json?: Record<string, unknown> | null;
  // mode-specific provenance (optional; read only by their profiles)
  contributing_signal_ids?: string[];   // synthetic
  asserted_by?: string | null;          // asserted/document
  source_artifact_id?: string | null;   // asserted/document, external/supplied
  supplied_by?: string | null;          // external/supplied
  extraction_anchor?: string | null;    // external/supplied
}
```
For external/crawled, this is exactly the fields `ingest-signal` already extracts from its zod-validated body — **no new inputs**, so the caller is unchanged in what it must provide.

## 4. Classification shape (recap)
```ts
type Classification =
  | { mode: 'external'; acquisition: 'crawled' | 'supplied' }
  | { mode: 'asserted'; subtype: 'document' }
  | { mode: 'synthetic' };
```
Phase B implements **only** `{external, crawled}` behavior; other profiles are declared but throw `NOT_IMPLEMENTED` until their slices land (they have no callers yet).

## 5. Return contract (must reproduce every current `ingest-signal` response)
```ts
type Outcome = 'admitted' | 'rejected' | 'deduplicated' | 'updated';
interface AdmissionResult {
  outcome: Outcome;
  signal_id?: string;            // admitted
  existing_signal_id?: string;   // deduplicated / updated
  reason?: string;               // rejected/deduplicated reason code (current strings preserved)
  detail?: string;               // human message (current strings preserved)
  httpStatusHint: number;        // 200 | 400 (preserves today's status per branch)
  payloadShape: 'rejected' | 'deduplicated' | 'accepted'; // selects the exact JSON envelope
  dgic?: unknown;                // null in Phase B
}
```
**Behavior-equivalence rule:** `ingest-signal` maps `AdmissionResult` → the **same JSON body + HTTP status** it returns today, per branch. The mapping is a lookup table covering every current branch:

| Current ingest-signal branch | reason | httpStatusHint | payloadShape |
|---|---|---|---|
| #256 missing client_id | `missing_client_id` | 400 | rejected |
| tenant_broadcast not impl | `broadcast_not_implemented` | 400 | rejected |
| F-034.1 null url | `null_source_url` | 200 | rejected |
| F-034.2 aggregator | `aggregator_url_not_canonical` | 200 | rejected |
| F-034.3 fragment title | `paragraph_fragment_title` | 200 | rejected |
| F-034.8 stale CVE | `stale_advisory` | 200 | rejected |
| F-034.9 null-result | `null_result_signal` | 200 | rejected |
| FP filter | `false_positive` | 200 | rejected |
| test filter | (test) | 200 | rejected |
| unknown-category | `uncategorizable` | 200 | rejected |
| CVE/url/title dedup | `deduplicated` (+existing_signal_id) | 200 | deduplicated |
| near-dup exact/≥0.8 | `deduplicated` | 200 | deduplicated |
| near-dup 0.5–0.8 → signal_update | `updated` | 200 | deduplicated |
| relevance gate reject | `ai_relevance_gate` (+score) | 200 | rejected |
| accepted insert | — (+signal_id) | 200 | accepted |

(The exact field names/messages are copied verbatim from current code so callers see no diff.)

## 6. Telemetry contract (preserve exactly)
The controller emits the **same** telemetry as today so dashboards/watchdog are unaffected:
- classifier AI call → `function_telemetry` `function_name='ingest-signal'` (via `callAiGatewayJson`, unchanged).
- relevance gate AI call → `function_name='ingest-signal-relevance-gate'` (unchanged).
- #256 contract reject → `recordTelemetry(status:'error', errorMessage:'contract_rejected:missing_client_id', context.rejection_reason)` (unchanged).
- classifier failure → DLQ (`dlqOnFailure`) unchanged.
- `filtered_signals` + `rejected_content_hashes` writes on relevance reject (unchanged).
- **Additive only:** an optional `context.admission_mode` may be attached to existing rows. **No row is removed, renamed, or re-timed.** (DGIC latency context is a *future* phase, not Phase B.)

## 7. Error / fail-closed seam (defined now, inert in Phase B)
- **Phase B behavior = today's behavior exactly:** relevance-gate error already fails **closed** (rejects) — preserved. Classifier failure → DLQ + fallback/unknown path — preserved. No new fail-closed.
- **Seam for future phases:** a `dgicStage(candidate, profile)` hook is declared in the pipeline *after* relevance, *before* insert, returning `{status, findings}`. In Phase B it is a **no-op pass-through** (returns nothing, admits). Future P1 = audit-only (stamp, still admit). Future enforcement = on `sub_grade`/evaluator-error → quarantine/fail-closed. Declaring the seam now means later phases insert at one well-defined point, not by re-threading the controller.

## 8. `ingest-signal` → controller mapping (refactor, not rewrite)
| Current code (approx) | Destination |
|---|---|
| HTTP/CORS/auth, zod validate | stays in `ingest-signal` |
| `#256` client_id/broadcast contract (~287) | controller `external.preGates` (same 400s) |
| F-034.1/.2/.3/.8/.9 + FP + test (~361–502) | controller `external.preGates` |
| classifier + fallback + unknown-reject (~827–982) | controller `external.classify` |
| content_hash/CVE/url/title/near-dup + signal_updates (~1024–1300) | controller `external.dedup` |
| AI relevance gate + filtered_signals + rejected_hashes (~1405–1631) | controller `external.relevanceGate` |
| final `signals` insert | controller `insert` |
| response JSON building | stays in `ingest-signal` (maps `AdmissionResult`) |

The moved code is **lifted verbatim** into profile stages (same queries, same order, same constants) — extraction, not redesign.

## 9. Test plan — proving inertness (the deliverable's crux)
**A. Characterization (golden) tests — pre-extraction baseline.** Build a fixture corpus exercising every §5 branch (one input per reject reason, each dedup layer, relevance accept/reject, a clean accept, skip_relevance_gate, fallback path, qa_test). Capture current `ingest-signal` outputs as goldens: HTTP status + JSON body + the resulting `signals` row (or absence) + `filtered_signals`/`rejected_content_hashes`/`signal_updates` writes + `function_telemetry` rows. Extend the existing `scripts/check-ingest-signal-contract.mjs`.

**B. Differential / shadow test.** On staging, run both implementations over the same corpus (old `ingest-signal` vs new `admitSignal(external/crawled)`); assert **byte-identical** HTTP bodies + identical DB side-effects + identical telemetry rows. Any diff = a behavior change = blocker.

**C. Realistic-load inertness (staging).** Deploy the refactor to staging; run `monitor-news-google` against the load fixture across ≥2 cursor-resume cycles; compare to a pre-refactor baseline window: admitted count, `quality_status` distribution, `filtered_signals` reason histogram, dedup rates, `ingest-signal`/`-relevance-gate` telemetry counts, and the monitor's `duration_ms`/budget criteria (must be unchanged — no added latency).

**D. Contract assertions.** `scripts/check-ingest-signal-contract.mjs` green (existing P0.1 contract tests). Add per-branch assertions for the §5 table.

**E. Negative/edge parity.** Malformed payloads, missing client_id, oversized text, non-UTF8, duplicate floods, gate-timeout (fail-closed) — old and new must reject/handle identically.

**Pass bar:** A–E all green ⇒ external/crawled is behavior-equivalent ⇒ extraction is inert ⇒ safe to route other modes onto the controller.

## 10. Non-goals (explicitly out of Phase B)
- No DGIC evaluation/stamp (the `dgicStage` is a no-op).
- No schema columns, no `quality_status` change, no operator-visibility change.
- No DB trigger.
- No other-mode behavior (synthetic/asserted/supplied profiles throw `NOT_IMPLEMENTED`; they have no callers yet).
- No tuning of thresholds/gates — verbatim lift only.

## 11. Open items
1. **Module home:** `_shared/admission/controller.ts` + `_shared/admission/profiles/external-crawled.ts` (the lifted body) — confirm placement.
2. **Caller-scope semantics:** confirm `ctx.caller` faithfully carries the current `caller.kind` used by `#256` telemetry + accessible-client checks.
3. **Log-line preservation:** current `console.log`/`warn` lines (F-034.x, dedup, gate) are operational signals — preserve verbatim via `ctx.logger` (some ops/alerting may grep them).
4. **Shadow-test write isolation:** running old+new in parallel must not double-insert in shared envs — run the new path in a dry-run/`returning`-rollback mode for the differential test, or against an isolated staging dataset.
