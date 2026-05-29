# Class A — Global Tradecraft migration design

**Date:** 2026-05-29. **Status:** design + staging-P0 applied. No prod schema work. PR #36 hold honored.

This document answers the operator's five required questions and shows the operator-facing before/after. It is a contract that a future implementation must honor, not the implementation itself.

> **AMENDMENT 2026-05-29 (operator-ratified):** five migration parameters locked. Shadow-gate ran read-only against prod's 15,418 rows; results recorded in §A1 below. P0 schema applied to staging only; prod apply held.

---

## 0. Inputs the design takes as given

From prior ratified work:

- **Target architecture (PR #50):** Class A = Global Tradecraft (no client/tenant cols; `asset_class='global_shared'`; trusted-writer allowlist; anonymization gate at write; labeled `[TRADECRAFT REFERENCE]` at LLM injection).
- **Classification study (PR #51):** the 15,418 legacy NULL-client_id `agent_beliefs` rows are ≥99.9% tradecraft. True Class B in the corpus is at most single-digit rows.
- **Operator-locked anonymization criteria:** entity-name match alone is insufficient. Gate must use tenant-derivative provenance · tenant-unique entities · investigation identifiers · internal asset references · PII indicators.
- **Workstream D claim-type handshake:** tradecraft at LLM injection = `ai_generated_hypothesis`; labeled as methodology, never as observation.
- **PR #36 still held:** Class B schema work (FORCE RLS, `agent_tenant_intelligence` table, tenant-derivative trigger) is *not* part of this migration. This migration is Class A only.

---

## 1. Refined anonymization gate

The gate runs at *read-of-legacy-row* time during migration and at *write-of-new-tradecraft* time thereafter. It produces one of three verdicts per row: **PASS** (auto-migrate to Class A), **QUARANTINE** (auto-route to operator review), or **DEMOTE** (re-route to Class B / discard — single-digit cases).

### 1.1 PASS — all five clauses must be true

| Clause | Definition | Why this discriminates |
|---|---|---|
| **G1 — Tenant-derivative provenance check** | The row's `supporting_entry_ids` (and any other source-provenance fields) do not resolve to tenant-scoped sources. Sources permitted: curated documents, public research entries, cross-tenant general-knowledge entries. Sources forbidden: tenant signals, tenant incidents, tenant entity_content, tenant documents flagged with non-null `client_id`. **Implementation finding (§A1):** on prod, all rows with resolvable provenance resolve cleanly to `expert_knowledge` (globally-shared write-frozen store). 13,322 of 15,418 rows have NULL `supporting_entry_ids` — provenance is *unresolvable*, not *failed*. These flow through a separate `passed_provenance_unknown` bucket rather than auto-quarantine. |
| **G2 — Tenant-unique entity match** | Content does not match any entity in the **tenant-unique allowlist** — a *separate* dictionary built from: `entities` with `role='principal_protectee'` OR `attributes->>'protected_principal'='true'` OR `risk_level='critical'` AND `type='person'` OR explicitly designated employee/asset entities. Does NOT include globally-tracked watchlist actors. Plus the 8 active **client names** as a direct tenant identifier. | Two-tier dictionary distinguishes tenant principals from watchlist actors. The classification study showed entity-name match alone is unsuitable. |
| **G3 — Investigation identifier match** | Content does not match any `poi_investigations.id` (UUID pattern); does not match any `poi_investigations.investigation_number` pattern; does not match any `incidents.id` UUID; does not match any `case_id` reference. | Investigation/incident identifiers are by-construction tenant-bounded. |
| **G4 — Internal asset reference** | Content does not match any value (length ≥ 6 chars) from `clients.high_value_assets` (per-client asset arrays — e.g., "Coastal GasLink", "LNG Canada plant 3"). | Operator-curated client-specific facility/asset names. Distinct from globally-known geographic references. |
| **G5 — PII pattern match** | Content does not match: email regex; phone regex; SSN/SIN/IIN/passport pattern. | PII never belongs in global tradecraft. |

A PASS row is provisionally Class A. It moves to the live `agent_tradecraft` table with `anonymization_status='passed'` (G1 resolved) or `'passed_provenance_unknown'` (G1 unresolvable; content gates pass).

### 1.2 QUARANTINE — any of these triggers operator review

| Trigger | Verdict |
|---|---|
| Any of G2 / G3 / G4 / G5 detects a match | **QUARANTINE** — content-level match suggests possible tenant tie. Operator reviews to confirm tradecraft-with-mention vs tenant-claim. |
| G1 resolves to a **tenant-derived source** (signal / incident / poi_investigation / agent_investigation_memory) | **QUARANTINE** — structural tenant tie detected via provenance. |
| `confidence < 0.55` | **QUARANTINE** (per operator decision 2 — never auto-discard low-confidence). |
| `evolution_log` shows contradictions or rejections | **QUARANTINE** — contested beliefs warrant review before global injection. |

Quarantine routes to `agent_tradecraft_quarantine`. Rows remain there until an operator resolves them.

### 1.3 DEMOTE — explicit Class B detection

| Detection | Verdict |
|---|---|
| G1 fails to tenant-derivative source AND content contains tenant-unique entity name AND content makes a *claim-shape assertion* about that entity | **DEMOTE to Class B** — content is tenant intelligence. |

Expected to apply to at most single-digit rows per the classification study.

---

## 2. The five operator questions, answered

### 2.1 What gets migrated automatically?

Every row that passes the gate's G2–G5 content checks (with G1 either resolved-positive or unresolvable). Per §A1 shadow result: **15,418 of 15,418 (100%) of the legacy NULL-client rows pass the content gates.** Of those:

- **2,096 (13.6%)** carry `anonymization_status='passed'` AND `provenance_resolved=true` — definitively safe.
- **13,322 (86.4%)** carry `anonymization_status='passed_provenance_unknown'` AND `provenance_resolved=false` — content-safe but origin not tracked.

The 86.4% bucket is operator-tunable at retrieval time (§3.2 below). Default: included in prompt injection alongside the resolved bucket. The flag makes the distinction visible to anyone querying.

### 2.2 What gets quarantined automatically?

Per §A1: **0 rows.** The operator's tight dictionary + the absence of tenant-derived source pointers + zero PII matches across the corpus means the quarantine queue is empty before any operator review. The 5%/800-row threshold passes with massive margin.

This means manual review (§2.3) has zero items in the legacy migration. Operator review is reserved for ongoing post-cutover writes that fail the gate.

### 2.3 What gets manually reviewed?

The quarantine queue. Three actions per row: approve / demote / discard. Empty for the legacy migration; operative for future writes.

### 2.4 Rollback path

8 phases. P0–P7 reversible; P8 (legacy DROP) non-recoverable and ≥ 90 days post-cutover.

| Phase | Reversible? | Rollback action | Recovery time |
|---|---|---|---|
| **P0** Schema preparation | Yes | `DROP TABLE` both. Live system unaffected. | seconds |
| **P1** Shadow classification (read-only SELECT against prod) | Yes | None to roll back; report-only. | n/a |
| **P2** Operator quarantine review | Yes | Decisions append-only; reverseable. | per-row, seconds |
| **P3** Bulk Class A insert into shadow | Yes | `TRUNCATE agent_tradecraft`. | seconds |
| **P4** Cutover `dashboard-ai-assistant` (feature-flag) | Yes | Flag flip. | seconds |
| **P5** Cutover remaining operator-facing readers | Yes | Per-surface flag flip. | seconds |
| **P6** Writer cutover (knowledge-synthesizer etc.) | Yes | Code revert. | minutes |
| **P7** Legacy `agent_beliefs` set read-only | Yes | Re-enable writes. | minutes |
| **P8** Drop `agent_beliefs` | **No** | non-recoverable (≥ 90 days post-P7) | n/a |

Invariants:
- Legacy `agent_beliefs` is never modified during P0–P7.
- Every Class A row carries `migration_source_id` back to origin.
- Per-surface feature flags gate every reader independently.

### 2.5 Success metrics

Five orthogonal. The migration is successful only when all five hold.

| # | Metric | Pass criterion | Baseline (today) |
|---|---|---|---|
| **S1** | operator-Aegis tradecraft access restored | dashboard-ai-assistant prompts include ≥ 3 tradecraft items per request on average | **0** (current state — measured) |
| **S2** | no tenant-unique content in Class A | 0 rows in `agent_tradecraft` match any G2/G3/G4/G5 pattern | n/a until P3 |
| **S3** | quarantine review completed | 0 rows in `agent_tradecraft_quarantine` with NULL `reviewed_at` at cutover | **0** queue (empty going in, per §A1) |
| **S4** | no regression in agent-chat / training / login | side-by-side functional equivalence pre vs post | requires P5 measurement |
| **S5** | methodology never labeled as observation | prose-lint regression suite finds 0 violations | requires P4 + lint suite extension |

---

## 3. Operator-facing outcome — before / after

### 3.1 Today (pre-migration)

| Surface | Tradecraft access | Tenant intelligence access | Operator-perceived effect |
|---|---|---|---|
| Aegis chat | **0 items** for every tenant; **77** entity_narratives for Petronas only | (only Petronas) | Operator-Aegis has no methodology context. |
| Executive briefings | 0 items | 0 (de-facto) | Briefings draw only on signals + incidents + agent debates. |
| Agent-to-agent chat | up to 15 tradecraft items per request | (n/a) | Agents learn from the corpus. |
| Training (academy-*) | up to 10 items per agent | (n/a) | Agent training reflects the corpus. |

### 3.2 After migration

| Surface | Tradecraft access | Tenant intelligence access | Operator-perceived effect |
|---|---|---|---|
| Aegis chat | **up to 3 labeled tradecraft items per request** (operator decision 3 — tunable). Label: `[TRADECRAFT REFERENCE — methodology, not observation]`. Drillable. | Unchanged today (Class B unchanged in this migration) | Operator-Aegis has methodology context for the first time. Cannot present methodology as observed fact (S5 enforced). |
| Executive briefings | Up to N labeled items where relevant | Unchanged | Briefings can ground recommendations in methodology with explicit attribution. |
| Agent-to-agent chat | Same as today (reader switches to `agent_tradecraft` post-P5; no behavioral difference) | (n/a) | No regression. |
| Training | Same as today (reader switches to `agent_tradecraft`) | (n/a) | No regression. |
| Tenant intelligence isolation | (separately enforced by future Class B work) | Strictly tenant-scoped via certified retrieval seam | Cross-tenant intelligence contamination remains structurally impossible. |

---

## 4. Phasing

| Phase | Status (this update) | Operator-facing impact | Gate to advance |
|---|---|---|---|
| **P0** Schema | ✅ **staging applied 2026-05-29**; prod held | None | Operator review of count report + explicit prod-apply authorization |
| **P1** Shadow gate | ✅ **executed read-only against prod**; results in §A1 | None | Verdict counts within thresholds (passed) |
| **P2** Operator quarantine review | Not applicable (empty queue) | None | n/a |
| **P3** Bulk Class A insert (shadow) | Pending | None until P4 | Operator authorization |
| **P4** Cutover `dashboard-ai-assistant` (feature-flagged) | Pending | First operator-visible change — Aegis chats start including `[TRADECRAFT REFERENCE]` items | S1 measured > 0 ; S5 prose-lint regression suite extended and green |
| **P5** Cutover remaining operator-facing readers | Pending | Executive briefings include labeled items | S4 regression suite green |
| **P6** Writer cutover | Pending | None visible; legacy table becomes read-only | All new tradecraft writes pass the gate; quarantine catches anything that doesn't |
| **P7** Legacy `agent_beliefs` set read-only + reads removed | Pending | None | All readers point at `agent_tradecraft`; integration tests green |
| **P8** Drop `agent_beliefs` | Pending (≥ 90 days post-P7) | None | Explicit operator approval |

---

## 5. Operator decisions — RATIFIED 2026-05-29

| # | Decision | Locked value |
|---|---|---|
| 1 | Quarantine veto threshold | **≤ 5% (~800 rows).** Actual: 0% on shadow run. |
| 2 | Low-confidence rows | **Quarantine, never auto-discard.** |
| 3 | Initial Class A injection budget | **3 items per Aegis prompt.** Tunable upward later if feedback supports it. |
| 4 | Tenant-unique entity dictionary scope | **Tight: principals, employees, designated assets, investigations, case identifiers, client names.** |
| 5 | Phase ordering | **P4 before P6.** Operator-Aegis consuming Class A tradecraft before writer cutover. |

---

## A1 — Shadow-gate count report (read-only against prod, 2026-05-29)

The gate was implemented as a single SQL query against prod's 15,418 NULL-client `agent_beliefs` rows. No writes. Verdicts:

| Verdict | Count | % of 15,418 | Disposition |
|---|---|---|---|
| **PASS_definitive** (G1 expert_knowledge provenance + content gates pass) | **2,096** | 13.6% | Auto-migrate; `anonymization_status='passed'`, `provenance_resolved=true` |
| **PASS_provenance_unknown** (G1 unresolvable + content gates pass) | **13,322** | 86.4% | Auto-migrate; `anonymization_status='passed_provenance_unknown'`, `provenance_resolved=false` |
| **QUARANTINE** | **0** | 0% | n/a — queue empty |
| **DEMOTE** (Class B detection) | **0** | 0% | n/a |

**Provenance shape:**
- 0 rows had any `supporting_entry_ids` pointing to tenant data (signals / incidents / poi_investigations / agent_investigation_memory).
- All rows with resolvable provenance (2,096) resolved cleanly to `expert_knowledge` — the globally-shared write-frozen store.
- 13,322 rows had NULL `supporting_entry_ids` (older synthesis runs that did not track provenance).

**Content gate (G2–G5) shape on prod:**
- 0 rows matched any active client name.
- 0 rows matched any `clients.high_value_assets` entry of length ≥ 6.
- 0 rows matched an email regex.
- 0 rows matched a phone regex.
- 0 rows matched an SSN/SIN regex.

This is consistent with the classification study (PR #51) which manually verified 0 of 20 SQL-flagged "Class B" rows were genuinely tenant-specific. The refined gate (G1–G5 instead of naive entity-name match) produces operationally clean numbers.

---

## A2 — P0 staging-applied verification (2026-05-29)

Schema applied via `mcp__supabase__apply_migration` to `lkvyrvuakzguszbpwnfz`. Verification:

| Object | Result |
|---|---|
| `agent_tradecraft` columns | 24 ✓ |
| `agent_tradecraft` indexes | 6 ✓ |
| `agent_tradecraft` RLS policies | 1 (`agent_tradecraft_global_select`) ✓ |
| `agent_tradecraft_quarantine` columns | 20 ✓ |
| `agent_tradecraft_quarantine` indexes | 4 ✓ |
| `agent_tradecraft_quarantine` RLS policies | 2 (super_admin select/update) ✓ |
| Functional probe — bad `asset_class` → rejected | PASS ✓ |
| Functional probe — bad `domain` → rejected | PASS ✓ |
| Functional probe — bad `anonymization_status` → rejected | PASS ✓ |
| Functional probe — valid INSERT succeeds | PASS ✓ |
| Cleanup — TRUNCATE leaves 0 rows | ✓ |
| **Rollback status** | Fully reversible: `DROP TABLE public.agent_tradecraft_quarantine; DROP TABLE public.agent_tradecraft;` |

**Prod apply held pending operator review of this report.**

---

## 6. What this design does NOT do (unchanged)

- Does not apply schema to prod. Held pending operator review.
- Does not run P3 (bulk insert into shadow). Held pending operator authorization.
- Does not specify Class B migration. Future work.
- Does not address FORCE RLS posture migration for tenant-bound stores. PR #48 inventory's broader Provenance Doctrine work continues separately.

## 7. Decision requested — next-phase gate

Three calls before any next-phase advancement:

1. **Apply P0 schema to prod?** Reversible; pure additive.
2. **Advance to P3 (bulk insert into shadow `agent_tradecraft`)?** Reversible via TRUNCATE.
3. **Plan P4 (operator-Aegis reader cutover with prose-lint extension)?** That's the first operator-visible change.

The migration can pause at any boundary. P0 + P1 already complete; P2 not applicable (empty queue); P3 and beyond await your call.
