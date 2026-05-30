# Decision Layer R1 — Authorization Sheet (pre-R1.0 sign-off)

**Status:** PROPOSED 2026-05-29 — signable authorization artifact. **This document does not, by itself, authorize implementation.** Operator sign-off on §1–§8 below converts the recommendations from `decision-layer-r1-q-recommendations-2026-05-29.md` (v2, post-Q5 clarification) into the authorized basis for the **R1.0 phase only** — schema + RLS + provenance assertion on `aegis_decision_threshold_trace`, and nothing else.

**Companion artifacts (all unchanged by this sign-off):**
- `architecture-decisions/decision-layer-doctrine-2026-05-29.md` (RATIFIED v2)
- `architecture-decisions/decision-layer-r1-threshold-detection-2026-05-29.md` (R1 ADR — RATIFIED in principle, **unchanged** per operator directive)
- `decision-layer-r1-q-recommendations-2026-05-29.md` (v2 — Q1–Q10 + audit watchlist + I1/I2 invariants)

**Operator-locked invariants from Q5 clarification (binding for all phases R1.x):**

> **I1.** Statistical noise without commitment impact ≠ frame.
>
> **I2.** Quiet commitment-invalidating event ≠ excluded.

---

## How to use this sheet

For each of the 8 items below:
- **Default** = the recommendation from the Q1–Q10 doc (post-operator-approval).
- **Operator action** = one of: `CONFIRM default` · `OVERRIDE → [value]` · `DEFER (do not authorize this item)`.
- A single item left at `DEFER` does **not** block R1.0 sign-off for the other items, but R1.0 implementation will skip / pause on the deferred dimension until it's confirmed.

Operator signs by indicating their action against each item. No code, schema, or behavioral change is authorized until **at least items 1–4 + item 7 + item 8** are confirmed (items 5 and 6 can defer without blocking R1.0).

---

## §1 — Q1–Q10 resolutions

Confirms the 10 question resolutions from `decision-layer-r1-q-recommendations-2026-05-29.md` v2 (post-Q5 clarification).

| Q | Resolution | Operator action |
|---|---|---|
| **Q1** | Minimal hard-coded authority map for R1 cold-start; full authority-map ADR follows. (Operator strong approval recorded.) | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q2** | Detector runs in-process inside `dashboard-ai-assistant`; refactor to `_shared/` if ≥2 surfaces consume in future. | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q3** | Dynamic commitment derivation from existing surfaces; dedicated `principal_commitments` table deferred to a follow-on ADR. (Operator strong approval recorded.) | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q4** | Working-model snapshot bound: `min(last_briefing, 30 days)` globally. | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q5** | Rolling 28-day median + z-score ≥ 2 retained **for telemetry and observability ONLY**. Commitment-linkage is the sole C1 gating signal. Invariants **I1** and **I2** are operator-locked. | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q6** | Cold-tenant first-query → `frame_fires=false`; tenant warms up implicitly via existing surfaces (first briefing, first incident, first itinerary, ≥3 substantive chat turns). (Operator strong approval recorded.) | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q7** | Investigation-hypothesis expiry: use `investigations.next_review_at` if set; if NULL, treat as expired. | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q8** | Detector budget: 200ms cap, fail-closed to `frame_fires=false`, every timeout traced as `short_circuit_axis='timeout'`. | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q9** | Per-tenant feature flag + global kill switch + row-level `audit_only` field. (Operator strong approval recorded.) | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **Q10** | `dashboard-ai-assistant` only for R1 cold-start; expansion to other surfaces is a separate operator-gated decision per surface. (Operator strong approval recorded.) | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |

---

## §2 — Audit watchlist classes

Confirms the four durably-tracked classes from §B of the recommendations doc.

| Class | Definition | Operator action |
|---|---|---|
| **§B.1** Operator-flagged false-negative class | Significant signal without explicit commitment to invalidate. Tracked via new Flight Recorder field `c1_significant_no_commitment`. Daily operator review. Per-pattern tuning rules re-evaluate specific Q's (Q3/Q4/Q6/Q7). (Operator strong approval recorded — "correct mechanism for measuring the known blind spot without weakening the doctrine.") | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **§B.2** Cross-tenant fire-rate variance | Per-tenant normalized fire rate; flagged if any tenant >2× median of active tenants. | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **§B.3** Ungrounded firing | Every cited `evidence_row_ids` / commitment_id must resolve to a real, tenant-scoped row. **Zero-tolerance** — any single occurrence stops the R1.7 clock. | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |
| **§B.4** Statistical drift into gate (I1 violation) | Static audit (build-time assertion that `materiality_score` reads from commitment-linkage only) + runtime audit (any fired frame whose C1 candidates all have `invalidated_commitment_id=null` is an I1 violation). **Zero-tolerance.** | ☐ CONFIRM ☐ OVERRIDE: ______________ ☐ DEFER |

