# Staging vs Production — Test Environment Plan

**Status:** PROPOSED. Operator-led setup required (Supabase project creation, Cloudflare config, DNS).

## Why this is needed

Today every code change goes directly to production:
- `deploy-functions.yml` deploys to project `kpuqukppbmwebiptqmog` (production)
- `deploy-frontend.yml` deploys to the single Cloudflare worker bound to `aegis.silentshieldsecurity.com`
- There is no environment where the operator can verify an RLS change, a schema migration, or an AI prompt edit before live users see it
- The single biggest stabilization-plan items (F-001 AI gate consolidation, F-007 RLS rewrite, F-008 schema migration) are MUCH less risky if rehearsed in staging first

## Target architecture

```
                                    ┌─────────────────────────────┐
                                    │ aegis.silentshieldsecurity  │
                       ┌───push─────│ .com (production frontend)  │
                       │            └──────┬──────────────────────┘
                       │                   │
                       │                   │ talks to
                       │                   ▼
                       │            ┌─────────────────────────────┐
                       │            │ Supabase: kpuqukppbmwebipt… │
GitHub  ─┬─push main ──┤            │ (PRODUCTION — current proj) │
         │             │            └─────────────────────────────┘
         │             │
         │             └──push────► ┌─────────────────────────────┐
         │                          │ aegis-staging.silentshield… │
         └─push staging branch ────►│ .com (staging frontend)     │
                                    └──────┬──────────────────────┘
                                           │
                                           │ talks to
                                           ▼
                                    ┌─────────────────────────────┐
                                    │ Supabase: NEW (fortress-stg)│
                                    │ separate project, separate  │
                                    │ vault, separate cron        │
                                    └─────────────────────────────┘
```

Branch model:
- `main` → production (current)
- `staging` → staging environment (new)
- Feature branches → either merge to `staging` for rehearsal, OR PR straight to `main` for trivial changes

## Concrete setup steps

### Step 1 — Create the staging Supabase project (operator only)

I cannot do this via MCP — billing-tied operation. Aaron's manual steps:

1. **Supabase dashboard → New Project**
   - Name: `fortress-staging`
   - Region: `us-west-2` (same as production for parity)
   - Postgres version: `17.6` (match production exactly)
   - Pricing tier: Pro (matches production; ensures backup capability for test)
2. **Note the new `project_ref`** (will be a different ID — call it `<STAGING_REF>`).
3. **Apply all production migrations to staging:**
   - From `supabase/migrations/` — apply every `.sql` file in chronological order
   - Easiest path: use `supabase db push --project-ref <STAGING_REF>` from a clean checkout of main
4. **Seed minimal test data:**
   - 1-2 test clients (`_staging_petronas`, `_staging_bcch`)
   - 1-2 test users with each role (`super_admin`, `admin`, `analyst`, `viewer`)
   - Skip historical signals — staging starts clean each test cycle

### Step 2 — Copy secrets to staging vault

Each LLM provider key, plus Twitter bearer, NAAD API key, etc. needs to land in the staging vault.

