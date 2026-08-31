# WO-TECH-RADAR-DECIDE — fix or remove tech-radar-scanner

**Status:** LOGGED (do not start). **Opened:** 2026-08-31 (WO-SONAR-CREDENTIAL ruling).

## The fact
`tech_radar_recommendations` has **0 rows, lifetime.** `tech-radar-scanner` has **never produced output.**
It is not degraded-by-dead-key (that would show pre-May rows then silence, like agent-knowledge-seeker) —
it has produced nothing at any point. On a dead Perplexity key it `continue`s past every category
(`if(!rawIntel) continue`), and evidently produced nothing even when the key was live.

## The decision
**Fix it, or remove it.** Under the standing rule that a feature is removed unless it earns its place
(`[[feedback_cleanup_method_rulings]]` — "does anything consume this?"), and given zero lifetime output +
zero consumers observed, **removal is the default.**

- If FIX: needs a real end-to-end run producing rows a consumer reads (`[[feedback_one_real_run_before_done]]`),
  and it is explicitly **excluded from the Perplexity renewal case** (do not fund on its account).
- If REMOVE: de-register cron (if any), drop the function + `tech_radar_recommendations` table via migration,
  update any UI reference.

## Explicitly NOT justifying the Perplexity renewal
Per ruling, tech-radar-scanner does **not** count toward the renewal. The renewal is justified by
agent-knowledge-seeker, monitor-travel-risks, query-expert-knowledge (and — pending operator placement —
ingest-expert-media at 750 lifetime rows).

## Do NOT (per ruling)
Not now. Log only.
