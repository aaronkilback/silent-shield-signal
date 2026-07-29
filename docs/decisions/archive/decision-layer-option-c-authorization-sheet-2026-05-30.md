> **ARCHIVED — superseded, retained for the immutable decision chain (nothing deleted, everything traceable).**
> PR #64. Option C authorization sheet; decisions carried into the G2 architecture (PR #66) and the prod-applied C.0-C.4 schema.

---

# Decision Layer Option C — Authorization Sheet (pre-C.1 sign-off)

**Status:** PROPOSED 2026-05-30 · **v2 correction 2026-05-30** — schema-reality pre-flight (run before any C.1 apply) found that the v1 sheet referenced a backfill source (`briefing_workspaces.tenant_id`) that does NOT exist in prod or staging. **The v1 sign-off is rescinded; v2 supersedes it and requires re-ratification.** No migration was applied during v1. Corrections appear in §2 (CQ1, CQ4 rows), §3 (scope rows), §195-area (what-sign-off-authorizes block). **CQ1 strictness preserved verbatim per operator: tenant_id required + NOT NULL + fail-closed + Provenance preserved. No C.0. No softening. tenant_id stays NOT NULL.** Signable artifact for Option C implementation. **This document does not, by itself, authorize implementation.** Operator sign-off on §1–§9 below converts the recommendations from `decision-layer-option-c-cq-recommendations-2026-05-30.md` (v2) into the binding pre-implementation contract for **C.1 only** (the first phase of Option C: G3 schema migration + RLS + Provenance CHECK backstop). C.2–C.4 remain separately gated.

**Companion artifacts (all unchanged by this sign-off unless noted):**
- `architecture-decisions/decision-layer-doctrine-2026-05-29.md` (v2, RATIFIED)
- `architecture-decisions/decision-layer-r1-threshold-detection-2026-05-29.md` (R1 ADR, RATIFIED in principle, **unchanged** per standing operator directive)
- `architecture-decisions/decision-layer-option-c-schema-patches-2026-05-29.md` (Option C ADR, PROPOSED, awaiting this sign-off)
- `decision-layer-option-c-cq-recommendations-2026-05-30.md` (CQ resolutions — operator-approved 2026-05-30)
- `decision-layer-r1-commitment-inventory-study-2026-05-29.md` (the inventory study that triggered Option C)
- `decision-layer-r1-authorization-sheet-2026-05-29.md` (the R1 §D sheet — analogous pattern; this sheet follows the same structure for Option C)

**Locked operator constraints for this sign-off:**

> *"Option C remains a commitment-inventory improvement effort. It is NOT authorization for R1.1. After Option C is complete, I want the commitment inventory study re-run before any Decision Layer detector work is authorized."*

These two clauses are §7 and §8 of this sheet and are non-negotiable in the binding contract.

---

## How to use this sheet

For each of the 9 items below:
- **Default** = the recommendation from the Option C ADR + CQ recommendations doc (post-operator-approval 2026-05-30).
- **Operator action** = one of: `CONFIRM default` · `OVERRIDE → [value]` · `DEFER (do not authorize this item)`.
- A single item left at `DEFER` does **not** block sign-off for the other items, but C.1 implementation will skip / pause on that dimension until it's confirmed.

Operator signs by indicating their action against each item. **No code, schema, or behavioral change is authorized** until items §1, §2, §3, §4, §5, §7, §8, §9 are confirmed (item §6 — pilot tenant Phase 2 — can defer without blocking the C.1 schema migration to the test fixture, but cannot defer through C.2).

---

## §1 — Gap inclusion (G1 / G2 / G3)

Operator scope decision 2026-05-30:

| Gap | Decision | Operator action |
|---|---|---|
| **G3** — `cop_timeline_events.tenant_id` (must-do; load-bearing for empirical lift) | APPROVE | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| **G1** — `investigations.next_review_at` | APPROVE | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| **G2** — `incidents.principal_tier_deadline_at` | DEFER | ☐ CONFIRM DEFER ☐ OVERRIDE: ______________ |

---

## §2 — CQ resolutions (CQ1–CQ9)

