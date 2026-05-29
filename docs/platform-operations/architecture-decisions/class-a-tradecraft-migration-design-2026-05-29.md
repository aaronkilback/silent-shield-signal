# Class A — Global Tradecraft migration design

**Date:** 2026-05-29. **Status:** design only. No code, no migration, no schema work started. Honors PR #36 hold and the target-architecture ratified in PR #50.

This document answers the operator's five required questions and shows the operator-facing before/after. It is a contract that a future implementation must honor, not the implementation itself.

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
| **G1 — Tenant-derivative provenance check** | The row's `supporting_entry_ids` (and any other source-provenance fields) do not resolve to tenant-scoped sources. Sources permitted: curated documents, public research entries, cross-tenant general-knowledge entries. Sources forbidden: tenant signals, tenant incidents, tenant entity_content, tenant documents flagged with non-null `client_id`. | Mirrors the structural fix from §6 Option 3 of the classification study. Catches contamination at the *origin* of the belief, not by inspecting its output text. |
| **G2 — Tenant-unique entity match** | Content does not match any entity in the **tenant-unique allowlist** — a *separate* dictionary built from: `entities` with `role='principal_protectee'` OR `attributes->>'protected_principal'='true'` OR `risk_level='critical'` AND `type='person'` OR explicitly designated employee/asset entities. Does NOT include globally-tracked watchlist actors (North Korea, ISIS-K, Department of Defense, etc.). | Two-tier dictionary distinguishes tenant principals from watchlist actors. The classification study showed entity-name match alone is unsuitable. |
| **G3 — Investigation identifier match** | Content does not match any `poi_investigations.id` (UUID pattern); does not match any `poi_investigations.investigation_number` pattern (case-form like `INV-YYYY-NNNN` if such exists); does not match any `incidents.id` UUID; does not match any `case_id` reference. | Investigation/incident identifiers are by-construction tenant-bounded. Their presence is unambiguous tenant attribution. |
| **G4 — Internal asset reference** | Content does not match any value from `clients.high_value_assets` (per-client asset arrays — e.g., "Coastal GasLink", "LNG Canada plant 3"). Does not match any operator-defined watch-list facility name. | These are operator-curated client-specific facility/asset names. Distinct from globally-known geographic references. |
| **G5 — PII pattern match** | Content does not match: email regex; phone regex; SSN/SIN/IIN/passport pattern; date-of-birth pattern; precise street-address pattern. | PII never belongs in global tradecraft regardless of which tenant it originated from. |

A PASS row is provisionally Class A. It moves to the live `agent_tradecraft` table with `anonymization_status='passed'`.

### 1.2 QUARANTINE — any of these triggers operator review

