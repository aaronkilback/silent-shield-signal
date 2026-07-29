# Backlog: registry-hygiene phantom sweep (~30 entries)

**Raised:** 2026-07-29 (health-monitor triage — the Registry-is-a-Promise probe surfaced far more than the 4 named phantoms).

## The finding

After handling the 4 named phantoms (community-outreach/threat-intel/twitter-6h de-registered; resolve-agent-predictions scheduled) and deleting legacy bare-name duplicates that had a suffixed cron variant, `registry_phantom_check()` still flags **~30 `cron_job_registry` entries** that violate the Registry-is-a-Promise standing rule:

- **~17 with no live cron** (registered, never scheduled): monitor-canadian-sources, monitor-community-outreach, monitor-domains, monitor-earthquakes, monitor-emergency-google, monitor-entity-proximity, monitor-facebook, monitor-github, monitor-linkedin, monitor-pastebin(-6h), monitor-regional-apac, monitor-regulatory-changes, monitor-travel-risks, monitor-weather, monitor-wildfire-comprehensive, self-improvement-nightly.
- **~13 with a cron but no successful heartbeat ever** (likely registry `job_name` ≠ heartbeat `job_name`, or genuinely never-completing): auto-archive-stale-entities, calibration-updater-12h, compute-signal-baselines-6h, expert-knowledge-sweep-weekly, ingest-world-knowledge-weekly, knowledge-synthesizer-nightly (known-frozen, heartbeats 'skipped'), monitor-macro-indicators-6am, prediction-tracker-3h, propagate-knowledge-edges-2h, retry-dead-letters-hourly, semantic-embed-knowledge-4h, source-credibility-updater-8h, stuck-document-recovery-15min.

## Triage per entry (not done here — needs a dedicated sweep)

For each: **retired** → de-register; **registry name ≠ heartbeat name** → align the names (like resolve-agent-predictions `-nightly`→`-daily`); **broken** → fix + verify one successful run; **known-exception** (e.g. knowledge-synthesizer heartbeats 'skipped' under the INC-LEARN-CONTAM freeze) → allowlist with rationale. The social monitors (facebook/linkedin/instagram) fold into the actor-list successor + the keyword-CSE deferral.

## Why deferred from this triage

Cleaning ~30 entries is a dedicated hygiene sweep (each needs a retired-vs-namemismatch-vs-broken judgment); doing it blind risks de-registering real jobs. The watchdog probe now aggregates them into ONE critical finding per run (attention-safe), so the debt is visible and tracked, not flooding. Standing rule + probe shipped; the sweep is the follow-up.
