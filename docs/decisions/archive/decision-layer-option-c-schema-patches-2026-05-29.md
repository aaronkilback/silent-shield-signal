> **ARCHIVED — superseded, retained for the immutable decision chain (nothing deleted, everything traceable).**
> PR #63/#64. Superseded by the Option C G2 architecture (PR #66) and the CQ1-CQ9 recommendations.

---

# ADR — Decision Layer Option C: Minimum Schema Patches for Commitment Inventory Maturity

**Status:** PROPOSED 2026-05-29 — design-only ADR for operator ratification. **No code, no schema changes, no implementation work authorized by this document.** Option C scope per operator directive 2026-05-29 (after rejecting Options A + F): "Close the minimum set of schema gaps required to produce a meaningful commitment inventory."

**Companion artifacts:**
- `decision-layer-doctrine-2026-05-29.md` (v2, RATIFIED)
- `decision-layer-r1-threshold-detection-2026-05-29.md` (RATIFIED in principle, unchanged)
- `../decision-layer-r1-q-recommendations-2026-05-29.md` (v2 with Q5 clarification)
- `../decision-layer-r1-authorization-sheet-2026-05-29.md` (SIGNED 2026-05-29)
- `../decision-layer-r1-commitment-inventory-study-2026-05-29.md` (PROD inventory: 6 of 8 commitment classes absent/shape-mismatched)

**Locked principle when ratified:** Option C closes the **minimum** schema gaps required to mature the inventory — not the maximum. Goal is **R1.1 audit becomes meaningful**, not commitment inventory completeness. Completeness is Option B (`principal_commitments` table) and Option D (build missing surfaces), both deferred. The doctrine + the R1 ADR remain unchanged. C1 gate remains commitment-linkage; I1/I2 invariants remain locked.

## Problem (formalized from the inventory study)

The 2026-05-29 commitment inventory study identified that 6 of 8 referenced commitment classes are absent or shape-mismatched in prod. The R1.1 C1 detector, if shipped against the current inventory, would fire on near-zero queries — not because the gate is wrong, but because the inventory is empty. The §B.1 watchlist would fill; the 7-day audit would measure inventory shape, not gate quality.

Option C scope: identify the **minimum** schema patches that move the inventory from "empty" to "meaningful audit-able." Not all gaps. Not completeness. Just enough that R1.1's audit measures the **gate**, not the data hole.

Specific gaps from the inventory study (§I):

| # | Gap | Class affected | Type |
|---|---|---|---|
| G1 | `investigations.next_review_at` doesn't exist | Investigation hypothesis | Schema-only |
| G2 | `incidents` has only alerting-tier `sla_targets_json` (mttd/mttr in minutes), no principal-tier `deadline_at` | Incident response posture | Schema-only |
| G3 | `cop_timeline_events` table empty + only `workspace_id` (no `tenant_id`) | Scheduled events | Hybrid: schema (add tenant_id) + writer-adoption |
| G4 | `autonomous_actions_log.status='succeeded'` never set by writers | (Not a commitment surface — out of scope) | N/A |
| G5 | No principal-events / public-appearances surface | Scheduled events | (Largely subsumed by G3 if cop_timeline_events is tenant-scoped) |
| G6 | No press/statement surface | Public statements | New table — Option D territory |
| G7 | No strategic-posture surface | Strategic postures | New table — Option D territory |

Option C is bounded by what produces **meaningful audit volume** with **minimum schema surface area**. G4 / G6 / G7 are excluded (G4 is wrong-target; G6 / G7 are Option D). G1 / G2 / G3 are the candidate set.

## Principle (PROPOSED)

The Option C bundle is the **smallest schema-and-activation patch set that moves the inventory from "empty across 6 of 8 classes" to "1–2 classes generating real per-tenant deadline-bearing rows that R1.1 can derive against."**

The bundle is **minimum-viable**, not exhaustive. Each patch is individually:

1. **Reversible at the schema layer** (single `DROP COLUMN` or equivalent).
2. **Forward-compatible with Option B** (a future `principal_commitments` table can either consume these columns as the canonical source-of-truth or treat them as denormalized views without conflict).
3. **Independent** — patches in Option C do not depend on each other and can be applied/reverted in any order.

