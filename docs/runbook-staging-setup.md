# Runbook — Staging Environment Setup

**Audience:** Operator (Aaron). Run once, post-demo.
**Estimated time:** 1–2 working hours.
**Outcome:** Working `aegis-staging.silentshieldsecurity.com` backed by a separate Supabase project.

---

## Pre-flight check

```bash
# Confirm you are on main and clean
cd ~/code/silent-shield-signal
git status                    # should be clean
git rev-parse HEAD             # note for migration apply step
```

Check that today's pre-demo commits landed:
- `195a1e5f` — workflow files + tier rec + planning docs
- `8d3d68cc` — heartbeat fixes

---

## Step 1 — Create the staging Supabase project

1. Open <https://supabase.com/dashboard/new/project>
2. **Organization:** same as `Fortress` (production)
3. **Name:** `fortress-staging`
4. **Region:** `US West (Oregon) — us-west-2` (must match production for parity)
5. **Pricing tier:** **Pro** (~$25/mo) — see `docs/staging-vs-prod.md` for reasoning
6. **Database password:** generate a strong one, save to 1Password
7. Click **Create new project**, wait ~2 min for provisioning

**Capture the project ref** — it appears in the URL: `https://supabase.com/dashboard/project/<STAGING_REF>`. You'll need this in Step 4.

---

## Step 2 — Apply all production migrations to staging

Easiest path from a clean working tree:

```bash
# Login to Supabase CLI if not already
supabase login

# Push all migrations to staging
supabase db push --project-ref <STAGING_REF>
```

This applies every file under `supabase/migrations/` in chronological order. Expect 50+ migrations to run. If any fail, fix forward — staging is the place to find migration-order bugs.

**Verify:** in Supabase dashboard → Tables — confirm core tables exist (`signals`, `incidents`, `ai_agents`, `clients`, `tenants`, `tenant_users`).

---

## Step 3 — Seed vault secrets

In the staging project dashboard → **Project Settings → Vault**, add:

**Required (block deploys without them):**
| Name | Value |
|---|---|
| `OPENAI_API_KEY` | Generate a NEW staging-only key in OpenAI dashboard — separate from prod |
| `ANTHROPIC_API_KEY` | NEW staging key |
| `GEMINI_API_KEY` | NEW staging key |
| `service_role_key` | Copy from staging dashboard → API → service_role |

**Optional / reuse production:**
| Name | Value |
|---|---|
| `TWITTER_BEARER_TOKEN` | Reuse prod (rate-limited at Twitter regardless) |
| `PERPLEXITY_API_KEY` | Reuse prod or new |
| `GOOGLE_API_KEY`, `GOOGLE_CSE_ENGINE_ID` | Reuse prod |

**Why separate OpenAI/Anthropic/Gemini keys:** if a staging test blows up token usage, it doesn't hit your production billing budget. Worth the 5 minutes to provision.

---

## Step 4 — Run the staging-setup SQL

In the staging project dashboard → **SQL Editor**, paste the contents of `scripts/staging-setup.sql` and run.

Final SELECT should return:
```
active_crons = 0
staging_clients = 2
env_marker = STAGING
```

If `active_crons` is not 0, re-run the DO block at the top.

---

## Step 5 — Add GitHub secrets

Repo → Settings → Secrets and variables → Actions → New repository secret. Add:

| Secret name | Value |
|---|---|
| `STAGING_PROJECT_REF` | The ref from Step 1 |
| `STAGING_VITE_SUPABASE_URL` | `https://<STAGING_REF>.supabase.co` |
| `STAGING_VITE_SUPABASE_PUBLISHABLE_KEY` | Staging dashboard → API → anon (publishable) key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging dashboard → API → service_role key |

The existing `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` are reused — they're scoped to your operator account, not per-project.

---

## Step 6 — Cloudflare DNS + Worker

1. Cloudflare dashboard → `silentshieldsecurity.com` zone → **DNS → Records**
2. **Add record:**
   - Type: `CNAME`
   - Name: `aegis-staging`
   - Target: `aegis.silentshieldsecurity.com` (or whatever production points at — Cloudflare routes based on the Worker route pattern, not the CNAME target as long as it's proxied)
   - Proxy status: **Proxied** (orange cloud)
   - TTL: Auto

3. **Worker creation happens automatically** on first `wrangler deploy --env staging`. No manual worker creation needed — the workflow handles it.

4. **Verify CNAME:** `dig aegis-staging.silentshieldsecurity.com` — should resolve via Cloudflare.

---

## Step 7 — Trigger first staging deploy

```bash
git checkout main
git checkout -b staging
git push -u origin staging
```

This:
- Creates the `staging` branch tracking `origin/staging`
- Triggers `deploy-functions-staging.yml` (deploys all changed functions to staging)
- Triggers `deploy-frontend-staging.yml` (builds + deploys Cloudflare worker)

**Watch the GitHub Actions tab.** First runs:
- Functions deploy: ~5-10 min (depending on changed function count)
- Frontend deploy: ~3-4 min
- Benchmark on staging: ~2-3 min (will establish baseline)

If either workflow fails, check the secret values from Step 5.

---

## Step 8 — Smoke test staging

1. Open <https://aegis-staging.silentshieldsecurity.com> in a browser
2. You should see the login page
3. Provision a test user in staging:
   - Supabase staging dashboard → Authentication → Users → Add user
   - Email: `staging-test@silentshieldsecurity.com`
   - Skip email verification
4. Log in. You should see an EMPTY dashboard (no signals — staging has no monitor runs)
5. Confirm by running in staging SQL Editor:
   ```sql
   SELECT environment FROM environment_marker WHERE id = 1;
   -- Should return 'STAGING'
   ```

---

## Step 9 — Document for the next operator

Add to `docs/runbook-staging-setup.md` (this file) any quirks you hit. Suggested:
- Actual staging project ref (for future reference)
- Time the setup took end-to-end
- Any migration-order bugs that surfaced

---

## What happens after setup

Day-to-day workflow becomes:

| Task | Branch flow |
|---|---|
| Trivial UI fix | PR → `main` directly |
| Edge function change with AI behavior impact | PR → `staging`, verify benchmark, then PR `staging → main` |
| RLS / schema migration | MUST go through staging first |
| Agent prompt edit | Through staging |

The `staging` branch is **disposable** — you can `git reset --hard main` it any time to reset staging to production parity. The Supabase staging project persists.

---

## Tearing down (if needed)

If staging needs to go away:
1. Supabase dashboard → fortress-staging project → Settings → Pause / Delete
2. Cloudflare → Workers → delete `silent-shield-signal-staging` worker
3. Remove DNS record `aegis-staging.silentshieldsecurity.com`
4. Remove the 4 GitHub staging secrets
5. Delete the `staging` branch: `git push origin --delete staging`

Total teardown: ~10 minutes. Reversible.
