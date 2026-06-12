# RLS Containment Plan — broad-authenticated cross-tenant leak (2026-06-12)

**Status:** PLAN ONLY. No prod policy changed yet. Operator directive: C (plan) first, then A (full sweep) in controlled batches; per-table before/after verification; no traveller/family accounts until Batch 1 closed + verified.

## Decision checkpoint
**Q:** Can a normal authenticated user from Tenant A read or write Tenant B operational rows through PostgREST?
**Current:** YES (confirmed — broad `true` / `auth.uid() IS NOT NULL` policies granted to `authenticated`/PUBLIC on tenant-scoped tables).
**Target:** NO — except explicitly approved global/reference tables + service-role/admin mechanisms.

Scope of this plan: the broad **`authenticated`/PUBLIC** policies only. `service_role` policies are OUT OF SCOPE (service_role bypasses RLS regardless; not the leak). Role-gated (`admin`/`analyst`) policies that lack client scope are noted as **residual hardening** but are not the primary fix (they require a privileged role, not a normal user).

---

## Canonical replacement patterns

**Helpers (exist, used by current policies):** `is_super_admin(uuid)`, `get_user_accessible_client_ids()` (returns client_ids for the user's tenant memberships), `has_role(uuid, app_role)`.

### SET-C — client_id operational table (the default)
```sql
-- READ: tenant members of the row's client, or super_admin
CREATE POLICY "<t>_sel" ON public.<t> FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid())
         OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
-- WRITE (only added when the ONLY prior writer was a broad ALL policy):
CREATE POLICY "<t>_ins" ON public.<t> FOR INSERT TO authenticated
  WITH CHECK (is_super_admin(auth.uid())
         OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "<t>_upd" ON public.<t> FOR UPDATE TO authenticated
  USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
  WITH CHECK (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "<t>_del" ON public.<t> FOR DELETE TO authenticated
  USING (is_super_admin(auth.uid()) OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
```
Tighter than today (was: any authenticated). Preserves existing role-gated write policies where present.

### SET-T — tenant_id operational table
```sql
CREATE POLICY "<t>_sel" ON public.<t> FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid())
         OR tenant_id IN (SELECT tu.tenant_id FROM public.tenant_users tu WHERE tu.user_id = auth.uid()));
```
(+ ins/upd/del analogues only where a broad ALL policy was the sole writer.)

### Pattern-D — derived scope via FK (no own client_id): `travel_alerts`
```sql
CREATE POLICY "travel_alerts_sel_scoped" ON public.travel_alerts FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid())
    OR traveler_id IN (SELECT id FROM public.travelers
                        WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids()))
    OR itinerary_id IN (SELECT id FROM public.itineraries
                        WHERE client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));
```

### Pattern-P — profiles (user-owned, not client operational)
Drop only the broad `auth_users_can_view_profiles`. KEEP existing `Profile viewing policy` (self OR privileged role OR workspace co-member) + own-insert/own-update + super_admin. **Sensitive:** profiles carries `last_known_lat/lng`. Breakage risk if normal users rely on broad name lookups — verify operator role + app profile reads first.

### Pattern-G — confirmed global/reference (Batch 3, only if confirmed)
If a table is genuinely global, allow the global rows explicitly rather than `true`:
```sql
USING (client_id IS NULL OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()) OR is_super_admin(auth.uid()))
```
Do NOT apply until operator confirms the table is reference, not operational.

---

## Per-table register

Exposure = the **broad** authenticated/PUBLIC access today. "Drop" = broad policies removed. "Keep" = existing properly-scoped/role/service policies retained. "Add" = new scoped policies.

| # | Table | Scope col | Rows / tenants | Exposure (broad) | Classification | Drop | Add | Pattern | Breakage risk | Batch |
|---|-------|-----------|----------------|------------------|----------------|------|-----|---------|---------------|-------|
|1|threat_radar_snapshots|client_id|0|R+Ins+Upd|L1C op|4 broad (view×2, create, update)|sel/ins/upd/del + sa|SET-C|Low (0 rows; service writes unaffected)|1|
|2|radical_activity_tracking|client_id|0|R+W+U+D (ALL)|L1C op (sensitive)|2 broad (manage ALL, view)|sel/ins/upd/del + sa|SET-C|Low (0 rows)|1|
|3|sentiment_tracking|client_id|0|R+W+U+D (ALL)|L1C op|2 broad (manage, view)|sel/ins/upd/del + sa|SET-C|Low (0 rows)|1|
|4|predictive_threat_models|client_id|0|R+W+U+D (ALL)|L1C op|2 broad (manage, view)|sel/ins/upd/del + sa|SET-C|Low (0 rows)|1|
|5|threat_precursor_indicators|client_id|0|R+W+U+D (ALL)|L1C op|2 broad (manage, view)|sel/ins/upd/del + sa|SET-C|Low (0 rows)|1|
|6|internal_assets|client_id|8 / **all NULL**|R (broad); writes role-gated|L1C op (NULL-client backfill needed)|1 broad (view)|sel + sa|SET-C select|**HIGH** — 8 NULL-client rows vanish until backfilled|1 (backfill first)|
|7|investigation_threads|client_id|22 / 1|R (broad); writes service|L1C op|1 broad (read)|sel + sa|SET-C select|Low|1|
|8|monitoring_proposals|client_id|611 / **5**|R (broad); upd admin; ins service|L1C op (ACTIVE leak)|1 broad (view)|sel + sa|SET-C select|Med — verify UI read still works for members|1|
|9|signal_correlation_groups|client_id(+tenant_id)|62 / 1|R (broad)|L1C op|1 broad (auth view)|none (scoped CRUD already exists)|—|Low (cleanest)|1|
|10|task_force_missions|client_id|0|R (broad); manage admin; create own|L1C op|1 broad (view)|sel + sa|SET-C select|Low (0 rows)|1|
|11|travel_alerts|via traveler/itinerary|0|R (broad); manage roles|L1C op (derived)|1 broad (auth view)|sel scoped|Pattern-D|Low (0 rows); preserves travel UI for members|1|
|12|travel_itineraries|client_id|0|R (broad ×2)|L1C op (legacy/maybe deprecated)|2 broad (auth view, auth.role)|sel + keep sa|SET-C select|Low (0 rows) — candidate for drop|1|
|13|entity_watch_list|client_id|0|R (broad)|L1C op|1 broad (auth read)|sel|SET-C select (keep sa + service)|Low|2|
|14|signal_sequences|client_id|17 / 2|R (broad)|L1C op (ACTIVE leak)|1 broad (ss-auth-read)|sel + sa|SET-C select|Low|2|
|15|agent_missions|client_id|0|R+Ins+Upd (broad)|L1C op|3 broad (read, create, update)|sel/ins/upd + sa|SET-C|Low (0 rows)|2|
|16|agent_world_predictions|client_id|0|R (broad)|L1C op|1 broad (auth read)|sel + sa|SET-C select|Low (0 rows)|2|
|17|trajectory_positions|client_id|0|R (broad)|L1C op|1 broad (auth read)|sel + sa|SET-C select|Low (0 rows)|2|
|18|scheduled_briefings|client_id+tenant_id|1 / NULL|R (broad); manage admin|L1 tenant/L1C op|1 broad (view)|sel + sa|SET-C select (client_id) |Low|2|
|19|auto_escalation_rules|tenant_id|3 / NULL|R (broad); manage admin|L1 tenant op|1 broad (view)|sel + sa|SET-T select|Low (verify NULL-tenant rows intent)|2|
|20|client_observation_baselines|client_id|690 / **5**|R (broad)|L1C op (ACTIVE leak)|1 broad (cob-auth-read)|sel + sa|SET-C select|Med — verify baseline reads still work|2|
|21|profiles|id / client_id|7 / NULL|R (broad)|User-owned (sensitive: geo)|1 broad (auth_users_can_view_profiles)|none (keep Profile viewing policy)|Pattern-P|**HIGH** — name/profile lookups may break for no-role users|2 (careful)|
|22|investigation_playbooks|tenant_id|0|R (broad); manage admin|UNCERTAIN (tenant-derived learning)|TBD|TBD|SET-T or G|confirm intent|3|
|23|investigation_templates|client_id|0|R (broad); manage admin|UNCERTAIN (client-derived)|TBD|TBD|SET-C or G|confirm intent|3|
|24|false_positive_patterns|client_id|0|R (broad); manage role|UNCERTAIN (global+per-client mix likely)|TBD|TBD|G (NULL-global + client)|confirm intent|3|
|25|tech_radar_recommendations|tenant_id|0|R (broad); manage admin|UNCERTAIN (likely global reference)|TBD|TBD|G or SET-T|confirm intent|3|

sa = super_admin bypass policy (`is_super_admin(auth.uid())`).

---

## Verification template (run per table, before → after)

RLS is simulated by setting the JWT claims for a target user (service-role MCP session can do this):
```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','<USER_TENANT_A>','role','authenticated','email','a@x')::text, true);
-- 1. allowed user sees own client/tenant rows only:
SELECT count(*) AS own_visible FROM public.<t>;            -- expect = rows in A's clients
-- 2. foreign-tenant row returns 0:
SELECT count(*) AS foreign_visible FROM public.<t> WHERE id = '<KNOWN_TENANT_B_ROW>';  -- expect 0
-- 3. write blocked unless owned (for write-scoped tables):
INSERT INTO public.<t> (client_id, ...) VALUES ('<TENANT_B_CLIENT>', ...);  -- expect RLS violation / 0 rows
ROLLBACK;
```
Populated tables to actually exercise foreign-tenant reads: `monitoring_proposals`, `client_observation_baselines`, `signal_sequences`, `signal_correlation_groups`, `investigation_threads`. Empty tables: verify a synthetic two-tenant fixture inserted under service role, checked under two authenticated identities, then removed.

Test identities: one tenant-A member (no privileged role), one tenant-B member, one no-tenant user (future traveller — must see 0 everywhere except their linked travel), super_admin (sees all). Confirm operator `d7edb69f` role before profiles change.

---

## Rollback plan

Each batch is one migration. Rollback = recreate the exact dropped policies. The dropped policy DDL is captured verbatim per table (from the pg_policy dump in this session) in the migration's header comment, so rollback is a paste of the original `CREATE POLICY` statements. No data is modified by these migrations (DDL only), so rollback is policy-only and instant. internal_assets backfill (if done) has its own rollback: `UPDATE internal_assets SET client_id = NULL WHERE id IN (...)` for the backfilled ids.

Order of operations per batch:
1. Snapshot current policies (pg_policy dump) → migration header.
2. Apply DROP + CREATE in a single transaction.
3. Run verification template for every table in the batch.
4. If any verification fails (allowed user blocked, or foreign row visible) → ROLLBACK the migration, fix, re-apply.
5. Record before/after in this doc.

## Batch order
- **Batch 1** (rows 1–12): highest sensitivity / active. internal_assets gated behind NULL-client backfill decision.
- **Batch 2** (rows 13–21): remaining operational; profiles handled last + carefully.
- **Batch 3** (rows 22–25): confirm operational-vs-global FIRST (all 0 rows, no active leak); only then scope.

## Residual hardening (post-sweep, separate)
Role-gated write policies without client scope (an `analyst`/`admin` on tenant A could write tenant B): monitoring_proposals.update, task_force_missions.create(own only — ok), internal_assets writes, false_positive_patterns.manage, scheduled_briefings.manage, auto_escalation_rules.manage, investigation_playbooks/templates.manage, tech_radar.update. Lower priority (requires privileged role) — track but not in this sweep unless directed.
