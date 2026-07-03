# Staging Frontend Release Contract

This source packet prepares evidence for a future staging frontend release lane. It does not authorize or implement deployment.

## Required Before Any Deployment Implementation

- A protected GitHub `staging` Environment with branch restriction to `staging` and required reviewer protection.
- Staging-scoped Cloudflare credentials, separate from the current shared repository credentials.
- Explicit approval before any deployment workflow can run.
- A separately reviewed workflow that fails closed unless it records a deployment receipt with:
  - source SHA;
  - artifact hash;
  - GitHub run ID;
  - Worker target;
  - Cloudflare version ID;
  - traffic percentage;
  - prior rollback version;
  - route;
  - served-artifact verification;
  - actor;
  - timestamp.
- Rollback must name a specific prior Cloudflare version.

## Current Preflight Evidence

The no-deploy staging preflight may build the frontend and write:

- `dist/version.json`;
- `release/staging-frontend-preflight-record.json`.

The artifact manifest hash is non-circular: it hashes `dist/**/*` after the build while excluding `dist/version.json`, then writes `dist/version.json` only after the artifact hash is known.

## Explicit Boundary

No deployment is authorized by this PR or its preflight. No live Cloudflare version ID, traffic allocation, served-artifact verification, rollback proof, or release is created or proven by this source packet.
