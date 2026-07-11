# Operator Friction Ledger

**Purpose.** Capture real operator conversations with Aegis and route each friction point into an **existing** workstream — so live operator experience continuously pressure-tests priorities already on the roadmap, without spinning up new projects or context-switching.

> **This is a prioritization lens, not a project.** Behavior-loop evidence for *what Fortress should build*. It must **never** become evidence for *what Fortress believes is true* (reality loop). Firewall absolute.

> **Dominant finding (2026-06-06, Petronas) — and how it evolved.**
> defects (15) → root causes (5) → "Aegis overstates certainty" → **the assumption factory:**
> **Fortress currently lacks a systematic mechanism for expressing *bounded uncertainty* across truth, relevance, and capability domains.**
> When the system has no way to say "partial / uncertain / within these bounds," it defaults to *complete / certain / I-can*. That single missing mechanism manufactures the truth-, relevance-, and capability-overstatements operators expose. The session **did not discover new doctrine — it identified where the ratified epistemic-honesty doctrine is not yet operationalized.**
>
> **Status — HIGH-CONFIDENCE HYPOTHESIS (n=1), not a proven universal.** This is one session's finding. The framework is now **FROZEN at Q1–Q5**, and the next 3–5 independent operator sessions will *attempt to falsify* it (see **Validation Protocol**). Treat doctrine as Fortress treats intelligence: **confidence rises only through repeated independent confirmation.** The ledger's job is to **falsify**, not confirm.

---

## Prioritization lens (standing doctrine)

The chain that gives each friction point its value:

**Friction → Root Cause → Layer → Assumption → Assumption Origin**

— the difference between discovering a false assumption and discovering **the factory that produces it.**

**The framework is FROZEN at Q1–Q5 (no Q6).** The compression chain appears complete; further questions risk overfitting before enough evidence exists. The next phase is **observation, not framework expansion.** Every friction review answers these five questions, in order:

1. **Does this preserve or collapse decision space?** *(primary sort key)*
2. **Is this a surface symptom or a foundational cause?**
3. **At what layer did the failure originate?** *(L1–L4)*
4. **What assumption did this failure expose?** *(the falsified belief)*
5. **Why did we believe that assumption?** *(the mechanism that allowed it — the factory)*

### Severity by decision-space impact (not trust impact, not incident count)

| Tier | Criteria |
|---|---|
| **HIGH / Critical** | false certainty · **collapses decision space** · operators act on incorrect assumptions |
| **LOWER** | friction but **preserves decision space** · operator still knows there is a gap |

Trust impact ≠ decision-space impact. A visible "I can't" preserves decision space; a confident "this matters here" collapses it invisibly.

### Layer hierarchy (Q3)

| Layer | Governs | Failure means |
|---|---|---|
| **L1 — Truth** | claim fidelity · canonical counts · grounding · provenance · calibration · authoritative state | the fact/state is wrong |
| **L2 — Relevance** | geographic · stakeholder · entity · threat · context | facts may be true; the relevance transform is wrong |
| **L3 — Capability** | tool/data access · permissions · execution · capability awareness | can't do (or wrongly claims it can) the thing |
| **L4 — Experience** | voice · STT · dialogue · UX · performance · presentation | upstream intact; delivery degraded |

Classify at the **most-foundational broken layer**. **Depth correlates with collapse:** L1/L2 (invisible substrate) → COLLAPSE; L3/L4 (visible) → PRESERVE.

### Assumption + origin lens (Q4–Q5) — the red-team output

The highest-value findings are not defects — they are **disproven assumptions** and the **mechanisms that generated them**. Operator conversations are a live red-team; the goal is to find hidden assumptions *and their factories* before they harden into doctrine.

**`assumption_class` (why the assumption existed):**

| Class | Meaning |
|---|---|
| **A — Unknown Assumption** | we never realized we were assuming this |
| **B — Development Shortcut** | we knew it was incomplete but implicitly behaved as if complete |
| **C — Missing Evidence** | we lacked the evidence to validate or reject it |
| **D — Historical Artifact** | once true; reality changed |
| **E — Emergent Interaction** | only visible when a real operator used the system |

