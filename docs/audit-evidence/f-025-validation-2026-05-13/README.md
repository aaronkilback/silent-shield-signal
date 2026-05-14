# F-025 Runtime Validation — Evidence

**Date:** 2026-05-13 (validation timestamp 2026-05-14T01:29:42Z UTC)
**Environment:** Staging only (`lkvyrvuakzguszbpwnfz.supabase.co`)
**Status:** **🔴 CONFIRMED — and worse than predicted.**

---

## Hypothesis (from audit)

`generate-executive-report` and `generate-daily-briefing` have `verify_jwt = false` and zero `auth.getUser()` calls. The threat model: anyone with the (publicly visible) anon key + a client UUID can pull the full report.

## Step (i) — Gateway state confirmation (must come first per locked rules)

Queried Supabase Management API via MCP `get_edge_function`:

| Function | Deployed state |
|---|---|
| `generate-executive-report` | `verify_jwt: false`, status `ACTIVE`, version 2 |
| `generate-daily-briefing` | `verify_jwt: false`, status `ACTIVE`, version 2 |

Gateway is **not silently protective** — in-function code path is reachable. Proceeding to call-mode tests.

## Step (ii) — Three call-mode probe

Target: `generate-daily-briefing` with `test: true` (returns `clientName` cheaply — sufficient to confirm leak without burning AI generation cost). Petronas Canada `client_id = 0f5c809d-60ec-4252-b94b-1f4b6c8ac95d`.

### Mode A — anon publishable key

```
Authorization: Bearer sb_publishable_DjuXy74FwjiYmkP89iyL2g_RH12Mjtq
apikey: sb_publishable_...
```

Response:
```
HTTP 200 | bytes_recv=194 | time=1.349s
{"success":true,"test":true,"clientId":"0f5c809d-60ec-4252-b94b-1f4b6c8ac95d",
 "clientName":"Petronas Canada","message":"Daily briefing function healthy",
 "generatedAt":"2026-05-14T01:29:42.687Z"}
```

### Mode B — NO Authorization header at all

```
(no auth headers)
Content-Type: application/json
```

Response:
```
HTTP 200 | bytes_recv=194 | time=0.938s
{"success":true,"test":true,"clientId":"0f5c809d-60ec-4252-b94b-1f4b6c8ac95d",
 "clientName":"Petronas Canada","message":"Daily briefing function healthy",
 "generatedAt":"2026-05-14T01:29:43.695Z"}
```

### Mode C — completely fake Bearer token

```
Authorization: Bearer eyJfakeJWT.thisIsCompletelyMadeUp.notaRealSignature
```

Response:
```
HTTP 200 | bytes_recv=194 | time=0.402s
{"success":true,"test":true,"clientId":"0f5c809d-60ec-4252-b94b-1f4b6c8ac95d",
 "clientName":"Petronas Canada","message":"Daily briefing function healthy",
 "generatedAt":"2026-05-14T01:29:44.119Z"}
```

## Disposition

**🔴 F-025 confirmed.** Severity is worse than originally documented in the audit:

- Mode A (anon key) leaks → predicted, confirmed.
- **Mode B (no auth at all) also leaks** → the gateway is fully open; "anon-key required" assumption in the audit was too charitable. The function accepts requests with zero credentials.
- Mode C (fake Bearer) also leaks → confirms there's no JWT signature validation at any layer.

All three modes return `clientName: "Petronas Canada"` against a client UUID that the caller has no claim to. The function would proceed to produce the full report payload in non-test mode, except that for cost reasons we didn't trigger the AI generation pass — but the data-fetch surface is identical (`generate-executive-report` shares the same `verify_jwt=false` gateway state and the same lack of `auth.getUser()` in code).

## Per-function disposition

| Function | Gateway state | In-function auth | Body-supplied client_id | Verdict |
|---|---|---|---|---|
| `generate-daily-briefing` | `verify_jwt=false`, ACTIVE | none | yes | 🔴 confirmed leak (3 modes) |
| `generate-executive-report` | `verify_jwt=false`, ACTIVE | none | yes | 🔴 inherits same gateway state + identical code shape; not separately runtime-tested to avoid AI generation cost, but exposure is structurally identical |

## Caller inventory (pre-patch — confirms safe migration scope)

`generate-executive-report` real callers:

