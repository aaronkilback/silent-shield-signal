# DIAG 2026-08-07 — benchmark staleness · source-discovery phantom · B-query result (report only)

## 1. Benchmark (`run-benchmark` / `benchmark_runs` / `benchmark_examples`) — stale-and-largely-meaningless
- **What it measures:** 39 labeled examples ingested against a sandbox client, pipeline actuals scored vs labels on decision (`signal_creation_accuracy`), `category_accuracy`, `severity_calibration`, `noise_suppression_rate`. Closest proxy to a client stress test.
- **The 39 (9 classes):** should-CREATE 20 — real_activism 8, real_cyber_on_stack 5, real_market_macro 4, real_wildfire 3; should-SUPPRESS 10 — noise_local_event 4, noise_off_stack_cyber 4, noise_unrelated 2; plus edge_case 4, llm_hallucination 5.
- **Why 40 days stale:** **NOT scheduled (0 cron).** CI-deploy-triggered (`triggered_by=ci_deploy:…`). All 8 runs cluster **2026-06-18 → 2026-06-28**, then nothing — the deploy hook that ran it silently stopped and nothing else invokes it. Same class as the week's theme (a producer whose trigger died unnoticed).
- **Run 9bfc2d7a = 2026-06-28 02:53** (label v1, pipeline_version null). Decision 0.5128 / category 0.4167 / severity 0.8333 / noise 0.5333.
- **Coin-flip baseline:** always-guess-"create" = **20/39 = 0.513**. The pipeline's decision score is **0.5128 = exactly 20/39** → it scores identically to saying "create" for everything. **Zero discriminative signal; a coin flip (~0.50) is statistically the same.** The decision metric is meaningless as-is — a real gap, not just staleness.
- **Before the changes? YES** — 2026-06-28 predates the 2026-08-02 born-quarantine + gate instrumentation (+ recent severity work). **The numbers describe a system that no longer exists.** **Caveat:** run-benchmark ingests via the **ingest-signal** path; the 86%-drop gate + born-quarantine are on the **RSS path** (`process-intelligence-document`) — different paths, so even a fresh run wouldn't directly reflect the RSS-path changes.
- **Verdict:** stale-and-largely-meaningless as a *current* measure. Before it can score a client stress test: (a) re-run against the current pipeline, (b) schedule it (or restore a live trigger — no-silent-trigger-death), (c) rebuild the decision metric (51% = chance).

## 2. `source-discovery-weekly` — 2nd never-run critical, but NOT a stub (secret drift)
- **Cron registered + active:** YES — `cron.job` jobid 227, `0 3 * * 0` (Sun 03:00 UTC), active. Registry entry present (weekly; `is_critical=false` — the "critical" on the board is from ever_succeeded=false, not the registry flag).
- **Name matches heartbeat:** YES — the fn calls `startHeartbeat('source-discovery-weekly')`, matching cron + registry. No name mismatch (unlike the resolve-agent-predictions phantom).
- **Ever executed:** **NO** — 0 heartbeats, `registry_phantom_check.ever_succeeded=false`.
- **503 stub?** **NO** — real 274-line `autonomous-source-discovery` (not contained; different from dr-storage-backup which IS a 503 stub).
- **Root cause = secret drift.** The fn gates on `requireInternalCaller(req)` (line 72) **before** `startHeartbeat` (line 81). The cron **does** send `x-fortress-internal` from `vault.decrypted_secrets['fortress_internal_secret']` — so the wiring is present. 0 heartbeats ⇒ the gate **rejects** the call ⇒ the vault value ≠ the fn's `FORTRESS_INTERNAL_SECRET` env (or the env is unset). It fired once (Sun 2026-08-02 03:00) and failed the gate. **This is exactly the WO-CHECK5-BURNDOWN "auto-source-discovery header-auth UNVERIFIED until first scheduled run" item — now confirmed FAILED.** Fix (not now): align edge-fn `FORTRESS_INTERNAL_SECRET` == `vault.fortress_internal_secret` (same env-vs-vault key-drift class as prior incidents). Config, not code.

## 3. B-query (Phase-2 `ingest_decisions` funnel) — RAN NOW; Phase 3 unblocked
The B-query is a **manual analysis** of `ingest_decisions` (not automated) — it hadn't been executed (we were on DR/token work); I ran it now. **Data collection DID happen: 5,208 decisions, 2026-08-02 19:39 → 2026-08-07 13:39** (72h+, forward-only).

| stage | passed | dropped (reason) |
|---|---|---|
| parse | 2,295 | 0 |
| **client_match** | **309 (13.5%)** | **1,982 `no_client_match` (86.4%)** + 4 `false_positive_content` |
| relevance_score (of 309) | 260 | 37 `below_threshold` + 12 `extraction_no_signals` |
| insert | 253 | 56 `not_inserted` |

**Headline: 86% of parsed RSS items are dropped at the keyword client-match gate, BEFORE scoring** (their `relevance_score` is NULL by construction). End-to-end 2,295 parsed → 253 signals = **11%**, the loss overwhelmingly at client_match. This confirms the Phase-2 finding at scale (n=5,208, not the 12-item A-sample) and quantifies exactly what Phase 3's matcher rebuild must fix. **Phase 3 is unblocked** — the collected data supports the matcher replacement + the RSS scoring/dispatch/severity requirements already recorded in WO-GATE-KEYWORD-PRESCORE-01.
