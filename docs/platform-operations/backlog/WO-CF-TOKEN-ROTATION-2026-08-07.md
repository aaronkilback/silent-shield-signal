# WO-CF-TOKEN-ROTATION — Cloudflare token rotation (2026-08-07)

Division of labor: **operator does all token create/revoke ops in the CF dashboard + updates GitHub secrets; agent verifies deploys only.** Agent never holds a token-write credential.

## Item 2 — silent-shield-signal CI (staging) build token
- **What deploys via this token:** ONLY `deploy-frontend-staging.yml` → `wrangler deploy --env staging` (worker `silent-shield-signal-staging`, route `aegis-staging.silentshieldsecurity.com/*`). It reads the **repository** secret `CLOUDFLARE_API_TOKEN` (verified: line 63; job has no `environment:` block).
- **New token `silent-shield-signal-ci-deploy` (created 2026-08-07):** `Account › Workers Scripts › Edit` + `Zone › Workers Routes › Edit` + `Zone › Zone › Read`, scoped to the account + zone `silentshieldsecurity.com`. **No R2, no KV, no DO** (none are bound in `wrangler.toml`).
- **Sequence:** operator updates repo secret → agent runs staging workflow → agent pastes green → THEN operator revokes the old CI token. Old token not revoked until green.

## Item 3 — local `wrangler login` OAuth ("Edit Cloudflare Workers" ×2)
- These two User-level tokens (Apr 30) authenticate **interactive/manual wrangler**, which includes BOTH:
  - the delivery `deploy-*.sh` (`./deploy-protection.sh`, etc.), and
  - **the prod frontend `wrangler deploy`** (`fortress.silentshieldsecurity.com` / worker `silent-shield-signal`) — prod frontend has NO CI lane; it is manual only.
- **Sequence:** operator `wrangler login` (fresh) → agent verifies via `./deploy-protection.sh` → operator revokes both old "Edit Cloudflare Workers" entries.
- **Caveat (agent-flagged):** revoking both breaks interactive wrangler on BOTH logged-in machines until each re-runs `wrangler login`. `./deploy-protection.sh` verifies only the machine/token it runs on. If prod frontend is deployed from a *different* machine than the delivery scripts, that machine needs its own re-login **before** its token is revoked, or the next prod frontend deploy fails auth.

## PENDING DELETION (gated) — `STAGING_CLOUDFLARE_API_TOKEN`
- **Environment secret** in GitHub environment `staging-preview` (added ~2 mo ago). **Orphan: zero references repo-wide; no workflow declares any `environment:` block**, so it is unreachable by any job. Likely a half-finished migration to environment-scoped secrets that never wired `environment: staging-preview` into the workflow.
- **DO NOT delete yet** (operator ruling + agent's own trap): an orphaned *GitHub secret* does not mean a safe-to-revoke *CF token*. Two GitHub secrets can hold the same CF token value, and the underlying CF token may be used outside this repo. **Gate: establish the CF-token mapping (by last-used + created date) first**, confirm the CF token behind it isn't also the live one / used elsewhere, THEN delete the GitHub secret and (if safe) revoke its CF token.

## CF token mapping — how to establish (agent cannot; values are opaque both sides)
- GitHub secret values are write-only; the CF token list shows only name / permissions / **last-used** / created — never the value. No code path maps value→token.
- **Method:** the CF token behind repo `CLOUDFLARE_API_TOKEN` shows last-used aligning with recent staging deploy runs; the token behind the orphan env secret shows no CI usage. Cross-check created dates vs GitHub secret ages (repo secret 4 mo, env secret 2 mo). Operator to read the CF list (names + last-used + created) → agent helps match before any revoke.
