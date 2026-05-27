# ADR — Aegis Operational State Integrity (no implied actions)

**Status:** RATIFIED 2026-05-27 — governing doctrine for operational actions, recommendations, approvals, and execution. **Locked principle: "No persisted object → no claim"** (the operational equivalent of "no trace → no claim"). Aegis must never narrate operational state that does not exist in persisted form — *operationally truthful, not theatrically operational; never sound more capable than the underlying operational state actually is.* First build slice (C/D persisted recommendations + claim discipline) greenlit; E (approval) and F (execution) follow — do NOT jump to execution.

## Problem (formalized — workflow theater)
Retrieval + reasoning (A/B) are real (certified entity graph, provenance, isolation). But the action layers are simulated:
- **"change Trent Reznor to monitored"** → honest refusal (good — safer than fake success) but **generic-SaaS wording** ("consult your system administrator") that misrepresents the real authority model.
- **"recommend a source"** → *"I've made a recommendation… pending human approval."* **Proven false:** that phrasing exists in **no source code** — it was **LLM narration with no tool call and no persisted row.** When challenged, Aegis admitted *"I have not yet formed a specific recommendation."*

This is **implied persistence / implied actions / implied workflows / implied approvals without stored operational state.** It is the single most corrosive trust failure: the model *narrates* operational state that does not exist.

## Principle (RATIFIED intent)
**Aegis may assert that a recommendation/action/approval/execution exists ONLY if a persisted operational object exists**, with: `id` · `status` · `approval_state` · scope (`target_tenant`/`client`/`entity`) · `actor` · `audit` · timestamps. **No object → no claim.** "I recommend …" (a proposal in conversation) and "I have recorded recommendation `[rec:ID]`, status=pending_approval" (a persisted object) are **different speech acts** and must never be conflated.

## A–F pipeline separation + maturity
| Stage | Definition | State requirement | Today |
|---|---|---|---|
| **A. Retrieval** | scoped reads | certified surface + provenance trace | ✅ real (entity graph slice) |
| **B. Reasoning** | analysis over retrieved facts | cites A's provenance | ✅ real |
| **C. Recommendation generation** | produce a concrete proposal | **persisted object created, id returned** | ◑ **simulated** — narrated, often not persisted |
| **D. Persistence** | store the proposal | row in a proposals/recommendations table | ◑ partial — `monitoring_proposals`/`signal_merge_proposals`/`tech_radar_recommendations`/`entity_suggestions` exist (have `status`) |
| **E. Approval workflow** | explicit approve/reject + who/when | `approval_state` + approver + audit | ❌ **absent** — no approval column on any proposal table |
| **F. Execution** | apply an approved object | via `operatorAction` (actor≠owner) + receipt | ❌ absent (e.g. monitoring-toggle has no tool) |

## Operational object model (unify + extend)
Every C-stage output is a **persisted operational object**:
```
{ id, kind ('monitoring_adjustment'|'source_recommendation'|'signal_merge'|...),
  target_tenant, target_client?, target_entity?,
  payload (the concrete proposal),
  status: draft → pending_approval → approved | rejected → applied,
  created_by (actor: tenant user OR operator), created_at,
  approved_by?, approved_at?, applied_by?, applied_at?,
  audit (trace of state transitions) }
```
Reuse the existing proposal tables; **add the missing `approval_state`/approver/audit columns** (E is the biggest gap). Aegis's recommend/propose tools MUST insert this object and return its `id`; if they don't persist, they MUST NOT narrate a recommendation as existing.

## Claim discipline (the enforcement — action-side of "no trace → no claim")
- Aegis may say **"I've recorded a recommendation [rec:ID]"** only when the tool returned a real `id`.
- Otherwise it says **"I can propose X — shall I record it for approval?"** (a proposal, no implied state). It must **never** say "made", "submitted", "pending approval", or "applied" without the object.
- "approved" / "applied" claims require the object to be in that `status` (verified by re-read), per the post-action receipt rule (AR3).
- Audit existing `recommend_*`/`suggest_*`/`propose_*` tools: which persist (return id) vs which return narration only. The narration-only ones are defects — make them persist or make them honest proposals.

## Approval workflow (E)
Explicit `approval_state` + transitions + authority: who may approve a given `kind` (tenant analyst vs operator) — derived from the authority model, not implied. Every transition writes audit. No silent auto-approval; no "pending approval" without a row actually in `pending_approval`.

## Execution (F)
An object is applied **only when `status='approved'`**, through the **`operatorAction` seam** (Aegis Ops control plane): explicit `target`, actor≠owner, audit row, **measured receipt** ("monitoring enabled for entity X; active_monitoring_enabled=true"). The **monitoring-state toggle** ("change Trent to monitored") becomes a real F-stage capability here — not a refusal forever.

## Refusal wording (operational, not generic SaaS)
Until a capability's F-stage tool exists, refusals must be **operationally honest** and reflect the real authority model — tied to the capability registry (AR1):
- ❌ "Please consult your system administrator."
- ✅ *"I can identify the required change (enable monitoring for Trent Reznor), but monitoring-state modifications require authorized operational approval and that execution path isn't enabled yet."*

It names the change, states the authority gap, and does not imply it happened.

## Relationship + sequencing
This is the **persistence/approval/execution layer** of the already-ratified action-integrity doctrine (AR1–AR6) and the Aegis Ops control plane (`operatorAction`, actor≠owner, audit, receipts). It extends the unified retrieval graph's discipline from reads to actions. **Build follows ratification**, slice-by-slice (recommendation object + claim discipline first; approval columns; then execution via `operatorAction`, with monitoring-toggle as the first F-stage capability). Prioritized **above new AI surface features**, per operator direction.

**No code. Formalization of operational state integrity. Implementation is the gated next focus.**
