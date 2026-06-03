# Fortress Assessment Baseline Framework

**Status:** DRAFT PROPOSAL — uncommitted, for operator review.
**Nature:** An *evidence system*, not a roadmap. It records where Fortress **actually is**, repeatedly,
over time, so earned capability can be distinguished from intent, effort, and optimism.
**Governs itself:** this framework is subject to the [Aegis Capability Integrity Doctrine] — it may
not promote any capability status without evidence, and its own maturity is PRESENT (proposed), not
PROVEN, until assessments are actually produced under it.

> Roadmaps describe where Fortress is going. Assessments describe where Fortress is.
> A roadmap is not evidence. An assessment is not vision. Never conflate them.

---

## 0 · The baseline (verified to exist, 2026-06-01)

- **Assessment 001 = `docs/platform-operations/program-readiness-review-2026-05-30.md`** — confirmed
  present; it is a real point-in-time, evidence-tagged readiness record (Proven-fixed/unverified/known-risk
  subsections, a capability inventory, readiness scores, and a "what this is NOT" section).
- **Constraint it imposes:** it grades in its own vocabulary (`Production Ready / Pilot Ready /
  Experimental / Dormant` + `N/10` scores), which predates the `NOT PRESENT / PRESENT / PROVEN /
  TRUSTED` labels and the Mark/Level model. The framework therefore defines a **one-way translation
  layer** (§6) so later assessments compare cleanly — **without editing 001** (historical integrity).

---

## 1 · Assessment structure

Every assessment is an **immutable, sequentially-numbered, dated document**: `Assessment NNN — <type> — <YYYY-MM-DD>`.
Required sections:

1. **Header & provenance:** assessment id, date, **assessor identity + type** (Claude / Codex / human
   audit / third-party), and the prior assessment + baseline it compares against.
2. **Epistemic scope declaration (mandatory):** exactly what the assessor *could* and *could not*
   verify, and by what means (ran tests / read code / queried telemetry / observed runtime / relied on
   prior docs). An assessment that does not state its limits is invalid. Distinguish **verified this
   assessment** from **carried on documentary faith**.
3. **Capability ledger delta:** the per-capability status table (§3) with evidence refs.
4. **Trustworthiness ledger delta:** per-dimension trust evidence (§4).
5. **Comparison to prior + baseline:** improved / regressed / newly-proven / still-unproven /
   assumptions-invalidated / evidence-expired (§5).
6. **Risk & trust-gap register:** open risks, ranked by customer/deployment/mission impact.
7. **What this assessment is NOT:** explicit non-claims, to block downstream inflation.

No assessment may contain roadmap aspirations as evidence. Future-state belongs in roadmaps, not here.

---

## 2 · Required evidence categories

A status claim is only as strong as a **citable, reproducible** artifact. Allowed evidence types:

| Category | Example citation | Strongest status it can justify |
|---|---|---|
| **Code reference** | `path:line` @ commit SHA | PRESENT |
| **Test output** | command + pass/fail counts + date | PROVEN (unit) |
| **Operational validation** | validation doc id + observed result on real/representative data | PROVEN |
| **Telemetry / query** | the query + result + date + environment | PROVEN |
| **Operator review / sign-off** | who + date + what was reviewed | contributes to TRUSTED |
| **Independent / third-party validation** | external assessor + method | contributes to TRUSTED |
| **Operational history** | time window + N independent observations + incident-free record | TRUSTED |
| **Incident record (counter-evidence)** | incident id | *caps/downgrades* status |

**Rules:** (a) no evidence ref → status is **UNKNOWN**, never inferred upward. (b) Evidence must name
its **environment** (prod / staging / local) — staging-only evidence cannot justify a prod TRUSTED.
(c) A test that is **red or absent** caps the dependent capability at PRESENT. (d) The assessor's own
demonstrations are **not evidence** (Capability Integrity Doctrine).

---

## 3 · Capability tracking model

A stable, append-only **Capability Registry** keyed by capability id, tracked as a time series.

**Decomposition rule (anti-inflation):** capabilities are registered at *claim* granularity, not
feature-name granularity. "Entity Resolution" is not one row — its substrate, its comparison function,
and its confidence verdict are separate capabilities with separate evidence, because they have
separate trust states. A single label over a bundle hides the weakest member.

Ledger row (append-only — one per capability per assessment):

```
capability_id | assessment_id | layer | status | environment | evidence_refs[] | assessor | note
```

- **layer** ∈ {Implemented, Proven, Trusted} — *only* product layers are tracked here. Claude and
  Vision are explicitly excluded from the ledger (they are not earned capability).
- **status** ∈ {NOT PRESENT, PRESENT, PROVEN, TRUSTED, UNKNOWN}.
- A capability's status is **the lowest status its evidence justifies**, never the highest claimed.

This yields, per capability, a readable trajectory across assessments (e.g. ER-verdict-engine:
001 PRESENT → 002 PRESENT(red tests) → 003 PROVEN).

---

## 4 · Trustworthiness tracking model

Trust is **not a single bit**. A capability is TRUSTED only when *every* dimension has standing
evidence. Track each dimension explicitly:

| Trust dimension | Evidence question |
|---|---|
| Reliability | Does it work repeatedly over operational history, not once? |
| Explainability | Can the operator see *why*, with grounded references? |
| Repeatability | Same inputs → same outputs; deterministic where it claims to be? |
| Grounding | Are outputs tied to real retrieval traces, not parametric/fabricated? |
| False-certainty resistance | Has it been shown it will *refuse / stub* rather than fabricate? |

