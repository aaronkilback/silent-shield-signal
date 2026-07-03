# Active Control Board

Last reconciled: 2026-07-03

## Current workstreams

### Staging frontend delivery-lane containment

- Class/state: A / SOURCE CONTAINMENT READY — deployment implementation blocked
- Proof: source-side containment removes automatic GitHub Actions staging frontend deployment from `staging` and leaves only a manual, non-deploy preflight that builds with staging Vite variables and writes a preflight artifact.
- Deployment status: not deployed, not certified, and no staging deployment is authorized. Direct/manual Wrangler paths outside this workflow remain unproven and uncontrolled by this PR.
- Next gate: staging credential-scope decision, Cloudflare provider Evidence Operation, deployment receipt design, rollback proof, and served-artifact verification before any staging release implementation.
- Priority: P0.

### Staging CI YAML Validity

- Class/state: B / READY — source-only, awaiting separate merge decision
- Proof: duplicate `env:` key removed from the staging `unit-tests` step; focused static test verifies exactly one `env:` block with all required invariant-test variables.
- Caveat: no GitHub Actions run, job execution, or CI recovery is proven. The exact internal GitHub workflow-validation error remains unproven.
- Next gate: separate merge decision; this repair grants no release capability, deployment approval, or PR #96 release decision.
- Priority: P1.

### Browser signal filter boundary — PR #96

- Class/state: B / READY — source-only, release-blocked
- Proof: source work is ready but remains release-blocked until delivery-lane containment and a separate release decision.
- Next gate: certified delivery lane, then a separate release decision.
- Priority: P1.