| CQ | Resolution | Operator action |
|---|---|---|
| **CQ1 (v2)** | G3 backfill via `COALESCE` over Path A (`workspace → incident → tenant`) and Path B (`workspace → investigation → client → tenant`) + SET NOT NULL + named Provenance CHECK backstop, all in one migration. **CQ1 strictness preserved verbatim per operator: tenant_id required + NOT NULL + fail-closed + Provenance preserved. No nullable transition. No C.0.** | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| **CQ2** | Add service-role manage policy only. No tenant-scoped end-user policy. R1.1 reads via service-role + WHERE clause. Pre-existing Briefing Room workspace-UI RLS gap is out of Option C scope. | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| CQ3 | DEFER G2 (operator-resolved) | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| **CQ4 (v2)** | Bundle minimum writer plumbs. G3 (v2): `COPCanvas.tsx` `addEvent` mutation derives tenant_id via the same two-path FK chain the backfill uses (CQ1 v2); recommends a small `SECURITY DEFINER` RPC `get_workspace_tenant_id(uuid)` so chain logic lives once on the DB side. Insert fails closed (NOT NULL rejects) if derivation returns NULL. G1: small form field + edge function parameter on `investigation-ai-assist`. No auto-derivation, no UI nudges, no backfill from past activity. | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| CQ5 | Adoption strategy out of scope. Observe empirical adoption per §13 success criterion. | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| **CQ6** | Option C columns = authoritative source-of-truth. Option B (`principal_commitments`) = a VIEW aggregating across source tables, NOT a separate write surface. Option B's eventual design scope shifts from "table" to "view." | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| CQ7 | Investigation synopsis-fill problem out of scope. Surface in §B.1 watchlist if FN class manifests. | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| CQ8 | `evidence_source` = canonical table name verbatim (`'cop_timeline_events'`, `'investigations'`, `'incidents'`). Same pattern as `aegis_retrieval_trace.surface`. | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| **CQ9** | Pilot tenant: Phase 1 (24h sanity) on internal/test fixture. Phase 2 (2-week empirical-lift window) on Petronas Canada (PECL) primary. BCCH held until PECL +1 week clean. | ☐ CONFIRM ☐ OVERRIDE: ______________ |

---

## §3 — C.1 scope confirmation

C.1 authorizes the following work, and **only** the following work:

| In scope for C.1 | Out of scope (deferred to C.2+) |
|---|---|
| Migration (v2 chain-corrected per CQ1 v2): `ALTER TABLE cop_timeline_events ADD COLUMN tenant_id uuid` + `UPDATE ... SET tenant_id = COALESCE(<Path A subquery>, <Path B subquery>)` + `SET NOT NULL` + named Provenance CHECK backstop | G3 writer plumb in `COPCanvas.tsx` + small SECURITY DEFINER chain RPC — that's C.2 |
| New service-role manage RLS policy on `cop_timeline_events` | G1 schema migration (`investigations.next_review_at`) — that's C.3 |
| Staging-first apply, then prod, parity verification on both | G1 editor plumb — that's C.4 |
| Migration is reversible (DROP COLUMN; data fully recoverable via the two-path FK chain through `investigation_workspaces`) | Any R1.1 detector work |
| Smoke-test backfill (both tables 0-row, so `UPDATE` empty; verify migration applies cleanly and NOT NULL constraint holds) | Any behavioral effect of any kind |

C.1 produces **zero behavioral effect on Decision Layer detector path** — `aegis_decision_threshold_trace` is unchanged; no R1.1 reads or writes are introduced. The only observable effect is that the new column exists on `cop_timeline_events`.

**Operator action:** ☐ CONFIRM C.1 scope = schema + RLS + backfill only · ☐ OVERRIDE: ______________

---

## §4 — Phased gating (C.1 → C.4, individually gated)

C.1 through C.4 are **individually gated**. Sign-off on C.1 does NOT authorize C.2 — each phase requires its own operator GO.

| Phase | Scope | Reversibility | Gate |
|---|---|---|---|
| **C.1** | G3 schema + RLS + Provenance CHECK + backfill (currently empty); staging-first then prod | DROP COLUMN (data fully recoverable via FK) | This sheet |
| **C.2** | G3 writer plumb (one-line in `COPCanvas.tsx`); staging then prod | Revert one-line frontend change | C.1 green + separate operator GO |
| **C.3** | G1 schema (`investigations.next_review_at` column add); staging then prod | DROP COLUMN | C.2 green + separate operator GO |
| **C.4** | G1 editor plumb (investigation editor form field + edge function payload field); staging then prod | Revert frontend + edge function changes | C.3 green + separate operator GO |

**Operator action:** ☐ CONFIRM phases are individually gated · ☐ OVERRIDE: ______________

---

## §5 — Pilot tenant Phase 1 (internal/test fixture, defer-eligible)

Phase 1 = 24h sanity validation that:
- C.1 schema migration applies cleanly
- C.2 writer plumb writes `tenant_id` end-to-end from the workspace context
- No regression in the Briefing Room UI's existing behavior (which today is dormant — already 0 rows readable; goal is not to make it worse)
- No regression in any other surface touching `cop_timeline_events`

