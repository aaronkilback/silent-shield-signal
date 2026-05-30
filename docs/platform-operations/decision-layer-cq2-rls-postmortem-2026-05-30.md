# Post-Mortem — CQ2 "Zero RLS Policies on cop_timeline_events" Finding

**Status:** INFORMATIONAL 2026-05-30 — operator-requested post-mortem after C.1 acceptance. Does NOT block C.1 (already accepted) or C.2 (separate gate). Documents the root cause of the incorrect 2026-05-29 CQ2 finding, sweeps adjacent RLS assertions for similar errors, and proposes corrective methodology.

## Summary

The 2026-05-29 CQ2 recommendation in `decision-layer-option-c-cq-recommendations-2026-05-30.md` stated: *"The current prod state of `cop_timeline_events`: RLS is enabled. Zero policies are defined. The Briefing Room read path is therefore currently broken in prod."* That conclusion was **factually wrong on a load-bearing detail.** Prod actually carried a pre-existing `"Workspace members can manage COP timeline"` policy (workspace-membership-scoped, FOR ALL, role=public). The Briefing Room read path was not broken; it just wasn't used.

**Why this matters:** the CQ2 finding shaped a downstream design recommendation (CQ2 was used to argue against adding a tenant-scoped end-user RLS policy). The actual functional outcome did not change because my recommendation — *"add only a service-role manage policy"* — was the correct call regardless of the pre-existing workspace policy. But the reasoning chain that led there contained a false premise. That is the substance of this post-mortem.

## §1 — Why the original conclusion was reached

The pre-flight query that produced the finding was:

```sql
select policyname, permissive, roles::text[], cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'cop_timeline_events'
order by policyname;
-- Also confirm rls is enabled
select relname, relrowsecurity
from pg_class
where relname = 'cop_timeline_events' and relnamespace = (select oid from pg_namespace where nspname = 'public');
```

I sent this to `mcp__plugin_supabase_supabase__execute_sql` in **one call** with two SELECT statements separated by `;`. The MCP tool returned:

```json
[{"relname":"cop_timeline_events","relrowsecurity":true}]
```

I read the response as:
1. RLS is enabled (the `relrowsecurity:true` row from the second SELECT)
2. Zero policies are defined (the first SELECT "returned no rows")

**Conclusion #2 was the error.** The first SELECT did not "return no rows" — its result was **never returned at all.** The `mcp__plugin_supabase_supabase__execute_sql` tool returns only the final result set when multiple SELECT statements are sent in one call. The first SELECT's rows were silently discarded by the tool before I saw them.

I made a falsifiable claim ("zero policies") on the basis of evidence I never actually saw.

## §2 — Why the conclusion was incorrect

Two failure modes compounded:

**Failure mode A — tool-output assumption.** I assumed that if a query was syntactically valid and the call succeeded, the response contained all result sets. The MCP tool's actual behavior is to return only the last result set. This is a tool-contract surprise, not a query bug — but I should have noticed that I never saw any rows from `pg_policies` at all (not even the column header), which would have been impossible if the query had run and returned 0 rows.

**Failure mode B — empirical verification skipped.** A correctly-skeptical reading of the result would have been "I got one row from a query that asked for two SELECTs. That's a tool-shape signal, not a data signal. Re-run the queries separately." I did not do that. I treated the absence of evidence as evidence of absence.

The actual prod policy on `cop_timeline_events` was always:

```
"Workspace members can manage COP timeline"
  PERMISSIVE, role=public, FOR ALL
  qual: EXISTS (SELECT 1 FROM workspace_members wm
                 WHERE wm.workspace_id = cop_timeline_events.workspace_id
                   AND wm.user_id = auth.uid())
```

This is a workspace-membership-scoped policy, not tenant-scoped. It works correctly for the Briefing Room UI use case (a workspace member can read/write events in their workspace). It also did not interfere with C.1's design — my service-role manage policy is additive, PostgreSQL combines RLS policies with OR semantics, and service-role bypasses regardless.

## §3 — Whether similar assumptions exist elsewhere

I ran an empirical sweep on prod against every table I made an RLS assertion about during recent decision-layer work. Result table follows; comparison against my claims in the recent ADRs / authorization packages:

