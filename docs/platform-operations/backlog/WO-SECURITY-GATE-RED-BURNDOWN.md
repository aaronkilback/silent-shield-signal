# WO-SECURITY-GATE-RED-BURNDOWN — security-gate is red on main (+124 over baseline) and unenforced

**Status:** OPEN — report only (operator ruling 2026-09-07: "report only, WO the burn-down"). **Do NOT run
`npm run security-gate:baseline` / `run.mjs --update-baseline` until this burns down.** Regenerating now
would bake all +124 current violations into the accepted baseline (ratchet-poisoning) — permanently
grandfathering 17 live public endpoints and 56 actively-exploitable service-role handlers. Worse than red.

## Evidence (authoritative gate run on `origin/main`, 2026-09-07)
| check | baseline (2026-08-26) | current | delta | meaning |
|---|---|---|---|---|
| check1 (verify_jwt=false unallowlisted) | 0 | 17 | +17 | live public endpoints, no allowlist review |
| check2 (service-role + request-scope, no membership check) | 26 | 82 | +56 | **exploitable today** — extends WO-item4-check2-worklist |
| check3 (role escalation) | 1 | 1 | 0 | — |
| check4 (table created without RLS+policy in same migration) | 25 | 47 | +22 | static per-file check; see below |
| check5 (hand-rolled auth, no shared helper) | 186 | 215 | +29 | extends WO-CHECK5-BURNDOWN-01 |
| **total** | **238** | **362** | **+124** | |

## Root cause (same as the E2E gap)
Baseline is 2026-08-26; ~124 violations were introduced since via new functions/migrations, **un-fixed and
un-gated**. The `security-gate` workflow runs on `push:[main]` but `main` is **unprotected** and most commits
are **direct-push** (see Task-2 findings / `WO-E2E-BRANCH-PROTECTION-DECISION`), so the gate runs red and
blocks nothing. The gate exists but does not enforce. Standing-red per doctrine.

## check4 — no live exposure; re-baseline is the wrong tool
All 25 baseline check4 tables are **RLS-enabled in prod** (verified 2026-09-07): 13 have policies; **12 are
RLS-on / 0-policy = deny-by-default closed**, which the RLS-at-Creation rule states is the *correct* secure
default for service-role-only tables. No live exposure. The +22 new check4 need the same live check.
- check4 is a **static per-migration-file** check — it re-fires on unchanged files, so re-baselining does
  NOT clear it. Two correct clears:
  1. **Fix the checker's false-positive class** (preferred): treat `RLS enabled + no policy` as
     deny-by-default-secure (pass), and look for `ENABLE ROW LEVEL SECURITY` across migrations, not only in
     the create-table file. This removes most of check4 by correctness.
  2. `@security-exempt(check4)` annotations on the migration files carrying the live-RLS evidence.
- The 12 deny-by-default (0-policy) tables: academy_agent_scores, alert_delivery_allowed_recipients,
  alert_emission_refusals, client_geo_assets, geo_place_gazetteer, harness_retrieval_verifications,
  hazard_pathway_scores, incident_gate_decisions, job_worker_lease, misrouted_signals,
  operator_alert_bridge_state, report_claim_manifest.

## check1 — 17 firing (all deployed + ACTIVE, verify_jwt=false, unallowlisted)
Per-function review before allowlisting (confirm each does its own in-code auth like the child-safety fn,
vs a genuinely open endpoint): agent-sentinel, attribution-nexus-gate, cipher-analyze-investigation,
cipher-compute-fingerprint, cipher-endorse-hypothesis, cipher-guardrails-test, cipher-ingest-evidence,
cipher-promote-hypothesis, cipher-reject-hypothesis, compute-linguistic-fingerprint,
**edit-child-safety-guidance**, ingest-screenshot-evidence, monitor-geo-wildfire, monitor-x-single,
r2-smoke-test, view-subject-exposure-report, x-query-probe.

- **edit-child-safety-guidance — reviewed (deployed bundle pulled, v25).** `verify_jwt=false` **but NOT
  anonymous**: calls `getCallerIdentity()`, enforces **super_admin-or-service_role** (403 otherwise),
  requires a non-`DRAFT` `reviewed_by`, version-bumps every write. **Exposure is controlled (PROVEN).** The
  defect is **repo drift** — its source is missing from the repo (config.toml block is an orphan; can't be
  reviewed from git). Fix = restore source from the deployed bundle → commit, then allowlist with
  justification (super_admin-gated child-safety records editor).

## Allowlist orphans (public-endpoints.json)
- **6 "deleted-function" orphans — all deployed + ACTIVE = DRIFT, not prunable** (restore source or
  intentionally retire from prod): auth-email-hook (vjwt=false), contact-submit (false), heygen-webhook
  (false), inbound-call-notify (false), sync-buzzsprout (false), generate-lesson-video (true).
- **4 genuinely-stale allowlist entries — safe to prune** (no longer public): correlate-entities +
  entity-deep-scan (now deployed `verify_jwt=true`), fuse-geospatial-intelligence + identify-precursor-
  indicators (not deployed).

## Deploy drift (surfaced, own priority)
**368 deployed edge functions vs 329 in the repo → ~39 deployed functions with no repo source** (incl.
edit-child-safety-guidance + the 6 allowlist orphans). Live prod code unreviewable from git. Ties to
`WO-SCANNER-DEPLOY-DRIFT` / `scripts/security-gate/drift.mjs`.

## Burn-down sequence (proposed; no baseline regenerate at any step)
1. Fix the check4 checker false-positive class → check4 drops by correctness. Re-assess delta.
2. Restore drift sources into the repo (child-safety fn first), so prod is reviewable, then per-function
   review the 17 check1 + allowlist the proven-safe ones one at a time WITH justification.
3. Burn check2 (+56, exploitable) and check5 (+29) via the existing worklists
   (`WO-item4-check2-worklist`, `WO-CHECK5-BURNDOWN-01`).
4. Only after current == a reviewed, minimal set: record the DECREASE via `--update-baseline` (the sole
   legitimate use — record a burn-down, never accept an increase).
5. Enforcement: the gate cannot protect main while main is unprotected + direct-push — resolve alongside
   `WO-E2E-BRANCH-PROTECTION-DECISION` (same enforcement gap).

## Cross-refs
`WO-item4-check2-worklist`, `WO-CHECK5-BURNDOWN-01`, `WO-SCANNER-DEPLOY-DRIFT`,
`WO-E2E-BRANCH-PROTECTION-DECISION`, `WO-E2E-DEPLOY-GATE-EVIDENCE`. Standing rules: Population-Before-Check,
Deployed-Not-Committed, RLS-at-Creation.
