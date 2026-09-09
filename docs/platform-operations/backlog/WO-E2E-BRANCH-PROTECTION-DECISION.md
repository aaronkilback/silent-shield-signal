# WO-E2E-BRANCH-PROTECTION-DECISION — should main require PRs (and a passing E2E) to advance?

**Status:** DEFERRED — decision only, do NOT build. Split out of the E2E-reconcile fix by operator ruling
(2026-09-07): requiring PRs on `main` changes how the operator *works*, not just how CI works, and deserves
its own decision rather than riding in as a subclause of a gate fix. B1 (`WO-E2E-DEPLOY-GATE-EVIDENCE`)
shipped independently and makes the deploy gate honest today without this.

## The question
B2 of "Option C": branch-protect `main` so it can only advance via a PR whose `Playwright E2E` check
passed. This turns "a commit is on main ⇒ its E2E passed" into an enforced invariant (closes the coverage
gap at the source, not just at the deploy gate).

## Why it is not free (the real cost)
The operator is the **sole committer** and pushes **directly to `main` dozens of times per session**.
Requiring PRs on every change is a material workflow cost — most changes are backend/edge-function/doc work
that never touches the frontend `src/` E2E covers.

## Report to produce (later, separately)
1. **What PR-only would actually cost in practice** given a single committer — per-session friction,
   latency, and whether the release-control benefit justifies it for non-frontend work.
2. **Middle option:** require PRs (and passing E2E) **only for changes touching `src/`**, leaving
   backend/doc/migration work on the direct-push flow. Mechanisms to evaluate:
   - A path-scoped required-status-check / ruleset (branch protection can't natively path-scope required
     checks — likely needs a `pull_request` `paths: [src/**]` gate job that is required, plus a policy that
     `src/` edits go via PR), OR
   - A lightweight pre-push / CI guard that fails a direct push to main that touches `src/**` (advisory →
     enforced), pointing the operator to the PR path.
3. Recommendation + explicit trade-off, for an operator go/no-go.

## Cross-refs
- `WO-E2E-DEPLOY-GATE-EVIDENCE` (B1, shipped) — the deploy-side half; already fail-closed without this.
- `WO-PROD-FRONTEND-DEPLOY-LANE` / WO-PRR — governed-release lineage.
