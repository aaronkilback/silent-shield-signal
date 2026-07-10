# Frontend Release Record — 2026-07-10 (controlled unfreeze)

**Type:** Controlled Worker release (not hotfix). WO-PRR gate was deliberate; this release runs one governed pass, not a lane change.

**Target Worker:** `silent-shield-signal` on `fortress.silentshieldsecurity.com/*` (prod), preceded by `silent-shield-signal-staging` on `aegis-staging.silentshieldsecurity.com/*`.

**Baseline (currently live on prod):**
- Worker version: `8693a651-0374-4d7a-9a19-8c16a80d28a8`
- Deployed: `2026-07-08T17:08:41.077Z`
- Bundle: `assets/main-Dux10mCG.js` (706,038 bytes)

**Release SHA:** `origin/main` HEAD — `7e4ed751a43e1495d459da3c8250f158fb6818e4` (2026-07-10 06:51:37 -0700)

**Elevation note (WO-PRR):** the frozen-lane flag from 2026-07-05 (WORK-ORDERS.md §"WO-PRR evidence") predicted exactly this failure — five merged frontend guards protected nobody for ~54 hours. Rule-3 browser check on 2026-07-10 surfaced it. This release does not resolve WO-PRR — it demonstrates the cost and produces the governed template. Lane-shape decision (preflight + manual gate + deploy step, or scheduled releases) folds into WO-PRR rather than being decided here.

## What ships (frontend-affecting commits merged after 2026-07-08T17:08:41Z)

Enumerated via `git log --format='%h %ai %s' origin/main --since='2026-07-08T17:08:41Z' -- 'src/**' 'public/**' 'index.html' 'package.json' 'package-lock.json' 'vite.config.ts' 'wrangler.toml' 'tailwind.config.ts' 'tsconfig*.json' 'postcss.config.js'`. Five commits, four files.

| # | Commit     | Merged (local)      | PR   | Frontend files                            | Effect |
|---|------------|---------------------|------|-------------------------------------------|--------|
| 1 | `87de469a` | 2026-07-08 14:13    | #116 | `EnvironmentBadge.tsx`                    | Gate env-badge query on authenticated session |
| 2 | `fa71002a` | 2026-07-09 08:01    | #125 | `EnvironmentBadge.tsx`                    | Env-badge residual: stop caching anon-null as success (platform-admin-no-tenant) |
| 3 | `f32110dc` | 2026-07-09 10:21    | #127 | `EnvironmentBadge.tsx`                    | Env badge sourced from build-time `VITE_SUPABASE_URL` — no more DB read for badge state |
| 4 | `f20f3b48` | 2026-07-09 18:45    | #132 | `ArchivalDocumentUpload.tsx`, `UnifiedDocumentUpload.tsx` | Upload UIs require client selection (removes the `|| 'unassigned'` path fallback) |
| 5 | `b507a515` | 2026-07-09 19:19    | #135 | `DashboardAIAssistant.tsx`                | AI-chat upload path refuses when `!selectedClientId` (client-scope guard) |

Non-frontend files in `#132` and other commits (edge functions, watchdog) have shipped separately via `supabase functions deploy` and are already live in prod. This release ships **only** the frontend components listed above.

## What does NOT ship in this release (deliberate scope)

- Edge functions — already prod-live via CLI deploy this week per WO-DATA-INTEGRITY.
- `supabase/migrations/` — already prod-applied.
- Docs / config-only commits — not Worker-served.
- A/B (this addendum's own migration + edge-fn patch) — those ship separately, ahead of the Worker release, so their backstops are live regardless of when the Worker actually flips.

## Deploy plan (governed, one pass)

### 1. Staging Worker
- Push `origin/main` to the `staging` branch (fast-forward or reset — operator to confirm which).
- `deploy-frontend-staging.yml` triggers on push to `staging`, runs `wrangler-action deploy --env staging` (WORKS — this lane is live).
- Post-deploy: capture staging Worker version ID + bundle hash.

### 2. Operator rule-3 pass on staging (`aegis-staging.silentshieldsecurity.com`)
- Test A: upload without client selected → expect the "Select a client for the assistant before uploading documents" toast.
- Test B: ambiguous AEGIS org question → expect only the two real tenants (Silent Shield Ops, Critical Risk Team); no `_legacy_test_tenant_2026_03_12`.
- Test C: env badge smoke — confirm badge renders `STAGING` correctly on load, doesn't disappear on tenant-less state.

### 3. Prod Worker deploy (on staging GO)
```
# clean detached worktree at the exact release SHA
git worktree add /tmp/ss-frontend-release-7e4ed751 --detach 7e4ed751a43e1495d459da3c8250f158fb6818e4
cd /tmp/ss-frontend-release-7e4ed751
npm ci --no-audit --no-fund
npm run build
wrangler deploy   # deploys to prod worker silent-shield-signal
```
Capture:
- New Worker version ID (`wrangler deployments list --name silent-shield-signal | head`)
- New bundle filename (`curl -sL https://fortress.silentshieldsecurity.com/ | grep -oE 'assets/main-[A-Za-z0-9]+\.js'`)
- Grep the deployed bundle for these 4 strings — all were 0 before, expect nonzero after:
  - `"Select a client for the assistant before uploading documents"`
  - `"ai-chat-upload"`
  - `"tenants.is_test"` *(only if the B tenant-enum patch was included in the frontend bundle — but B is an edge-function fix, so this grep may correctly stay 0; treat as diagnostic-only)*
  - `"VITE_SUPABASE_URL"` *(env-badge build-time source, from #127)*

### 4. Operator rule-3 pass on prod (hard-refreshed browser)
Same three tests. Additionally repeat the exact scenario that produced dab4a5fb / 75fd5b9e — upload with no client selected — and confirm the toast fires (frontend guard). If it doesn't (browser cache), the DB trigger from A backstops it and rejects the write with `check_violation`.

### 5. Ledger this release
Append the release record + verification evidence to `ops/ledger/WORK-ORDERS.md` as an addendum to WO-DATA-INTEGRITY and a WO-PRR evidence entry (cost-line demonstration).

## Rollback

- Prod Worker: `wrangler rollback --name silent-shield-signal --version-id 8693a651-0374-4d7a-9a19-8c16a80d28a8` (reverts to the current live).
- Staging Worker: same command with `--name silent-shield-signal-staging` and staging's prior version ID (capture during staging deploy).

## Related

- Backing addendum: `A` (DB trigger `enforce_ai_chat_archival_client_scope`), `B` (`dashboard-ai-assistant/index.ts:10367-10370` tenant-enum `is_test` patch), `C` (fixture disposition of dab4a5fb + 75fd5b9e), `D` (rule-3 doctrine to STANDING_RULES.md), `E` (ledger addendum + branch swap).
- WO-PRR: `ops/ledger/WORK-ORDERS.md` §"WO-PRR — Production Reality Reconciliation" (2026-07-05 onward). This release is a cost-line datapoint, not a lane fix.
- Memory: `reference_fortress_frontend_worker_deploy.md` (durable Worker-vs-Pages reference).
