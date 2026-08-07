# WO-BENCHMARK-REBUILD — the benchmark is not fit to score anything (SCOPE, do not build)

**Ruling 2026-08-07 (operator): BENCHMARK IS NOT FIT TO SCORE ANYTHING.** Evidence (DIAG-2026-08-07):
- **Decision `signal_creation_accuracy` = 0.5128 = exactly 20/39 = "always create."** Zero discriminative signal — a coin flip scores the same.
- **Last run 2026-06-28, trigger silently dead** (CI-deploy-hook, not scheduled; 0 cron).
- **Exercises the `ingest-signal` path while ~84% of volume flows through the RSS path** (`process-intelligence-document`) — it doesn't even measure the path that matters.

## Scope (build later, separate ruling — after Phase 3)
1. **Schedule it properly — cron in `cron_job_registry`, not a CI hook that can die silently.** A deploy hook is invisible to the watchdog (WO-OUTPUT-ASSERTION-MONITORING invisibility mode 1). Register the expectation; the produced-leg probe asserts it actually runs + writes a `benchmark_runs` row on cadence.
2. **It must exercise the RSS path.** Feed the 39 labeled examples through `process-intelligence-document` (RSS/url_feed ingest), not only `ingest-signal` — so it measures the client-match gate, composite scoring, dispatch, and the recalibrated severity that Phase 3 rebuilds. Ideally run it against **both** paths and report per-path, since both still exist, but the RSS path is the one carrying the volume.
3. **Rebuild the decision metric so majority-class guessing scores near zero, not 51%.** Raw accuracy is inflated by the base rate (20/39 create). Replace with a **chance-corrected** metric — **Matthews Correlation Coefficient (MCC)** or **Cohen's κ** (both ≈ 0 for majority-class/chance guessing; 1 = perfect), and/or **balanced accuracy** and **per-class recall** (edge_case, llm_hallucination broken out — they were 1/4 and 1/5). Report the confusion matrix, not a single inflated number.
4. **Re-run against the post-Phase-3 pipeline and report the delta** — old (2026-06-28, ingest-signal, raw accuracy) vs new (post-Phase-3, RSS path, chance-corrected). The delta is the evidence Phase 3 improved the thing a client is scored on.

## Corpus notes
39 examples, 9 classes: real_activism 8 · real_cyber_on_stack 5 · real_market_macro 4 · real_wildfire 3 (20 should-create) · noise_local_event 4 · noise_off_stack_cyber 4 · noise_unrelated 2 (10 should-suppress) · edge_case 4 · llm_hallucination 5. Consider expanding + refreshing labels (`label_version` v2) so the corpus reflects current client stacks; keep the held-out / `is_canary` quarantine discipline (WO-OUTPERFORM).

## GATE (operator ruling)
**WO-OUTPERFORM does not run until the benchmark is rebuilt and passing on the current pipeline.** No four-lane comparison goes in front of a client while the platform's own benchmark scores at chance. Sequence: Phase 3 shadow → cutover → benchmark rebuild (this WO) → benchmark passes on current pipeline → *then* WO-OUTPERFORM.