**New prioritization rule.** Fixing a false assumption is valuable. **Fixing the *mechanism* that repeatedly generates false assumptions is more valuable.** The strongest roadmap evidence is not "what broke most often" — it is "which *factory* keeps producing false assumptions."

---

## Validation protocol — the ledger is a falsifier, not a confirmer

The Bounded-Uncertainty factory is a **high-confidence hypothesis from one session (n=1)**, not a proven universal. **Do not force future sessions into the Bounded-Uncertainty doctrine — let reality test it.** The ledger's job is to *falsify*, not confirm.

**Run mechanically — do not try to confirm Factory A, and do not try to disprove it; let the framework classify what appears.** Evidence-reading standard (locked 2026-06-06): **recurrence > dominance.** Track **frequency · severity · recurrence · independent appearance.** Do **not** require perfect convergence — e.g. S2: A+C, S3: A+D, S4: A, S5: B+D is *not* a failure to converge; it may indicate A is foundational while other factories vary by workflow. **The objective is surprise, not explanation: a session that *disproves* Factory A is more valuable than one that confirms it.** Confidence rises only when reality keeps independently producing the same result — "does reality keep producing this?", never "does this sound right?"

**Run the Q1–Q5 framework UNCHANGED across the next 3–5 real operator sessions.** For each session produce:

1. Frictions
2. Root causes
3. Layer distribution (L1–L4)
4. Disproven assumptions
5. Assumption factories
6. Dominant session finding

Then **compare sessions.** Key question: *do independent operator sessions repeatedly converge on the same assumption factory?* Classify each session's dominant factory:

| Factory | Hypothesis under test |
|---|---|
| **A** | Bounded uncertainty not operationalized |
| **B** | Capability awareness not operationalized |
| **C** | Coverage discovery not operationalized |
| **D** | Grounding / provenance not operationalized |
| **E** | Other (a new factory) |

- **Success criterion (confidence ↑):** multiple *unrelated* sessions converge on the same factory → elevate it toward foundational.
- **Failure criterion (Petronas was local):** each session produces a *different* factory → the finding was local, not systemic → downgrade.
- **Falsification standing:** if sessions repeatedly survive the framework **without** reproducing Factory A, that is **evidence against** the current Bounded-Uncertainty interpretation. If they repeatedly converge on A, that is **evidence for** it.

**One session discovered the doctrine; several must validate it.** Until then, Bounded Uncertainty is a high-confidence hypothesis, not a proven principle. Phase = **observation. No framework expansion.**

---

## Required fields per entry

- **Decision-space impact** — Collapses | Preserves
- **Originating layer** — L1 | L2 | L3 | L4
- **`exposed_assumption`** — the falsified belief (+ reality)
- **`assumption_origin`** — why we believed it (the mechanism)
- **`assumption_class`** — A | B | C | D | E
- **Root cause** · **Existing workstream** · **Foundational or surface-level**
- **Would fixing this remove multiple future friction points?** (Y/N + which)
- (descriptive: Expected · Actual · Proposed resolution)

---

## Exposed assumptions + origins (Q4–Q5) — Petronas session

| Cause | Layer | Exposed assumption | Reality | Why we believed it (origin) | Class |
|---|---|---|---|---|---|
| **F3** | L1 | authoritative counts are internally consistent | no canonical state for agent/entity counts (20→60) | no operator had challenged the count path; no canonical aggregator for roster/entity counts | **C + E** |
| **OFL-09** | L1 | enumerated entities are the complete set | partial view presented as complete | partial retrieval results shown **without completeness caveats** | **B** |
| **F2** | L2 | signals surfaced for a location are operationally relevant | relevance transform not grounded (proximity/stakes) | **retrieval success conflated with relevance** | **B** |
| **F1** | L3 | if Aegis offers an action, it can execute it | capability-registry enforcement missing | **no Capability Registry enforcement existed** | **B** |
| **F4 (honest)** | L3 | Aegis can reach the operator's data surfaces | doc library / ArcGIS not certified retrieval surfaces | surfaces never wired; assumed reachable | **B / C** |
| **F5** | L4 | the voice channel is faithful and responds only to the operator | STT hallucinates from silence; no addressee gating; session not continuous | only visible under real ambient use after the realtime-GA migration | **E (+ D)** |

### The assumption factory (Q5 synthesis) — *hypothesis*

