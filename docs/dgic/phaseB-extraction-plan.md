# Phase B — Concrete Extraction Plan (implementation review)

**Status:** PLAN for review. **No implementation. No deploy. No mutations.**
**Invariant:** external/crawled behavior is byte-equivalent to today's `ingest-signal`. Verbatim lift; no redesign, no log/telemetry renames (open-items #2/#3), no live double-inserts (#4).

---

## 1. File changes

**New (additive — zero existing callers until `ingest-signal` opts in):**
- `_shared/admission/types.ts` — `Classification`, `SignalCandidate`, `AdmissionContext`, `AdmissionResult`, `Outcome`, internal `WorkingSignal`, `StageResult`.
- `_shared/admission/controller.ts` — `admitSignal(candidate, classification, ctx)`: `profileFor()` dispatch, the ordered pipeline runner, the no-op `dgicStage`, the final `insert` + telemetry, `dryRun` handling.
- `_shared/admission/profiles/external-crawled.ts` — the **verbatim-lifted** external stages: `preGates`, `classify`, `dedup`, `relevanceGate`.

**Modified:**
- `supabase/functions/ingest-signal/index.ts` — keep HTTP/CORS/auth/zod-validate/candidate-build; gate the admission body behind a flag (§6); add `mapResultToResponse()` (the §5 lookup from the architecture doc → exact current JSON/status).

**Unchanged (imported as-is by the profile):** `_shared/ai-gateway.ts` (`callAiGatewayJson`), `signal-relevance-scorer.ts` (`isTestContent`, `scoreSignalRelevance`), `_shared/heartbeat.ts`, telemetry/`recordTelemetry`, `signal-query-filters.ts`, etc.

---

## 2. Internal pipeline contracts
```ts
// WorkingSignal = candidate + the derived locals today's inline code threads between blocks,
// so the data flow is preserved exactly (no recomputation, no reordering).
interface WorkingSignal {
  candidate: SignalCandidate;
  effectiveUrl?: string | null; effectiveTitle?: string | null; signalText?: string;
  classification?: any;            // classifier output (category, severity, confidence, normalized_text, ...)
  contentHash?: string;
  gate?: { score: number; reason: string; primary_connection: string };
  signalRow?: Record<string, unknown>;  // the insert payload, assembled verbatim
}
type StageResult = { kind: 'continue' } | { kind: 'terminal'; result: AdmissionResult };
type Stage = (w: WorkingSignal, ctx: AdmissionContext) => Promise<StageResult>;
```
Controller runs stages in order; first `terminal` short-circuits and is returned (mapping preserved). This mirrors today's early-`return new Response(...)` control flow one-for-one.

---

