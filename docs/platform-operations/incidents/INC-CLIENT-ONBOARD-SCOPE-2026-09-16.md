# INC-CLIENT-ONBOARD-SCOPE — duplicate/misfiled "Kyle Kane" clients

**Opened:** 2026-09-16 · **WO:** WO-CLIENT-ONBOARD-SCOPE

## Root cause (see chat investigation, Findings 1–6)
Quick Entry passes tenant scope as a client-side value (`useTenant().currentTenant.id`) in the request body. When it was stale/undefined one minute after the tenant was created, the `process-client-onboarding` super-admin path fell back to the caller's sole membership (Silent Shield Operations). With no `(tenant_id,name,org)` uniqueness and no onboarding→active transition, this produced a duplicate — one misfiled, both `status='onboarding'` (invisible to active-scoped views). Onboard risk_score was an LLM guess with a hardcoded 50 fallback.

## Step 4 — prod data deletion (operator GO 2026-09-16)
Deleted both client rows (no re-parent, per ruling):

| id | name | org | tenant_id | tenant | risk |
|---|---|---|---|---|---|
| `94aab5bd-e1dd-41ed-9f0e-5f1543e5baef` | Kyle Kane | OnSpark | `feff5c44-c77b-4e02-b247-aa5a44a8b751` | Silent Shield Operations (misfiled) | 50 |
| `fefc0ad3-7042-4a8b-b502-2cfb51428069` | Kyle Kane | Onspark | `0a2cd6a2-cd5a-4b8e-9a36-417579a6b563` | Silen Shield Clients (correct tenant) | 65 |

**Dependent-row census before delete:** 0 rows across all 76 tables with a FK to `clients` (query: `query_to_xml` count per FK column for both IDs → empty result set). No cascade, no orphans.

**Delete result:** `rows_deleted = 2`. Follow-up proof: `select count(*) from clients where id in (…) or name ilike 'Kyle Kane'` → **0**.

## Fixes shipped / staged
- **Step 1+2 (PR #219, deployed `process-client-onboarding` v122):** onboard writes `risk_assessment.risk_score = null` (50 fallback removed), LLM read kept only as `analyst_notes`, `threat_profile = []`; super-admin with no `tenant_id` → 400 "Select a tenant"; UI gates submit until `currentTenant?.id`.
- **Provenance flag (open):** onboarding still sends prospect identity + location to gpt-4o-mini. Tracked, unchanged.
- **Steps 3, 5, 6, 7:** pending per morning rulings (B/C/D then E, F-gated Step 7).
