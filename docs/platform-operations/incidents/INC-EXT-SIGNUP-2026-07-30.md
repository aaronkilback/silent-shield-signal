# INC-EXT-SIGNUP-2026-07-30 — Unrecognized external self-signup (esanaworldbiz@gmail.com)

**Status:** CONTAINED (account banned + tokens revoked 2026-07-30). Public signup still ON — operator action pending.
**Class:** unauthorized-account / public-signup exposure. **Severity:** high (external account on production auth), **realized data exposure: none found.**

## Immutable preservation record (auth snapshot, 2026-07-30)
| Field | Value |
|---|---|
| user_id | `ed4b7451-357e-41bc-a44f-3a0c99d5a3e9` |
| email | `esanaworldbiz@gmail.com` |
| claimed full_name | `Benjamin Asher` |
| created_at | 2026-06-14 09:41:51 UTC |
| email_confirmed_at | 2026-06-14 09:42:33 UTC (self-confirmed, ~42s — working inbox) |
| invited_at | null (NOT invited — self-service signup) |
| provider | email (email/password); raw_app_meta_data.providers = [email] |
| signup IP | 154.161.46.208 (Ghana / West Africa) |
| user-agent | Mozilla/5.0 (iPhone; iOS 17_7_2) Mobile Safari/604.1 |
| session id | 35c02a29-15b0-42ac-b006-7452e9635b97 (created 09:42:33, not_after null) |
| refresh token | id 17565 (was revoked=false / LIVE at discovery) |
| role grant | `viewer`, created_by=null (signup-handler auto-grant) |
| tenant memberships | 0 |
| profile | name=esanaworldbiz@gmail.com, client_id=null |

## Activity (full sweep, 2026-07-30)
- Swept ~125 user-attributed public tables. Only rows: `user_roles` (the viewer grant) + `profiles`. **Zero** activity rows anywhere (ai_assistant_messages, aegis_invocations, aegis_request_trace, edge_function_errors, audit_events, generated_reports, conversations — all 0).
- **Logging gap finding:** `function_telemetry` has no `user_id` column → success-path edge-function calls are not attributed to a user. Absence of a success-path request log means zero-activity cannot be *cryptographically* proven — only that the account left no rows and no trace in the tables that do log user context.
- RLS scoping: with 0 tenant memberships, `get_user_accessible_client_ids()` returns empty → this account could read no client data via RLS-governed paths. Residual exposure = service-role edge functions that resolve client from the request rather than caller tenant membership (WO-SCOPE-EGRESS-01 / item 5 sweep — PENDING).

## Containment actions (reversible, no deletion)
- `auth.users.banned_until = 2100-01-01` (2026-07-30)
- `auth.refresh_tokens.revoked = true` for all tokens of the user
- `auth.sessions` row PRESERVED for forensics

## Open actions
1. **Disable public signup** (GoTrue `DISABLE_SIGNUP=true`) — operator, dashboard/Management API.
2. **Remove/repair the signup-handler auto-`viewer` grant** so signup can't mint standing accounts.
3. **Item 5 service-role sweep** — every authenticated-invocable service-role edge function: does it derive client/tenant from caller membership or from a request param / activeClientIds. Priority: traveller-aegis-chat, dashboard-ai-assistant, AEGIS tool handlers, then the rest.
4. Identify "Benjamin Asher" / esanaworldbiz@gmail.com out-of-band. Do NOT unban until identified.