**Recommended Phase 1 tenant:** A dedicated `_pilot_optionc` fixture (or `_qa_test_client` if the operator prefers reusing an existing fixture).

| Phase 1 tenant | Operator action |
|---|---|
| Recommended: dedicated `_pilot_optionc` fixture | ☐ Name fixture: ______________ ☐ Use `_qa_test_client` ☐ DEFER |

---

## §6 — Pilot tenant Phase 2 (real-tenant 2-week window, defer-eligible through C.1 only)

Phase 2 = 2-week empirical-lift window per §13 success criterion. Real-tenant operator uses the Briefing Room timeline UI for actual principal events; the §13 thresholds determine whether Option C succeeded structurally vs whether the inventory problem is behavioral.

| Phase 2 primary tenant | Operator action |
|---|---|
| Recommended: **Petronas Canada (PECL)** primary; BCCH held until PECL +1 week clean | ☐ CONFIRM PECL primary ☐ OVERRIDE: ______________ ☐ DEFER (item 6 only) |

Item 6 may be deferred without blocking C.1 sign-off (schema can be applied without any tenant being designated as Phase 2 yet). However, item 6 must be confirmed before **C.2** starts — the writer plumb is the activation point for empirical-lift measurement.

---

## §7 — Option C is NOT R1.1 authorization (locked binding clause)

**Operator-stated 2026-05-30 (verbatim):**

> *"Option C remains a commitment-inventory improvement effort. It is NOT authorization for R1.1."*

Specifically, Option C completion (C.1 through C.4 all green) does NOT authorize:
- R1.1 (C1 detector implementation)
- R1.2 (C2 detector implementation)
- R1.3 (C3 detector implementation)
- R1.4 (aggregator + Flight Recorder integration + per-tenant flag surface)
- R1.5 (7-day audit observation)
- R1.6 (tuning)
- R1.7 (audit-only → behavioral promotion to R2)
- R2 / R3 / R4 / R5 / R6
- Any prompt-assembly change
- Any output-shape change
- Any Decision Frame generation
- Any modification to the doctrine or the R1 ADR

R1.1 authorization remains a **separate, future operator GO** that depends on §8 below.

**Operator action:** ☐ CONFIRM Option C is NOT R1.1 authorization · ☐ OVERRIDE: ______________

---

## §8 — Post-Option-C re-run of the commitment inventory study (locked binding clause)

**Operator-stated 2026-05-30 (verbatim):**

> *"After Option C is complete, I want the commitment inventory study re-run before any Decision Layer detector work is authorized."*

After C.4 is green, **before** any R1.1 / R1.x / R2+ authorization conversation, the commitment inventory study is **re-run against post-Option-C prod state** and produced as a new artifact (e.g., `decision-layer-r1-commitment-inventory-study-rerun-<YYYY-MM-DD>.md`).

The re-run study must answer the same 7 questions the original inventory study answered, against post-Option-C data, and produce honest per-class coverage measurements:

| Re-run measurement | Threshold for "Option C succeeded structurally" |
|---|---|
| Real-tenant `cop_timeline_events` rows | ≥10 |
| Real-tenant `investigations` rows with `next_review_at` populated AND `synopsis` non-NULL | ≥3 |
| Real-tenant `incidents` rows with `principal_tier_deadline_at` populated | n/a (G2 deferred — measurement skipped or 0 expected) |

The re-run study **is the gate** between Option C and any future R1.1 / R1.x / R2+ authorization conversation. If the §13 thresholds are not met after 2 weeks of Phase 2 operation, the operator pivots to Option B (`principal_commitments` view per CQ6) or Option E (conversation-extraction) rather than proceeding to R1.1.

**Operator action:** ☐ CONFIRM re-run is the next mandatory gate · ☐ OVERRIDE: ______________

---

## §9 — Held items remain unchanged

The following remain held and are NOT modified by this sign-off:

