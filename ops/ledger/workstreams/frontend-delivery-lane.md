# Frontend Delivery Lane

**Class:** A
**State:** SOURCE CONTAINMENT READY — deployment implementation blocked
**Priority:** P0
**Owner:** Aaron

## Scope

Source-side containment for the production frontend release path. This lane controls whether a frontend-path merge can automatically reach the Cloudflare Worker deployment route.

## What changed in source

- Automatic GitHub Actions production frontend deploy is no longer triggered by `push` to `main`.
- The workflow contains no Cloudflare action, Wrangler command, Cloudflare secret reference, or GitHub `production` Environment reference.
- The remaining manual workflow is preflight-only and requires:
  - `approved_commit_sha`;
  - `confirm_frontend_preflight: RUN_FRONTEND_RELEASE_PREFLIGHT`.
- The preflight checks required CI conclusions for the exact approved SHA.
- The build emits a non-secret `dist/version.json`.
- The preflight record states deployment, served verification, and rollback were not run.
- Static tests guard against reintroducing automatic production deployment or Cloudflare/Wrangler references.

## What this does not prove

- No deployment has run.
- No GitHub `production` Environment has been created or verified.
- No Cloudflare secret placement has been changed or verified.
- No Cloudflare rollback command or provider metadata shape has been proven.
- No served artifact has been verified against a live route.
- Direct/manual Wrangler paths outside this workflow remain unproven and uncontrolled by this PR.
- No actual manual release implementation exists in this workflow.
- No application, authorization, Supabase, RLS, migration, staging, or production runtime behavior changed.

## Remaining gates

1. Create or verify GitHub Environment `production`.
2. Require Aaron or an explicitly approved release owner as reviewer.
3. Restrict the environment to `main`.
4. Move or scope Cloudflare deployment secrets to that protected environment.
5. Run a read-only Cloudflare Evidence Operation to prove deployment/version metadata and rollback-to-version behavior.
6. Implement a separate governed manual release workflow only after the provider and GitHub settings evidence exists.
7. Perform one controlled release verification before treating the lane as certified.
8. **Every deploy stamps its source (incl. manual `wrangler deploy`).** The deploy MUST write
   `dist/version.json` carrying the exact source commit SHA (and build time), and that SHA must be
   captured in the deployment so "what code is in prod" is always answerable from the served artifact.
   **Motivation:** the 2026-08-20 hand-upload (deployment source: "Upload") recorded no SHA, wrote no
   `version.json` (the served path is the SPA catch-all), and embedded no commit marker — the production
   frontend is currently running an **unidentifiable** commit. No deploy may leave prod unidentifiable
   again; a plausible-but-unverifiable "what's running" is the frontend twin of a plausible-fake contact
   field. Cheapest form: a wrapper script that runs `frontend-release-control.mjs write-version` before
   `wrangler deploy`, so even the manual path can't skip it.

## Stale-proof triggers

Reconcile this card if any of these change:

- `.github/workflows/deploy-frontend.yml`;
- `.github/workflows/ci.yml`;
- `wrangler.toml`;
- GitHub Environment settings;
- Cloudflare Worker route or active version;
- Cloudflare deployment or rollback metadata;
- any PR touching `src/**`, `public/**`, frontend build config, or deployment workflow paths.
