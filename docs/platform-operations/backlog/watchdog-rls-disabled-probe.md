# Backlog: Watchdog RLS-disabled probe

**Status:** Backlog (logged 2026-07-28, INC-RLS-EXPOSURE-2026-07-28 step 6). Not built today.

## Why
INC-RLS-EXPOSURE-2026-07-28: public tables shipped with RLS **disabled** and were anon-readable (real tenant/client data exposed). The watchdog did not catch it — it was a Supabase advisory. New tables can regress this at any time.

## Probe
Each watchdog run, query:
```sql
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false;
```
Any row (excluding the known exception `spatial_ref_sys`, PostGIS extension-owned) is a **CRITICAL** finding: a public table with RLS disabled. Alarm tier INTERRUPTION — this is a data-exposure risk.

Enhancement: also flag public tables with RLS **enabled but zero policies** AND a live anon/authenticated grant that isn't intentional deny-by-default (a subtler variant), and tables where the frontend reads directly but no policy exists.

## Related standing rule
Every new table ships with RLS enabled at creation (CLAUDE.md, 2026-07-28). This probe is the runtime backstop for when that rule is missed. Migration-template / CI enforcement is the preventive layer; the probe is detective.
