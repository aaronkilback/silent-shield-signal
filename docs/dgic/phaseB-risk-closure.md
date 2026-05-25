# Phase B — Implementation Risk Closure Note

**Status:** risk closure for build authorization. No implementation. No mutations.

---

## Risk 1 — Feature-flag rollback truth → **RESOLVED: env flag REJECTED for rollback; use DB-backed runtime flag**

**Finding (not assumed — investigated):** Supabase Edge secrets/env are read via `Deno.env.get()`, but the *value* is the environment present **at isolate boot**. Docs do **not** guarantee that updating a secret propagates to **already-warm isolates** without a redeploy/recycle — and Supabase now keeps isolates warm longer (persistent storage / faster cold starts), which makes a stale-env window *more* likely, not less. The "instant env-flip rollback, no redeploy" claim is therefore **unproven** → per your directive, we do not rely on it.

**Resolution:**
- **Primary rollback = DB-backed runtime flag.** A row (e.g., `dgic_config.key='admission_controller_enabled'`) read **fresh per invocation** (one cheap indexed `select`, **not** cached — the flag is the one value we deliberately don't cache) by `ingest-signal`. Flipping the row takes effect on the **next invocation**, no redeploy, no isolate-recycle dependency → genuinely runtime-switchable.
- **Secondary rollback = redeploy** of the prior `ingest-signal` (guaranteed; additive `_shared/admission/*` files are inert without a caller).
- Env vars are **not** used for the cutover decision.
- Trade-off acknowledged: a per-invocation flag read adds one tiny query; acceptable (ingest-signal already does many DB ops) and the flag read is itself wrapped fail-safe (read error → default to **legacy**, the authoritative path).

---

## Risk 2 — Verbatim parity doctrine → **RESOLVED: byte-parity bar + nondeterminism allowlist + cutover rule**

**Doctrine (binding):** the **legacy path is authoritative and default** until parity is *proven*. The controller becomes default for external/crawled **only after** the parity harness is green across the full corpus **and** realistic load. No "functionally equivalent" drift is accepted.

**Parity bar — must be IDENTICAL:**
- **HTTP response:** byte-identical body + status code, per branch.
- **DB side-effects:** same tables, same column value-sets, same row counts (admission-core writes only — see Risk 3 boundary).
- **Telemetry side-effects:** identical `function_telemetry` rows — same `function_name` (`ingest-signal`, `ingest-signal-relevance-gate`), `status`, `error_class`, `error_message`, and `context` keys.
- **Log semantics:** identical `console.log/warn` lines, same content, same order.

**Permitted nondeterminism allowlist (the ONLY fields that may differ; everything else is byte-compared):**
- generated `uuid`s (signal id, row ids),
- `now()`/timestamp fields + `duration_ms`/latency,
- AI-call *latency* (not content — content is replayed/stubbed in the harness),
- ordering only where the DB does not guarantee it (must be explicitly justified per case).

The harness normalizes **only** these, then byte-compares. Any other diff = blocker; legacy stays default.

---

## Risk 3 — Full side-effect inventory → **RESOLVED (with a boundary decision)**

**Boundary decision (needs your confirm):** set the **controller boundary at the `signals` insert (line 1814).** The admission *decision + insert* moves into `admitSignal`; the **post-insert orchestration tail stays in `ingest-signal` verbatim, unmoved.** This (a) keeps the controller scoped to the admission contract, (b) shrinks the dry-run/parity surface to the admission core, and (c) leaves the high-side-effect tail (alerts, webhooks, queue, incident creation) **out of dry-run** because it is unchanged code that only runs on the live accept path. Consequence: post-insert orchestration becomes **mode-specific** (external/crawled keeps its tail; synthetic/asserted define their own minimal post-processing later) — which is desirable.

### A. Admission core — IN controller scope, IN dry-run (must simulate or capture)
| Side effect | line | target | stage | dry-run treatment |
|---|---|---|---|---|
| website `fetch(url)` | 557 | external GET | preGates (F-034) | **simulate** (replay recorded response) |
| `recordTelemetry` (#256 reject) | 292 | function_telemetry | preGates | **capture intent** (no write) |
| classifier `callAiGatewayJson` | 827 | OpenAI + function_telemetry(`ingest-signal`) | classify | **simulate** (replay) + capture telemetry intent |
| classifier DLQ (`dlqOnFailure`) | 882 | dead_letter_queue | classify | **capture intent** (fires only on classifier failure) |
| `invoke('detect-duplicates')` | 1142 | edge fn (read) | dedup | **simulate** (replay) |
| `signal_updates` insert | 1252 | signal_updates | dedup (near-dup 0.5–0.8) | **capture intent** |
| `rejected_content_hashes` upsert | 1272 | rejected_content_hashes | dedup reject | **capture intent** |
| relevance `callAiGatewayJson` | 1474 | OpenAI + function_telemetry(`ingest-signal-relevance-gate`) | relevanceGate | **simulate** (replay) + capture telemetry intent |
| `filtered_signals` insert | 1593 | filtered_signals | relevance reject | **capture intent** |
| `rejected_content_hashes` insert | 1611 | rejected_content_hashes | relevance reject | **capture intent** |
| `filtered_signals` insert | 1648 | filtered_signals | relevance fail-closed | **capture intent** |
| **`signals` insert** | 1814 | signals | accept | **capture intent** (the proposed row) |

Reads in-core (no write, but mock for determinism): `clients`(206/759/1425), `sources`(673), `feedback_events`(781), `signals` dedup reads (794/1071/1097/1121), `signal_updates`(1246), `learning_profiles`(1436), `source_credibility_scores`(1575), `rejected_content_hashes`(1040).

### B. Post-insert orchestration tail — OUT of controller (stays in `ingest-signal`, unmoved, NOT dry-run)
`x_quota_consumption`(1878) · OpenAI embeddings `fetch`(1938)+`signals` embedding update(1946) · `duplicate_detections`(1997) · `expert_knowledge` read(2050)+`signals` expert_context update(2103) · `incidents`(2175/2182/2375/2412/2419) · `alerts`(2210) · invokes: `ai-decision-engine`(2156/2343), `webhook-dispatcher`(2164/2477), `alert-delivery`(2231)/`alert-delivery-secure`(2237), `correlate-signals`(2500) · `signals` update(2273) · **`rpc('enqueue_signal_processing')`(2555) — queue**.

**Why this split is safe:** the tail is **not moved** — it runs in the caller exactly as today on the accept path, so external/crawled behavior is preserved without dry-running alerts/webhooks/queues (which have real external effects and must never fire in a test). Parity for the tail = "unchanged code" (proven by diff of the caller, not by simulation).

### C. Dry-run completeness rule
Dry-run (`ctx.dryRun=true`) must, for the **12 admission-core effects in table A**, either **simulate** (replay recorded external responses) or **capture intent** (record the would-be write, execute nothing). A build checklist asserts all 12 are intercepted — a write reaching the DB in dry-run is a harness defect and a build blocker.

---

## Decisions needed before build authorization
1. **Confirm the controller boundary at the `signals` insert** (post-insert tail stays in `ingest-signal`) — the basis for tractable parity + safe dry-run.
2. **Confirm DB-backed runtime flag** (`dgic_config.admission_controller_enabled`, read fresh per invocation, fail-safe to legacy) as primary rollback; redeploy secondary.
3. **Confirm the nondeterminism allowlist** (uuids, timestamps/duration, AI latency) as the only permitted diffs under the byte-parity bar.

---

## Sources (Risk 1 verification)
- [Edge Functions | Supabase Docs](https://supabase.com/docs/guides/functions)
- [Environment Variables / Secrets | Supabase Docs](https://supabase.com/docs/guides/functions/secrets)
- [Inspecting edge function environment variables | Supabase Docs](https://supabase.com/docs/guides/troubleshooting/inspecting-edge-function-environment-variables-wg5qOQ)
- [Persistent Storage and 97% Faster Cold Starts for Edge Functions | Supabase Blog](https://supabase.com/blog/persistent-storage-for-faster-edge-functions)
