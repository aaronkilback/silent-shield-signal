# Doctrine Review — "Hide the Mechanism. Never Hide the Epistemic State."

**Status:** SYNTHESIS / EVALUATION. Not implementation, no backlog, no sequencing change, no new
workstream. Synthesizes the architecture evaluations produced in this thread:
- Tenant-attribution regression (P0, resolved)
- Temporal Integrity campaign
- Collection vs Retrieval bottleneck assessment + Operator Question Test
- F-TEMPORAL-3 retrieval defects / silent-empty failure mode
- Mission-vs-Incident, Intelligence-Requirement, and two-layer (User Intent / IR) evaluations
- The copper-theft conversation

---

## 1. Is a foundational doctrine emerging? — Yes, and it was previously *unnamed*

A single principle recurs underneath nearly every finding: **failures cluster at the boundary between the
system and the operator, and they take one of two symmetric forms — leaking mechanism inward, or hiding
epistemic state outward.** The candidate doctrine names both:

> **Hide the mechanism. Never hide the epistemic state.**

It is not a temporary temporal-campaign insight. It is the **interface/honesty doctrine** that the existing
canon implied but never stated outright. Its precise scope matters (see §3) — it governs *how Aegis presents
itself and its knowledge*, not how it isolates tenants or what it collects.

---

## 2. Does it explain the nine findings?

Honest accounting — **CLEAN** (explains *and* would have prevented), **ORGANIZING** (a design evaluation the
doctrine shapes, not a failure), **PARTIAL** (adjacent — another doctrine is the precise governor).

| # | Finding | Mechanism that leaked | Epistemic state that was hidden | Would the doctrine have prevented it? | Fit |
|---|---|---|---|---|---|
| 1 | **Tenant-attribution** | Tenant scoping/RLS internals — cross-tenant rows surfaced *as* own-tenant intelligence | **Provenance / ownership** — "this is another tenant's data" | **Partial.** Surfacing provenance makes it *detectable*; the *prevention* is isolation (RLS/derive triggers). Governed primarily by Provenance + Grounding-State. | PARTIAL |
| 2 | **Temporal Integrity** | `created_at` (ingestion) substituted for event time | **Freshness / recency + timing-unknown** | **Yes.** "Never hide freshness/unknowns" forbids showing an undated/old item as current. The fix *was* surfacing the temporal bucket. | CLEAN |
| 3 | **Collection vs Retrieval** | — (an assessment, not a failure) | — | The doctrine is the **diagnostic lens**: you can only tell "no data" (collection) from "data unreached" (retrieval) if coverage gaps *and* retrieval failures are both visible. | LENS |
| 4 | **F-TEMPORAL-3 / silent-empty** | — (internal) | **Retrieval failure** — swallowed error returned `[]`, indistinguishable from genuine emptiness | **Yes.** "Retrieval failures must remain visible" turns the swallowed error into a visible failure → caught immediately instead of running empty in prod. | CLEAN |
| 5 | **Incident-gated dispatch** | The **incident precondition** (workflow mechanic) exposed as an operator-facing constraint | — | **Yes (hide-mechanism half).** Route the intent without exposing the incident requirement. | CLEAN |
| 6 | **Mission vs Incident** | — (design evaluation) | — | The doctrine's first half *is* the conclusion: make mission/incident **internal**; never a user prerequisite. | ORGANIZING |
| 7 | **Intelligence Requirement** | — (design evaluation) | — | IR is the **internal home of the epistemic state** (confidence/coverage/satisfaction). The doctrine says: hold it internally, surface it externally. Complementary. | ORGANIZING |
| 8 | **Copper theft** | Incident precondition leaked | **Grounding of the advisory answer** — is the tracker rec grounded in tenant data or general knowledge? | **Yes (both halves).** Route by intent (hide mechanism) *and* state the grounding of the recommendation. | CLEAN |
| 9 | **User Intent → Best Execution Path** | — (the architecture) | — | This **is** the doctrine made concrete: hide-mechanism = route intent→path; never-hide-epistemic-state = the surfacing contract. | ORGANIZING |

