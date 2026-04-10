# Fortress AI

## CI Status
All systems verified: 2026-03-14T23:36:39.341Z
Supabase keys updated and validated.

<!-- last-deploy: 2026-03-15T02:47:27.072Z -->

## Rules for edge functions

### Scheduled edge functions — definition of done

A scheduled edge function is NOT done until ALL of the following exist:

1. **Function deployed** — `supabase functions deploy <name>`
2. **pg_cron job exists** — migration with `cron.schedule(...)` pointing to the function URL
3. **Heartbeat name matches cron job name** — the `job_name` string written to `cron_heartbeat` inside the function MUST exactly match the first argument of `cron.schedule()`
4. **cron_job_registry entry exists** — INSERT into `public.cron_job_registry` with the same job name, `expected_interval_minutes`, description, and `is_critical`
5. **Validation passes** — run `node scripts/validate-cron-alignment.mjs` and confirm ✅ PASS

**Before creating any cron migration**, check for an existing cron schedule for that function:
```
grep -r "functions/v1/<function-name>" supabase/migrations/ --include="*.sql"
```
If one exists, do NOT create a duplicate — update or fix the existing one.

**Naming rule**: The pg_cron job name should be `<function-name>-<frequency>` (e.g., `monitor-rss-sources` if unique, or `agent-knowledge-seeker-4am` if time-of-day matters). Whatever name is chosen, it must match the `job_name` in the function's `cron_heartbeat` upsert exactly.

### Run the validation script after any cron-related change
```
node scripts/validate-cron-alignment.mjs
```
