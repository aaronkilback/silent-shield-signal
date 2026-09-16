# WO-ATTRIBUTION-FIX — identity-resolution gate for person Deep-Scan subject attribution

**Status:** DESIGN + PR-STAGED DRAFT ONLY. Nothing applied, deployed, or merged. Draft SQL: `WO-ATTRIBUTION-FIX-draft.sql` (this dir) — **DO NOT APPLY** (see hard dependency below). Supersedes the "confidence columns alone" framing (WO-ATTRIBUTION-CONFIDENCE) — those columns are one component here.

## The defect (precise)
The pipeline decides "is this finding *real*" and "does the source *corroborate*", but **nothing decides "is this about the subject vs a homonym."** `nameGate` (`_shared/subject-retrieval.ts` ~245) is forbidden from rejecting by constraint **C1** ("anchors EXPAND/VERIFY, never RESTRICT"); `verifyFindings` fails **open**. A full-name match is admitted on name alone.

Prod evidence (operator subject `32750258-…`, read-only): entity `role`/`institution`/`specialty` are **NULL**, so `isResultAboutEntity` (`entity-deep-scan:154`) returns `true` unconditionally. Fabricated homonym cases (`Kilback v. Technology/Security/Photo/…`) are live `is_finding=true`. The *Kilback v. Olynyk* finding is a **true** subject finding (operator IS the BC conservation officer) but was admitted for the wrong reason (name+legal context), not resolved identity.

