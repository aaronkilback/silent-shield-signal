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
