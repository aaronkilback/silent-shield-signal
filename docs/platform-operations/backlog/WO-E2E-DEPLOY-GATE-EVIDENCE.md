# WO-E2E-DEPLOY-GATE-EVIDENCE — governed deploy gate now resolves E2E from the introducing PR (fail-closed)

**Status:** BUILT 2026-09-07 (branch `fix/e2e-deploy-gate-evidence`, off `origin/main`). Proof-pending —
a workflow change is only "done" once it runs on the deploy path (Deployed-Not-Committed rule); it takes
effect only after landing on `main` (workflow_dispatch reads the default-branch workflow). This is B1 of
the E2E-reconcile "Option C"; **B2 is deliberately split out** → `WO-E2E-BRANCH-PROTECTION-DECISION`.

## The defect (evidence, 2026-09-07)
- The Playwright E2E job (`ci.yml`) is gated `if: github.event_name == 'pull_request'` — it runs ONLY on
  PRs, against the PR's main-lineage **Cloudflare Pages preview built with STAGING Supabase env**, and is
  keyed to the **PR head sha**. On push-to-main the Pages build bakes PROD env (wrong target), so E2E can't
  run there. Confirmed: latest main push run → `Playwright E2E = skipped`.
- `main` is **not a protected branch**; commits land by direct push (29/30 recent CI events are `push`).
  So the deployed main sha carries a *skipped* E2E, never a real one.
- The governed prod deploy (`deploy-frontend-production.yml`, the current prod lane since PR #207,
  2026-08-27) read E2E on the **approved main sha** and required success **only when `src/` changed**,
  accepting `skipped` otherwise. Net effect: the E2E requirement never validated a genuine run —
  it passed on skip (no src change), or would block on a src change it could never satisfy (E2E is never
  present on the main sha). Six recent deploys shipped with E2E skipped and no evidence.

## The fix (B1, applied)
`deploy-frontend-production.yml` "Require exact CI success" step:
1. **Deleted** the `srcdiff` step and all `src_changed` conditioning (it was the waiver that let a skipped
   E2E through).
2. **E2E is resolved from the PR that introduced the approved commit, fail-closed:**
   `listPullRequestsAssociatedWithCommit(approved_sha)` → most-recently-merged PR → latest `Playwright E2E`
   check on **that PR's head sha** → require `conclusion === 'success'`. **Refuse** if no merged PR, no E2E
   run on the head, or non-success. `skipped` is NEVER accepted, regardless of src changes.
- Non-E2E required checks are still read on the approved main sha (unchanged).

## Consequence (intended, confirmed correct)
A `src/` change pushed straight to `main` with no PR (e.g. the false-zero fix `ad46e653`) is now correctly
**BLOCKED** — it has no PR, so E2E never ran on it. Correct path: open a PR carrying the change → E2E runs
on the `pull_request` event → deploy the resulting commit, whose evidence the gate resolves. Preferable to
shipping with no evidence, which is what had been happening.

## Proof plan (Deployed-Not-Committed)
Verified when the first real governed deploy after this lands exercises the gate: (a) a no-PR src commit is
refused with the "no merged PR introduced" message; (b) a commit introduced by a PR whose E2E passed is
admitted, logging "success on introducing PR #N". Until then: BUILT, not proven-live.

## Cross-refs
- Trigger stays `pull_request` (respects the staging-preview target constraint) — Option A (build a
  staging-env target on the push path) was rejected as heaviest + duplicative.
- `WO-E2E-BRANCH-PROTECTION-DECISION` (B2, deferred) — the source-side invariant that would make PR-passed
  E2E a precondition of reaching main at all.
- `WO-PROD-FRONTEND-DEPLOY-LANE` (now stale re: "no CI lane" — the governed lane exists since PR #207).
