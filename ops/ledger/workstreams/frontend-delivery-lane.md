# Frontend Delivery Lane

**Class:** A
**State:** SOURCE REMEDIATION READY
**Priority:** P0
**Owner:** Aaron

## Scope

Source-side containment for the production frontend release path. This lane controls whether a frontend-path merge can automatically reach the Cloudflare Worker deployment route.

## What changed in source

- Production frontend deploy is no longer triggered by `push` to `main`.
- Production deploy is `workflow_dispatch` only.
- Manual release requires:
  - `approved_commit_sha`;
  - `confirm_frontend_release: RELEASE_FRONTEND_PRODUCTION`;
  - `rollback_version_id`.
- The deploy job references GitHub Environment `production`.
- The workflow checks required CI conclusions for the exact approved SHA before Wrangler can run.
- The build emits a non-secret `dist/version.json`.
- The release receipt schema records source SHA, run ID, actor, target, artifact hash, deployment version, timestamp, served-version verification result, and rollback pointer.
- Static tests guard against reintroducing automatic production Wrangler deployment.

## What this does not prove

- No deployment has run.
- No GitHub `production` Environment has been created or verified.
- No Cloudflare secret placement has been changed or verified.
- No Cloudflare rollback command or provider metadata shape has been proven.
- No served artifact has been verified against a live route.
- No application, authorization, Supabase, RLS, migration, staging, or production runtime behavior changed.

## Remaining gates

1. Create or verify GitHub Environment `production`.
2. Require Aaron or an explicitly approved release owner as reviewer.
3. Restrict the environment to `main`.
4. Move or scope Cloudflare deployment secrets to that protected environment.
5. Run a read-only Cloudflare Evidence Operation to prove deployment/version metadata and rollback-to-version behavior.
6. Perform one controlled release verification before treating the lane as certified.

## Stale-proof triggers

Reconcile this card if any of these change:

- `.github/workflows/deploy-frontend.yml`;
- `.github/workflows/ci.yml`;
- `wrangler.toml`;
- GitHub Environment settings;
- Cloudflare Worker route or active version;
- Cloudflare deployment or rollback metadata;
- any PR touching `src/**`, `public/**`, frontend build config, or deployment workflow paths.
