# Client-Membership Foundation

| Field | Value |
| --- | --- |
| Class | A — Trust surface |
| State | **BLOCKED** |
| Priority | P0 — Trust Gate |
| Owner | Aaron |
| Decision owner | Aaron |
| Environment in scope | `fortress-staging` / `lkvyrvuakzguszbpwnfz` only |
| Production | Explicitly excluded |

## Invariant

A tenant user may access a client's intelligence only through an explicit active membership for that client. Tenant membership alone must never grant access to a sibling client's signals, reports, Aegis context, exports, or realtime data.

## Allowed scope

- The reviewed client-membership substrate migration and governed staging release packet.
- Staging-only, explicitly authorized Evidence Operations that name one read-only command/path, target, receipt, and stop condition.
- Synthetic staging fixtures only after a separately authorized Class A mutation decision.

## Forbidden scope

- Production access or mutation.
- Raw SQL, `db push`, migration repair, manual migration-history edits, credential rotation, or configuration mutation.
- Claiming client isolation is live-proven before a two-client sentinel test succeeds.

## What is proven

- Source/release work exists for `supabase/migrations/20260701090000_client_membership_substrate_v1.sql`.
- Migration SHA-256: `84f30c728f59fbf7ed044f003474f6606d000ae95d9929c95db764925a7c6afa`.
- The governed staging preflight from source commit `8edf95be120dde886a3954d4f9fcd49352fb41c9` proved target and migration hash, then failed closed at `migration_history_read`; no apply ran.
- The known staging topology has one observed user, one tenant, and one client. It cannot demonstrate sibling-client isolation without controlled synthetic fixtures.

## Before-state evidence: observed direct `signals` policy

This is the before half of the future closure evidence. It records an existing authenticated-dashboard observation from 2026-07-02; **no new remote read was performed for this ledger update**.

Observed policy capture, canonical form:

```text
policy_name: signals_tenant_select
command: SELECT
roles: public
using: client_id IN (SELECT client_id FROM get_user_accessible_client_ids())
```

Canonical capture SHA-256: `c83fee1e6f42f3ff08a57c091ad0a13064bbccec2e9f6683d0e93d9e045e72d8`

The observed no-argument helper joins `clients` to `tenant_users` for `auth.uid()`. Therefore the policy is tenant-scoped rather than explicitly client-membership-scoped. The hash is an integrity check for this sanitized ledger capture, not a provider-signed artifact.

## Required sequence

The formal post-recovery sequence is:

1. **Preflight retry:** only after the v3 recovery ladder permits it and Aaron explicitly authorizes the named Evidence Operation. Rung 2 alternate read path is prioritized to distinguish pooler behavior from database behavior; rung 3 is one original-path governed preflight retry after cooldown.
2. **Apply:** only after a successful governed preflight, remote pending-list proof, recovery evidence, and a separate explicit Class A apply approval.
3. **Seed:** create synthetic Client A / Client B identities, clients, memberships, and controlled sentinel data in staging. This is a mutation and requires its own separate authorization; it is not implied by apply approval.
4. **Sentinel proof:** run the two-client allowed-and-denied test. Client A must access only authorized Client A data and must be denied Client B sentinel data. Record commit, target, identities, result, limitations, and stale-proof triggers.

No stage may be skipped. A successful apply alone does not prove isolation.

## Current blocker and next gate

The Supabase CLI temporary-login / Supavisor path returned SASL authentication failures and `ECIRCUITBREAKER` during migration-history read. The dashboard read path was usable when observed; the failure is therefore not evidence of a total staging database outage. It is classified, not root-caused.

**Next gate:** the v3 recovery ladder. After breaker cooldown and explicit Evidence Operation authorization, prioritize one documented alternate read path. A support response can inform the decision but is not required to unlock the cooldown-based retry gate.

## Evidence references

- Staging snapshot: `ops/ledger/workstreams/staging-environment.md`
- Failed preflight receipt SHA-256: `dd5042f500dbb9a06449fd6cd633b23ace6e8519108d5b9b84442b6efd7c001e`
- Redacted stderr artifact SHA-256: `99f3d7d069af69a3ff89b80b9e221ac1a75b855120c7d9cc8ade408ce2e5d156`

## Stale-proof triggers

Treat this card as stale if the policy/helper, migration source, staging target, topology, deployment mapping, or any environment evidence changes.