| Table | Recent claim | Actual prod state (2026-05-30) | Verdict |
|---|---|---|---|
| `aegis_decision_threshold_trace` (R1.0) | "2 policies — operator read + service manage" | 2 policies: `aegis_decision_threshold_trace operator read` (auth, SELECT) + `aegis_decision_threshold_trace service manage` (service_role, ALL) | ✅ **Correct** |
| `agent_tradecraft` (Class A) | RLS enabled, one global-shared SELECT policy | 1 policy: `agent_tradecraft_global_select` (auth, SELECT) | ✅ **Correct** |
| `agent_tradecraft_quarantine` (Class A) | Operator-only access (quarantine sibling) | 2 policies: `atq_super_admin_select` + `atq_super_admin_update` (auth) | ✅ **Correct** (matches operator-forensic-access pattern) |
| `investigation_workspaces` (C.0) | "C.0 does not modify RLS" (true) — but I never enumerated existing policies | 3 pre-existing policies: `Members can view their workspaces` (public, SELECT) + `Owners can update workspaces` (public, UPDATE) + `Users can create workspaces` (authenticated, INSERT) | ⚠️ **Not asserted wrongly, but an inventory gap.** I never claimed zero; I just didn't enumerate. C.0 correctly left them untouched. |
| `cop_timeline_events` (C.1) | Originally CQ2: "zero policies." Corrected in C.1 validation: 2 policies. | 2 policies: pre-existing `Workspace members can manage COP timeline` (public, ALL) + C.1's `cop_timeline_events service manage` (service_role, ALL) | ❌ **CQ2 finding incorrect; C.1 validation report's correction is accurate.** |
| `decision_layer_audit_alerts` (C.1) | "2 policies — operator read + service manage" | 2 policies present matching the claim | ✅ **Correct** |

**Pattern:** the CQ2 cop_timeline_events finding is the **only outright-incorrect** RLS assertion. The investigation_workspaces case is a minor inventory gap (I didn't enumerate pre-existing policies, but I also didn't claim there were none); C.0 did not depend on them and the migration correctly left them in place.

No other prod RLS surface I touched during the decision-layer arc carries a wrong claim.

## §4 — Corrective action

### Done already
- **C.1 validation report explicitly corrected the CQ2 finding** (PR #69) — surfaced the pre-existing policy and the original error in the same artifact that accepted C.1.
- **The CQ2 functional recommendation was the right call anyway** — even with the pre-existing workspace policy present, the right answer for Option C scope was still "add service-role manage only; do not add tenant-scoped end-user policy." The reasoning chain was flawed; the destination was correct.

### Required (methodology)

1. **MCP query rule for the operator chat record:** when running `mcp__plugin_supabase_supabase__execute_sql`, only the **last** result set is returned. Multiple SELECTs in one call silently drop earlier results. Going forward:
   - Run each SELECT as a separate call, OR
   - Combine into a single `UNION ALL` with a label column (the pattern I use for fast-scan inventories), OR
   - Materialize results into a temp/regular table and SELECT from that as the final statement.

   I'll save this rule to durable memory immediately (separate memory artifact, this session).

2. **Tool-result skepticism rule:** when a query asks for two things and the response contains evidence of only one, the right read is "tool returned partial data" — not "the missing thing has zero rows." A returned-zero-rows result for a SELECT against `pg_policies` would include column headers + an empty body, not be entirely absent. Treat absence-of-data and zero-rows-of-data as distinguishable signals.

### Optional (housekeeping)

3. **Enumerate pre-existing RLS for `investigation_workspaces` in a future doc update** — the C.0 ADR did not list the three pre-existing policies. Low priority. The C.0 migration didn't touch them and verification confirmed they continue to operate correctly. Could be folded into a future C.x ADR if it touches workspace RLS.

4. **CQ recommendations doc CQ2 textual fix** — the v2 doc still says "Briefing Room read path is currently broken in prod." This phrasing is wrong (the path is functional for workspace_members). The C.1 PR corrected it in the validation report; the recommendations doc itself remains uncorrected. Low priority — historical artifact at this point — but worth fixing if the doc is ever revisited.

### Not required

- **No remediation of any deployed prod schema.** C.0 and C.1 are both validated as functionally correct. The error was in pre-deployment reasoning, not in the deployed result.
- **No re-ratification of the G2 architecture.** The G2 design holds regardless of which pre-existing policies were on cop_timeline_events; the architecture's correctness does not depend on the CQ2 baseline.
- **No rollback.** Nothing about the deployed state is wrong.

## Methodology lesson saved to durable memory

I'm saving the MCP multi-SELECT rule as a feedback memory in this session so it survives compaction:

> *MCP `execute_sql` only returns the last result set when multiple SELECT statements are sent in one call. Run queries one at a time, combine with `UNION ALL` + label column, or materialize results into a regular/temp table and SELECT from that as the final statement. Treat "absence of data in response" and "zero rows returned" as distinguishable signals — they look the same in the response only because the MCP tool drops the earlier result set silently.*

## Status

| | |
|---|---|
| C.1 acceptance | unaffected — informational only |
| C.2 authorization | unblocked; package returned separately per operator directive |
| Held items | unchanged |
| Deployed prod state | correct; no schema remediation required |

## Changelog

- **2026-05-30 v1** — initial post-mortem. Root cause of CQ2 error identified as MCP multi-SELECT result-discard behavior compounded by absence-of-evidence reasoning. Empirical sweep across all six recently-asserted RLS surfaces on prod; only the cop_timeline_events finding was wrong (C.1 validation report already corrected). investigation_workspaces inventory gap noted as minor. Methodology lesson recorded to durable memory.
