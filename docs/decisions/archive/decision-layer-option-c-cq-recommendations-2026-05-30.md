> **ARCHIVED — superseded, retained for the immutable decision chain (nothing deleted, everything traceable).**
> PR #64. CQ1-CQ9 recommendations; absorbed into the G2 architecture (PR #66).

---

# Decision Layer Option C — CQ1–CQ9 Recommendations

**Status:** PROPOSED 2026-05-30 — recommendations doc following operator's in-principle approval of Option C (G3 + G1 approved; G2 deferred). **No implementation. No schema changes. No code.** Pre-implementation planning artifact only.

**Companion artifacts:**
- `architecture-decisions/decision-layer-option-c-schema-patches-2026-05-29.md` (PR #63 — Option C ADR, scope of G1/G2/G3 + the 9 open CQs)
- `architecture-decisions/decision-layer-doctrine-2026-05-29.md` (v2, RATIFIED)
- `architecture-decisions/decision-layer-r1-threshold-detection-2026-05-29.md` (RATIFIED in principle, unchanged)
- `decision-layer-r1-commitment-inventory-study-2026-05-29.md` (the inventory study that triggered Option C)

**Scope locked by operator:** APPROVE G3 + G1; DEFER G2. CQ recommendations apply to G3 + G1 only.

**Output format:** Single recommendation per CQ. The five operator-highlighted CQs (CQ1, CQ2, CQ4, CQ6, CQ9) get fuller rationale; the others get one-liners.

---

## CQ1 — G3 backfill strategy ⭐ (v2 — chain corrected; strictness preserved verbatim)

**Question.** When adding `tenant_id` to `cop_timeline_events`, what is the backfill source, and must NOT NULL hold after backfill?

### v2 schema-reality correction (2026-05-30)

A schema-reality pre-flight before any C.1 apply discovered the v1 recommendation's backfill source `briefing_workspaces.tenant_id` does NOT exist in prod or staging. The actual FK on `cop_timeline_events.workspace_id` is to `investigation_workspaces.id`, and `investigation_workspaces` itself has NO `tenant_id` column. Tenant scope is reachable only via two FK chains:

- **Path A:** `cop_timeline_events.workspace_id → investigation_workspaces.incident_id → incidents.tenant_id`
- **Path B:** `cop_timeline_events.workspace_id → investigation_workspaces.investigation_id → investigations.client_id → clients.tenant_id`

`investigation_workspaces.incident_id` and `.investigation_id` are both nullable (one OR the other on a given row). Backfill uses `COALESCE` across the two paths. Both `cop_timeline_events` and `investigation_workspaces` are 0-row in prod and staging, so the `UPDATE` is still empty — change is forward-correctness, not data migration.

### Recommendation (v2)

**Backfill via `COALESCE` over Path A and Path B; set NOT NULL on the same migration; add the named Provenance Doctrine CHECK constraint backstop.** Operator-locked CQ1 strictness preserved verbatim: tenant_id required + NOT NULL + fail-closed + Provenance preserved. No nullable transition. No C.0 precursor. CQ1 not softened.

```sql
1. ALTER TABLE cop_timeline_events ADD COLUMN tenant_id uuid;

2. UPDATE cop_timeline_events e SET tenant_id = COALESCE(
     -- Path A: workspace → incident → tenant
     (SELECT i.tenant_id
        FROM incidents i
        JOIN investigation_workspaces w ON w.incident_id = i.id
       WHERE w.id = e.workspace_id),
     -- Path B: workspace → investigation → client → tenant
     (SELECT c.tenant_id
        FROM clients c
        JOIN investigations inv ON inv.client_id = c.id
        JOIN investigation_workspaces w ON w.investigation_id = inv.id
       WHERE w.id = e.workspace_id)
   );

3. ALTER TABLE cop_timeline_events ALTER COLUMN tenant_id SET NOT NULL;

4. ALTER TABLE cop_timeline_events
     ADD CONSTRAINT cop_timeline_events_provenance_ck
     CHECK (tenant_id IS NOT NULL);
```

### Why

- **The table has 0 rows in prod.** Backfill is trivially empty across both paths; no transition pain to manage. The "temporary NULL" path solves a problem that doesn't exist and was rejected by operator directive.
- **Get to the canonical state immediately.** Future rows must carry tenant_id; the writer plumb (CQ4 v2) derives tenant_id via the same chain at write time. Leaving the column nullable would leak that obligation into "and remember to tighten this later" — a recipe for drift.
- **The named CHECK constraint backstop** is the same R1.0 pattern (Provenance Doctrine non-bypassable backstop that survives accidental `ALTER COLUMN DROP NOT NULL`).
- **Reversible** — the entire migration reverts as `ALTER TABLE cop_timeline_events DROP COLUMN tenant_id;` (zero data loss because there are no rows; chain is recoverable via the existing FKs in any case).
- **Fail-closed at the writer** — if the chain derivation produces NULL at write time (workspace has neither `incident_id` nor `investigation_id`, or those parents have NULL tenant scope), the insert is **rejected** by the NOT NULL constraint. This is the intended fail-closed behavior per the operator-locked CQ1 strictness.

---

## CQ2 — G3 RLS approach ⭐

**Question.** After adding `tenant_id`, do we (a) add a tenant-scoped policy alongside the existing workspace-scoped one, (b) replace with tenant-scoped only?

### Pre-flight observation

The current prod state of `cop_timeline_events`:
- RLS is **enabled**
- **Zero policies are defined**

Under Postgres RLS semantics: with RLS enabled and zero policies, non-service-role reads return 0 rows. The Briefing Room "Add Timeline Event" UI's read path is therefore **currently broken in prod** — but no one has noticed because no one has used the feature. This is a pre-existing condition, not a problem Option C introduces.

### Recommendation

**Add a single service-role manage policy. Do NOT add an end-user tenant-scoped read policy.** Leave the broken Briefing Room read path as a pre-existing concern outside Option C's scope.

```
DROP POLICY IF EXISTS "cop_timeline_events service manage" ON public.cop_timeline_events;
CREATE POLICY "cop_timeline_events service manage"
  ON public.cop_timeline_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

### Why

- **R1.1 reads via service-role** + explicit `WHERE tenant_id = $1` in the query, per the standing Tenant Isolation discipline (the [[feedback-tenant-isolation-checklist]] rule that says service-role queries must carry tenant filters at the SQL level — never RLS-only). This is the canonical pattern for every other audit-and-eval surface in the platform.
- **The existing UI uses `addEvent` mutation through the user-authenticated supabase client** in `COPCanvas.tsx`. If the operator later wants to fix the Briefing Room UI's read path, that's a separate workspace-scoped RLS policy that Option C does not need to ship.
- **Adding a tenant-scoped end-user policy now is wrong** — it would widen access (any authed user in the tenant could read all timeline events, not just their workspace's) without any UI consuming the wider scope. Permissions creep with no consumer.
- **Service-role manage is the minimum required** for the writer path + R1.1 reads to work without breaking. It matches the R1.0 pattern and the rest of the Flight Recorder family.

Out of Option C scope: fixing the Briefing Room read path. That belongs in a separate "workspace UI repair" PR if the operator chooses to pursue it.

---

## CQ3 — G2 inclusion

**Resolved by operator** 2026-05-30: **DEFER G2.** Skip.

---

## CQ4 — Writer plumbing scope inside Option C ⭐ (v2 — chain lookup at write time)

**Question.** Strict schema-only, or include minimum writer plumbs?

### Recommendation (v2)

**Bundle the minimum writer plumbs for each approved gap inside Option C.** Schema-only Option C is hollow (produces 0% empirical lift per the inventory study). Treat each writer plumb as the minimum activation needed for the schema patch to produce data.

**v2 correction:** the v1 G3 plumb was sized as "one-line addition" assuming `workspace.tenant_id` was directly available. Per the v2 schema reality, `investigation_workspaces` has no `tenant_id` column. The writer must therefore derive tenant_id via the same two-path FK chain the backfill uses (CQ1 v2). This is a small lookup, not a one-liner, but still LOW effort.

| Approved gap | Minimum writer plumb (v2) | Touch points |
|---|---|---|
| **G3** | `src/components/briefing/COPCanvas.tsx` `addEvent` mutation: before insert, fetch tenant_id via `COALESCE(incidents.tenant_id via incident_id, clients.tenant_id via investigation_id → investigations.client_id)`. The fetched tenant_id is included in the insert payload. If the derivation returns NULL, the insert is rejected by the NOT NULL constraint (fail-closed per CQ1 strictness). Recommended implementation: a small RPC (`get_workspace_tenant_id(uuid)`) so the chain logic lives once on the database side rather than duplicated in every writer. | 1 frontend file change + 1 small `SECURITY DEFINER` RPC migration. |
| **G1** | Investigation editor: new `next_review_at` date input on the investigation edit form + propagation through the save handler. Edge function `investigation-ai-assist` payload must accept the field. | ~2 frontend files + 1 edge function. |

Explicitly excluded from CQ4's "minimum":
- Auto-derivation of `next_review_at` by an AI heuristic (out of Option C scope; would require its own design)
- Auto-population of `cop_timeline_events` from itineraries or chat-extraction (Option E territory)
- UI nudges to remind operators to populate review dates or timeline events (behavioral; out of Option C scope)
- Backfilling existing investigations with derived review dates from past activity

### Why

- **Schema without writers produces no observable lift.** The Option C ADR §4 was explicit: G3's empirical contribution depends on the writer being tenant-aware; G1's empirical contribution depends on operators being able to enter a review date. Without these plumbs, Option C is structurally a no-op against the §13 success criterion (≥10 timeline events, ≥3 investigations with full content).
- **Both plumbs are minimal** — G3 is genuinely one line; G1 is a small form field and edge-function parameter. Total Option C surface is dominated by the schema migrations, not the writers.
- **Auto-derivation is intentionally out of scope** because it changes the semantics from "operator stated a commitment" to "system inferred a commitment" — and the inferred path is Option E's territory (conversation-extraction) with its own watchlist and threshold concerns.

---

## CQ5 — Per-tenant adoption strategy for G3

**Recommendation.** **Out of scope for Option C implementation.** Schema + writer plumbs enable data; operator adoption is observed empirically in the §13 success-criterion window. If organic adoption is 0 after 2 weeks, the inventory problem is **behavioral** and the operator pivots per the §13 path.

No engineering of "adoption" inside Option C. Forcing nudges/onboarding is Option D/E territory.

---

## CQ6 — Forward compatibility with Option B ⭐

**Question.** When `principal_commitments` (Option B) is later authorized, are Option C columns (a) authoritative source-of-truth feeding a view-like normalization, or (b) demoted to denormalized cache fields populated by triggers / dual-write?

### Recommendation

**(a) — Option C columns remain authoritative source-of-truth on their originating tables. `principal_commitments` (when shipped) is a VIEW (or materialized view) that aggregates across the source tables, not a separate write surface.**

```
-- Conceptual shape of the future Option B view (NOT authorized by this doc):
CREATE VIEW principal_commitments AS
  SELECT 'investigation' AS class, id AS source_id, tenant_id,
         next_review_at AS deadline, ...
    FROM investigations WHERE next_review_at IS NOT NULL
  UNION ALL
  SELECT 'event' AS class, id AS source_id, tenant_id,
         event_time AS deadline, ...
    FROM cop_timeline_events
  UNION ALL
  ...;
```

### Why

- **No dual-write integrity problem.** Each domain table (investigations, cop_timeline_events, incidents) owns its data and is the single source of truth. Writers don't have to write to two places. Triggers stay out of the path.
- **No backfill on Option B day-1.** The view aggregates existing data immediately; there's no migration to "move data into `principal_commitments`."
- **Easier to add more source surfaces over time** — Option D could add `press_releases` and `strategic_postures` tables; each gets a UNION branch in the view; no schema changes to existing tables.
- **Materialization is a tuning decision, not a doctrine decision.** If the view's runtime cost is meaningful, it can become a materialized view with a refresh trigger; same SQL shape, different physics. The operator's choice to defer.
- **Reverting Option B becomes trivial.** Drop the view. Source tables are unaffected. Option C investments are independent of whether Option B ever ships.

The cost of (b) — denormalized cache fields populated by triggers/dual-write — is fragility (triggers are hard to test) and inverted control flow (commitments table tells investigations table what's true). Option (a) keeps doctrine boundaries clean.

This recommendation also implies: **Option B, when designed, should be a view-shaped ADR**, not a table-shaped ADR. That changes Option B's scope; flagged here for the Option B design conversation.

---

## CQ7 — Investigation synopsis-fill problem

**Recommendation.** **Out of scope for Option C.** The 5 currently-open investigations with `synopsis=NULL` are a behavioral/hygiene issue independent of schema. Surface in §B.1 watchlist (`c1_significant_no_commitment`) if it manifests as a meaningful false-negative class once R1.1 starts. No UX nudge inside Option C.

---

## CQ8 — R1.1 evidence_source contract

**Recommendation.** **Use the canonical table name as the `evidence_source` identifier** in R1.1's `c1_candidate_deltas[].evidence_source` field:

- `'cop_timeline_events'` for events
- `'investigations'` for investigation hypotheses
- `'incidents'` for incident postures (if/when G2 is later included)

Same naming pattern as the existing `aegis_retrieval_trace.surface` field. No transformations, no abbreviations — table name verbatim. Future surfaces extend the same way (`'press_releases'`, `'strategic_postures'`, etc.).

---

## CQ9 — Pilot tenant for empirical lift ⭐

**Question.** Which tenant gets the G3 schema + writer plumb first, and uses the Briefing Room timeline UI for actual principal events?

### Recommendation

**Two-phase pilot rollout:**

| Phase | Tenant | Duration | What gets measured |
|---|---|---|---|
| **Phase 1 — Sanity** | An internal/test fixture (`_qa_test_client` already exists in prod; a dedicated `_pilot_optionc` fixture is cleaner) | 24 hours | Schema migration applies cleanly; writer plumb writes tenant_id; no regression in Briefing Room UI; existing 0-row state preserves cleanly |
| **Phase 2 — Real-tenant** | **Petronas Canada (PECL)** as primary; BCCH held until PECL has ≥1 week of clean data | 2 weeks (per §13 success criterion window) | Whether organic Briefing Room timeline UI adoption produces ≥10 real-tenant timeline events |

### Why PECL as Phase 2

- **Operational schedule includes principal commitments** that fit `cop_timeline_events` naturally: site visits, public appearances, regulator engagement, board interactions, community-relations events. The exec-protection validation scenario was effectively a PECL-shape principal commitment.
- **Higher chat-volume tenant** per recent validation activity, meaning R1.1 (when later authorized) has more queries to evaluate.
- **Existing entity coverage in monitoring** — PECL has a substantial entity inventory; commitment-linkage evaluations have more context to reason against than a tenant with thin entity coverage.

### Why BCCH stays held

- **Different commitment shape.** Clinic operations are largely continuous (patient care, routine clinical scheduling) rather than discrete event-driven. The "scheduled event the principal attends" class — the load-bearing G3 contribution — fits less naturally.
- **Higher sensitivity around clinic operations** suggests adding a new write surface is better done after PECL pilot has surfaced any operational issues.
- **Sequential adoption** lets us learn from PECL before broadening; parallel would conflate signals from two very different tenant patterns.

### What ends Phase 1 and starts Phase 2

Phase 1 ends when: (a) schema migration applied cleanly, (b) the test fixture's Briefing Room timeline UI writes a tenant-scoped event end-to-end, (c) no regression observed in any existing prod surface. Once these three confirm, Phase 2 begins with an operator-explicit GO. Phase 2 is not an automatic promotion from Phase 1.

---

## Resolution matrix (fast-scan)

| CQ | Resolution |
|---|---|
| **CQ1** | Backfill immediately + NOT NULL + Provenance CHECK backstop (3 statements; table is empty so backfill is no-op) |
| **CQ2** | Add service-role manage policy only. Do NOT add tenant-scoped end-user policy. Pre-existing Briefing Room read path issue is out of scope. |
| CQ3 | DEFER G2 (operator-resolved 2026-05-30) |
| **CQ4** | Bundle minimum writer plumbs: 1-line G3 change in `COPCanvas.tsx`; small form field + edge function parameter for G1 |
| CQ5 | Out of scope. Observe empirical adoption per §13 success criterion. |
| **CQ6** | Option C columns remain authoritative-source-of-truth. Option B is a view, not a separate write surface. |
| CQ7 | Out of scope. Surface in §B.1 watchlist if meaningful. |
| CQ8 | `evidence_source` = canonical table name (`'cop_timeline_events'`, `'investigations'`, `'incidents'`) |
| **CQ9** | Phase 1: internal/test fixture (24h sanity). Phase 2: PECL primary. BCCH held until PECL +1 week clean. |

---

## What this document does NOT do

- Authorize implementation. The CQ resolutions become the binding plan only after operator sign-off on an authorization sheet (similar pattern to the R1 §D authorization sheet).
- Modify the Option C ADR (`decision-layer-option-c-schema-patches-2026-05-29.md`). The ADR keeps its §11 open-questions section intact for audit trail; this document is the resolution layer over it.
- Touch any held item (P5 / P6 / Class B / PR #36 / R1.1 / R1.2–R1.7 / R2–R6).
- Change the Decision Layer Doctrine or the R1 ADR (both remain unchanged per standing operator directive).
- Resolve the Briefing Room workspace UI's broken-RLS state (pre-existing concern, outside Option C scope).

## Next gate

If the operator approves these CQ recommendations, the next artifact is the Option C **authorization sheet** — a signable doc capturing the per-CQ resolutions plus the phase ordering (C.1 G3 schema → C.2 G3 writer plumb → C.3 G1 schema → C.4 G1 editor plumb), matching the pattern used for R1.

## Changelog

- **2026-05-30 v1** — initial CQ1–CQ9 recommendations. Five highlighted CQs (CQ1, CQ2, CQ4, CQ6, CQ9) carry fuller rationale; other CQs resolved as one-liners. Pre-flight observation on cop_timeline_events RLS state (no end-user policies present in prod — Briefing Room read path is currently dormant). PECL named as Phase 2 pilot tenant; BCCH held.
- **2026-05-30 v2** — schema-reality pre-flight before C.1 apply (operator-approved Option α correction) found v1's documented backfill source `briefing_workspaces.tenant_id` does NOT exist. Actual FK is to `investigation_workspaces.id`, which itself has no `tenant_id` column. Two-path FK chain documented: Path A (workspace → incident → tenant) + Path B (workspace → investigation → client → tenant). CQ1 v2 reworded with the COALESCE-over-two-paths SQL. CQ4 v2 sized appropriately: G3 writer plumb is no longer one-line — recommends a small SECURITY DEFINER RPC (`get_workspace_tenant_id`) so chain logic lives once on the DB side. **CQ1 strictness preserved verbatim per operator: tenant_id required + NOT NULL + fail-closed + Provenance preserved. No C.0. CQ1 not softened. tenant_id stays NOT NULL.** No staging apply, no prod apply, no migration commit until re-authorized via the corrected authorization sheet.