| Trigger | Verdict |
|---|---|
| Any of G2 / G3 / G4 / G5 detects a match | **QUARANTINE** — content-level match suggests possible tenant tie. Operator reviews to confirm tradecraft-with-mention vs tenant-claim. |
| G1 cannot be resolved (the row's `supporting_entry_ids` is empty, null, or points to source materials that no longer exist) | **QUARANTINE** — provenance unverifiable. Operator decides based on content alone. |
| The row is below a minimum-confidence threshold (e.g., `confidence < 0.55`) | **QUARANTINE** — low-confidence rows aren't worth global-distribution risk; operator review prunes low-value content during migration. |
| The row's `evolution_log` shows contradictions or rejections | **QUARANTINE** — contested beliefs warrant review before global injection. |

Quarantine routes the row to `agent_tradecraft_quarantine` (a parallel table with the same shape plus `quarantine_reason` and `reviewed_by`/`reviewed_at` fields). Rows remain there until an operator either approves, demotes, or discards.

### 1.3 DEMOTE — explicit Class B detection

| Detection | Verdict |
|---|---|
| G1 fails AND content contains tenant-unique entity name AND content makes a *claim-shape assertion* about that entity (e.g., possessive pronouns like "their", "our", or assertion verbs like "is at risk", "is exposed") | **DEMOTE to Class B** — content is tenant intelligence; needs `tenant_id` attribution. |

For the 15,418 legacy rows, this is expected to apply to *at most single digits* per the classification study. Demoted rows DO NOT enter `agent_tradecraft`; they queue for the (separately-planned) Class B migration alongside the 115 already-client-attributed entity_narrative rows.

---

## 2. The five operator questions, answered

### 2.1 What gets migrated automatically?

Every row that passes **all five clauses (G1–G5)**. From the classification study: expected ≥ 99% of the 15,418 rows (≈ 15,200–15,300). These flow to `agent_tradecraft` in a single bulk INSERT-into-staging step with `anonymization_status='passed'` and `migration_source_id` referencing the originating `agent_beliefs.id`.

**Throughput note:** the bulk migration is read-only against the source table and append-only against the destination. The destination `agent_tradecraft` is empty before the migration. No live consumer reads from it yet (that's a later phase). The bulk write is fully reversible by `TRUNCATE agent_tradecraft` until cutover.

### 2.2 What gets quarantined automatically?

Every row failing at least one G-clause without being a clear Class B demote. Per §1.2. From the classification study's false-positive analysis: **expected ~150–400 rows (≈1–3% of 15,418)** will be quarantined automatically — mostly rows that match a globally-known actor entity name without making a tenant-specific claim. Operator review will approve most of these into Class A (since the classification study showed they're tradecraft despite the name mention).

The quarantine table is sized for human review — not unbounded. If automatic quarantine exceeds (say) 800 rows, the gate is too aggressive and the design needs refinement before the migration runs.

### 2.3 What gets manually reviewed?

The quarantine queue. Operator reviews each row with three actions per row:

| Action | Effect |
|---|---|
| **Approve to Class A** | Row copies to `agent_tradecraft` with `anonymization_status='passed_after_review'` plus `reviewed_by`/`reviewed_at`. |
| **Demote to Class B** | Row queues for the (later) Class B migration with required `tenant_id` attribution. Operator supplies the attribution at review time. |
| **Discard** | Row is annotated as `not_migrated` with reason; remains in the legacy `agent_beliefs` table for audit but never enters `agent_tradecraft` or `agent_tenant_intelligence`. |

The expected manual-review volume is the quarantine count above. Review UI is operator-internal (a small queue page). Estimated review time: ~30 seconds per row at typical content density; 200 rows = ~2 hours operator effort across the migration window.

### 2.4 Rollback path

Designed in layers — each phase has an independent revert point.

| Phase | Operator-visible state | Rollback action | Recovery time |
|---|---|---|---|
| **P0 — Schema preparation** | Live system unchanged. `agent_tradecraft` + `agent_tradecraft_quarantine` tables created (empty). | `DROP TABLE` both. Live system unaffected. | seconds |
| **P1 — Shadow classification** | Live system unchanged. Gate runs against all 15,418 rows in shadow mode; writes verdicts to a reporting table only; no rows in `agent_tradecraft` yet. | Delete the reporting rows. Live system unaffected. | seconds |
| **P2 — Operator quarantine review** | Live system unchanged. Quarantine queue populated; operator reviews. | Operator decisions are append-only; can be reversed by writing a new verdict. | per-row, seconds |
| **P3 — Bulk Class A insert (shadow)** | Live system unchanged. `agent_tradecraft` populated with PASS rows + approved-after-review rows. No reader is wired to it. | `TRUNCATE agent_tradecraft`. | seconds |
| **P4 — Reader cutover (one surface at a time)** | First operator-facing surface (`dashboard-ai-assistant`) starts reading `agent_tradecraft` for Class A injection. Legacy `agent_beliefs` reads still happen at other surfaces. | Feature-flag toggle reverts `dashboard-ai-assistant` to read from `agent_beliefs` again (which still exists, untouched). | seconds (env-var flip) |
| **P5 — All readers cut over** | All operator-facing surfaces read from `agent_tradecraft`. Legacy `agent_beliefs` still exists, still writable by the unchanged writers. | Per-surface feature flag flip reverts to legacy reads. | seconds |
| **P6 — Writer cutover** | `knowledge-synthesizer:197` (and the 3 other writers) write to `agent_tradecraft` via the trusted-writer RPC. Legacy `agent_beliefs` becomes read-only. | Revert writer code; legacy `agent_beliefs` accepts writes again. New `agent_tradecraft` writes that landed in the interim remain queryable. | minutes (code revert + deploy) |
| **P7 — Legacy decommission** | `agent_beliefs` is set to `read-only` mode (write-freeze trigger). Still queryable. Reads from it removed from all code paths. | Disable write-freeze trigger; reintroduce reads. | minutes |
| **P8 — Legacy drop** | `agent_beliefs` table dropped. Only `agent_tradecraft` and `agent_tenant_intelligence` exist. | NON-RECOVERABLE except via DB backup restore. **This phase only happens ≥ 90 days post-cutover** with explicit operator approval. |

**The migration is reversible up to and including P7.** P8 is intentionally far in the future.

**Key invariants throughout rollback:**

1. **Legacy `agent_beliefs` is never modified during P0–P7.** The migration is additive, not destructive, until very late.
2. **Every Class A row in `agent_tradecraft` carries `migration_source_id` pointing back to the originating `agent_beliefs.id`.** Forward and reverse mappings always exist.
3. **Per-surface feature flags** (`USE_AGENT_TRADECRAFT_FOR_DASH_AI`, `USE_AGENT_TRADECRAFT_FOR_AGENT_CHAT`, etc.) gate every reader independently. A surface can be reverted without affecting others.

### 2.5 Success metrics (proves migration worked)

Five orthogonal metrics. The migration is judged successful only when **all five** hold.

| # | Metric | Pass criterion | How measured |
|---|---|---|---|
| **S1** | **Operator-Aegis tradecraft access restored** | dashboard-ai-assistant Aegis prompts now include ≥ 3 tradecraft items per request on average (today: 0) | Flight Recorder `aegis_retrieval_trace` rows tagged `class='global_tradecraft'`; sampled over 100 consecutive prod chat turns |
| **S2** | **No tenant-unique content reached Class A** | 0 of the rows in `agent_tradecraft` match any tenant-unique entity / investigation identifier / internal asset / PII pattern | Re-run the G2–G5 gates against the final `agent_tradecraft` table; count must be 0 |
| **S3** | **Quarantine review completed cleanly** | 100% of quarantined rows reach a terminal state (approve / demote / discard). Quarantine queue empty at cutover. | Count `agent_tradecraft_quarantine` rows with NULL `reviewed_at` (must be 0) |
| **S4** | **No regression in agent-chat / training / login behavior** | Pre-migration vs post-migration outputs from these surfaces are functionally equivalent (same agent personalities, same training topics, same login summary topics) | Side-by-side comparison on a fixed set of test prompts before/after cutover |
| **S5** | **Methodology never labeled as observation** | All Class A injections in Aegis prompts carry the `[TRADECRAFT REFERENCE — methodology, not observation]` label; prose-lint (from Workstream D) detects zero violations of "Confirmed:…" / "Reports indicate…" framing applied to a tradecraft item | Workstream D prose-lint regression suite extended with tradecraft-labeling cases; CI gate fails if any violation lands |

**Failure of any single metric blocks cutover to the next phase.** The migration is staged so that S1 + S2 are testable during P3 (shadow), and S3 + S4 + S5 are testable progressively during P4–P6.

---

## 3. Operator-facing outcome — before / after

### 3.1 Today (pre-migration)

| Surface | Tradecraft access | Tenant intelligence access | Operator-perceived effect |
|---|---|---|---|
| Aegis chat (dashboard-ai-assistant) | **0 items** for every tenant except Petronas Canada; 0 for Petronas as well (the 115 owned entity_narrative rows are not tradecraft) | 77 entity_narratives for Petronas; 0 for everyone else | Operator-Aegis has no methodology context. Every chat is data-only or model-default. |
| Executive briefings (generate-daily-briefing) | 0 items | 0 (de-facto) | Briefings draw only on raw signals + incidents + agent debates. |
| Agent-to-agent chat | up to 15 tradecraft items per request (currently the only consumer of the 15,418 corpus) | (n/a — agent-chat is operator-tier) | Agents learn from the corpus. Operators don't see it. |
| Training (academy-*) | up to 10 items per agent | (n/a) | Agent training material reflects the corpus. |

**Effective state:** the 15,418 tradecraft beliefs exist but are invisible to every operator-facing surface. Operator capability deficit is the side effect of INC-LEARN-CONTAM containment applied uniformly.

### 3.2 After migration

| Surface | Tradecraft access | Tenant intelligence access | Operator-perceived effect |
|---|---|---|---|
| Aegis chat | **up to N labeled tradecraft items per request** (N tunable; default 5). Each item carries `[TRADECRAFT REFERENCE — methodology, not observation]` and a drill-down link to the source. | Unchanged today (Class B unchanged in this migration) | Operator-Aegis has methodology context for the first time. Can answer questions like "What does workplace-violence pathway analysis say about this signal?" with proper attribution. **Cannot** present methodology as observed fact (S5 enforced by prose-lint). |
| Executive briefings | Up to M labeled items if relevant to the briefing scope. Independent N tunable. | Unchanged | Briefings can ground recommendations in methodology with explicit attribution. |
| Agent-to-agent chat | Same as today (corpus unchanged in content; the read switches to `agent_tradecraft` post-P5 with no behavioral difference) | (n/a) | No regression. |
| Training | Same as today (read switches to `agent_tradecraft`) | (n/a) | No regression. |
| Tenant intelligence isolation | (separately enforced by future Class B work) | Strictly tenant-scoped via certified retrieval seam | Cross-tenant intelligence contamination remains structurally impossible. |

**Effective state:** the false choice between *capability deficit* and *contamination risk* is resolved. Aegis regains methodology expertise (labeled). Tenant intelligence stays isolated (untouched in this migration; addressed by the future Class B work). Methodology is structurally prevented from masquerading as observation (Workstream D prose-lint + injection labeling).

---

## 4. Phasing — operator-visible cutover schedule

This is the *shape* of the migration; not a calendar.

| Phase | Reversible? | Operator-facing impact | Gate to advance |
|---|---|---|---|
| **P0** — Build `agent_tradecraft` + `agent_tradecraft_quarantine` schema | Yes | None | Schema review + operator approval |
| **P1** — Shadow gate run against all 15,418 rows | Yes | None (results visible to operator only) | Quarantine count < 800; manual sanity-spot of sample quarantine rows |
| **P2** — Operator review of quarantine queue | Yes | None | Queue empty (S3) |
| **P3** — Bulk Class A insert into `agent_tradecraft` (shadow; no readers wired) | Yes (TRUNCATE) | None | S2 audit passes (0 tenant-unique content in `agent_tradecraft`) |
| **P4** — Cut over `dashboard-ai-assistant` to read from `agent_tradecraft` (feature-flagged) | Yes (flag flip) | Operator-Aegis starts seeing tradecraft references | S1 measured > 0; S5 enforced by prose-lint regression suite |
| **P5** — Cut over remaining operator-facing readers (executive briefings) | Yes (flag flip) | Executive briefings start including tradecraft references | S4 regression suite green |
| **P6** — Cut over writers (knowledge-synthesizer:197, ingest-expert-media, etc.) to write to `agent_tradecraft` via the trusted-writer RPC + anonymization gate | Yes (code revert) | None visible; legacy `agent_beliefs` becomes read-only | All new tradecraft writes pass the gate; quarantine catches anything that doesn't |
| **P7** — Legacy `agent_beliefs` table set read-only + reads removed from all code | Yes (re-enable writes) | None | All readers point at `agent_tradecraft`; integration tests green |
| **P8** — **Drop `agent_beliefs`** | **No** | None | ≥ 90 days post-P7 + explicit operator approval |

Each phase's gate must pass before the next begins. The migration can pause indefinitely between any two phases.

---

## 5. Open design decisions before implementation begins

These are the calls that downstream implementation needs you to make:

1. **Quarantine threshold for migration veto.** If automatic quarantine produces > 800 rows (≈ 5% of corpus), is that a signal to refine the gate further before P2, or to absorb the operator review burden? My recommendation: refine the gate; the false-positive cost is high enough to warrant another pass.
2. **Minimum-confidence threshold for inclusion.** §1.2 proposes confidence < 0.55 → quarantine. Should it instead be (a) auto-discard low-confidence rows entirely, (b) include them in Class A with a "low-confidence" flag that reduces their injection priority, or (c) the proposed quarantine path?
3. **Class A injection budget per Aegis prompt.** §3.2 cites a default of 5 items per prompt. Should this default be lower (e.g., 3) to start conservatively, then raised based on operator feedback?
4. **Tenant-unique entity dictionary scope.** §1.1 G2 proposes a tighter tier (principal protectees + critical persons + designated assets). Should the dictionary also include client-employee entities? Confirmed-stalker entities? The narrower the dictionary, the more rows pass G2; the broader, the more rows quarantine.
5. **Writer RPC enforcement of the gate.** The proposed RPC `record_tradecraft_belief()` runs the G1–G5 gate before insert. Should the gate failures land in `agent_tradecraft_quarantine` automatically, or should the RPC return an error to the calling function and let it handle the rejection? My recommendation: automatic quarantine routing — simpler caller contract.
6. **Phase ordering — should P6 (writer cutover) come before P4 (operator-Aegis reader cutover)?** Argument for: stop the bleeding first (no new NULL-owner writes), then migrate the legacy corpus. Argument against (the current proposal): operator-visible value (S1) lands earlier, validating the architecture before the more invasive writer change.

---

## 6. What this design does NOT do

- Does not specify the `agent_tradecraft` table DDL — that's the Class A schema migration (Class B work; held alongside PR #36 until operator authorization to begin).
- Does not specify Class B migration. The 115 already-client-attributed entity_narrative rows + any P2-demoted rows queue separately. Distinct future design.
- Does not implement the gate. The gate is specified at the criteria level; implementation choices (NER vs lexical, batched vs streaming, etc.) are downstream.
- Does not address FORCE RLS posture migration for tenant-bound stores. PR #48 inventory's broader Provenance Doctrine work continues separately.
- Does not commit to a calendar. Phases gate on metrics, not dates.

## 7. Decision requested

Five inputs needed from you before any implementation begins:

1. **Quarantine threshold** for migration veto (recommendation: ≤ 5% / ~800 rows).
2. **Minimum-confidence threshold** policy (recommendation: quarantine, not discard).
3. **Class A injection budget** default (recommendation: 5 items per prompt; tunable).
4. **Tenant-unique entity dictionary scope** (recommendation: tight — principals + critical + designated assets only).
5. **Phase ordering** confirmation (P4 before P6, per current proposal).

Plus: explicit authorization to enter P0 (schema work). That authorization, when given, lifts the PR #36 hold *only for the Class A scope* — Class B schema work continues to be held.
