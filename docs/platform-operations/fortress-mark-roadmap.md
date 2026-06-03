# Fortress Mark Roadmap + Aegis Intelligence Maturity Roadmap

**Status:** DRAFT — model ratified by operator 2026-06-01; readiness criteria for Marks I–II are
evidence-grounded below, Marks/Levels III–V are structural placeholders pending operator input.
**Nature:** Capability-maturity model. NOT branding, NOT release numbering, NOT marketing.
**Purpose:** Evaluate architecture, prioritization, technical debt, feature proposals, sequencing,
and — above all — *trustworthiness*.

> **The Marks are not the important part. The readiness criteria are.**
> A Mark is achieved when a capability is *demonstrated trustworthy*, not when it exists.
> Implementation ≠ completion. Capability ≠ trustworthiness. Trustworthiness must be shown with evidence.

---

## Two roadmaps, co-advancing

| | Measures | Asks |
|---|---|---|
| **Fortress Mark** | platform capability | "What can the platform do?" |
| **Aegis Level** | intelligence / judgment | "How intelligently can it think?" |

Fortress is the Suit (advances through Marks). Aegis is the Intelligence Officer (persistent identity,
matures through Levels). **Aegis maturity cannot exceed Fortress trustworthiness** — a capability Aegis
cannot trust, it cannot reason on. Both must advance together.

| Mark (Fortress capability) | Question | Aegis Level | Aegis mission |
|---|---|---|---|
| I — Intelligence Collection | What happened? | I Observer | maintain awareness |
| II — Intelligence Correlation | What is connected? | II Analyst | understand relationships |
| III — Intelligence Trajectory | What is forming? | III Forecaster | understand what is forming |
| IV — Decision Advantage | What should we do? | IV Advisor | preserve decision space |
| V — Autonomous Intelligence Ops | What should leadership know before they ask? | V Intelligence Officer | proactive intelligence leadership |

---

## The advancement doctrine (enforced when evaluating proposals)

Each Mark is the foundation for the next, and **a Mark cannot be trusted if the previous Mark is not
trustworthy**:

```
Untrustworthy Correlation (II)  →  Untrustworthy Trajectory (III)
                                →  Untrustworthy Decision Support (IV)
                                →  Decision space destroyed.
```

Therefore: **every Mark must be trustworthy before the next Mark can be trusted.**

### Mandatory evaluation checklist (every proposal states this explicitly)

1. Which Fortress Mark does this affect?
2. Which Aegis Level does this affect?
3. Does it increase capability maturity?
4. Does it increase intelligence maturity?
5. Does it improve trustworthiness?
6. Does it preserve decision space?

Challenge any proposal that: skips prerequisite maturity · creates false certainty · grows feature
count without advancing capability · adds complexity without adding trustworthiness.

---

## Readiness criteria

Readiness = the *evidence* that a Mark/Level is trustworthy enough to be built upon. "Required
capabilities" answer *can it do the thing*; "trustworthiness evidence" answers *can we trust it*.

### Mark I — Intelligence Collection · Aegis I Observer

**Required capabilities:** broad multi-source collection (news, social, RSS, gov alerts, wildfire,
cyber/KEV); provenance-complete ingestion; quarantine boundary; retrieval/summary/briefing.
**Trustworthiness evidence required:**
- Every artifact has unambiguous ownership provenance (Provenance Doctrine) — *largely in place*.
- Collected timestamps carry trustworthy semantics: a signal's time reflects **actor/event time**,
  not collection cadence, OR is honestly labeled ungrounded.
- Monitors that silently yield nothing or regress are detected (behavioral watchdog).

**Current evidence / open gaps (2026-06-01):**
- ✅ Provenance hard-reject in `ingest-signal`; quarantine primitives; watchdog behavioral phase.
- ⚠️ **Temporal-grounding gap (G-9):** `temporal_grounding` column is 100% `'unknown'` (T-1 writer
  not shipped); only ~25% of prod signals carry actor-time-reliable `event_date`; social monitors
  write cosmetic/copied `event_date`. **This is a Mark I trustworthiness gap** — and it is exactly
  what threatened Mark II (see below). G-9 follow-on (uncommitted) closes the *consumption* side;
  the *writer* side (T-1 + social-monitor event_date hygiene) remains open.
