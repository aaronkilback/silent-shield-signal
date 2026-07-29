# Decision-record archive

Immutable archive of decision records whose PRs were superseded/closed but whose
**decisions shipped** (as prod schema or as consumed authorization packages). Doctrine:
*nothing deleted, everything traceable* — an authorization package that shipped prod
schema is part of the decision chain even when its PR is closed as superseded.

Each file carries a one-line `ARCHIVED — superseded` header naming the superseding PR/commit;
the original content follows verbatim.

## Salvaged in the PR-triage session (2026-07-29)

### Decision records archived (10) — from closed doc PRs #58, #63, #64, #65, #66, #68, #73, #75.

### Prod-applied migrations landed alongside this archive (6)

These migration files were applied to the prod DB **out-of-band** (via direct SQL, not the
migration runner) and never landed in git — a Tier-1 DR/parity gap. Each was verified against
live prod schema (schema-diff, not trust) before landing; all matched.

| Migration | Objects (verified live in prod) | Origin PR |
|---|---|---|
| `20260529180000_classA_tradecraft_p0_schema.sql` | `agent_tradecraft` (24 base cols, **15,418 rows**) + `agent_tradecraft_quarantine` (20 cols) + RLS | #53 |
| `20260529210000_classA_keyword_retrieval_n1.sql` | `agent_tradecraft.hypothesis_search` tsvector + `agent_tradecraft_update_search()` + `trg_at_update_search` + `idx_at_search` GIN + `retrieve_tradecraft_keyword()` RPC | #57 (was parked; migration is prod-live, so its **schema** is DR-required — the dash-ai retrieval cutover code stays parked) |
| `20260529220000_decision_layer_r10_threshold_trace.sql` | `aegis_decision_threshold_trace` (22 cols, 3 CHECKs, 6 idx, RLS) | #61 |
| `20260530120000_decision_layer_c0_investigation_workspaces_tenant_id.sql` | `investigation_workspaces.tenant_id` NOT NULL + provenance CHECK + enforce trigger + `get_workspace_tenant_id()` | #67 |
| `20260530140000_decision_layer_c1_cop_timeline_events_tenant_id.sql` | `cop_timeline_events.tenant_id` NOT NULL + trigger + `decision_layer_audit_alerts` + drift RPCs + nightly cron | #69 |
| `20260530160000_decision_layer_c3_investigations_next_review_at.sql` | `investigations.next_review_at` | #74 |

### ⚠ Open follow-up — migration-ledger baseline (prod write, needs operator go)

None of these 6 versions are recorded in prod `supabase_migrations.schema_migrations` (they were
applied out-of-band). Landing the files is safe for CI (no db-push workflow) and safe for a
fresh DR rebuild (empty ledger → migrations run once). But a **manual `supabase db push` against
the existing prod** would try to re-apply them and choke on the non-idempotent DDL in #53/#57
(`create table` / `add column` / `create trigger` without `if not exists`). Remediation: baseline
the 6 versions into `schema_migrations` (mark as already-applied). Held pending operator go — it
is a prod-ledger write beyond the file-salvage that was authorized.
