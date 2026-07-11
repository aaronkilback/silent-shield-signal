# Implementation Tickets — Bounded-Uncertainty Operationalization

Derived from the (frozen) Operator Friction Ledger. **No new doctrine, no new framework.** Each ticket maps to an existing workstream and instantiates the provisional Bounded-Uncertainty principle at a specific layer. Priority order as directed.

| # | Ticket | Layer | Workstream | Complexity |
|---|---|---|---|---|
| 1 | Canonical Counts | L1 Truth | P1.1 canonical metrics | **M** |
| 2 | Coverage Caveats | L1 Truth (completeness) | Coverage (R1) | **M** |
| 3 | Capability Registry | L3 Capability | Aegis Authority (AR1/AR3/AR4) | **L** |
| 4 | Tenant-Scoped Platform Introspection | synthesis | introspection backlog (depends 1–3) | **L** |
| 5 | Geographic Relevance Receipts | L2 Relevance | signal-relevance-scorer + Claim Gate | **M** |

> Sequencing note: TKT-1/2/3 are independent and parallelizable. TKT-4 is a synthesis that **depends on 1–3** and sits behind the P0 critical path (Claim Gate → Linkage/G3 → Resolution → Ground-Truth). TKT-5 is independent.

---

## TKT-1 — Canonical Counts  ·  P1  ·  Complexity M  ·  Workstream: P1.1 canonical metrics (extend)

**Current behavior.** Count queries (agents, entities) return inconsistent numbers across paths; a failed primary query silently falls back to a different count (observed: "20 agents" → "60 agents"). No single source of truth for roster/entity/object counts; Aegis emits the fallback as authoritative.

**Desired behavior.** One canonical count source per object type. Every count answer routes through it. A failed primary query returns *"count unavailable"* — **never** a contradicting fallback number.

**Required components.**
- `getCanonicalCount(objectType, tenantId)` extending the `_shared/threat-metrics.ts` aggregator pattern (P1.1), covering entities · agents · signals · incidents · investigations · sources · monitors.
- Route all Aegis/dashboard count responses through it; remove ad-hoc count paths and fallback-to-alternate-number logic.
- Tenant-scoped; counts exclude nothing silently (declare exclusions).

**Acceptance criteria.**
- The same count question returns the same number across surfaces and on repeat asks.
- A primary-query failure yields "unavailable," not a different number (regression test reproduces the 20→60 condition and asserts no contradiction).
- Counts are tenant-scoped and deterministic.

---

## TKT-2 — Coverage Caveats  ·  P1  ·  Complexity M  ·  Workstream: Coverage (R1)

**Current behavior.** Enumerations/counts are presented as complete with no completeness qualifier (observed: "just one Petronas entity," stated as the whole set).

**Desired behavior.** Every count/list answer carries a coverage state — **complete | partial | unknown** — and Aegis states it when completeness isn't proven ("found N via available retrieval paths; **completeness unknown**"). Fail-honest: default to *unknown* when it can't prove complete.

**Required components.**
- A coverage/completeness annotation attached to count/list results, derived from retrieval scope vs. known surfaces.
- Wording rules so the caveat is surfaced as a **structured field**, not a free-text disclaimer.
- "Provably complete" path so Aegis may state completeness when warranted.

**Acceptance criteria.**
- No count/list answer asserts completeness without evidence (OFL-09 pattern cannot reproduce).
- Caveat is structured and decision-relevant, not a blanket hedge.
- When coverage is provably complete, the answer says so.

**Dependency.** Reachability/completeness depends on the certified-retrieval surface map (shared with TKT-4).

---

## TKT-3 — Capability Registry  ·  P2  ·  Complexity L  ·  Workstream: Aegis Authority (Capability Registry AR1 / Receipts AR3 / Refusal AR4)

**Current behavior.** Aegis offers actions (create entity, external web scan, create agent) before verifying it can execute them, then fails after the operator commits ("can't create entities here"). Narrates fake progress ("working on it") with no task. **Offered ≠ executable.**

**Desired behavior.** A registry of implemented capabilities with authority bounds (**Read · Create · Update · Delete · Execute-Workflow**) per object/context. Aegis consults it **before** offering; states honest limitations up front; **offered ⇒ executable** enforced; "working on it" only with a real task + measured receipt.

**Required components.**
- Capability registry: `capability → {implemented?, authority, context}`; tenant/environment aware.
- A gate in the offer/tool path that consults the registry before any action is proposed.
- Honest-refusal templates (state the limit before offering); removal of reflexive "want me to create…" offers for unregistered capabilities.
- Post-action receipts (AR3): no progress narration without a running task; receipt asserts the measured post-condition.

**Acceptance criteria.**
- Aegis never offers an action it cannot execute (OFL-02/03/15 cannot reproduce).
- Honest limitation stated **before** offering, not after.
- "Working on it" appears only with a real task and returns a measured receipt (OFL-14 cannot reproduce).
- Tool list is registry-gated.

---

## TKT-4 — Tenant-Scoped Platform Introspection  ·  P3  ·  Complexity L  ·  Workstream: introspection synthesis (depends on TKT-1/2/3)

**Current behavior.** Aegis discovers its own limitations mid-conversation; cannot state what exists / what is reachable / what is actionable before responding.

**Desired behavior.** Before answering, Aegis can: inventory tenant-scoped objects, state **reachability** (Directly / Indirectly / Referenced-but-Unavailable / Unknown) and **authority** (RCUD + Execute), and explain each (what/why/connected/evidence/limits). **Zero surprise.**

**Required components.**
- A pre-answer environment snapshot composing: canonical counts (**TKT-1**) + coverage/reachability (**TKT-2** + certified surfaces) + capability registry/authority (**TKT-3**) + grounding/explanation (Claim Gate, Linkage/G3).
- Bounded-uncertainty expression on any unknown dimension.

**Acceptance criteria.**
- Aegis states limits **before** the operator finds them (scripted zero-surprise session passes).
- For any tenant object it can answer: exists? · reachable? · authority? · actions? · evidence?
- Any unknown dimension is expressed as a boundary, not guessed.

**Dependency / sequencing.** Consumes TKT-1/2/3 + certified retrieval; **sits behind the P0 critical path** and does not reorder it.

---

## TKT-5 — Geographic Relevance Receipts  ·  P4  ·  Complexity M  ·  Workstream: signal-relevance-scorer (geographic grounding) + Claim Gate

**Current behavior.** Signals surfaced for a location are presented as relevant regardless of distance (observed: LNG/pipeline signals ~1000 km away framed as the laydown-yard's risk); confident risk claims on geographically-loose evidence; no distance shown.

**Desired behavior.** Every surfaced signal/priority carries a **relevance receipt** — distance to the asset/location + relevance basis. **Possible** relevance is labeled as such, never as **established**. Risk claims require proximate grounding; distant regional context is framed as *general*.

**Required components.**
- Proximity + stakes weighting in `signal-relevance-scorer`.
- A relevance receipt (distance + basis) attached to each surfaced item and to "what should I focus on" rankings.
- Claim-Gate rule: no site-risk assertion without proximate provenance.

**Acceptance criteria.**
- Each surfaced signal shows its distance/relevance basis.
- A ~1000 km signal is not presented as site risk without the distance stated (OFL-05/06/07 cannot reproduce).
- "Top priority today" ranks by proximity + stakes.
- Risk claims cite proximate evidence or are explicitly framed as general regional context.

---

*Source: Operator Friction Ledger (frozen Q1–Q5), Petronas session 2026-06-06. Tickets are implementation work mapped to existing workstreams; no doctrine or framework changes.*