---

## §3 — R1.0 scope confirmation

R1.0 authorizes the following work, and **only** the following work:

| In scope for R1.0 | Out of scope (deferred to R1.1+) |
|---|---|
| Create `aegis_decision_threshold_trace` table (columns per R1 ADR §6) | C1 / C2 / C3 detector logic (R1.1, R1.2, R1.3) |
| Apply Provenance Doctrine contract (`tenant_id NOT NULL`) | The threshold aggregator (R1.4) |
| Apply RLS policy (tenant-scoped SELECT; service-role writes via the shared seam) | Flight Recorder integration into `dashboard-ai-assistant` (R1.4) |
| Apply CHECK constraint backstop for ownership invariant | Behavioral effect of any kind |
| Migration is reversible (drop table, no data dependency yet) | Tuning, observation, promotion (R1.5, R1.6, R1.7) |

R1.0 produces **zero** behavioral effect — the table exists, but nothing writes to it yet. Detector code lands in R1.1+, gated separately.

**Operator action:** ☐ CONFIRM R1.0 scope = schema only · ☐ OVERRIDE: ______________

---

## §4 — Phased gating

R1.0 through R1.7 are **individually gated**. Sign-off on R1.0 does NOT authorize R1.1 — each phase requires its own operator GO. Each phase is reversible (R1.0 by drop migration; R1.1–R1.4 by detector code revert; R1.5–R1.6 are observation only; R1.7 is the audit-only → behavioral promotion gate).

| Phase | Scope (one-line) | Gate |
|---|---|---|
| R1.0 | Schema + RLS + provenance assertion | This sheet |
| R1.1 | C1 detector (commitment-linkage + materiality, telemetry alongside) | R1.0 green + separate operator GO |
| R1.2 | C2 detector (minimal authority map + stake classifier) | R1.1 green + separate operator GO |
| R1.3 | C3 detector (deadline derivation + live-decision identification) | R1.2 green + separate operator GO |
| R1.4 | Aggregator + Flight Recorder integration | R1.3 green + separate operator GO |
| R1.5 | 7-day audit observation (no code changes) | R1.4 green |
| R1.6 | Tuning iteration (if required) | R1.5 evidence shows it's needed |
| R1.7 | Audit-only → behavioral promotion (R2 takes the output) | All §7 promotion criteria met + separate operator GO |

**Operator action:** ☐ CONFIRM phases are individually gated · ☐ OVERRIDE: ______________

---

## §5 — Pilot tenant for the 7-day audit (defer-eligible)

Names which tenant gets `decision_frame_enabled = true` first (the audit-only canary). The detector produces zero behavioral effect even in this tenant during the audit period — only the Flight Recorder field is populated.

**Recommendation:** A non-customer-facing internal/test tenant for day 1 (sanity check that the detector runs without errors), then promote to a real tenant for the full 7-day audit. The real tenant should have **active commitments** in working-model surfaces (recent briefings, open incidents, scheduled itineraries) so the C1 detector has material to evaluate.

| Phase | Recommended pilot tenant | Operator action |
|---|---|---|
| Day 1 (sanity check) | Internal/test tenant (operator names which one) | ☐ Name tenant: ______________ ☐ DEFER (item 5 only) |
| Days 2–8 (full audit) | A real tenant with active commitments — e.g., Petronas Canada (PECL) or BC Children's Hospital (BCCH) | ☐ Name tenant: ______________ ☐ DEFER (item 5 only) |

Item 5 may be deferred without blocking R1.0 sign-off (schema can be applied to all tenants but never activated until item 5 resolves).

---

## §6 — Audit cadence (defer-eligible)

The R1 ADR §7 names a 7-day audit period. The operator can adjust the cadence of daily review within that period.

**Recommendation:** Daily review of:
- `frame_fires` summary (total / by tenant / by short-circuit axis)
- Top 5 entries in `c1_significant_no_commitment` (§B.1 watchlist)
- Any §B.3 (ungrounded firing) or §B.4 (I1 violation) occurrences
- Cross-tenant variance summary (§B.2)