## The fix
**Split the two stages C1 conflated.** Discovery keeps recall (C1 unchanged — don't narrow queries, or the 2011 Olynyk case is never found). **Attribution reverses C1** — anchors may now REJECT.

## Rework — Codex block (four fixes, 2026-09-16)
1. **Independent-provenance exclusion (the core fix).** Every anchor carries `source` (the exact URL / store it was learned from). Before evaluating a candidate page, `resolveAttribution` **excludes any anchor whose `source` is that same page** — or is a page previously misattributed to the subject. **An anchor can never confirm the page it came from.** Without this the gate launders its own past errors: a wrong-person page that once became a "confirmed" finding would seed an anchor that re-confirms that same page forever. Confirmation must come from a *different* source than the page being judged.
2. **Confirmation bar (bare location never confirms).** `confirmed` requires EITHER (a) **≥2 confirming anchors from ≥2 independent sources** (distinct source pages/stores after the exclusion above), OR (b) **exactly one STRONG anchor** — role **+ specific counterparty**, a verified email, a verified handle, an owned domain, or a data-broker PII record. A single WEAK anchor — bare `location`, employer-name-only, generic role — **never confirms** → `unattributed`. (Olynyk = strong compound `role:conservation_officer + case_party:Olynyk`; a name+city coincidence is one weak anchor → not confirmed.)
3. **Hard-stop, no overwrite.** `unattributed`/`unresolved` hard-stop exactly like `contradicted` — `resolveAttribution` returns immediately and the item is written `is_finding=false`. The DB guard `fn_sei_item_gate` **rejects any later UPDATE** that would set `is_finding=true` on an item whose `attribution_state ∈ {unattributed, unresolved, contradicted}`. No downstream classifier (legal/media/…) can overwrite it. There is no code path from unattributed/unresolved to a finding — the fall-through is closed.
4. **Executable activation guard.** The identity gate **refuses to run** for a subject whose `subject_identity_anchors` set has zero `verified` anchors (`if (verifiedAnchors.length === 0) abort('anchors not bootstrapped')`), and the gate feature flag **cannot be enabled** while any active subject has zero verified anchors (startup/deploy-time check). Ordering is enforced in code, not stated in prose — the gate literally cannot evaluate an unbootstrapped subject.

### Anchor model (`subject_identity_anchors`, new table, RLS-at-creation, owner-scoped)
Assembled per scan from: `entities.attributes` (role/employer/specialty/location/email/handles/domains); `subject_learned_terms` (litigant/case_name/citation → `case_party`/`employer`); **prior `attribution_state='confirmed'` findings** (a learned fact like "conservation officer" becomes a reusable anchor). Each anchor row carries: `polarity` (positive/contradicting), `strength` (strong/weak), `source` (provenance URL/store), and `verified` (bool). POSITIVE anchors = subject identity facts; CONTRADICTING anchors = a *different verified* identity's facts.

### Decision rule — `resolveAttribution(subject, anchors, location)`
Anchors are first filtered to those whose `source` ≠ this location's page (fix 1). Then:
| condition (after independence filter) | verdict | persisted |
|---|---|---|
| ≥1 contradicting anchor (verified rival) | **contradicted** → reject/quarantine, **return immediately** | `contradicted`, never a finding |
| ≥2 confirming anchors from ≥2 independent sources, OR 1 STRONG anchor; no contradicting | **confirmed** → admit + record identifier | `attribution_state=confirmed`, `attribution_basis=confirming_anchor` |
| only weak/self-sourced anchors, or full name only | **unattributed** → mention, never a finding, **hard-stop** | `unattributed`, `name_only` |
| no verified anchors loaded / gate could not run | **unresolved** → mention, explicit, **hard-stop** | `unresolved` (Absence-Is-Not-A-Value; never NULL-inferred) |

**Inversion:** a finding now requires BOTH `exposure_class='finding'` AND `attribution_state='confirmed'`. `exposure_class` = "adverse + corroborated?"; `attribution_state` = "is it the subject?" — orthogonal. This demotes the 5 fabricated `Kilback v. <noun>` cases to `unattributed`.

### Olynyk — positive test (resolves beyond the name)
The pressreader article independently states **role: conservation officer**, **jurisdiction: BC Supreme Court**, **counterparty: Olynyk/Ministry**. Even with the string "Aaron Kilback" deleted, `role:conservation_officer + location:BC + case_party:Olynyk` uniquely pins the subject — no homonym (Netflix analyst, @ashkilback, Kindle author) is a BC conservation officer sued by Olynyk → **confirmed**, `attribution_identifier='role:conservation_officer|case_party:olynyk'`.
**Mirror (same mechanism rejects):** `Amparo Kilback — Data Analyst at Netflix` carries contradicting `role:data_analyst`+`employer:Netflix` → **contradicted** → quarantined, forced `is_finding=false` even if a classifier later fires.

### Close the rubber-stamp (WO-GATE2-NONLEGAL)
Gate 2 for non-legal categories tests the page against tokens derived from that same page's title → self-satisfying. Prod: **mention 161/165, media 66/74 `corroborates=true`** (tautology). Fix: non-legal `corroborates=true` only if `resolveAttribution`=confirmed at that location (a confirming anchor independent of the page title); else `corroborates=false, gate_failed='gate2_identity'`. Olynyk's legal locations still pass (carry role/case_party). Net: mention/media corroboration collapses to the real residue; nothing downstream can promote a name-collision.

### Persisted record (item 5 integrated)
`subject_exposure_items`: `attribution_state`/`attribution_identifier`/`attribution_confidence`/`attribution_basis`. `subject_exposure_locations`: `confirming_anchors[]`/`contradicting_anchors[]` (per-location, auditable to source). Full DDL in the draft SQL.

### Code change points
- `_shared/subject-retrieval.ts`: `resolveAttribution` new — **(a) filter out anchors whose `source` == the candidate page** (fix 1), **(b) apply the strong-or-≥2-independent bar** (fix 2), **(c) return immediately on contradicted/unattributed/unresolved** (fix 3); `verifyFindings` rejects `contradicted`, hard-tags `unattributed`/`unresolved` (no fail-open); `loadIdentityAnchors` new (loads `polarity/strength/source/verified`); **`assertAnchorsBootstrapped(subject)` abort guard at the top of the identity branch** (fix 4); thread state through `clusterFindings`/`persist`/`gateLocation`.
- `_shared/corroboration-gate.ts`: `findingEntityPresent` non-legal re-anchored to a confirming anchor from an **independent source** (not the page's own title); new `gate_failed='gate2_identity'`.
- `entity-deep-scan/index.ts`: `isResultAboutEntity` returns `unresolved` (not `true`) when no anchors.
- **DB `fn_sei_item_gate`**: hard-stop guard — an item with `attribution_state ∈ {unattributed,unresolved,contradicted}` is forced `is_finding=false`/`exposure_class='noise'`, and **any UPDATE raising `is_finding` to true on such a row is rejected** (fix 3, non-overwritable at the storage layer). `fn_sel_reclassify` stays a pure counter. **Triggers must stay lockstep with the TS constants.**
- **Activation guard (fix 4, executable):** a feature-flag/startup check that refuses to enable the gate while any active subject has zero `verified` anchors — see draft SQL `attribution_gate_enabled()` guard.

## RULING (2026-09-16, operator)
**The anchor bootstrap ships BEFORE the attribution gate, always.** Nothing about the new gate deploys until the subject's anchors are seeded and verified. **The acceptance oracle below is a HARD GATE** (not advisory): one real re-run — Olynyk `confirmed`, the fabricated `Kilback v. <noun>` cases `unattributed`, any contradicting-anchor homonym `contradicted` — verified in SQL and **shown to the operator before the gate goes live**. This design + PR #223 stay **staged, no deploy, pending Codex**.

## ⚠ HARD DEPENDENCY (acceptance-blocking — from adversarial review)
The live subject entity has `role`/`institution`/`specialty` **NULL**. With no anchors loaded, the gate can only ever return `unattributed`/`unresolved`, so **every finding — including Olynyk — demotes to mention**. WO-ATTRIBUTION-FIX makes the report *emptier, not more correct*, unless the **anchor bootstrap** ships first: seed anchors from `subject_learned_terms` (Olynyk `case_party` already exists) + prior-confirmed findings + operator-supplied `role:conservation_officer`. This is mandatory, not optional. Contradicting anchors require knowing rival identities; safe default = absence of a contradicting anchor never *confirms*, only permits `unattributed` (so the subject is never wrongly rejected for an unknown rival).

## Acceptance oracle (one real run before done)
One real Deep Scan re-run on the Kilback subject where: Olynyk lands `attribution_state='confirmed'` (role + case_party); the 5 fabricated `Kilback v. <noun>` cases land `unattributed`; the Netflix/Ash items land `contradicted` — all verified in SQL.
