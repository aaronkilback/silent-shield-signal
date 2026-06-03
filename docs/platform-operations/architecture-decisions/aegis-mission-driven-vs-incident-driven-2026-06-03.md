# Doctrine Evaluation — Mission-Driven vs Incident-Driven Aegis

**Status:** EVALUATION. Not ratified. No implementation, no design spec. Prepared as a decision input;
does not touch the active Temporal Integrity deployment.
**Trigger:** copper-theft conversation — operator said "dispatch a specialist," Aegis replied it could not
because there was no incident.

## 1. The claim, grounded in code (not intuition)

The incident-gating is **structural**, not a prompt quirk:
- `dispatch_agent_investigation(incident_id, agent_call_sign?, prompt?)` → forwards to
  `incident-agent-orchestrator`, which `throw new Error('incident_id is required')`.
- `trigger_multi_agent_debate(incident_id)` → `multi-agent-debate`: `if (!incident_id) throw`.
- Persona/tool docs define dispatch as "Send agents to **investigate incidents**."
- Partial primitives that exist but do **not** fill the gap:
  - `assign_mission` — a *standing directive to a named agent* (deadline, reporting cadence). Not a
    one-shot Question→Collect→Brief mission.
  - `investigations` table — a case-file (file_number, synopsis) with **no agent/edge-function writer**;
    effectively a manual/legacy record, not wired to dispatch.
- Autonomous collection (monitors) runs on cron — but **operator-directed** collection/investigation has
  **only** the incident path.

**Conclusion:** to investigate a threat, an operator must first manufacture an incident. Incidents are
acting as a **prerequisite for intelligence collection.**

## 2. Verdict — is this aligned with Fortress doctrine?

**No. It is inverted.** Doctrine ([[feedback_signal_decision_action]], Fortress Mark roadmap) frames Aegis as
an **Intelligence Officer**: intelligence work *produces* incidents; an incident is one possible
**conclusion**, not the entry ticket. Copper theft is a **threat pattern**, not an incident. Forcing an
incident first:
- **Corrupts the incident record** — incidents become "things I wanted to look into" rather than confirmed,
  actionable events (poisons severity metrics, executive trust, the whole P1/P2 ledger).
- **Blocks proactive collection** — the highest-value Intelligence-Officer work (what's forming, vulnerability
  assessment, horizon scanning) has no home.
- **Caps the Fortress Mark ceiling** at reactive Collect→Incident; mission-driven collection is the
  prerequisite for Marks III–IV (Trajectory, Decision Advantage).
- **Contradicts the stated capability** — calling Aegis an "Intelligence Officer" while it can only act on
  incidents is exactly the kind of unproven claim the [[feedback_aegis_capability_integrity]] doctrine warns
  against.

**Intelligence collection should be MISSION-driven; the incident becomes a downstream, gated artifact.**

## 3. The five questions

### Q1 — When should Aegis answer directly from existing knowledge (no mission)?
When grounded retrieval over existing tenant intelligence already answers the question at adequate coverage
and freshness:
- the question maps to data **in-store**, grounded retrieval returns sufficient coverage, and **new
  collection would not materially change the answer**.
Aegis answers + cites, and *offers* ("I can task a mission to go deeper") rather than auto-spawning. This is
the fast path and should handle the majority of questions.

### Q2 — When should Aegis determine collection is required (→ mission)?
When grounded retrieval is **insufficient to answer trustworthily**:
- **Coverage gap** — corpus lacks the entity/topic/timeframe (e.g. "copper theft NE BC" returns ~nothing).
- **Staleness** — existing data too old for a "what's forming" question.
- **New external observation needed** — assess emerging activism, research trackers, examine a facility.
- **Boundary signal** — Intelligence Boundary Awareness says "outside what we've collected."

Critical dependency: Aegis must **know** it lacks data rather than fabricate or return a silent empty. This
is the same R-vs-C distinction as the post-temporal backlog §6, and it depends on the **silent-empty fix +
IBA** (Wave A). *Mission-vs-answer routing is only as trustworthy as retrieval honesty.*

