# INC-BRIEFING-XTENANT-2026-08-26 — authenticated cross-tenant read via unscoped `incident_id` (generate-incident-briefing)

**Status:** REMEDIATED 2026-08-26 — membership gate deployed + live-verified (no-auth 401 / member 200 / cross-tenant 404); a pre-existing load bug (invalid `signals(...)` embed, 500-for-all, which had been masking the leak) was fixed in the same pass. **Class:** cross-tenant data exposure (authenticated).
**Relationship to INC-AITOOLS-XTENANT-2026-07-30:** SAME class (service-role + request-supplied scope id
+ no membership check), DIFFERENT function and DIFFERENT access profile. INC-AITOOLS-XTENANT is the
*unauthenticated* set (ai-tools-query / generate-poi-report / investigate-poi, `verify_jwt=false`, no
auth at all). This is *authenticated* cross-tenant: it requires any valid logged-in JWT but performs no
tenant-membership check. Filed separately per the reconciliation on 2026-08-26 — it is NOT part of the
INC-AITOOLS-XTENANT record (that record describes ai-tools-query; generate-incident-briefing appears
nowhere in it, and was sitting un-incidented in the security-gate check5 baseline).

## Finding
- **What:** `generate-incident-briefing` runs `verify_jwt=true` (any authenticated user passes the
  gateway) but uses a **service-role** client (RLS bypass), takes **`incident_id` from the request body**,
  and queries `incidents` by `id` with **no tenant/client/membership check** (0 in-function caller checks,
  source-verified). It then returns, for that incident:
  - the incident row (`select *`) + `clients(name, industry, locations)`,
  - all linked `signals` (normalized_text, severity, category, source, source_url, raw_json),
  - linked `entities` (name, type, risk_level, threat_score, description),
  - related `alerts` (**channel, recipient, status, sent_at** — recipient addresses),
  - incident_outcomes / improvements.
- **Mechanism:** `const { incident_id } = await req.json()` → `createServiceClient()` →
  `.from('incidents').select(...clients,signals...).eq('id', incident_id).single()`. Any authenticated
  caller from tenant A can pass tenant B's `incident_id` and receive B's incident + client name +
  signals + entities + **alert recipient addresses**.
- **Only apparent tenant gate is in the caller, not the function:** `dashboard-ai-assistant` calls the
  tool with `assertTenantContext("generate_incident_briefing", tenantId)`, which checks the caller *has*
  a tenant context — NOT that the incident belongs to it — and does not apply on **direct invocation**
  (verify_jwt=true → any authenticated user can POST the function directly, bypassing the assistant).

## Access profile (vs INC-AITOOLS-XTENANT)
| | INC-AITOOLS-XTENANT (ai-tools-query et al.) | INC-BRIEFING-XTENANT (this) |
|---|---|---|
| Auth required | **None** (verify_jwt=false) | **A valid JWT** (any authenticated user) |
| Scope source | caller-supplied `tenant_id`, or none at all | caller-supplied `incident_id` |
| Membership check | none | none |
| RLS bypass | service-role | service-role |
| Reachable to | the open internet | any logged-in Fortress user, cross-tenant |

## Why it was missed
- The security-gate **check2** (service-role + request-supplied scope id + no membership) tracked only
  `client_id / tenant_id / entity_id`. `generate-incident-briefing` is scoped on **`incident_id`**, which
  was NOT in `SCOPE_IDS`, so check2 did not flag it. It was flagged by the broader **check5** (reads
  request data without the shared identity helper) but baselined as known-debt and never triaged into an
  incident. `SCOPE_IDS` was extended (2026-08-26) to include `incident_id`/`signal_id`/`investigation_id`
  so this shape now fails the gate going forward.

## Exploitability / evidence
- **Live today:** YES — not yet remediated (this record is filed before the fix, per operator "understand
  first"). `verify_jwt=true` so the gateway requires a JWT, but no in-function membership check exists.
- **Retention:** `generate-incident-briefing` is not per-invocation instrumented (no `function_telemetry`
  rows), and edge request logs are not retained across the relevant window → **actual cross-tenant use can
  be neither confirmed nor ruled out**, same evidentiary limit as INC-AITOOLS-XTENANT.
- **Blast radius bound:** requires a valid authenticated account (not open-internet). Fortress's live
  tenant population is small (PECL / CRT / SSO-personal / test). An authenticated user in one of these
  could read another's incidents. The high-sensitivity data class is the same PECL person-entity /
  incident material under the INC-AITOOLS-XTENANT legal hold.

## Remediation (planned — NOT yet applied)
- Add a caller gate: `getCallerIdentity(req)` → reject anon; if `user`, resolve the incident's
  `client_id` (or `tenant_id`) and verify `userCanAccessClient(caller.userId, client_id)`; allow
  `service_role` (internal callers). Same pattern as the cleared cipher-* / ingest-screenshot-evidence
  functions and the scan-entity-photos remediation (2026-08-26).
- This is a **Tier B (authenticated)** item; the operator's 2026-08-26 remediation pass started with the
  higher-risk unauthenticated Tier A (system-watchdog, scan-entity-photos). This record tracks the
  briefing fix as the next item in that queue.

## Open
- Apply the caller-membership gate above + deploy (verify_jwt stays true).
- Decide whether this rolls into the INC-AITOOLS-XTENANT PIPEDA determination or is assessed separately
  (different access profile — authenticated vs open).
