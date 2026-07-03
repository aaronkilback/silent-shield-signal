# Staging Frontend Delivery Lane

**Class:** A
**State:** SOURCE PREPARATION READY — runtime deployment implementation blocked
**Priority:** P0
**Owner:** Aaron

## Scope

Source-side containment for the staging frontend release path on the `staging` branch. This lane controls whether a staging-branch source change can automatically reach the Cloudflare Worker staging deployment route.

## What changed in source

- Automatic GitHub Actions staging frontend deploy is no longer triggered by `push` to `staging`.
- The workflow contains no Cloudflare action, Wrangler command, repository Cloudflare secret reference, or staging Cloudflare secret substitute.
- The remaining manual workflow is preflight-only and requires:
  - `approved_commit_sha`;
  - `confirm_staging_preflight: RUN_STAGING_FRONTEND_PREFLIGHT`.
- The preflight must be dispatched from `staging`.
- The preflight checks that checked-out `staging` exactly matches the approved SHA.
- The build may use only the existing staging Vite variables:
  - `STAGING_VITE_SUPABASE_URL`;
  - `STAGING_VITE_SUPABASE_PUBLISHABLE_KEY`.
- The preflight can write `dist/version.json` and `release/staging-frontend-preflight-record.json`.
- The preflight binds the staged build to a deterministic SHA-256 artifact-manifest hash.
- The artifact-manifest hash is non-circular: `dist/version.json` is excluded from the hash scope and written only after the artifact hash is known.
- The preflight record states deployment, Cloudflare version observation, traffic allocation observation, served verification, rollback, and release were not run.
- Static tests guard against reintroducing automatic staging deployment or Cloudflare/Wrangler credential references.

## What this does not prove

- No deployment has run.
- The workflow YAML formerly contained an auto-deploy path; the current disabled workflow state is external GitHub evidence, not source state.
- Direct/manual Wrangler paths outside this workflow remain unproven and uncontrolled by this PR.
- Shared repository Cloudflare credentials still exist.
- Staging Cloudflare credential scope has not been proven.
- No workflow execution, Cloudflare deployment, version receipt, served verification, rollback proof, credential scope, or release authorization is proven.
- No application, authorization, Supabase, RLS, migration, staging runtime, or production runtime behavior changed.

## Remaining gates

1. Decide on protected staging Environment settings and staging-scoped credentials.
2. Revalidate externally captured provider-read evidence during any future deployment authorization. Existing provider-read evidence established the current Worker's static-assets model, route, version-history/rollback-candidate availability, and absence of dashboard-listed bindings; it is not deployment proof, rollback proof, credential-scope proof, or release authorization.
3. Implement a separate governed manual staging release workflow only after provider, credential, approval, receipt, rollback, and served-artifact verification controls exist.
4. Perform one controlled staging release verification before treating the lane as certified.

## Stale-proof triggers

Reconcile this card if any of these change:

- `.github/workflows/deploy-frontend-staging.yml`;
- `wrangler.toml`;
- GitHub workflow enabled/disabled state;
- GitHub staging/production Environment settings;
- Cloudflare Worker route or active version;
- Cloudflare credential placement or token scope;
- any PR touching `src/**`, `public/**`, frontend build config, or staging deployment workflow paths.