## 3. Moved-code mapping (verbatim lift, region → stage)
| Current `ingest-signal/index.ts` (approx) | Destination |
|---|---|
| `#256` client_id / tenant_broadcast contract `~287–315` (incl. its `recordTelemetry`) | `external.preGates` |
| F-034.1/.2/.3/.8/.9 `~361–465` + FP `~488` + test `~501` | `external.preGates` |
| classifier `callAiGatewayJson` `~827–884` + fields/fallback `~886–957` + unknown-reject `~959–982` | `external.classify` |
| content_hash `~1024–1028` + CVE-dedup `~1062` + url-dedup `~1092` + title-dedup `~1113` + near-dup + `signal_updates` `~1147–1300` | `external.dedup` |
| AI relevance gate `~1405–1631` (gate call, threshold, `filtered_signals`, `rejected_content_hashes`, fail-closed catch) | `external.relevanceGate` |
| final `signals` insert | `controller.insert` |
| each `return new Response(...)` | becomes `return {kind:'terminal', result:{...}}`; `ingest-signal` re-creates the identical Response via `mapResultToResponse` |
**Rule:** copy queries, ordering, constants (0.30 threshold, 0.8/0.5 near-dup bands, 80-char title window, 30-day url window), and **`console.log/warn` strings verbatim** (open-item #3). `ctx.caller` is passed in, never rebuilt (open-item #2).

---

## 4. The no-op `dgicStage` seam
```ts
// controller.ts — placed AFTER relevanceGate, BEFORE insert. Phase B: pass-through.
const dgicStage: Stage = async (_w, _ctx) => {
  // PHASE B: no-op. FUTURE P1: evaluate + stamp w.signalRow (audit-only, still admit).
  // FUTURE enforce: on sub_grade/evaluator-error → terminal quarantine/fail-closed.
  return { kind: 'continue' };
};
```
One declared insertion point so later phases never re-thread the controller.

---

## 5. `ingest-signal` after refactor (skeleton)
```ts
// ...HTTP/CORS/auth/zod validate (unchanged)...
const candidate = buildCandidate(validated);                 // same fields extracted today
const ctx = { supabase, caller, requestStartedAt, config, logger: console.log };
const useController = Deno.env.get('USE_ADMISSION_CONTROLLER') === 'true';   // §6 flag
const result = useController
  ? await admitSignal(candidate, { mode: 'external', acquisition: 'crawled' }, ctx)
  : await legacyAdmit(validated, ctx);                        // the current inline body, untouched
return mapResultToResponse(result);                           // identical JSON/status per §5 table
```

---

## 6. Feature-flag cutover (the rollback backbone)
- Keep the **current inline path intact** as `legacyAdmit` behind `USE_ADMISSION_CONTROLLER` (default **false**). Flag **false** = today's exact code runs (definitionally byte-identical). Flag **true** = new controller.
- This gives: (a) instant rollback by flipping the flag — **no redeploy**; (b) a direct A/B oracle for the differential test (same binary, two paths); (c) a controlled staging burn-in.
- After A–E tests pass + a staging burn-in window, **delete `legacyAdmit` + the flag** in a follow-up cleanup commit (removes the duplication).

---

## 7. Characterization test additions
- **Corpus** (`scripts/dgic/fixtures/admission-corpus.json`): one input per §5 branch — #256 missing-client, broadcast, F-034.1/.2/.3/.8/.9, FP, qa_test, unknown-category, CVE/url/title dedup, near-dup ≥0.8, near-dup 0.5–0.8 (→signal_update), relevance-reject, clean-accept, skip_relevance_gate, fallback path.
- **AI determinism:** record real `callAiGatewayJson` responses for the corpus once and **replay them** (a stubbed gateway in the harness) so goldens are stable and tests are cheap/offline. (Documented as test-only injection; prod unaffected.)
- **Goldens** (`scripts/dgic/goldens/`): for each input capture HTTP status + JSON body + resulting `signals` row (or absence) + `filtered_signals`/`rejected_content_hashes`/`signal_updates` writes + `function_telemetry` rows. Captured from the **legacy path** (flag off) on isolated fixture data, then cleaned up.
- Extend `scripts/check-ingest-signal-contract.mjs` to assert each branch's §5 row (reason/status/payloadShape).

---

## 8. Differential test strategy (NO live double-insert — open-item #4)
Primary — **dry-run proposed-effects (zero writes):**
- `ctx.dryRun=true` makes the controller execute reads (dedup lookups, classify/relevance with the **replayed** AI stub) but **NOT** the insert or the `filtered_signals`/`rejected_content_hashes`/`signal_updates` writes — instead it returns the **proposed** `AdmissionResult` + a `proposedEffects[]` list (what it *would* write).
- Differential assertion: `admitSignal(dryRun)` proposed result + proposedEffects ≡ the goldens (from §7). Byte-identical body, same status, same intended DB writes, same telemetry intent. Any diff = blocker.
- **No old+new live run against shared tables** — goldens come from a one-time legacy capture on isolated fixtures; the new path is dry-run only.

Backstop — **isolated staging fixture dataset:**
- A dedicated throwaway test client/tenant; run the controller live (flag on) over the corpus; assert side-effects match goldens; `TRUNCATE`/delete the fixture rows after. Never against prod-like shared data.

Realistic-load inertness (flag on, staging): `monitor-news-google` over the load fixture across ≥2 cursor cycles vs a flag-off baseline window — admitted count, `quality_status`, `filtered_signals` histogram, dedup rates, telemetry counts, `duration_ms`/budget all unchanged.

---

## 9. Rollback plan
1. **Primary:** set `USE_ADMISSION_CONTROLLER=false` (env flip, no redeploy) → instant return to legacy path.
2. **Secondary:** `git revert` the `ingest-signal` change; the additive `_shared/admission/*` files have no other caller → harmless if left.
3. **Data:** Phase B writes nothing new (no schema, no DGIC stamp, no new tables) → no data rollback needed.
4. **Trigger for rollback:** any differential diff, any realistic-load delta (admitted count / filtered histogram / telemetry / duration), or any operator-visible change.

---

## 10. Implementation sequence (each gated)
1. Build `_shared/admission/*` + flagged `ingest-signal` (legacy default-on, controller behind flag). Behavior-preserving by construction (flag off = old code).
2. Characterization goldens (§7) on staging isolated fixtures (flag off).
3. Differential dry-run (§8 primary) — assert ≡ goldens.
4. Flag on (staging) → isolated-fixture backstop + realistic-load inertness (§8).
5. Burn-in window (staging) flag-on; watch telemetry/duration parity.
6. STOP-for-review → prod enable (flag on) gated → burn-in.
7. Cleanup commit: delete `legacyAdmit` + flag once green.

---

## 11. Open / risks
- **AI nondeterminism in goldens** → handled by replay-stub; confirm the stub injection point in `callAiGatewayJson` is test-only (no prod path).
- **`dryRun` plumbing** must reach every write site in the lifted stages (insert + filtered_signals + rejected_content_hashes + signal_updates) — checklist these 4 write sites explicitly during build.
- **Hidden side-effects** in the lifted regions (e.g., embedding computation, image extraction) — inventory any I/O in the moved blocks so dry-run captures intent without executing writes.
- **Flag drift** — ensure staging/prod flag states are tracked; the cleanup commit removes the ambiguity.