Every **decision-space-collapsing** cause at L1–L3 in *this session* is **Class B — Development Shortcut**, and the shortcut is *identical each time*: **there is no mechanism to express bounded uncertainty**, so the system defaults to the certain/complete answer.

- L1: no way to say *"this count is partial / unverified"* → defaults to a confident number, and to *complete*.
- L2: no way to say *"relevance here is weak / distance-discounted"* → defaults to *relevant*.
- L3: no way to say *"I can do this within these bounds / not in this context"* → defaults to *I can*.

**One factory, three layer-instantiations — pending replication.** The fix-the-factory move *if validated* is to **operationalize bounded-uncertainty expression**: confidence + coverage caveats on counts/claims (L1), grounded relevance scores with distance/stakes (L2), a capability registry that states honest bounds (L3). This synthesis is a single-session hypothesis (see Validation Protocol); it must survive 3–5 independent sessions before it is treated as foundational.

---

## Foundational causes — ranked (decision-space → layer → factory)

| Rank | Cause | Layer | Decision-space | Severity | Class | Leverage |
|---|---|---|---|---|---|---|
| **1** | **F3 — No canonical counts/state** | L1 | COLLAPSES | Critical | C+E | Highest — P1.1 extension + coverage caveat |
| **2** | **F2 — Geographic relevance not grounded** | L2 | COLLAPSES | Critical | B | High — proximity/stakes weighting |
| **3** | **F1 — Capability honesty not enforced** | L3 | PRESERVES (visible) — high trust | High | B | High — one registry gate |
| **4** | **F4 — Coverage gap** (→L1 if completeness implied) | L3/L1 | PRESERVES if disclosed; COLLAPSES if implied | Lower/High | B/C | per-surface; implied-completeness is dangerous |
| **5** | **F5 — Voice/STT/dialogue** | L4 | PRESERVES (visible) | Medium (privacy: High) | E/D | one VAD/session/STT fix |

**Factory-level fix order (if validated):** build the **bounded-uncertainty mechanism** once, instantiate per layer — L1 (truth confidence + coverage caveats) → L2 (grounded relevance) → L3 (capability registry bounds) → L4 (voice hardening, separate class). This collapses the five causes into **one mechanism + three instantiations + one voice fix** — *contingent on the hypothesis surviving validation.*

*(Seed-set per-row table — ID · issue · layer · decision-space · severity · cause · exposed_assumption — and the Expected/Actual/Root-cause/Workstream/Resolution detail table — retained from the prior revision; unchanged.)*

---

## Monthly review (do **not** count incidents)

Per root cause: **frequency · decision-space-weighted severity · originating layer · workstream · remediation leverage.**

**Assumption-level outputs:**
1. Most-frequently disproven assumptions.
2. Highest-severity disproven assumptions (decision-space-weighted).
3. Assumptions generating the most downstream friction.
4. Assumptions that **survived** repeated operator testing (design is sound — protect these).
5. **Assumption origins by frequency** (Class A–E distribution).
6. **Which assumption factories produce the most failures** (cluster by mechanism, not by symptom) — *the cross-session convergence test (Factories A–E).*

Output: top-5 causes · top disproven assumptions · **dominant factories + their cross-session convergence** · workstreams pressured · recommended priority shifts. Goal: **the fewest factory-level fixes that eliminate the most future operator frustration.**

---

## How to use this ledger

1. **Append, don't restructure**; tag every row with cause (F#), layer (L#), decision-space verdict, `exposed_assumption`, `assumption_origin`, `assumption_class`.
2. **Sort:** decision-space → layer depth → assumption importance → **factory frequency** (a recurring factory outranks a one-off).
3. **Every row points at an existing workstream** — never a new project.
4. **These are prioritization tools, not an architecture roadmap** — they distinguish truth/relevance/capability/experience failures, surface false assumptions, and locate the factories that produce them. They do not replace existing workstreams.
5. **The framework is frozen (Q1–Q5)** — run it unchanged; the next phase is validation, not expansion.
6. **Firewall** — behavior-loop input only (what to build). Never feeds the reality loop (what Aegis believes is true).

*Seed set: Session 2026-06-06 (Petronas, voice, field-prep). Next: append validation sessions 2–5 below, then run the convergence test.*
