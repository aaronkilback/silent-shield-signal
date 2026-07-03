# Staging Environment Snapshot

**Record status:** Source-only governance record. It records last-observed facts and does not authorize a connection, retry, migration, deploy, credential change, or production action.

| Field | Value |
| --- | --- |
| Last reconciled | 2026-07-02 |
| Environment | `fortress-staging` |
| Supabase project ref | `lkvyrvuakzguszbpwnfz` |
| Production ref explicitly excluded | `kpuqukppbmwebiptqmog` |
| Workstream class | Evidence record supporting Class A release decisions |
| State | **BLOCKED** for the client-membership staging release path |
| Priority | P0 — Trust Gate |
| Decision owner | Aaron |

## Scope and limitation

This card is an environment snapshot, not proof that staging mirrors production, that all staging behavior is healthy, or that any authorization boundary is live-proven. A dashboard branch label such as `main` / `PRODUCTION` is not treated as target proof; the Supabase project ref above is the target identity for this record.

## Last-observed technical state

1. **Client-membership substrate is not live.** A Table Editor search in the `public` schema returned no `client_memberships` table. The reviewed migration remains unapplied in staging.
2. **Direct `signals` selection is tenant-scoped, not client-membership-scoped.** RLS is enabled on `public.signals`, but the observed permissive `signals_tenant_select` policy uses `get_user_accessible_client_ids()`. The inspected no-argument helper derives client IDs by joining `clients` to `tenant_users` for the authenticated user. This grants tenant-wide client visibility through that direct policy; it is not the future explicit client-membership rule.
3. **A dashboard read path was usable when observed; the CLI temporary-login path was not.** The Table Editor and policy inspection described here were performed through the authenticated Supabase Dashboard on 2026-07-02. That proves only that this dashboard-read path was usable at that time; it does not prove general database connectivity. Against that evidence, the failed governed preflight is isolated to the Supabase CLI temporary-login / Supavisor path rather than a total staging database outage.
4. **Staging cannot prove sibling-client isolation today.** The last-known staging topology has one observed user, one tenant, and one client. There is no Client A / Client B fixture with which to demonstrate the allowed and denied paths.
5. **The governed migration preflight did not apply anything.** From source commit `8edf95be120dde886a3954d4f9fcd49352fb41c9`, the preflight proved the staging target and approved migration hash, then failed closed during `migration_history_read` after 60 seconds with termination confirmed. Remote migration history was not obtained and no apply command ran.
6. **The preflight failure is classified, not root-caused.** The preserved redacted stderr shows the Supabase CLI temporary-login path encountered SASL authentication failures followed by Supavisor `ECIRCUITBREAKER` / SQLSTATE `XX000`. This is not a migration failure and does not prove whether the cause is platform state, credentials, connection configuration, or another client.
7. **RLS Advisor warnings are separate inventory work.** Warnings for public-schema tables with RLS disabled were observed. Their exposure, use, and remediation have not been classified; no blanket enable-RLS action is authorized.
8. **The deployment relationship remains unresolved.** Staging and production are not assumed to mirror one another. The Worker/Pages/deployment-trigger relationship is not yet sufficiently proven to treat a merge to `main` as a routine frontend release.

## Evidence references

- Approved source baseline for the failed governed preflight: `8edf95be120dde886a3954d4f9fcd49352fb41c9`
- Client-membership migration: `supabase/migrations/20260701090000_client_membership_substrate_v1.sql`
- Migration SHA-256: `84f30c728f59fbf7ed044f003474f6606d000ae95d9929c95db764925a7c6afa`
- Preflight manifest SHA-256: `5bf44bfc0b3e0dc8dc76b34fa34d1c8b429d057fc587a4ae4cf40f840a04660f`
- Failed preflight receipt SHA-256: `dd5042f500dbb9a06449fd6cd633b23ace6e8519108d5b9b84442b6efd7c001e`
- Redacted stderr artifact SHA-256: `99f3d7d069af69a3ff89b80b9e221ac1a75b855120c7d9cc8ade408ce2e5d156`

The original receipt and artifact paths were in a temporary worktree. Before a future protected operation, retain sanitized copies or durable references in `ops/ledger/EVIDENCE.md`; do not commit raw logs, credentials, tokens, or unredacted connection output.

## Rebuild-versus-repair fork

When the access blocker clears, the next environment decision is a separately authorized parity diff, not an automatic repair. Given the single-user/single-tenant/single-client topology, absent `client_memberships` table, and unresolved deployment relationship, the likely outcome may be a staging rebuild from an approved production-schema baseline plus synthetic staging seed. That is an expected fork, not a decision, authorization, or assertion that a production snapshot may be copied. Any rebuild, production read, seed mutation, or configuration repair remains a separate Class A decision.

## What remains unknown

- Remote migration history and exact pending migration list.
- Whether the client-membership migration is already applied remotely by any other means.
- Live staging schema and policy state beyond the recorded dashboard observations.
- Two-client authorization behavior for `signals`, Aegis, reports, exports, and realtime.
- Production policy, schema, deployment, and runtime state.

## Next gate and no-go rule

**Next gate:** The v3 staging recovery ladder governs the next action. After the required cooldown and with explicit Evidence Operation authorization, prioritize rung 2: one documented alternate read path to distinguish pooler behavior from database behavior. Rung 3 is one governed original-path preflight retry after cooldown. A support response may inform the decision but is not the retry gate. Either success would still not authorize apply.

**No-go:** No retry, migration apply, credential rotation, configuration mutation, deployment, production contact, or alternate connection test is authorized by this card.

## Stale-proof triggers

Reconcile this card before relying on it if any of the following changes: the staging project/ref, deployment mapping, `signals` policy or helper, migration state, authenticated identity/client topology, Supabase connection behavior, or any receipt/dashboard observation that conflicts with this record.
