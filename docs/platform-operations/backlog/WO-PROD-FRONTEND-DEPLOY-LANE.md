# WO-PROD-FRONTEND-DEPLOY-LANE — prod Fortress frontend has no CI deploy lane (SCOPE, do not fix)

**Structural finding (2026-08-07, operator-directed).** The production Fortress frontend
(`fortress.silentshieldsecurity.com`, worker `silent-shield-signal`) has **no CI deploy lane**. It
deploys **only** by manual `wrangler deploy` from a local machine under an **interactive OAuth
session** (`wrangler login`). `deploy-frontend.yml` is preflight-only/disabled (commits c8ef558f +
15a02a76, 2026-07-03). Staging is the only CI-deployed frontend (`deploy-frontend-staging.yml`).

## Why this is a real single point of failure (separate from the token work)
- **Prod deploy capability lives on a laptop.** Lose/replace the machine and prod frontend cannot be
  deployed until someone re-runs `wrangler login` and reconstructs the manual runbook from docs
  (`frontend-release-2026-07-10.md`, `prod-deploy-plan-2026-07-10-*.md`).
- **Large blast radius on that one machine.** The local credential is a broad wrangler **OAuth**
  session — `wrangler whoami` on the deploy machine shows near-full account write (workers,
  workers_kv, workers_routes, workers_scripts, pages, d1, queues, pipelines, ai, secrets_store,
  containers, cloudchamber, `connectivity (admin)`, …), not a scoped token. One machine holds
  effectively account-wide write.
- **The manual hazard has already fired:** INC-WRANGLER-MISFIRE-2026-07-13 (a manual wrangler
  misfire deleted the prod worker for ~10 min). Manual-from-laptop is both a SPOF *and* an incident
  surface.

## What a proper CI lane would take
- A gated GitHub Actions workflow targeting the **prod** worker: `wrangler deploy` (no `--env`),
  `--name silent-shield-signal` explicit (INC-WRANGLER-MISFIRE rule), with a **scoped** token — the
  SAME minimal set proven for staging (`Workers Scripts:Edit` + `Workers Routes:Edit` + `Zone:Read`
  on `silentshieldsecurity.com`, **no R2, no OAuth-broad scope**) stored as a repo/environment secret.
- A bundle-verification step (grep built `./dist` for the release marker, as the manual runbook
  already does) as a pre/post gate.

## The risk cost — why NOT auto-deploy on push
Auto-deploy on push to a **client-facing prod route** is its own hazard: an unreviewed source change
reaches the URL clients see in one push. That is exactly the disaster release-control froze the lane
to prevent (see WO-PRR ledger 2026-07-05 / -07 / -08). An automated lane must NOT be push-triggered.

## Recommended middle ground (to be evaluated, not built here)
**Manual-trigger-only (`workflow_dispatch`) workflow + scoped token + GitHub Environment approval
gate + bundle grep.** This removes the laptop SPOF (any authorized operator triggers from GitHub,
no local broad-OAuth dependency) while keeping a human approval in the loop and a scoped, revocable,
non-laptop credential. It is the frontend-deploy slice of the broader **WO-PRR** governed-release
effort.

## Dependencies / cross-refs
- **WO-PRR** (production reality reconciliation / governed release lane) — parent effort; #53
  release-control reconstruction, #57 Playwright E2E auth (required by the preflight gate).
- Token: a new **prod**-scoped deploy token (mirror of `silent-shield-signal-ci-deploy`, same zone +
  minimal perms) — replaces the broad local OAuth for prod deploys.
- Memory `[[reference-fortress-frontend-worker-deploy]]` (manual-deploy recipe + token mapping).

**SCOPE ONLY — do not build.** Recorded per operator 2026-08-07 as a real SPOF distinct from the
CF-token rotation (`WO-CF-TOKEN-ROTATION-2026-08-07`).
