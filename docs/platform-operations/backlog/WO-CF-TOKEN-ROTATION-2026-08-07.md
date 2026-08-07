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

### Machine picture — MEASURED on the deploy machine (2026-08-07), corrects the WO-DR inference
`wrangler whoami` + the local credential file on THIS machine show:
- Auth is an **OAuth session** (`wrangler login`), email `akilback@hotmail.com`, account `0fb0e48f157b0e38ac0858022550f46d`. Credential file `~/Library/Preferences/.wrangler/config/default.toml` — **created Aug 1 2026, modified Aug 7 2026** (holds oauth_token + refresh_token, not a static API token).
- **This machine's credential is Aug-1-dated OAuth — it is NOT either Apr-30 "Edit Cloudflare Workers" token.** The dates don't match, and the OAuth scopes are near-full-account-write (workers/kv/routes/scripts, pages, d1, queues, pipelines, ai, secrets_store, containers, `connectivity admin`, …) — far broader than an "Edit Cloudflare Workers" template token.
- **Consequence — verification and revocation targets are DISJOINT.** A fresh `wrangler login` here only refreshes THIS machine's OAuth; it does not touch the two Apr-30 tokens. Green on this machine (deploy-protection.sh / prod deploy) is **silent** about whether the two Apr-30 tokens are still used elsewhere. Revoking them off this machine's green risks breaking a *different* machine/process with no warning.
- **Safe path (revised):** FIRST read each Apr-30 token's **Last used** (CF token list) + the account **Audit Log** (Manage Account → Audit Log — records source IP + user agent per token use). Both stale → likely superseded by the Aug-1 OAuth, safe to revoke. Either recently used from a non-this-machine IP → a second active consumer exists; migrate it first. THEN revoke. The `wrangler login` refresh on this machine is good hygiene regardless (whoami warns the OAuth is missing newer scopes), but it is not the revocation gate.
- **Open count:** cannot count machines from here. At minimum: this machine (Aug-1 OAuth) + wherever the two Apr-30 tokens are used (could be this same machine's pre-Aug-1 stale sessions, or other machines) — only Last used / Audit Log resolves it.

### RULING 2026-08-07 — revoke BOTH Apr-30 "Edit Cloudflare Workers" tokens
- **Evidence (operator, 7-day audit log filtered on Actor):** every action attributes to `oauth` (local wrangler), `dash` (browser), `system`, or `api_token`. The 08:43 `api_token` run (Create Assets Upload Session → Upload Assets → Upload Version → Create Deployment → Patch Script Settings → Post Worker subdomain) = the staging deploy on the NEW CI token — **CI token confirmed working in the audit trail, not just the workflow log**. 08:36 Delete / 08:38 Create (dash) = R2-read token revoke + CI token creation. **NOTHING in 7 days attributable to either Apr-30 token.**
- **Acknowledged caveat:** audit log records config *changes*, not *reads*, and window = 7 days not 30 — absence is weaker than a Last-used column. Mitigation: a *deploy* is a config-change (as the 08:43 run shows), so a live deploy path on either token WOULD have appeared; a glance at the per-token **Last used** column (all-time) closes the reads/window gap.
- **Decision + rationale:** revoke both. This machine's Aug-1 OAuth is independent, so operator wrangler auth is unaffected. An unattributable, deploy-capable, admin-broad standing credential is a liability; if a dormant second consumer exists, revocation makes it **fail loud and self-identify** — better than the token standing indefinitely. Cheap to reissue SCOPED. Consistent with the operator's credential-hygiene doctrine + the `floral-fire-d819` precedent.
- **Watch-list (next few days) — symptom is a loud wrangler auth error (`HTTP 403 / Authentication error [code: 10000]`):**
  1. Delivery deploy scripts (`deploy-protection.sh` / `deploy-delivery.sh` / `deploy-f16-page.sh`) failing at the `wrangler deploy` step — esp. if run from a machine other than the Aug-1-OAuth one, or with `CLOUDFLARE_API_TOKEN` set to an Apr-30 value.
  2. A prod-frontend `wrangler deploy` from a *second* machine (this machine is fine — OAuth).
  3. Any unexpected GitHub Actions Cloudflare-auth failure (known CI = `deploy-frontend-staging.yml`, already on the new token; no other workflow reads a CF token).
  4. Anything on account `0fb0e48f…` silently not updating (unlikely — wrangler errors loudly on auth).
- **Recovery if it breaks:** the failure names the operation; reissue a **scoped** token for that consumer (Workers Scripts:Edit + Workers Routes:Edit + Zone:Read; R2 only if that consumer genuinely needs it) or `wrangler login` on that machine — never another admin-all.
- **Note:** if the orphan `STAGING_CLOUDFLARE_API_TOKEN` happens to hold one of these Apr-30 values, revoking makes it doubly-dead (unreferenced AND revoked) — still delete it for hygiene, no urgency; keep it as its own gated item.

## PENDING DELETION (gated) — `STAGING_CLOUDFLARE_API_TOKEN`
- **Environment secret** in GitHub environment `staging-preview` (added ~2 mo ago). **Orphan: zero references repo-wide; no workflow declares any `environment:` block**, so it is unreachable by any job. Likely a half-finished migration to environment-scoped secrets that never wired `environment: staging-preview` into the workflow.
- **DO NOT delete yet** (operator ruling + agent's own trap): an orphaned *GitHub secret* does not mean a safe-to-revoke *CF token*. Two GitHub secrets can hold the same CF token value, and the underlying CF token may be used outside this repo. **Gate: establish the CF-token mapping (by last-used + created date) first**, confirm the CF token behind it isn't also the live one / used elsewhere, THEN delete the GitHub secret and (if safe) revoke its CF token.

## CF token mapping — how to establish (agent cannot; values are opaque both sides)
- GitHub secret values are write-only; the CF token list shows only name / permissions / **last-used** / created — never the value. No code path maps value→token.
- **Method:** the CF token behind repo `CLOUDFLARE_API_TOKEN` shows last-used aligning with recent staging deploy runs; the token behind the orphan env secret shows no CI usage. Cross-check created dates vs GitHub secret ages (repo secret 4 mo, env secret 2 mo). Operator to read the CF list (names + last-used + created) → agent helps match before any revoke.