- P5 / P6 / Class B / PR #36 (unchanged across all current ADRs and authorization sheets)
- R1.0 (`aegis_decision_threshold_trace` schema) — deployed, unaffected
- **R1.1** — still NOT authorized; not authorized by this sheet either
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated; not authorized by this sheet
- R2 / R3 / R4 / R5 / R6 — separately gated; not authorized
- Decision Layer Doctrine (`decision-layer-doctrine-2026-05-29.md` v2, RATIFIED) — unchanged
- R1 ADR (`decision-layer-r1-threshold-detection-2026-05-29.md`) — unchanged per standing operator directive
- Options A and F — remain rejected
- Options B, D, E — unchanged (B's eventual design scope shifts per CQ6 recommendation, but B itself remains deferred)
- The R1 §B watchlist classes (§B.1 false-negative class, §B.2 cross-tenant variance, §B.3 ungrounded firing, §B.4 statistical-drift I1 violation) — unchanged
- I1 / I2 operator-locked invariants — unchanged
- The R1 §D authorization sheet — unchanged

**Operator action:** ☐ CONFIRM held items unchanged · ☐ OVERRIDE: ______________

---

## What this sign-off authorizes (and what it does not)

If items §1, §2, §3, §4, §5, §7, §8, §9 are all `CONFIRM`ed (with §6 either confirmed or deferred):

### ✅ Authorized by this sheet
- **C.1 only** — G3 schema migration on `cop_timeline_events`: ADD COLUMN `tenant_id`, backfill via `COALESCE` over Path A (`workspace → incident → tenant`) and Path B (`workspace → investigation → client → tenant`) per CQ1 v2, SET NOT NULL, named Provenance CHECK backstop, service-role manage RLS policy. Staging-first then prod with parity verification. **Zero behavioral effect on Decision Layer detector path.**

### ❌ NOT authorized by this sheet
- C.2 (G3 writer plumb in `COPCanvas.tsx`) — requires separate operator GO after C.1 green
- C.3 (G1 schema migration) — requires separate operator GO after C.2 green
- C.4 (G1 editor plumb) — requires separate operator GO after C.3 green
- G2 (incidents column) — operator-deferred
- R1.1 detector code — locked behind the §8 re-run-inventory-study gate
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — each separately gated
- R2 / R3 / R4 / R5 / R6
- Any change to the Decision Layer Doctrine, the R1 ADR, the Option C ADR, or the CQ recommendations doc
- Any change to held items (P5, P6, Class B, PR #36, the R1 §B watchlist, I1/I2 invariants)
- Any prompt-assembly change
- Any output-shape change
- Any Decision Frame generation

Each subsequent phase has its own operator GO. Every authorization in this sheet is single-phase-scoped.

---

## Sign-off block

| Item | Operator decision | Date |
|---|---|---|
| §1 Gap inclusion (G3 APPROVE / G1 APPROVE / G2 DEFER) | _to be marked by operator_ | _____________ |
| §2 CQ resolutions (CQ1–CQ9) | _to be marked by operator_ | _____________ |
| §3 C.1 scope = schema + RLS + backfill only | _to be marked by operator_ | _____________ |
| §4 Phases individually gated | _to be marked by operator_ | _____________ |
| §5 Phase 1 pilot fixture | _to be marked by operator (or DEFER)_ | _____________ |
| §6 Phase 2 primary tenant | _to be marked by operator (or DEFER through C.1 only)_ | _____________ |
| **§7 Option C is NOT R1.1 authorization** (locked) | _to be marked by operator_ | _____________ |
| **§8 Re-run inventory study before any detector work** (locked) | _to be marked by operator_ | _____________ |
| §9 Held items unchanged | _to be marked by operator_ | _____________ |
| **Authorization for C.1** | ☐ AUTHORIZED ☐ NOT YET AUTHORIZED | _____________ |
| Authorizing operator | _______________________________ | _____________ |

The operator's authorization signal in this session is the chat message "Authorize C.1" (or equivalent unambiguous wording) with item-by-item decisions, after which §1–§9 above are recorded as the binding pre-implementation contract for C.1 only.

## Changelog

- **2026-05-30 v1** — initial Option C authorization sheet. Mirrors the R1 §D sheet structure adapted for the Option C bundle. Captures operator-locked §7 (Option C is not R1.1 authorization) and §8 (inventory-study re-run before any detector work) as load-bearing binding clauses. Eight mandatory items (§1, §2, §3, §4, §5, §7, §8, §9); one defer-eligible (§6 through C.1 only).
- **2026-05-30 v2** — schema-reality pre-flight before any C.1 apply (operator-approved Option α correction) found v1's backfill source `briefing_workspaces.tenant_id` does NOT exist. The previous v1 sign-off (which authorized a migration referencing the wrong source) is **rescinded**; the corrected v2 sheet supersedes it and requires re-ratification. v2 corrections: §2 CQ1 row reworded for COALESCE-over-two-paths; §2 CQ4 row reworded for the chain-derivation writer plumb (small RPC recommended); §3 scope rows updated to reflect the v2 migration shape and recovery via the two-path FK chain; §195 "What sign-off authorizes" entry updated similarly. **CQ1 strictness preserved verbatim per operator directive: tenant_id required + NOT NULL + fail-closed + Provenance preserved. No C.0 introduced. No softening. tenant_id stays NOT NULL.** No staging apply, no prod apply, no migration commit until the v2 sheet is signed.