### Q3 — Which operator requests are eligible for mission creation WITHOUT an incident?
All of the examples are eligible. General class: any **Question / Threat / Concern / Vulnerability / Pattern /
Opportunity** that needs investigation but is **not yet a confirmed actionable event**. Categories:
- Threat-pattern investigation (copper theft NE BC)
- Trend / "what's forming" analysis (emerging activism around LNG; what's forming around an entity)
- Vulnerability assessment (remote-facility exposure)
- Entity/POI deep-dive
- Decision-support research (suitable asset trackers — an *opportunity*, not a threat)
- Horizon scanning

**Eligibility test:** it is a question about the world that collection + analysis can answer, and it does not
assert a specific active incident requiring response.

### Q4 — Lifecycle
Endorse the proposed model, with the incident demoted to a gated output:
```
Trigger (Question/Threat/Concern/Vulnerability/Pattern/Opportunity)
   │
   ├─ Triage: answerable now from grounded knowledge?  ── yes → Answer + cite (no mission)
   │
   └─ no →  Mission Creation        (objective, scope, success criteria, provenance, deadline)
              → Agent Selection      (semantic match to the active fleet — reuse existing auto-select)
              → Collection           (tasked monitors / OSINT / retrieval)
              → Analysis             (specialist + AEGIS-CMD synthesis)
              → Briefing             (operator-facing, grounded, cited)
              → Recommendation
              → OPTIONAL Incident    (only if findings meet incident criteria: confirmed + actionable + needs response)
```
Implications (for later design, not now):
- **Mission becomes a first-class record** (mission_id, status: open/collecting/analyzing/briefed/closed),
  the way incidents are today.
- The dispatch/debate/briefing machinery is re-keyed to a **work-item** that is `mission_id` **OR**
  `incident_id` — not incident-only.
- Incident creation is a **promotion gate**, not an entry gate.

### Q5 — Safeguards so not every question becomes an investigation
The governance that keeps this from exploding:
1. **Triage-first (default to answer):** escalate to a mission only when Q2 criteria are met. Most questions
   resolve on the fast path — missions are the exception, not the reflex.
2. **Explicit authorization:** Aegis *proposes* a mission and the operator confirms (or a clear intent like
   "dispatch a specialist to investigate X" authorizes it). Missions are never auto-spawned on every query.
3. **Budget / rate governance:** missions consume real collection budget (API credits, agent runs) — per-tenant
   caps + rate limits; refuse/queue beyond budget.
4. **Dedup / consolidation:** before launching, check for an active mission on the same subject; recurring
   patterns (copper theft) become **one standing mission/watch**, not N one-shots.
5. **Bounded scope + success criteria:** every mission must declare an objective and completion criteria so it
   **terminates** — no open-ended fishing.
6. **Collection is safe; action is gated.** A mission may freely COLLECT → ANALYZE → BRIEF (read/gather is
   low-risk). Any *action* — creating an incident, notifying, mutating state — stays behind the existing
   **execution gate** (Grounding-State doctrine: F-stage DISABLED until grounding/provenance are trustworthy).
   So mission-driven *intelligence* is within today's safety posture; mission-driven *action* is not yet enabled.
7. **Provenance/grounding inheritance:** mission outputs carry grounding state + citations; an ungrounded
   mission finding cannot be promoted to an incident.

## 4. Capability-integrity labeling (what exists vs. what's claimed)
- **Incident-gated dispatch** — PRESENT (proven in code).
- **Mission-driven Question→Collect→Brief spine** — **NOT PRESENT** (the gap).
- **`assign_mission` (standing agent directive)** — PRESENT, but a different shape; a partial building block,
  not the workflow.
- **`investigations` case-file table** — PRESENT but unwired to agents; latent primitive.
- **"Aegis is an Intelligence Officer"** — ASPIRATIONAL; today it is structurally a question-answerer +
  incident-responder. Earned by building the mission spine, not by naming it.

## 5. Relationship to the active campaign & the backlog
- **Does not affect Temporal Integrity.** Recorded as a candidate for the post-temporal slate.
- **Coupled to Wave A:** mission-vs-answer routing (Q1/Q2) requires retrieval honesty — Aegis must reliably
  distinguish "no data" (collection gap → mission) from "data exists, unreached" (retrieval bug). That is the
  backlog §6 R/C distinction and depends on the silent-empty fix, the harness, and IBA. **The mission model
  should not be built on top of dishonest retrieval.**
- Suggest tracking as **F-MISSION-1** in the post-temporal backlog (operating-model initiative), sequenced
  after Wave A retrieval/observability and the §6 bottleneck measurement — so we build the mission spine on a
  foundation that can honestly tell when collection is actually required.

## 6. Bottom line for the commander
The incident-gated workflow is **misaligned**: it makes Aegis behave like a chatbot that can only react to
incidents, when doctrine wants an Intelligence Officer that runs **missions** and produces incidents as one
possible outcome. The fix is an operating-model change (mission as the unit of work; incident as a gated
output), not a tracker tweak. It is **eligible for the next campaign slate**, explicitly **after** retrieval
honesty (Wave A) so the "do I answer or collect?" decision rests on trustworthy evidence. No work started.

---

## 7. Deeper challenge — is the first-class object actually the *Intelligence Requirement*?

**Raised by the commander after §1–§6.** Caution flag: §2–§4 elevated **Mission** to the organizing object.
That may repeat the incident mistake one level up — privileging a *workflow verb* (tasking) over the
*decision-anchored noun* (the need). Evaluating the alternative:

```
Question / Threat / Concern
   → Intelligence Requirement              (the stable object — "what must we know, to decide what?")
       → satisfied by: Answer | Mission | Watch | Incident | Briefing | No-Action
           → Decision Support
```

### 7.1 — Is Mission the correct first-class object? **No.**
A Mission is **one possible response** to a need, and it is **transient** (it completes, fails, or is
superseded). Making it first-class reproduces the incident error: it forces every need through one workflow.
A question answerable from existing knowledge, a standing watch, or a "no action required" determination do
not fit cleanly under "Mission." Mission is a **verb**; we were about to enthrone a verb.

### 7.2 — Would Intelligence Requirement be a better organizing construct? **Yes.**
The **IR is the stable, decision-anchored noun.** It captures *why* (the decision it supports), *what* must be
known, *for whom*, *by when*, and *at what confidence* — and it **outlives** any single response. This is not a
new invention: it is the mature **PIR / intelligence-cycle** model (Requirements → Direction → Collection →
Processing → Analysis → Dissemination → feedback). Adopting a proven construct is a strength, not a risk.
Advantages over Mission-centric:
- **Decision-first** — an IR must name the decision it serves → satisfies the commander's intent that doctrine
  be driven by **decision support, not workflow mechanics**.
- **Stable thread** — "what do we know about copper theft, and how confident are we?" is answerable from the
  IR's state regardless of how many missions ran. Missions/incidents/briefings become *events against* the IR.
- **Honest partial state** — an IR can be `open / partially-satisfied / satisfied / stale`, independent of any
  mission's success → operationalizes "false certainty destroys decision space" ([[feedback_signal_decision_action]]).
- **Tames mission-explosion** — the IR's *default* service is **Answer from existing intelligence**; a mission
  is an escalation, not a reflex.

### 7.3 — What objects may satisfy an IR?
A response set, one or more, over time, each carrying grounding/provenance and linked back to the IR:
- **Answer** (grounded retrieval) — existing intelligence suffices → cite, mark satisfied.
- **Collection Mission** — retrieval insufficient (the §Q2 criteria) → bounded tasking.
- **Standing Watch** — the need is ongoing (recurring pattern / persistent entity surveillance).
- **Incident** — findings reveal a confirmed, actionable event needing response (now an *output serving* the IR).
- **Briefing / Decision-Support product** — the dissemination artifact delivered to the decision-maker.
- **No-Action / Accept-Risk / Dismiss** — a **legitimate, recorded** outcome with rationale (intelligence often
  concludes "nothing actionable" — it needs a home, which neither incident- nor mission-centric models give it).
IRs may be **partially satisfied, re-opened, and superseded** without losing the thread.

### 7.4 — Fit with Commander's Intent + Signal → Decision → Action
The IR is arguably the **missing middle** that makes Signal→Decision→Action coherent: it is the explicit
articulation of "what must I know to make this decision?" sitting between raw signal and decision. It turns
ambient signal into a **decision-anchored question**, preserves decision space (named confidence + gaps), and
makes the **Intelligence-Officer** claim structurally true — a real IO manages a **requirements list (PIRs)** and
reports satisfaction, not "runs missions." This is the construct that unlocks Marks III–IV (Trajectory,
Decision Advantage) on the Fortress roadmap. Mission-centric optimizes *workflow*; IR-centric optimizes
*decision support* — which is exactly the commander's stated intent.

### 7.5 — Risks if every intelligence gap becomes a mission (and the new risks IR introduces)
- **Mission-explosion (the original worry) — *reduced* by IR:** because the IR's default is Answer, missions
  become the exception. Still cap with budget, dedup, bounded scope, collection-safe/action-gated (per §Q5).
- **New risk — over-formalization / ceremony:** if every trivial question must mint a formal IR, the fast path
  slows. *Mitigation:* IRs are lightweight; only **durable, decision-bearing** needs get promoted to tracked
  IRs — a one-off lookup stays implicit.
- **New risk — IR sprawl / zombie requirements:** un-closed IRs accumulate. *Mitigation:* satisfaction criteria
  + review/expiry + dedup (one "copper theft NE BC" IR, not ten).
- **New risk — coverage illusion:** a tidy IR list can *imply* coverage that collection isn't actually
  delivering (the dead-monitor failure mode at a higher level). *Mitigation:* IR state must reflect **real**
  collection/answer status → again coupled to retrieval honesty + IBA.
- **New risk — priority inflation:** everything becomes "priority." *Mitigation:* distinguish PIR from routine.

### 7.6 — Verdict + anti-anchoring guard
**The more fundamental object is the Intelligence Requirement, not the Mission.** Recommended hierarchy:
**IR = first-class** (decision-anchored, persistent); **Mission / Watch / Answer / Incident / Briefing /
No-Action = response types** that service it; **Incident remains an output, never an input.**
- **Capability-integrity label:** an Intelligence-Requirement object is **NOT PRESENT** today (current
  first-class objects are incident + partial mission/investigation primitives). IR-centric is a *hypothesis*,
  not a current capability.
- **Anti-anchoring (we have now reframed incident → mission → IR):** do **not** lock IR as the final answer and
  start architecting it. Subject it to the same disconfirming discipline as the backlog §5/§6: validate against
  **real operator behavior** (the Operator Question Test) — do operators actually reason in *requirements*, or
  is IR an analyst's elegant abstraction that adds ceremony to the fast path? Let observed behavior, not
  conceptual elegance, confirm the construct before commitment.

**No work started, no backlog item created, no sequencing changed** (per directive). This section captures the
deeper object question so that, if/when the operating-model campaign opens, we evaluate **Intelligence
Requirement** as the candidate root — driven by decision support, not workflow mechanics.

---

## 8. The two layers — Operator Experience vs System Architecture

**Meta-finding (the commander's real challenge):** §1–§7 reasoned almost entirely about the **internal
operating model** (incident → mission → IR). The copper-theft failure — *"I cannot, there is no incident"* —
is a **different axis**: the **operator-experience** layer. We were evaluating the architecture layer and the
UX layer **as if they were one thing.** They are not. That conflation *is* the defect: the incident precondition
is an internal mechanism that **leaked** into the operator's experience.

**Verdict: yes — next-gen Aegis should be two separate-but-coupled concepts.**
```
EXTERNAL (Operator Experience)        INTERNAL (System Architecture)
User Intent                           Signals
   → Best Execution Path                 → Intelligence Requirements
        (router hides mechanism)            → Missions / Watches / Incidents / Briefings
                                               → Decision Support
            └──────── coupled by: (a) an intent→path ROUTER, and ────────┘
                      (b) an EPISTEMIC-SURFACING CONTRACT
```
The external layer optimizes for **effortlessness + intent-fidelity** (feel like Claude/Perplexity for simple
asks). The internal layer optimizes for **rigor, provenance, durable decision support** (feel like an
Intelligence Officer for deep asks). What connects them is a **router** (classify intent → select execution
path → invoke internal objects) and — the crux — an **epistemic-surfacing contract**.

> **The one asymmetry that governs everything: hide the *mechanism*, never hide the *epistemic state*.**
> The operator must never need to know "incident vs mission vs IR." The operator must **always** be told
> "I have grounded data / I don't / this is low-confidence / this isn't collected." Mechanism is private;
> uncertainty and coverage are public. Get this wrong in either direction and the system fails.

### Q1 — Is Intelligence Requirement still the correct first-class object *internally*? **Yes.**
The two-layer framing does not weaken §7; it **clarifies** it. IR remains the internal first-class object
(decision-anchored, persistent). The earlier confusion came partly from imagining the operator must *see* or
*name* the IR — they must not. IR is internal; the operator speaks intent. (Still a hypothesis pending the
Operator Question Test.)

### Q2 — Should User Intent be the primary routing construct *externally*? **Yes.**
Intent (advisory / search / assessment / research / monitoring / operations) is how operators actually think.
The system classifies intent → routes to the best execution path (direct answer / retrieval / product search /
assessment / mission / watch / incident / briefing) **without the operator choosing or seeing the path.** Two
guardrails: the router (a) asks **one** brief clarifying question when intent is genuinely ambiguous, and (b)
defaults to the **least-effort path that honestly serves the intent**, then *offers* escalation — never forces
the heavy path.

### Q3 — Relationship between Intent / IR / Mission / Watch / Incident / Briefing
Layered, and explicitly **not 1:1**:
- **User Intent** — external, per-utterance, transient. The entry event.
- **Best Execution Path** — the router's decision; maps an intent to one or more internal actions.
- **Intelligence Requirement** — internal, durable, first-class. Created/updated **only when** an intent
  implies a knowledge need worth tracking. *Most simple intents resolve without ever minting an IR.*
- **Missions / Watches / Incidents / Briefings** — internal **responses** that service IRs (per §7); never
  operator-invoked primitives.
- **Decision Support** — terminal output, surfaced back as a natural answer/briefing.
Mapping is **many-to-many over time**: many intents converge on one IR (everyone asking about copper theft);
one IR accumulates many responses; one briefing answers many intents. The router mediates; the operator sees
none of it.

### Q4 — Mistakes if we EXPOSE internal workflow concepts to operators
- **Abstraction leak** (the copper-theft failure) — forces operators to learn internal preconditions.
- **Cognitive burden** — must learn mission/incident/IR vocabulary to get an answer.
- **Workflow gaming** — operators manufacture incidents/missions to unlock capability → **corrupts the incident
  ledger** (exactly what we found).
- **Brittleness** — UI vocabulary couples to internal schema; refactors break the user's mental model.
- **Adoption loss** — feels like enterprise workflow software, not an intelligence partner.

### Q5 — Mistakes if we HIDE too much and Aegis becomes a generic chatbot
The symmetric, equally-dangerous failure:
- **Loss of grounding/provenance** — answers from parametric knowledge, not cited tenant intelligence (the
  INC-CTX-CONTAM fabrication mode).
- **Breaks the epistemic-surfacing contract** — hides "I don't actually have data on this" → fabrication
  instead of honest "not collected." *This is the cardinal sin of over-hiding.*
- **No durable intelligence** — stateless; loses "what do we know about X over time," loses decision memory.
- **No proactive capability** — only reacts to prompts; loses standing watches / "what's forming" → collapses
  Marks III–IV.
- **False effortlessness** — fast, confident, shallow/wrong answer on a question that actually *required*
  collection. **Over-hiding = confident shallowness; over-exposing = bureaucratic friction.** The target sits
  between: effortless surface, rigorous core, honest about which mode it is in.

### Q6 — Fit with Commander's Intent ("preserve decision space by shortening Signal → Decision → Action")
The separation serves it **directly and on both halves**:
- **Shortens S→D→A** — the external router removes workflow friction (no manufacturing incidents) → faster
  question-to-decision-support; the internal IR layer keeps the substance grounded.
- **Preserves decision space** — the epistemic-surfacing contract refuses false certainty (honest "I don't
  know / not collected / low-confidence"). The internal layer is *where* confidence/coverage is tracked; the
  external layer *honestly surfaces* it.
- Both failure modes attack decision space: over-exposure *lengthens* the loop (friction); over-hiding
  *manufactures false certainty*. **The two-layer split, done right, is precisely what avoids both** — which is
  why it fits the doctrine better than either a pure-workflow or pure-chatbot model.

### Q7 — Copper-theft, specifically
This was a **dual external-layer failure**: (1) no intent routing, and (2) an abstraction leak.
- **"What tracker do you recommend for copper theft?"** = **Advisory / Product-Research** intent → execution
  path: **Direct Answer + Product Search + comparison**, grounded in tenant context (copper theft as a known
  threat to the assets). No incident, no mission. Effortless, Perplexity-class.
- **"Dispatch a specialist agent."** = **Operations / Investigation** intent → open/attach an **IR**
  ("understand copper-theft threat to PETRONAS NE-BC assets") → select agent → **Collection Mission** — *without
  an incident.* Aegis should never have surfaced "no incident."

**How Aegis should differentiate intent** (verb + object signature, not internal state):
| Operator says… | Intent | Execution path |
|---|---|---|
| "recommend / compare / which / best tool for…" | Advisory / Product-Research | Direct Answer / Product Search |
| "what do we know about / tell me about…" | Search / Retrieval | Grounded retrieval (escalate iff coverage insufficient) |
| "what's forming / assess / how serious is…" | Assessment | Intelligence Assessment (retrieve + analyze) |
| "investigate / dispatch / dig into / look into…" | Operations / Investigation | IR → Collection Mission |
| "watch / monitor / alert me on…" | Monitoring | Standing Watch |
Ambiguity → one clarifying question, or answer-first-then-offer-escalation. Crucially, the **answer-vs-collect**
decision is part of path selection and depends on **retrieval honesty** (can we ground this now?) — coupling
this whole model back to Wave A.

### 8.1 — Crux, caveats, and anti-anchoring
- **The crux is the epistemic-surfacing contract**, not the object taxonomy. Hiding mechanism is easy; the hard,
  high-stakes part is surfacing *exactly* the right epistemic state so the system is effortless **without**
  becoming a confident fabricator. That is where the design risk concentrates.
- **Capability-integrity labels:** today Aegis is **one layer** that leaks internal objects (incident) and
  partially hides others. The external **User-Intent router** is **NOT PRESENT**; the internal **IR object** is
  **NOT PRESENT**; the epistemic-surfacing contract is **PARTIAL** (grounding doctrine exists; intent-aware
  honesty does not). All three are hypotheses, not capabilities.
- **Anti-anchoring (this is the 4th reframe: incident → mission → IR → two-layer):** the two-layer model is the
  strongest organizing hypothesis yet, but it is still a hypothesis. Validate against **real operator behavior**
  via the Operator Question Test (backlog §6) — which already measures *intents in the wild* and failure modes
  (R/C/A/P). Let observed behavior confirm both the intent taxonomy (external) and the IR construct (internal)
  before any commitment. **Decision support over conceptual elegance.**

### 8.2 — Bottom line
Yes: build next-gen Aegis as **two separate-but-coupled layers** —
1. **External:** *User Intent → Best Execution Path* (interpretation + routing; mechanism hidden; effortless).
2. **Internal:** *Intelligence Requirement → Decision Support* (the intelligence operating model; rigorous; durable).
Connected by a **router** and an **epistemic-surfacing contract** (hide mechanism, never hide uncertainty).
This is what lets Aegis be **as effortless as ChatGPT when a simple answer is right, and as capable as an
Intelligence Officer when collection/analysis/action is required** — the stated goal. The separation is more
useful than either layer alone, and it explains every prior finding: the incident-gate, the mission/IR debate,
and the copper-theft leak were all symptoms of a **missing layer boundary.** Evaluation only — nothing built.