**Decision needed:** use the SAME keys as production, or separate staging-tier keys?
- Same keys: lower setup cost, but staging traffic counts against production quotas/budgets.
- Separate keys: higher hygiene (staging blow-up doesn't affect production billing) but operator manages 2x as many keys.

**Recommendation:** separate keys for the high-cost ones (OPENAI_API_KEY, ANTHROPIC_API_KEY). Shared for the low-volume ones (NAAD, Twitter — they're rate-limited regardless of which side calls them).

### Step 3 — Cron schedules in staging

Decision: should staging run the full monitor cron suite, or be on-demand only?

**Recommended: on-demand staging.**
- Disable all crons in staging by default (`cron.unschedule(jobname)` for every monitor-* and learning-loop cron after migration).
- Operator manually triggers specific functions via `supabase functions invoke --project-ref <STAGING_REF>` when testing.
- Avoids:
  - Burning LLM budget on staging-data noise
  - Staging crons hitting upstream sources twice (rate limits)
  - Staging cron heartbeats polluting Monitor Health

If a specific test needs cron-driven flow, the operator manually `cron.schedule()` only the relevant jobs for the duration of the test.

### Step 4 — DNS + Cloudflare config

1. **Cloudflare dashboard → Workers** → Create new worker `fortress-staging`
2. **wrangler.toml updates:**
   ```toml
   [env.staging]
   name = "fortress-staging"
   route = "aegis-staging.silentshieldsecurity.com/*"
   [env.staging.vars]
   VITE_SUPABASE_URL = "https://<STAGING_REF>.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY = "<staging-publishable-key>"
   ```
3. **DNS** (registrar dashboard):
   - Add CNAME `aegis-staging.silentshieldsecurity.com` → cloudflare worker
4. **TLS:** Cloudflare auto-provisions via universal SSL.

### Step 5 — Workflow changes

**`.github/workflows/deploy-functions-staging.yml`** (new file):
```yaml
on:
  push:
    branches: [staging]
    paths:
      - 'supabase/functions/**'
      - 'supabase/config.toml'
env:
  PROJECT_REF: <STAGING_REF>
  SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
# … same deploy steps as production but targeting staging project
```

**`.github/workflows/deploy-frontend-staging.yml`** — analogous for Cloudflare.

**Promotion workflow:** No automation initially. Operator-led "merge staging → main" PRs, with the benchmark CI from F-012 acting as the gate.

### Step 6 — Updated F-012 benchmark CI

The benchmark CI introduced today targets the production project. Update so that:
- Pushes to `staging` branch → benchmark runs against staging project, results stored in staging DB
- Pushes to `main` → benchmark runs against production (current behavior)

This means the same workflow file picks the project based on the branch.

## Operating model — what changes day-to-day

| Change type | Workflow |
|---|---|
| Trivial bug fix, UI tweak | PR → `main` directly. Production-only deploy. |
| Edge function with AI behavior change | PR → `staging`, verify in staging, then PR `staging → main` |
| RLS / schema migration | MUST go through staging. Verify with test users. Then PR to main. |
| Agent prompt change | PR → `staging`, run benchmark in staging, compare against production benchmark. Promote only if no regression. |
| New monitor function | Same as agent prompts — staging first. |

## Promotion checklist (`staging → main`)

Operator runs through before merging:
- [ ] Last 3 staging benchmark runs all show stable or improving accuracy
- [ ] No new `severity='critical'` `platform_findings` rows in staging in last 24h
- [ ] Test user in staging tenant A confirmed isolated from tenant B (after F-007 lands)
- [ ] If schema migration: forward + rollback tested in staging
- [ ] If agent change: spot-checked 3 signal_agent_analyses outputs in staging — quality matches production baseline

## What this plan does NOT solve

- **Data drift between staging and production.** Staging starts clean; production has months of real signals. Some bugs only manifest with realistic data volumes. Mitigation: periodic anonymized data sync from production → staging (separate doc, not yet built).
- **External API rate limits.** Twitter/Google CSE quotas are per-project but ALSO per-IP and per-account. Staging may share quota with production at the upstream layer.
- **Cost.** Staging Supabase project is ~$25-$599/mo depending on tier. Acceptable for the audit-fix risk reduction it enables.
- **`aegis.silentshieldsecurity.com` frontend stability work.** That's a separate plan post-CRT-demo.

## Estimated effort

| Step | Owner | Effort |
|---|---|---|
| Create Supabase staging project + migrations | Operator (Aaron) | 2-3 hours |
| Copy/separate vault secrets | Operator | 1-2 hours |
| Disable cron schedules in staging | Operator (or via SQL I can write) | 30 min |
| Cloudflare worker + DNS + TLS | Operator | 1-2 hours |
| Workflow files (deploy-{functions,frontend}-staging.yml) | Claude | 2 hours |
| F-012 update to be branch-aware | Claude | 1 hour |
| Test user provisioning | Operator | 30 min |
| **Total** | | **~1 working day** |

**Recommended timing:** After CRT demo, before Phase 0 of the stabilization plan starts. Staging exists to derisk every Phase 0-4 fix that follows.