The bundle does **not** include writer code beyond the minimum activation needed for each schema patch to produce data. Where activation is non-trivial (G3 cop_timeline_events writer-adoption), the ADR is honest about what's schema and what's behavior.

## §1 — Coverage analysis (Q1: which gaps produce the largest commitment coverage increase?)

Coverage is measured against the doctrine's 8 referenced commitment classes. A patch "covers" a class when it enables structural derivation of a deadline-bearing commitment row from prod data — including the empirical pathway, not just the schema column.

| Gap | Class | Coverage delta (structural) | Coverage delta (empirical, given prod state today) |
|---|---|---|---|
| G3 | Scheduled events | **+1 class** (the most-requested class from the validation scenario — exec-protection's "principal attends event" was exactly this) | **High potential** — Briefing Room "Add Timeline Event" UI already exists; the schema is just missing tenant_id so R1.1 can scope it. Empirical lift depends on operator adoption; but operator-direct entry has lower friction than e.g. travel-system integration. |
| G1 | Investigation hypothesis | +1 class | **Low** — even with `next_review_at` column, the 5 currently-open investigations have `synopsis=NULL`. Without prose substance, the column alone produces ~0 audit-meaningful rows. |
| G2 | Incident response posture | Sharpens existing partial coverage (does not add a new class — incidents are already partially-viable) | **Low** — ~0 real-tenant active incidents today; principal-tier deadline column without rows to populate is structural-only |

**Ranking by coverage:** G3 >> G1 ≈ G2.

**Single-patch best-coverage:** G3 (cop_timeline_events tenant scope) — the only Option C patch that unlocks a class with a realistic adoption path. Adding it lifts the exec-protection scenario from "no place to be stored" to "operator can store it in 4 clicks in the Briefing Room UI."

## §2 — Effort analysis (Q2: which are lowest effort?)

Effort is decomposed into: schema migration cost + writer adoption cost + reader integration cost.

| Gap | Schema migration | Writer | Reader integration | Total effort |
|---|---|---|---|---|
| G1 | `ALTER TABLE investigations ADD COLUMN next_review_at timestamptz` — trivial | Investigation editor UI/edge function must populate it on edit; today none exists | R1.1 must read it (this lives in R1.1 scope, not Option C) | **LOW (schema only)** + new editor plumb |
| G2 | `ALTER TABLE incidents ADD COLUMN principal_tier_deadline_at timestamptz` — trivial | Incident creation/edit must populate; today only `sla_targets_json` is populated | R1.1 must read it | **LOW (schema only)** + new editor plumb |
| G3 | `ALTER TABLE cop_timeline_events ADD COLUMN tenant_id uuid` + Provenance CHECK backstop + RLS update + backfill from `briefing_workspaces.tenant_id` | **Writer already exists** in `src/components/briefing/COPCanvas.tsx:178-204` (`addEvent` mutation). Just needs to start including tenant_id (one-line change). | R1.1 must read it | **LOW** (table + writer exist; the schema patch is the only new work) |

**Ranking by effort:** all three are LOW. G3 is the lowest because the writer is already shipped — the change is "make the existing writer tenant-aware" rather than "build a new writer."

## §3 — Derived vs stored (Q3: which can be derived versus stored?)

A value is "derived" if it can be computed at evaluation time from existing data without a new column. A value is "stored" if it requires schema + write-path.

| Gap | Derived possible? | Stored required? | Why |
|---|---|---|---|
| G1 | NO | Yes | Investigations have no temporal field that implies a review date. Nothing to derive from. |
| G2 | PARTIAL | Mixed | The class-default `opened_at + (sla_targets_json->>'mttr')::int * interval '1 minute'` can be computed today — but mttr is alerting-tier (5/30 min), not principal-tier (24h–4wk). Principal-tier deadline requires a separate stored column OR a doctrine decision that alerting-tier SLAs ARE the principal-tier deadlines for incidents (which they aren't). |
| G3 | NO (tenant scope) | Yes (single column) | Without tenant_id, R1.1 cannot scope cop_timeline_events to a tenant. The join through `briefing_workspaces` works at query time but adds latency and complexity (and is fragile against the Tenant Isolation discipline that prefers explicit tenant_id at row level). |

**Storage is required for all three.** None can be cleanly derived. G3's storage need is the smallest (one denormalized column from an existing FK).

## §4 — % coverage improvement (Q4: what percentage improvement is expected from each?)

Coverage improvement is measured against the inventory study's 8-class baseline. Honest estimates with empirical caveats:

| Gap | Structural % (schema-only) | Empirical % (today, given prod adoption) | Notes |
|---|---|---|---|
| G1 | +12.5% (1/8 classes) | **~0%** (synopsis fields are NULL on the 5 open investigations; even with `next_review_at`, the derivation has nothing to anchor against) | The empirical lift only materializes once operators start using investigation synopsis fields too — orthogonal to schema |
| G2 | 0% structurally (sharpens existing) | ~0% (~0 real-tenant active incidents) | Hardens the surface for future incidents; no current lift |
| G3 | +12.5% (1/8 classes) | **+12.5% to +25% achievable** depending on operator adoption of the existing Briefing Room timeline UI. **The only patch in Option C that has a realistic short-term empirical lift path.** | The lift is bounded by operator behavior, not by schema |

**Aggregate Option C bundle:** structural +25% (G1 + G3 together cover 2/8 classes). Empirical: **+12.5% to +25% in the 7-day audit window**, dominated entirely by G3.

If G3 is excluded from the bundle: structural +12.5%, empirical ~0%. **G3 is the load-bearing patch.**

## §5 — Reversibility (Q5: which changes are reversible?)

| Gap | Reversal SQL | Data loss on revert? |
|---|---|---|
| G1 | `ALTER TABLE investigations DROP COLUMN next_review_at;` | Yes — any populated review dates are lost. Mitigation: export to JSON before drop if needed for forensic record. |
| G2 | `ALTER TABLE incidents DROP COLUMN principal_tier_deadline_at;` | Yes — any populated principal-tier deadlines are lost. Same mitigation. |
| G3 | `ALTER TABLE cop_timeline_events DROP COLUMN tenant_id;` | Tenant scope is lost on the column, but the underlying `workspace_id` still resolves to a tenant via `briefing_workspaces`. So the data is recoverable via the FK join — no permanent loss. |

**All three are fully reversible at the schema layer.** G3 is the most cleanly reversible (data fully recoverable via FK join).

## §6 — Migration debt (Q6: which changes create future migration debt?)

Migration debt = the cost imposed on a future ADR (e.g., Option B `principal_commitments` table) by having committed to Option C's schema shape.

| Gap | Debt if Option B (principal_commitments) ships later | Debt magnitude |
|---|---|---|
| G1 | `investigations.next_review_at` becomes either (a) authoritative-source-of-truth feeding `principal_commitments` rows, or (b) denormalized duplicate. Either resolves cleanly. | **LOW** |
| G2 | Same pattern: incidents.principal_tier_deadline_at becomes a feeder or denorm field. | **LOW** |
| G3 | `cop_timeline_events.tenant_id` is a clean denormalization regardless of whether `principal_commitments` ships. The relationship between `cop_timeline_events` (chronological) and `principal_commitments` (normalized inventory) is genuinely different — timeline events feed commitments, not vice versa. | **ZERO** |

Aggregate Option C migration debt: **LOW-to-ZERO**. The bundle is forward-compatible with every Option B / Option D scenario. Each patch can be kept as authoritative-source-of-truth (with `principal_commitments` consuming as views) or demoted to denorm field (with `principal_commitments` as the canonical write surface). The decision is deferrable.

## §7 — Ranked recommendation

Combining §1–§6 across all criteria:

| Rank | Patch | Coverage | Effort | Reversibility | Migration debt | Composite recommendation |
|---|---|---|---|---|---|---|
| **1** | **G3 — `cop_timeline_events.tenant_id`** | **HIGH** (1 new class, the validation-scenario class) | LOW | High (data recoverable) | **ZERO** | **MUST-DO** for Option C to be meaningful |
| **2** | G1 — `investigations.next_review_at` | LOW empirically (synopsis empty), +12.5% structural | LOW | Yes | LOW | **SHOULD-DO** — cheap, named gap, forward-compatible |
| **3** | G2 — `incidents.principal_tier_deadline_at` | LOW empirically (~0 active real-tenant) | LOW | Yes | LOW | **OPTIONAL** — only worth it if operator anticipates principal-tier incident decisions soon |
| (skip) | G4 — autonomous_actions_log.status | 0% (wrong target) | N/A | N/A | N/A | **SKIP** — separate bug, not a commitment-coverage gap |
| (defer) | G5 — principal-events surface | Subsumed by G3 if G3 ships | N/A | N/A | N/A | **DEFERRED to G3** |
| (Option D) | G6 — press/statements | +12.5% | HIGH (new table) | High | HIGH (likely consumed by Option B) | **DEFER to Option D** |
| (Option D) | G7 — strategic posture | +12.5% | HIGH (new table) | High | HIGH | **DEFER to Option D** |

### Recommended Option C minimum-viable bundle

**G3 (MUST) + G1 (SHOULD).** G2 included as a "stretch" gate — operator decides per their incident-decision-frame expectation.

| Patch | What | Empirical lift | Total time-to-effect |
|---|---|---|---|
| **G3.0** | `ALTER TABLE cop_timeline_events ADD COLUMN tenant_id uuid` + Provenance CHECK backstop + RLS update + backfill from `briefing_workspaces.tenant_id` + one-line change in `COPCanvas.tsx` `addEvent` mutation to set tenant_id | Real per-tenant scheduled-event commitments visible to R1.1 once operators use the existing Briefing Room timeline UI | 1 migration + 1 frontend PR; dependent on operator UI adoption for empirical fill |
| **G1.0** | `ALTER TABLE investigations ADD COLUMN next_review_at timestamptz` + investigation editor plumb (UI + edge function `investigation-ai-assist`) | Investigation commitments derivable when operators populate it; today's 5 open investigations have NULL synopsis so theoretical-only | 1 migration + 1 frontend + 1 edge function PR |
| **G2.0 (stretch)** | `ALTER TABLE incidents ADD COLUMN principal_tier_deadline_at timestamptz` + incident editor plumb | Only useful if operator anticipates principal-tier incident frames; ~0 active rows today | Same shape as G1.0 |

### Why G3 is non-negotiable in this bundle

Without G3, Option C produces zero empirical lift in the 7-day audit. G1 alone is structural-only — the synopsis-empty problem makes its empirical contribution ~0. G3 is the only patch where the existing UI + writer infrastructure means the lift can materialize within the audit window if operators choose to use it.

If G3 is rejected, **Option C reduces to "schema patches that produce no observable lift"** — which is functionally equivalent to Option A (authorize R1.1 against the current inventory) with extra steps. In that case the operator should reconsider Option B (build `principal_commitments`) or Option E (conversation-extraction) since pure schema patches do not solve the empirical problem alone.

## §8 — Cost of doing nothing (Option C reject vs Option B / D / E)

If Option C is fully rejected (no schema patches at all), the operator's remaining paths to a meaningful audit are:
- Option A (accept the ambiguous audit) — operator already rejected
- Option B (build `principal_commitments`) — much higher effort; not bounded
- Option D (build missing surfaces) — highest effort; multi-ADR scope
- Option E (conversation-extraction) — depends on user behavior; 1.4% prevalence today

**Option C is the cheapest path** to commitment inventory maturity. Rejecting all of Option C means committing to one of B / D / E (or accepting permanent R1.1 dormancy). The Option C bundle's worst case (G3 alone) costs less than any alternative.

## §9 — Non-goals (explicit)

Option C explicitly does **NOT** do the following:

| Non-goal | Why |
|---|---|
| Build the `principal_commitments` table | Option B's territory. Option C is intentionally smaller. |
| Build any missing commitment surface from scratch (press / posture / disclosure) | Option D's territory. |
| Modify the Decision Layer Doctrine | Locked per operator. |
| Modify the R1 ADR | Locked per operator. |
| Weaken the C1 gate (commitment-linkage requirement) | Operator explicitly rejected Option F. |
| Touch the I1 / I2 invariants | Operator-locked. |
| Build the per-tenant feature flag surface for Q9 | R1.4 territory. |
| Build conversation-extraction (Option E) | Separate ADR if pursued. |
| Authorize R1.1 | Authorization gate is post-Option-C, separate operator GO. |
| Modify R1.0 schema (`aegis_decision_threshold_trace`) | R1.0 is the audit-only sink; unchanged. |
| Touch any held item (P5 · P6 · Class B · PR #36) | Standing operator directive. |
| Commit to an implementation timeline | Design-only ADR; implementation gated on ratification. |

## §10 — Preservation contracts (every ratified doctrine)

| Doctrine | Option C preservation contract |
|---|---|
| **Tenant isolation** | G3's `tenant_id NOT NULL` (post-backfill) is the canonical row-level scope. The existing join-through-workspace pattern is replaced by direct column scope per the [[feedback-tenant-isolation-checklist]] discipline. No new cross-tenant exposure surface. |
| **Provenance Doctrine** | Every new column adheres to the doctrine. `cop_timeline_events.tenant_id` gets the named CHECK constraint backstop pattern from R1.0 (survives accidental ALTER COLUMN DROP NOT NULL). `investigations.next_review_at` and `incidents.principal_tier_deadline_at` are tenant-scoped through their parent rows (investigations.client_id → client.tenant_id; incidents.tenant_id) — no new ownerless surface created. |
| **Anti-Fabrication Doctrine** | Schema patches only — no claim-generation path. Anti-fab is unaffected. |
| **Grounding-State Doctrine** | New columns become valid `evidence_row_ids` for R1.1 C1/C3 evaluation. Grounding chain: R1.1 detector cites the row id; the row carries provenance; doctrine intact. |
| **Tradecraft separation** | Option C does not touch tradecraft. Class A remains separate. |
| **Recommendation → Approval → Execution separation** | Option C is schema. No recommendation, no approval, no execution. |
| **Flight Recorder observability** | Option C touches no Flight Recorder surface. R1.0's `aegis_decision_threshold_trace` is unchanged. |
| **Aegis Authority Modes** | Schema patches apply equally to tenant-mode and Ops-mode reads; no new authority surface. |
| **Commander's Intent** | Option C operationalizes the doctrine by enabling the inventory the doctrine depends on. Does not deviate. |

## §11 — Open questions for ratification

| # | Question |
|---|---|
| **CQ1** | **G3 backfill strategy.** When adding `tenant_id` to `cop_timeline_events`, do we backfill from `briefing_workspaces.tenant_id` (and require it NOT NULL after backfill) — OR allow NULL temporarily during transition? Recommendation: backfill, then NOT NULL. The table has 0 rows today, so backfill is trivial; the constraint is the discipline. |
| **CQ2** | **G3 RLS policy.** `cop_timeline_events` currently has workspace-scoped RLS. After adding `tenant_id`, do we (a) add a tenant-scoped policy alongside the workspace-scoped one, or (b) replace with tenant-scoped only? Recommendation: ADDITIVE — keep workspace scope for the Briefing Room UI, add tenant scope for R1.1 read path. Doesn't break existing UI. |
| **CQ3** | **G2 inclusion.** Is G2 (`incidents.principal_tier_deadline_at`) part of the cold-start bundle, or only G3 + G1? Recommendation: G3 + G1 only; defer G2 until first principal-tier incident frame is actually anticipated. |
| **CQ4** | **Writer/UI scope.** Option C strictly is schema; does the operator authorize the **minimum** writer plumbs (1 line in `COPCanvas.tsx` for G3; investigation editor for G1) inside the Option C bundle, or split into Option C-schema + Option C-writer as separate gates? Recommendation: bundle the minimum writer plumbs (1-line change for G3; the G1 editor plumb is a separate small frontend PR) — without them, Option C is structural-only. |
| **CQ5** | **Per-tenant adoption strategy for G3.** Once `cop_timeline_events.tenant_id` is populated, how does the operator encourage real tenants to use the Briefing Room "Add Timeline Event" UI? This is a behavioral question, not a schema one — but if the operator expects R1.1 to fire within the 7-day audit window, the answer matters. |
| **CQ6** | **Forward compatibility with Option B.** If Option B (`principal_commitments`) is later authorized, the Option C columns can either be (a) authoritative-source-of-truth that `principal_commitments` views over, or (b) demoted to denormalized cache fields. Operator names the preferred direction so the Option B ADR can be designed against it. Recommendation: (a) — authoritative source-of-truth on the originating table; `principal_commitments` is a view-like normalization, not a separate write surface. Keeps writers honest. |
| **CQ7** | **Investigation synopsis-fill problem.** The 5 open investigations have NULL `synopsis` — meaning even with G1's `next_review_at`, R1.1 has nothing to anchor commitment text to. Is this a behavioral issue for the operator to address separately (e.g., investigation hygiene), or should Option C bundle a UX nudge to require synopsis on save? Recommendation: behavioral, out of Option C scope. Surface in §B.1 watchlist if it becomes a meaningful FN class. |
| **CQ8** | **G3 audit signal in R1.0 trace.** When R1.1 reads `cop_timeline_events` (post-G3), the `c1_candidate_deltas[].evidence_source` should record `'cop_timeline_events'`. Confirms this surface name is acceptable for the R1.1 contract. |
| **CQ9** | **Pilot tenant for Option C empirical lift.** Same question as §D items 5/6 of the authorization sheet (currently deferred to R1.4). Does the operator want to identify a pilot tenant now whose Briefing Room timeline is the first real-data exercise of G3? |

## §12 — Post-ratification implementation sketch (non-commitment)

If and only if this Option C ADR is ratified, implementation work would follow this phased sequence. **Nothing in this section is authorized by this ADR.**

| Phase | Scope | Gate |
|---|---|---|
| **C.1** | G3 schema migration (`cop_timeline_events.tenant_id` + Provenance CHECK + RLS additive policy + backfill from `briefing_workspaces.tenant_id`) — staging-first, then prod | Ratification + CQ1 + CQ2 resolved |
| **C.2** | G3 writer plumb (1-line change in `COPCanvas.tsx` `addEvent` to include tenant_id from the workspace context) | C.1 green |
| **C.3** | G1 schema migration (`investigations.next_review_at` column add) — staging-first, then prod | Ratification + CQ4 resolved |
| **C.4** | G1 editor plumb (investigation editor UI + edge function `investigation-ai-assist` writes the column on save) | C.3 green |
| **C.5** | (Optional) G2 schema migration (`incidents.principal_tier_deadline_at`) | Operator GO on CQ3 |
| **C.6** | (Optional) G2 editor plumb | C.5 green |
| **C.7** | Re-run the commitment inventory study against the post-Option-C data | After 1–2 weeks of post-Option-C operator activity |
| **C.8** | R1.1 authorization gate — re-evaluate the §H Option C vs B/D/E decision against post-Option-C inventory state | C.7 evidence-driven |

Each phase its own operator GO; no automatic promotion. R1.1 remains held pending C.7 evidence + separate operator GO at C.8.

## §13 — Success criterion for Option C

Option C is successful when **at least one** of the following is true after the post-implementation observation period:

1. ≥10 real-tenant `cop_timeline_events` rows exist (operators have used the Briefing Room timeline UI for actual principal events), OR
2. ≥3 real-tenant `investigations` rows have `next_review_at` populated AND `synopsis` non-NULL, OR
3. ≥5 real-tenant `incidents` rows have `principal_tier_deadline_at` populated (only if G2 is included)

If none of these thresholds is reached in 2 weeks, Option C is structurally complete but empirically dormant — the inventory problem is **behavioral**, not schema, and the operator should pivot to Option E (conversation-extraction) or Option B (`principal_commitments` with seeded data).

## §14 — Held

- P5 / P6 / Class B / PR #36 — unchanged
- R1.0 — deployed, unaffected
- R1.1 — still NOT authorized; Option C is a precondition, not authorization
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated
- R2 / R3 / R4 / R5 / R6 — separately gated
- Decision Layer Doctrine — unchanged
- R1 ADR itself — unchanged
- Options A, B, D, E, F — unchanged; Option A and F are rejected per operator
- Option B remains the eventual "right thing" for canonical commitments storage; Option C is a step toward it, not a replacement

## Changelog

- **2026-05-29 v1** — initial Option C design ADR. G3 + G1 minimum-viable bundle (with G2 stretch), ranked recommendation, 9 open questions for ratification, 8-phase non-commitment implementation sketch, success criterion. G3 (`cop_timeline_events.tenant_id`) identified as the load-bearing patch — the only one with realistic short-term empirical lift via the existing Briefing Room UI.
