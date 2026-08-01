# WO-REGISTRY-PHANTOM-CLEANUP-01 — 30 cron_job_registry phantoms

**Logged:** 2026-08-01. **Class:** Registry-is-a-Promise hygiene. **Log only — do not build yet.**

## Finding (classified 2026-08-01)
`registry_phantom_check()` returns 30 phantoms in two shapes:

- **17 — NO live cron (de-register candidates):** monitor-canadian-sources, monitor-community-outreach, monitor-domains, monitor-earthquakes, monitor-emergency-google, monitor-entity-proximity, monitor-facebook, monitor-github, monitor-linkedin, monitor-pastebin, monitor-pastebin-6h, monitor-regional-apac, monitor-regulatory-changes, monitor-travel-risks, monitor-weather, monitor-wildfire-comprehensive, self-improvement-nightly. → registry rows for jobs with no `cron.job`; **de-register** (delete the row) with a backlog note per the standing rule.
- **13 — cron exists but NEVER succeeded (broken / never-completes):** expert-knowledge-sweep-weekly, ingest-world-knowledge-weekly, propagate-knowledge-edges-2h, retry-dead-letters-hourly, semantic-embed-knowledge-4h, stuck-document-recovery-15min, auto-archive-stale-entities, calibration-updater-12h, compute-signal-baselines-6h, knowledge-synthesizer-nightly, monitor-macro-indicators-6am, prediction-tracker-3h, source-credibility-updater-8h. → each needs a per-entry heartbeat check to split *true name-mismatch* (a differently-named heartbeat succeeds — the rule's exemplar was `resolve-agent-predictions` -nightly-vs-daily) from *genuinely broken* (fix or de-register).

## knowledge-synthesizer-nightly — phantom for a CORRECT reason, not the cutover
Its cron exists (`0 5 * * *`) and it writes heartbeats under its own correct name (so NOT a name-mismatch): **4× `skipped` (last 08-01 05:00) + 1× `failed` (07-29), 0 succeeded.** It **self-skips because the belief/learning stores it feeds are FROZEN under INC-LEARN-CONTAM** — there is nothing to synthesize while writes are frozen. This is correct, not broken: **it will stay phantom until the belief-freeze is lifted (WO-BELIEF-PROVENANCE-01), and should not be "fixed" before then.** It is unrelated to the WO-CUTOVER-KSYNTH-01 header-gating descope.

## Fix (design)
De-register the 17 no-cron rows (delete `cron_job_registry` rows + backlog note). Triage the 13 broken: fix or de-register each, EXCEPT knowledge-synthesizer-nightly which is correctly-phantom-until-unfreeze (annotate as expected, or register it against the belief-freeze in `containment_registry` so the phantom probe suppresses it as contained-by-design).