**Verdict:** Mark I capability broad; trustworthiness has a known, now-scoped temporal gap.

### Mark II — Intelligence Correlation · Aegis II Analyst

**Required capabilities:** entity resolution / actor clustering; relationship analysis; confidence
scoring the operator can interpret.
**Advancement requirement (operator-stated):** *correlation conclusions must be explainable and
supported by evidence.*
**Trustworthiness evidence required:**
- Correlation cannot be manufactured from artifacts of collection (e.g. shared monitor cadence).
- Every correlation carries human-readable, per-axis evidence + an honest confidence/strength label
  that is not mistaken for an identity verdict.
- MEDIUM/HIGH outcomes have been observed **on real data** and shown correct for the right reasons.
- The aggregation that produces the verdict is itself test-covered and green.

**Current evidence / open gaps (2026-06-01):**
- ✅ ER v1 substrate in prod; Slice 2 axes + G-1 (behavioral-corroboration gate) + G-2 (evidence-
  strength language) + G-3 (auto_unknown) on staging; G-9 axis replacement closes the cadence-as-
  correlation false positive (negative-control test passing, uncommitted).
- ❌ **G-5 rich-path never validated on real data** — no MEDIUM/HIGH ever observed on trustworthy
  inputs. The central trustworthiness evidence for Mark II does not yet exist.
- ❌ **5 stale cluster-confidence aggregation tests red** on the branch (assert MEDIUM where G-1
  correctly yields LOW) — the verdict engine's test coverage is not green.
- Slice 2 PRA: **YELLOW**, not deployed.
**Verdict:** Mark II is **under construction, NOT yet trustworthy.** Per the advancement doctrine,
**Mark III work should not be trusted to build on it yet.**

### Mark III — Trajectory · IV — Decision Advantage · V — Autonomous Ops (and Aegis III–V)

**Status: criteria not yet finalized — requires operator input on capabilities not yet built.**
Defining specific readiness criteria here now would itself be false certainty. What is fixed is the
*shape* each must take (mirroring I–II):
- **Required capabilities** (what it must do),
- **Trustworthiness evidence** (operator-stated advancement requirements already give the spine:
  III — trajectory assessments show *measurable value and beat random/retrospective*; IV —
  recommendations are *explainable, evidence-based, tied to measurable outcomes*; V — Aegis
  *consistently surfaces meaningful risks/opportunities/decision windows before being asked*),
- **Open gaps + blocking risks + recommended next actions.**

These get filled in collaboratively as the underlying capability becomes real — never before.

---

## Current self-assessment (provisional, evidence-based)

- **Fortress Mark: I, consolidating toward II.** Collection is broad (Mark I capability present) but
  carries a temporal-grounding trustworthiness gap. Correlation (Mark II) is being stood up but is
  not yet trustworthy (G-5 unproven, aggregation tests red, not deployed).
- **Aegis Level: I (Observer), reaching for II (Analyst).** Aegis reliably retrieves/summarizes
  within grounded retrieval; it cannot yet be trusted to assert relationships, because Mark II
  correlation is unproven — and *Aegis maturity cannot exceed Fortress trustworthiness.*
- **Binding constraint:** finishing Mark II's trustworthiness (G-5 on real data + green aggregation
  suite), on top of a Mark I temporal foundation that is now honest (G-9), is the highest-leverage
  next move. Trajectory/decision-support work is premature until then.
- **Reframe of recent work:** G-9 was a **Mark I trustworthiness fix** (is the collected timestamp
  trustworthy?) that was silently corrupting **Mark II** correlation. It is the advancement doctrine
  in miniature — the foundation had to be made honest before the layer above it could be trusted.

---

## How to use this document

For every future feature/architecture proposal, answer the 6-point checklist, name the Mark + Level,
and state what *evidence* would prove the affected Mark trustworthy. Optimize for capability maturity
that leaders can safely trust — not feature count.