**Trust freshness / decay:** trust evidence expires. Each TRUSTED claim carries a `verified_on` date
and a re-verification interval; past it, status auto-flags **TRUSTED (evidence aging)** and, if not
re-verified by the next assessment, **downgrades to PROVEN**. Trust is a maintained state, not a
permanent award. (Mirrors the platform's own calibration/belief-decay discipline.)

---

## 5 · Comparison methodology

Each assessment computes a diff against **both** the immediately-prior assessment **and** Assessment 001.

For every capability, classify the change:
- **Improved** — status rose, with a *new evidence artifact* justifying it.
- **Regressed** — status fell (evidence invalidated, test went red, incident, environment lost).
  Regressions are **first-class and must be reported**, never silently dropped.
- **Newly proven / newly trusted** — crossed a threshold this assessment.
- **Still unproven** — claimed before, still no qualifying evidence (flag if N assessments stale).
- **Assumption invalidated** — a prior assessment's stated assumption was checked and found false.
- **Evidence expired** — trust aged out; needs re-verification.

**Iron rule:** *a capability advances only when evidence changes.* Time, effort, code volume, and
architectural sophistication do not advance status. The diff engine must reject a status increase that
cites no new evidence ref.

**Disagreement between assessors:** the **most-skeptical (lowest) status holds** until reconciled by a
named assessment that cites the deciding evidence. Never average; never take the optimistic read.

---

## 6 · Historical integrity rules

1. **Append-only. Never edit a published assessment.** Corrections are issued as a new assessment with
   an erratum note pointing back. Revisionism must be impossible by construction.
2. **The baseline is frozen.** Assessment 001 stays in its native vocabulary forever.
3. **Vocabulary mapping is additive, not destructive.** A one-way crosswalk lets old tiers be *read*
   in current terms without rewriting 001:
   | Baseline tier (001) | Read as (current) | Caveat |
   |---|---|---|
   | Production Ready | PROVEN, possibly TRUSTED | must re-confirm trust dimensions; prod-Proven ≠ Trusted |
   | Pilot Ready | PRESENT/PROVEN (staging) | not prod-Proven |
   | Experimental | PRESENT | not Proven |
   | Dormant | NOT PRESENT (operationally) | code may exist, capability inert |
   | `N/10` score | **advisory only** | scores are not evidence; see §7 challenge |
4. **Every status change is traceable** to a specific evidence artifact and the assessment that recorded it.
5. **Counter-evidence is preserved**, not deleted, even after a later assessment supersedes it.

---

## 7 · Governance rules

- **Who declares a baseline:** the operator. A baseline is a normal assessment elevated by explicit
  operator declaration (as 001 was, 2026-06-01).
- **Multi-assessor parity:** Claude, Codex, human audits, and third parties all produce assessments in
  the same structure; each is equal in form but weighted by *evidence and scope*, not by author.
- **Mandatory scope declaration** (per §1.2) — an assessor must disclose what it could not verify; an
  assessment without it is rejected.
- **Anti-gaming:** evidence-artifact requirement + independent/adversarial assessor encouraged +
  most-skeptical-status-wins + immutability. Self-congratulatory assessments fail the evidence test.
- **Cadence:** monthly · at major-milestone completion · before customer expansion · before major
  roadmap transitions. Cadence is a *floor*, not a substitute for evidence-triggered re-assessment.
- **The framework governs itself:** no exemptions; its own maturity is PRESENT (proposed) until
  assessments are produced under it and shown to prevent inflation in practice (then PROVEN).

---

## 8 · Challenged assumptions (applied aggressively, as requested)

- **Numeric readiness scores (`5.5/10`) invite false precision and drift.** They compress evidence into
  a feeling and are trivially inflated. *Recommendation:* scores, if kept, are **derived from**
  evidence-backed status counts, never asserted directly, and always shown beside the status ledger —
  or dropped in favor of "N capabilities Proven / M Trusted / K regressed."
- **"Production Ready" conflates Proven and Trusted.** The crosswalk (§6.3) forces a trust re-check
  rather than auto-crediting trust.
- **Single-label-per-feature hides the weakest member.** The decomposition rule (§3) is the counter.
- **Assessor self-grading is a conflict of interest.** Scope declaration + independent reconciliation +
  most-skeptical-wins mitigate it; they do not eliminate it — third-party audit is the real control.
- **Trust treated as permanent is itself false certainty.** Trust decay (§4) forces re-earning.
- **The framework could become unproven machinery.** Kept deliberately lightweight: immutable markdown
  assessments + an append-only ledger (committed CSV/JSON is sufficient; no new service required to
  start). Building a DB/UI for this is itself a capability that would need its own PROVEN evidence.

---

## 9 · Minimal starting artifacts (no new code required)

1. Adopt `program-readiness-review-2026-05-30.md` as **Assessment 001** (operator-declared — done).
2. Create an append-only `docs/platform-operations/assessments/capability-ledger.csv` with the §3
   columns; seed it by translating 001 via the §6.3 crosswalk (a *new* row set attributed to 001,
   not an edit of 001).
3. Author **Assessment 002** under this structure at the next milestone, producing the first real diff.

That is the whole system: immutable assessments + an append-only ledger + a disciplined diff. Evidence,
preserved over time, comparable, inflation-resistant.
