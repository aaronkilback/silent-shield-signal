# Staging Credential / Platform Debt — Legacy JWT Rejected by Edge Runtime

**Date:** 2026-06-01
**Surfaced during:** ER v1 Slice 2 staging validation (task #183)
**Scope:** Staging only (`lkvyrvuakzguszbpwnfz`). Prod status not assessed in this writeup.
**Severity:** Operational — blocks in-database invocation of `verify_jwt=true` edge functions via `pg_net` + `vault.decrypted_secrets.service_role_key`.
**Action taken in this writeup:** None. Documented per operator instruction (no credential rotation, no prod config change).

---

## §1 — What happened

When the deployed `er-compare-entities` (initial deploy, `verify_jwt=true`) was invoked from inside the staging database via `pg_net.http_post(...)` with `Authorization: Bearer <vault.decrypted_secrets.service_role_key>`, every request returned:

```json
{
  "status_code": 401,
  "content_type": "application/json",
  "body": { "code": "UNAUTHORIZED_LEGACY_JWT", "message": "Invalid JWT" }
}
```

The edge runtime rejected the JWT at the platform auth gate **before** the function body ran.

## §2 — Why

Supabase has introduced a new credential format (`sb_publishable_*` / `sb_secret_*` keys) and is deprecating the legacy JWT-style `service_role_key`. The staging vault entry named `service_role_key` is in the legacy format. The platform's edge-runtime auth gate has begun rejecting legacy JWTs with the explicit `UNAUTHORIZED_LEGACY_JWT` error code.

This is **not a Slice 2 defect** — the function code never executed. It is platform-level credential debt.

## §3 — Operator-resolvable paths (no work taken in this writeup)

| Option | What it requires | Trade-off |
|---|---|---|
| **A. Operator-environment invocation** | Operator runs `supabase functions invoke …` from a machine with current credentials, or uses Supabase Studio's "Test function" panel. I read the resulting DB state via MCP. | No credential rotation. Each validation cycle requires operator hands-on. |
| **B. Refresh vault secret to `sb_secret_*` format** | Operator generates a new staging service-role secret in the new format and `UPDATE`s `vault.decrypted_secrets` (or equivalent vault write). All `pg_net`-based invocation patterns (wraith, this validation flow, future automation) recover. | One-time fix; restores the in-DB invocation pattern broadly. Requires a credential rotation event per `feedback_credential_rotation_requires_explicit_go`. |
| **C. STAGING-ONLY `verify_jwt=false` redeploy** | Function's own tenant-id pre-flight remains the security boundary; the JWT platform gate is bypassed. Used for Slice 2 validation on 2026-06-01. | **Used today.** Staging only. Prod must keep `verify_jwt=true`. |

## §4 — Impact surface

| Surface | Affected? | Notes |
|---|---|---|
| Slice 2 staging validation | YES — resolved via Option C | Validation completed GREEN with verify_jwt=false on staging only |
| Slice 2 prod deploy | NO | Prod deploy will use `verify_jwt=true`. Operator invokes via supabase CLI / dash-ai chat (Slice 3+). Pg_net path is not on Slice 2's prod critical path. |
| Wraith per-action gate (smoke-tested via pg_net) | LIKELY YES — not re-tested today | If wraith was being smoke-tested via the same vault-JWT path, that test will also 401 now. Out of scope to fix in this writeup. |
| `scripts/test-aegis-tools.mjs` (uses local credentials) | UNKNOWN | The script uses environment variables, not vault. Probably unaffected. Not re-tested today. |
| Any other in-DB pg_net → edge function pattern | LIKELY YES if it depends on `vault.decrypted_secrets.service_role_key` |  |

## §5 — Why this writeup exists (without action)

Per operator instruction 2026-06-01:

> "After validation, document the legacy JWT issue separately as staging credential/platform debt.
> Do not rotate credentials.
> Do not change prod config."

This document satisfies that instruction. Cleanup of the legacy JWT path is a separate operator-gated workstream — NOT bundled with ER Slice 2 advancement.

## §6 — Pointers

- Validation report: `docs/platform-operations/er-v1-slice-2-staging-validation-2026-06-01.md`
- Task #183 (staging-validation blocked) — resolved via Option C; this writeup is the closure artifact for the underlying platform debt.
- Related memory: `feedback_credential_rotation_requires_explicit_go.md` — any future Option B execution requires explicit operator "execute now" confirmation, not just discussion.
- Related memory: `feedback_no_prod_jwt_in_chat.md` — credential material stays out of chat regardless of which option is chosen.

## §7 — Open follow-on (not authorized today)

When the operator chooses to revisit:
1. Decide between Option B (refresh vault secret system-wide) or accept ongoing Option A (operator-environment invocation).
2. If Option B: rotate staging first, observe wraith + any other pg_net consumer for ~24h, then rotate prod.
3. Re-enable `verify_jwt=true` on staging `er-compare-entities` once the in-DB invocation pattern is restored. Re-run the 4 Slice 2 validation scenarios as a regression check.