**Read:** 4 CLEAN failure-preventions (#2, #4, #5, #8), 3 ORGANIZING design principles (#6, #7, #9), 1 diagnostic
lens (#3), 1 PARTIAL (#1). The doctrine explains or shapes **8 of 9**; the ninth (tenant isolation) is adjacent
but properly owned by Provenance/Grounding. That is strong — but **not universal**, which is exactly why its
scope must be stated rather than over-claimed.

---

## 3. Scope — what it governs, and what it does not

A foundational doctrine earns its place by being **precise about its domain**, not by being a universal solvent.

**Governs (the operator↔system interface / epistemic-honesty contract):**
- UX and conversation design · agent behavior · reporting & briefings · mission/decision-support presentation ·
  routing logic's *visibility* · how confidence/coverage/freshness/assumptions are communicated.

**Does NOT govern (other doctrines own these):**
- **Tenant isolation / access control** → Provenance + Grounding-State + RLS (the candidate makes a leak
  *detectable*, not *impossible*).
- **What gets collected** → "Own the Information Flow" / "Never Outsource Awareness."
- **Correctness of the underlying data/logic** → testing, grounding, the deployment gates.

Stated with scope: *within the interface, this is foundational; outside it, it is adjacent.*

---

## 4. Refinement — the two halves have different force

Treating it as a blunt rule would damage the "effortless" goal. As a **doctrine** (requires judgment to apply):

- **"Hide the mechanism" = hide by *default*, reveal on demand (progressive disclosure).** Not "never show
  the mechanism" — an analyst may *want* the agent/provenance/retrieval trace. The rule is: never *require* the
  operator to understand mechanism; always make it *available* to those who ask.
- **"Never hide the epistemic state" = near-absolute, but surface the *decision-relevant* state, proportionate
  to stakes.** Not a uniform uncertainty dump (which would clutter and re-break effortlessness). Surface what
  *changes the decision* — confidence when it's low enough to matter, coverage gaps when they bound the answer,
  freshness when recency is the question, "not collected" when the operator would otherwise assume coverage.

This asymmetry (default-hide-but-disclosable mechanism; near-absolute-but-salient epistemic honesty) is what
keeps the doctrine from fighting "Shorten the Loop." It demands judgment — the mark of a doctrine, not a rule.

---

## 5. Does it belong alongside the existing Fortress doctrines?

It does not duplicate them — it is the **interface-layer connective tissue** that ties three of them together,
and fills a gap none of them named:

| Existing doctrine | Relationship to the candidate |
|---|---|
| **Preserve Decision Space** | The candidate is *how you preserve it at the interface*: visible uncertainty = preserved decision space; hidden uncertainty = false certainty = destroyed decision space. Direct operationalization. |
| **Shorten the Loop** | "Hide the mechanism" *is* loop-shortening — remove workflow friction (no manufactured incidents) between question and decision support. |
| **Build Fortresses, Not Traps** | A system that hides its epistemic state is a **trap** (looks authoritative, misleads); one that surfaces it is a **fortress** (trustworthy under pressure). The candidate is "fortress not trap" at the *epistemic* level. |
| **Never Outsource Awareness** | "Never hide the epistemic state" keeps the operator's awareness intact — the machine's hidden confidence never *replaces* the operator's knowledge of what is/isn't known. |
| **Anticipate, Don't React** | Adjacent — the incident-gate forced reaction; intent-routing enables anticipation. |
| **Own the Information Flow** | Adjacent — about collection/sources, not interface honesty. |

It belongs **in the canon**, positioned as the doctrine that governs the *interface and honesty layer* — the
one the existing six (about posture, flow, and awareness) left implicit.

---

## 6. The most important question — foundational doctrine, or useful heuristic?

**Foundational doctrine — within its domain — not merely a heuristic.** Three tests, all passed:
1. **Explanatory** — it accounts for or shapes 8 of 9 campaign findings (§2).
2. **Prescriptive** — it generates concrete, correct design guidance for future architecture, UX, agent
   behavior, reporting, mission systems, and decision-support workflows (§3–§4).
3. **Generative/unifying** — it is the connective tissue between Preserve Decision Space, Shorten the Loop, and
   Build Fortresses Not Traps, and it names a layer the canon had left unnamed (§5).

A heuristic would fail test 3 (it would be a handy tip, not a unifier). This passes.

**So, if a builder remembers one principle while building future Aegis capabilities:**
- For anyone working on **interface, UX, agent behavior, reporting, mission/decision-support** — **yes, this is
  THE principle to remember.** It is foundational for that work.
- For the system as a whole — it is **one of a small canon**, specifically the **previously-missing interface/
  honesty doctrine**. It does not replace Provenance/Grounding (isolation/correctness) or the collection
  doctrines; it sits *beside* them.

Stated as a single durable line for the doctrine wall:

> **Hide the mechanism — by default, revealable on demand. Never hide the epistemic state — surface what
> changes the decision. The operator should never fight the architecture, and should never be deceived about
> what is known.**

---

## 7. Anti-anchoring & capability honesty
- This is the **5th and most general reframe** in the thread (incident → mission → IR → two-layer → this
  doctrine). It is the strongest synthesis, but it remains a **doctrine *proposal*** until ratified by the
  operator and tested against real behavior. The Operator Question Test (backlog §6) is its empirical check:
  if the dominant failure class is *good-data-bad-reasoning* (A) rather than presentation/retrieval honesty,
  the doctrine matters less than reasoning quality — watch for that.
- **Capability-integrity label:** today Aegis only *partially* honors this doctrine — the Grounding-State
  doctrine enforces some epistemic honesty, but mechanism leaks (incident-gate) and silent failures
  (F-TEMPORAL-3, swallowed errors) show the contract is **not yet systematically implemented.** The doctrine
  describes the *target*, not the *current state*.
- **Nothing built.** This review is a decision input for whoever ratifies Fortress doctrine; it changes no code,
  no campaign, and no sequencing. Temporal Integrity remains the only active workstream.
