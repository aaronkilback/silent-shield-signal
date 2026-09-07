# WO-E2E-DEPLOY-GATE-EVIDENCE — governed deploy gate now resolves E2E from the introducing PR (fail-closed)

**Status:** BUILT 2026-09-07 (branch `fix/e2e-deploy-gate-evidence`, off `origin/main`). Proof-pending —
a workflow change is only "done" once it runs on the deploy path (Deployed-Not-Committed rule); it takes
effect only after landing on `main` (workflow_dispatch reads the default-branch workflow). This is B1 of
the E2E-reconcile "Option C"; **B2 is deliberately split out** → `WO-E2E-BRANCH-PROTECTION-DECISION`.

> **AMENDMENT 2026-09-07 — B1 refused correctly on its FIRST REAL USE, for the WRONG reason. Fixed.**
> (branch `fix/e2e-gate-ff-collision`). In priority order:
>
> 1. **The defect (FF-collision).** A **fast-forward merge** puts the PR head sha directly on `main`, so a
>    **push-event** ci.yml run lands on the SAME sha as the pull_request run. Because E2E is
>    `pull_request`-only, that push run's E2E is **`skipped`**. The original resolution took the E2E check
>    run by `latestRun` (latest by start time) on the head sha — and the push-skip (20:11) is newer than the
>    pull_request success (19:57), so it selected the skip and **refused a genuinely-passed E2E**. Evidence:
>    two `Playwright E2E` check runs on `26c9874b` — `101852293113` (event=pull_request, run 34157409692,
>    **success**, 19:57) and `101855033192` (event=push, run 34158321313, **skipped**, 20:11). **Any
>    FF-merged deploy hits this.**
> 2. **The fix — select by EVENT, not by conclusion or start-time.** Resolve the `Playwright E2E` *job* from
>    the latest `pull_request` workflow run on the PR head (`listWorkflowRunsForRepo(head_sha)` filtered to
>    `event==='pull_request'`, newest first; `listJobsForWorkflowRun` → the `Playwright E2E` job). **Push-event
>    runs are never consulted, whatever their conclusion.** No pull_request E2E job → refuse; present-but-not-
>    success → refuse; multiple pull_request runs → latest by start time. Job resolved **by name, not by
>    workflow-file path** — robust to ci.yml being renamed / E2E moving workflows; the only coupling is the
>    `'Playwright E2E'` job-name string, and a rename fails **closed** (documented inline).
> 3. **The gate did its job.** It **fail-closed** (refused rather than shipping on ambiguous evidence) — the
>    correct *direction* — but for an incorrect *reason*: the frontend E2E genuinely ran and passed under
>    `pull_request`; the resolution couldn't distinguish it from the same-sha push-skip. Found on the gate's
>    **first real use**, which is exactly when you want to find it.
> 4. **My verification defect (the durable lesson).** The pre-dispatch "simulation" checked the PR→commit
>    association (`commits/{sha}/pulls` → PR merged) but **did not replicate the gate's actual E2E run
>    selection** — and the competing push-skip run **did not yet exist** when I checked. So I predicted
>    "admit" from a partial model and was wrong. **A simulation that models only part of a check is the same
>    failure class as a gate that reads the wrong run.** RULE: any pre-dispatch check MUST replicate the
>    gate's *actual selection logic* against *live data at dispatch time*, not a partial model captured
>    earlier. If prediction and gate disagree, that is a second defect to surface, never to work around.
>
> **Sequencing note:** landing this fix advances `main` past `26c9874b`, and the deploy requires
> `HEAD==approved_sha` (deploy-frontend-production.yml "Verify approved main commit"). So the false-zero
> deploy target becomes the **gate-fix merge commit** (which still contains the false-zero frontend), and the
> gate fix is merged **NON-fast-forward** so (a) the fixed B1 can resolve E2E from its PR and (b) this first
> deploy of the FF-fix does not itself depend on the FF-handling being correct (proven on a non-FF merge
> first). See also `feedback_replicate_gate_logic_live`.

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
