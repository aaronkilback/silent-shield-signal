# ADR — CRM data residency: Canada (Central)

**Date:** 2026-08-03 · **Status:** RATIFIED · **Decision owner:** ak@silentshieldsecurity.com

## Decision

The sell-by-chat CRM (WO-CRM-V1-CONVERSATION-TRACKER) runs on a **dedicated Supabase project in Canada (Central)**. Client sales-conversation records — handles, deal stage, objections, notes, and by extension the identities of prospects and customers — are **PII that must remain in Canadian jurisdiction**.

| Property | Value |
|---|---|
| Project name | `silent-shield-crm` |
| Project ref | **`doedbzdgpkkdiubodvzb`** |
| URL | `https://doedbzdgpkkdiubodvzb.supabase.co` |
| Region | **`ca-central-1` (Canada Central)** |
| Owning org | **`jgoadshubgxnlekprnsd`** (same Supabase org as Fortress prod `kpuqukppbmwebiptqmog` + staging `lkvyrvuakzguszbpwnfz`) |
| Created | 2026-08-03 |

## Constraints (binding on future work)

1. **The CRM project must not be migrated out of `ca-central-1`.** Any replacement/rebuild stays in a Canadian region.
2. **No CRM data may be replicated, backed up, exported, or mirrored to a non-Canadian region** — this includes read replicas, storage buckets, downstream analytics warehouses, logging sinks that persist row content, and any future Aegis/Fortress cross-read. If a consumer outside Canada needs CRM data, that is a residency decision requiring its own ruling, not a default.
3. **Distinct from Fortress prod.** Fortress prod (`kpuqukppbmwebiptqmog`) is `us-west-2` (Oregon). The CRM is deliberately a separate project so its Canadian residency is not entangled with Fortress's US region. Do not consolidate the two.
4. The project shares the org (`jgoadshubgxnlekprnsd`) with Fortress + staging, so it is visible to the Supabase MCP. That is an *access* fact, not a *residency* exception — residency is enforced by the project's region, not by who can query it.

## Related

- Work order + schema/RLS: `docs/platform-operations/backlog/WO-CRM-V1-CONVERSATION-TRACKER.md`
- Migration (proven three-user on staging): marketing repo `supabase/migrations/20260803140000_crm_slice1_conversation_tracker.sql`
- Frontend (dedicated CRM client, behind Cloudflare Access): marketing repo `src/pages/Conversations.tsx` (`feat/crm-slice1`)
