# WO-ATTRIBUTION-FIX — identity-resolution gate for person Deep-Scan subject attribution

**Status:** DESIGN + PR-STAGED DRAFT ONLY. Nothing applied, deployed, or merged. Draft SQL: `WO-ATTRIBUTION-FIX-draft.sql` (this dir) — **DO NOT APPLY** (see hard dependency below). Supersedes the "confidence columns alone" framing (WO-ATTRIBUTION-CONFIDENCE) — those columns are one component here.

## The defect (precise)
The pipeline decides "is this finding *real*" and "does the source *corroborate*", but **nothing decides "is this about the subject vs a homonym."** `nameGate` (`_shared/subject-retrieval.ts` ~245) is forbidden from rejecting by constraint **C1** ("anchors EXPAND/VERIFY, never RESTRICT"); `verifyFindings` fails **open**. A full-name match is admitted on name alone.

Prod evidence (operator subject `32750258-…`, read-only): entity `role`/`institution`/`specialty` are **NULL**, so `isResultAboutEntity` (`entity-deep-scan:154`) returns `true` unconditionally. Fabricated homonym cases (`Kilback v. Technology/Security/Photo/…`) are live `is_finding=true`. The *Kilback v. Olynyk* finding is a **true** subject finding (operator IS the BC conservation officer) but was admitted for the wrong reason (name+legal context), not resolved identity.

## The fix
**Split the two stages C1 conflated.** Discovery keeps recall (C1 unchanged — don't narrow queries, or the 2011 Olynyk case is never found). **Attribution reverses C1** — anchors may now REJECT.

### Anchor model (`subject_identity_anchors`, new table, RLS-at-creation, owner-scoped)
Assembled per scan from: `entities.attributes` (role/employer/specialty/location/email/handles/domains); `subject_learned_terms` (litigant/case_name/citation → `case_party`/`employer`); **prior `attribution_state='confirmed'` findings** (so a learned fact like "conservation officer" becomes a reusable anchor). POSITIVE anchors = subject identity facts; CONTRADICTING anchors = a *different verified* identity's facts.

### Decision rule — `resolveAttribution(subject, anchors, location)`
| condition | verdict | persisted |
|---|---|---|
| ≥1 confirming anchor, no contradicting | **confirmed** → admit + record identifier | `attribution_state=confirmed`, `attribution_basis=confirming_anchor` |
| ≥1 contradicting anchor (verified rival) | **contradicted** → reject/quarantine | `contradicted`, never a finding |
| full name only, no corroborating anchor | **unattributed** → mention, never a finding | `unattributed`, `name_only` |
| gate couldn't run (no anchors/no data) | **unresolved** → mention, explicit | `unresolved` (Absence-Is-Not-A-Value; never NULL-inferred) |

**Inversion:** a finding now requires BOTH `exposure_class='finding'` AND `attribution_state='confirmed'`. `exposure_class` = "adverse + corroborated?"; `attribution_state` = "is it the subject?" — orthogonal. This demotes the 5 fabricated `Kilback v. <noun>` cases to `unattributed`.

### Olynyk — positive test (resolves beyond the name)
The pressreader article independently states **role: conservation officer**, **jurisdiction: BC Supreme Court**, **counterparty: Olynyk/Ministry**. Even with the string "Aaron Kilback" deleted, `role:conservation_officer + location:BC + case_party:Olynyk` uniquely pins the subject — no homonym (Netflix analyst, @ashkilback, Kindle author) is a BC conservation officer sued by Olynyk → **confirmed**, `attribution_identifier='role:conservation_officer|case_party:olynyk'`.
**Mirror (same mechanism rejects):** `Amparo Kilback — Data Analyst at Netflix` carries contradicting `role:data_analyst`+`employer:Netflix` → **contradicted** → quarantined, forced `is_finding=false` even if a classifier later fires.

### Close the rubber-stamp (WO-GATE2-NONLEGAL)
Gate 2 for non-legal categories tests the page against tokens derived from that same page's title → self-satisfying. Prod: **mention 161/165, media 66/74 `corroborates=true`** (tautology). Fix: non-legal `corroborates=true` only if `resolveAttribution`=confirmed at that location (a confirming anchor independent of the page title); else `corroborates=false, gate_failed='gate2_identity'`. Olynyk's legal locations still pass (carry role/case_party). Net: mention/media corroboration collapses to the real residue; nothing downstream can promote a name-collision.

### Persisted record (item 5 integrated)
`subject_exposure_items`: `attribution_state`/`attribution_identifier`/`attribution_confidence`/`attribution_basis`. `subject_exposure_locations`: `confirming_anchors[]`/`contradicting_anchors[]` (per-location, auditable to source). Full DDL in the draft SQL.

### Code change points
`_shared/subject-retrieval.ts` (`resolveAttribution` new; `verifyFindings` rejects `contradicted`, tags `unattributed`/`unresolved`, stops identity fail-open; `loadIdentityAnchors` new; thread state through `clusterFindings`/`persist`/`gateLocation`); `_shared/corroboration-gate.ts` (`findingEntityPresent` non-legal re-anchored to confirming anchors; new `gate_failed='gate2_identity'`); `entity-deep-scan/index.ts` (`isResultAboutEntity` returns `unresolved` not `true` when no anchors); DB `fn_sel_reclassify` + `fn_sei_item_gate` (item-level guard so contradicted→noise, unattributed/unresolved→not-finding) — **triggers must stay lockstep with the TS constants**.

## RULING (2026-09-16, operator)
**The anchor bootstrap ships BEFORE the attribution gate, always.** Nothing about the new gate deploys until the subject's anchors are seeded and verified. **The acceptance oracle below is a HARD GATE** (not advisory): one real re-run — Olynyk `confirmed`, the fabricated `Kilback v. <noun>` cases `unattributed`, any contradicting-anchor homonym `contradicted` — verified in SQL and **shown to the operator before the gate goes live**. This design + PR #223 stay **staged, no deploy, pending Codex**.

## ⚠ HARD DEPENDENCY (acceptance-blocking — from adversarial review)
The live subject entity has `role`/`institution`/`specialty` **NULL**. With no anchors loaded, the gate can only ever return `unattributed`/`unresolved`, so **every finding — including Olynyk — demotes to mention**. WO-ATTRIBUTION-FIX makes the report *emptier, not more correct*, unless the **anchor bootstrap** ships first: seed anchors from `subject_learned_terms` (Olynyk `case_party` already exists) + prior-confirmed findings + operator-supplied `role:conservation_officer`. This is mandatory, not optional. Contradicting anchors require knowing rival identities; safe default = absence of a contradicting anchor never *confirms*, only permits `unattributed` (so the subject is never wrongly rejected for an unknown rival).

## Acceptance oracle (one real run before done)
One real Deep Scan re-run on the Kilback subject where: Olynyk lands `attribution_state='confirmed'` (role + case_party); the 5 fabricated `Kilback v. <noun>` cases land `unattributed`; the Netflix/Ash items land `contradicted` — all verified in SQL.
