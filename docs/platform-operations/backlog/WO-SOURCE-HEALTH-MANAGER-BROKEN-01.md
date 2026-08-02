# WO-SOURCE-HEALTH-MANAGER-BROKEN-01 — the source self-healer has never healed a source

**Logged:** 2026-08-02. **Status:** SCOPE — bug documented, fix HELD. **Priority:** MEDIUM (silent, long-standing; matters given the 173-source registry). Surfaced during WO-SOURCE-DISCOVERY-RELEVANCE-01.

## The bug
`autonomous-source-health-manager/index.ts`, bulk (cron) path, selects:
```ts
.from("sources").select("*").eq("source_type", "rss").eq("is_active", true)
```
**Neither column exists on `sources`.** The real columns are `type` (not `source_type`) and `status` (not `is_active`). The filter matches nothing / errors — `sourcesError` is logged but **not thrown**, so the function continues with an empty `sourcesToCheck` and heals **zero** sources. The autonomous "manager" is a no-op.

## How long it has been running broken
- **Introduced 2025-11-26** (commit `dc70bad4`); the broken `source_type`/`is_active` lines date from that **same first commit** — it has never worked. Only 2 commits ever touched the file; never fixed.
- **It IS scheduled:** `cron.job` = `source-health-manager-4h` (every 4 hours). ~2025-11-26 → 2026-08-02 ≈ **249 days × 6/day ≈ ~1,490 invocations, all bulk-mode no-ops.**

## Why it went unnoticed for ~8 months (doubly invisible)
1. **Writes no heartbeat** — it does not use `_shared/heartbeat.ts`, so there is **no `cron_heartbeat` row** under any `*source-health*` / `*health-manager*` name. The system-watchdog has nothing to see.
2. **Not in `cron_job_registry`** — `registry` lookup is null. So the Registry-is-a-Promise phantom probe has no entry to check either. A live cron with no registry entry and no heartbeat is invisible to both health layers. (It's the inverse of a phantom: *running* without a registered promise.)

## What it was supposed to do
Autonomous self-healing of RSS sources: find sources with recent failures (`monitoring_history` where `status='error'`, last 24h — that table **does** exist), test them, and with `auto_fix=true` (default) repair/reconfigure or disable persistently-failing sources. The **per-source** path (`source_id` provided → `.eq("id", source_id)`) uses valid columns and **works** — it is reached on-demand from `dashboard-ai-assistant` (line 5164) and referenced by `deployment-verification`. **Only the autonomous bulk path is dead.**

## Consequence
Given the ~173-source registry with a known tail of failing/stale sources, the platform has had **no working autonomous source remediation for ~8 months** — failing sources accumulate and are only fixed if an operator invokes the per-source path by hand. This connects directly to the source-health probe backlog (stale `last_ingested_at`) and to WO-SOURCE-DISCOVERY-RELEVANCE-01 (the discovery job adds sources; nothing autonomously prunes/heals the dead ones).

## Fix (when authorized — do not build)
1. `source_type`→`type`, `is_active=true`→`status='active'` in the bulk query (2-line fix).
2. Add `startHeartbeat`/`completeHeartbeat` (`_shared/heartbeat.ts`) under `source-health-manager-4h` so it becomes visible.
3. Add a `cron_job_registry` entry (Registry-is-a-Promise) so the watchdog tracks it.
4. Throw (or record a finding) on `sourcesError` instead of swallowing it — a self-healer that silently no-ops on its own query error is the exact failure that hid this.
5. Verify against the load fixture, then confirm ≥1 source actually healed (measurability-is-part-of-the-feature — do not close on a 200).