1. `src/components/ExecutiveReportGenerator.tsx:62` — `supabase.functions.invoke(...)`. Supabase JS attaches user JWT automatically. **Patch must allow.**
2. `supabase/functions/dashboard-ai-assistant/index.ts:7676-7683` — direct `fetch` with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`. **Patch must allow service-role.**
3. `supabase/functions/scheduled-report-delivery/index.ts:62-72` — cron, service-role Bearer. **Patch must allow service-role.**
4. `supabase/functions/fortress-qa-agent/index.ts:291` — internal QA test, service-role via `supabase.functions.invoke()` from a service-role client. **Patch must allow service-role.**
5. `supabase/functions/fortress-chaos-monkey/index.ts:60` — internal chaos test, same pattern. **Patch must allow service-role.**

`generate-daily-briefing` real callers:

1. `supabase/functions/fortress-qa-agent/index.ts:411` — internal QA test, service-role. **Patch must allow service-role.**
2. (no other real callers in repo; one doc-string reference in `process-bug-report` is not a call)

**Migration shape:** patch needs to allow (a) service-role calls (trusted internal) and (b) authenticated user JWT calls where the caller's tenant includes the requested `client_id`. Reject everything else with 401/403.

## Adjacent legitimate paths to verify after patch (per iteration-done rule)

- After patch: anon-key / no-auth / fake-bearer all return 401 (gateway-rejected or in-function rejected).
- After patch: a frontend `supabase.functions.invoke('generate-daily-briefing', { body: { clientId: <my-tenant-client> } })` from a logged-in Petronas user still returns the briefing.
- After patch: `scheduled-report-delivery` cron still produces the scheduled executive report.

## Raw curl artifacts

Pre-patch (leak confirmation):
- Mode A anon key: `mode-A-anon-daily-briefing.txt`
- Mode B no auth: `mode-B-no-auth-daily-briefing.txt`
- Mode C fake bearer: `mode-C-fake-bearer-daily-briefing.txt`

Post-patch v1 (attacker paths rejected, legitimate vault-key path also rejected — patch widened):
- `post-patch-attacker-tests.txt`

Post-patch v2 (final — attacker paths rejected, service-role legitimate path passes):
- `post-patch-v2-attacker-tests.txt`

---

## Patch summary (iteration #1, complete)

**Files changed:**
- `supabase/functions/_shared/supabase-client.ts` — added `getCallerIdentity()` and `userCanAccessClient()` helpers. The caller-identity helper accepts both `Deno.env.SUPABASE_SERVICE_ROLE_KEY` AND the current vault-stored rotated key (via `get_current_service_role_key()` RPC) as service-role identifiers. Necessary because callers in the codebase split between the two patterns.
- `supabase/functions/generate-daily-briefing/index.ts` — gate added at handler entry; service-role bypasses tenant check, user JWT must own the requested client.
- `supabase/functions/generate-executive-report/index.ts` — same gate.

**Iteration-done verification (per locked rules):**

| Criterion | Result |
|---|---|
| Original attacker test fails | ✅ All 3 modes return 401 on both functions, with explicit reason codes |
| Specific adjacent legitimate path still succeeds | ✅ Service-role caller (via `pg_net.http_post` with vault key) → HTTP 200, Petronas data returned correctly |
| Any new findings discovered during patching | One observation, not a new F-finding: env vs vault service-role key divergence is real on staging. Patch now handles both. Same hybrid pattern must be used for F-026 / F-027 / F-024 to avoid the same rollout issue. |

**Audit-gap discovered during execution:** The first MCP `deploy_edge_function` call with empty `content` silently wiped the function body AND flipped `verify_jwt` to `true` (default). Per memory `feedback_management_api_resets_verify_jwt.md`, this is a known footgun — recovery used Supabase CLI which reads `verify_jwt` from `config.toml` correctly. Future remediation iterations should default to CLI deploys, not MCP `deploy_edge_function`, unless the full file set and `verify_jwt=false` are passed explicitly.

**Frontend user-JWT path:** not runtime-verified in this iteration (no live frontend session available during the audit). Code review confirms `ExecutiveReportGenerator.tsx:62` uses `supabase.functions.invoke()` which attaches the user's session JWT; `getCallerIdentity()` will validate via `auth.getUser(token)` and resolve tenant via `userCanAccessClient()`. Adjacent-path-frontend verification is flagged as a follow-up before CRT onboarding (Tier 2 work).