**Operator action:** ☐ CONFIRM daily review · ☐ OVERRIDE cadence: ______________ ☐ DEFER (item 6 only)

Item 6 may be deferred without blocking R1.0 sign-off (cadence is reviewable in R1.4 before R1.5 observation begins).

---

## §7 — R1.7 promotion authority

R1.7 (audit-only → behavioral effect; R2 takes the output) is the **load-bearing handoff** that converts R1 from observability to behavior. It must require explicit operator GO; no automatic threshold may promote it.

**Confirmation:** R1.7 promotion requires:
1. All 6 promotion criteria from the R1 ADR §7 met (7+ days observed, FP ≤ 20%, FN ≤ 20%, zero ungrounded firings, zero I1 violations, per-tenant variance normal).
2. Operator's explicit written GO message (no implicit promotion).
3. The kill switch (§Q9) remains live and one-toggle-revertible after promotion.

**Operator action:** ☐ CONFIRM R1.7 requires explicit operator GO · ☐ OVERRIDE: ______________

---

## §8 — Held items remain unchanged

The following remain held and are **not** modified by this sign-off:

- P5 / P6 / Class B / PR #36 (unchanged across all current ADRs)
- R2 / R3 / R4 / R5 / R6 (held until R1.7 promotion gate)
- The Decision Layer Doctrine itself (`decision-layer-doctrine-2026-05-29.md` v2, RATIFIED)
- The R1 ADR itself (`decision-layer-r1-threshold-detection-2026-05-29.md`, **unchanged** per operator directive)
- All preservation contracts from the R1 ADR §10 (Tenant Isolation, Provenance, Anti-Fab, Grounding, Tradecraft separation, Recommendation/Approval/Execution separation, Flight Recorder, Authority Modes, Commander's Intent)

**Operator action:** ☐ CONFIRM held items unchanged · ☐ OVERRIDE: ______________

---

## What this sign-off authorizes (and what it does not)

If items 1, 2, 3, 4, 7, and 8 are all `CONFIRM`ed (with items 5 and 6 either confirmed or deferred):

✅ **Authorized:** R1.0 — schema + RLS + provenance assertion on `aegis_decision_threshold_trace`. Reversible migration. Zero behavioral effect.

❌ **NOT authorized by this sheet:**
- R1.1 C1 detector logic
- R1.2 C2 detector logic
- R1.3 C3 detector logic
- R1.4 aggregator + Flight Recorder integration
- R1.5 observation (gated on R1.4 green)
- R1.6 tuning (gated on R1.5 evidence)
- R1.7 audit-only → behavioral promotion (gated on §7 criteria + explicit operator GO)
- Any R2/R3/R4/R5/R6 work
- Any change to the Decision Layer Doctrine
- Any change to the R1 ADR
- Any change to held items (P5, P6, Class B, PR #36)

Each subsequent phase has its own operator GO requirement.

---

## Sign-off block

| Item | Operator decision | Date |
|---|---|---|
| §1 Q1–Q10 (10 lines) | _to be marked by operator_ | _____________ |
| §2 Audit watchlist (4 classes) | _to be marked by operator_ | _____________ |
| §3 R1.0 scope = schema only | _to be marked by operator_ | _____________ |
| §4 Individually-gated phases | _to be marked by operator_ | _____________ |
| §5 Pilot tenant | _to be marked by operator (or DEFER)_ | _____________ |
| §6 Audit cadence | _to be marked by operator (or DEFER)_ | _____________ |
| §7 R1.7 promotion authority | _to be marked by operator_ | _____________ |
| §8 Held items unchanged | _to be marked by operator_ | _____________ |
| **Authorization for R1.0** | ☐ AUTHORIZED ☐ NOT YET AUTHORIZED | _____________ |
| Authorizing operator | _______________________________ | _____________ |

The operator's authorization signal in this session is the chat message "Authorize R1.0" (or equivalent unambiguous wording) with item-by-item decisions, after which the §1–§8 above are recorded as the binding pre-implementation contract for R1.0.

## Changelog

- **2026-05-29 v1** — initial §D authorization sheet. Captures Q1–Q10 resolutions (post-operator-approval with Q5 clarification), the four audit watchlist classes (including new §B.4 for I1 invariant guard), R1.0 scope, phased gating, pilot-tenant + audit-cadence (defer-eligible), R1.7 promotion authority, and held-items confirmation. **Items 1–4 + 7–8 mandatory for R1.0 authorization; items 5–6 defer-eligible.**
