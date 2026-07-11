# Fortress AI — Compounding Intelligence Architecture
## Vision, Analysis & Build Plan
**Last updated: 2026-04-07**

---

FORTRESS VISION v2 (2026-07-11, supersedes 2026-04-07 vision section)

CORE THESIS

Fortress is a compounding intelligence organism. An autonomous
signal-to-incident pipeline where human feedback is training signal,
not approval gate. The asset is not the agent framework, which is
replicable. The asset is accumulated operational memory, the
signal-to-decision-to-outcome flywheel, which is not.

THREE PILLARS (unchanged, ratified)

1. Immutable event chain. Nothing deleted, everything traceable.
2. Bayesian confidence scoring. Signals earn incident status.
3. Outcome feedback loop. Every closed incident improves the next
   decision.

EMERGENT PROPERTIES (new, these are consequences of the pillars,
not features to build)

Retroactive intelligence. Because nothing is deleted and everything
is re-scorable, new signals rewrite the meaning of old ones.
Dismissed does not mean dead, it means dormant. The archive
appreciates. Data collected in January is worth more in July and
more again next year. Every new client and feed makes existing
history smarter.

Absence detection. A calibrated system with baselines treats
silence as data. A quiet actor, a stopped pattern, a dead feed are
signals. WO-CANARY is the inward-facing primitive. The outward-
facing version, baselining expected normal per entity and per site
and alerting on deviation toward quiet, is a roadmap item.

Synthetic experience. Phase 3.5 decouples system experience from
history. The system trains on ten thousand campaigns that never
happened and carries the pattern memory into the one world that
exists. Detection capability is no longer capped by the incident
rate of reality.

Behavioral identity. With sufficient sensor density, actors who
never show a face or plate are bound in the entity graph by how
they move. Gait, dwell time, approach angles, timing rhythms,
driving style. Identity made of behaviour. You can mask your face,
you cannot mask your habits.

BUILD SEQUENCE (extended)

Phase 1  Foundation. Complete.
Phase 2  Confidence. Complete.
Phase 3  Feedback loop.
Phase 3.5  Synthetic Intelligence Loop. Committed.
Phase 4  Entity graph.
Phase 5  Nervous system. Connected sensing in. Sensors, vehicles,
         cameras, wearables, drone feeds become graph inputs.
         Physical objects gain object permanence, the household
         becomes one entity with one combined threat surface.
Phase 6  Actuation. Connected response out. Confidence thresholds
         trigger physical and digital actions, gates, cameras,
         lighting, routing, pre-positioning. The best intervention
         is invisible to the principal.

Each phase verified before the next begins. No exceptions.

DOCTRINE PREREQUISITES (must exist before code)

Consent architecture. Monitoring a principal's body, family, or
household is a privacy regime, not a feature. Explicit consent
schema and contract language precede any Phase 5 ingestion of
personal telemetry. Done right this is a moat competitors cannot
retrofit. Done casually it is a lawsuit.

Actuation ruling. A section 2b level doctrine decision defining
which actions may fire without a human, at what confidence, with
what rollback, before any Phase 6 code exists.

COMMERCIAL ENDGAME

The feedback loop run long enough produces calibrated probabilities
with a verifiable track record. Site, window, likelihood, proven
honest over time. That is actuarial data. It reframes physical
security from cost centre to priceable risk and expands the buyer
pool beyond protective intelligence consolidators to underwriters.
Exit thesis remains 4 to 7x ARR, 10M ARR target, 25 principal hard
cap, but the actuarial layer is the multiple expander.

---

## The Signal Pipeline — How It Actually Works (as of 2026-04-07)

Traced from source to incident, based on direct source code analysis:

```
Monitor functions
(monitor-news, monitor-canadian-sources, monitor-social, etc.)
        │
        ▼
  ingest-signal  ◄── PRIMARY GATEKEEPER (most signals)
        │
        ├── False positive filter (keyword-matcher)
        ├── Test content filter
        ├── Content hash check (previously rejected)
        ├── CVE dedup (same CVE today?)
        ├── URL dedup (same source_url in 30 days?)
        ├── Semantic near-dedup 80% (detect-duplicates)
        └── Same-story check 50-79% (AI: new intel or rehash?)
        │
        ▼
  AI Classification (gpt-4o-mini)
  → normalized_text, entity_tags, severity, confidence, event_date, is_historical
        │
        ▼
  Client Matching
  → keyword scoring (length-weighted) + AI fallback
  → match_confidence: explicit | high | medium | low | ai | none
        │
        ▼
  AI Relevance Gate (gpt-4o-mini)
  → PECL score 0.0–1.0
  → Reject if score < 0.60 → write to filtered_signals
  → Accept if score ≥ 0.60
        │
        ▼
  Learned Pattern Relevance Score (signal-relevance-scorer)
  → Suppress if known noise pattern
        │
        ▼
  Signal written to DB
  (with severity_score, quality_score, confidence, source_url, content_hash)
        │
        ├── (async) Anomaly scoring
        ├── (async) Expert knowledge enrichment
        ├── (async) Entity correlation
        └── (async) Signal correlation
        │
        ▼ (P1 CRITICAL FAST-PATH)
  Parallel: AI Decision Engine + Webhook + Incident creation
  → No confidence threshold check on fast path (known gap)
        │
        ▼ (STANDARD PATH — all others)
  ai-decision-engine (gpt-5.2)
  → Applies approved rules first (deterministic)
  → Smart filter: AI only for high/critical or confidence ≥ 0.8
  → Historical content guardrail: >90 days old → force low, no incident
  → Anti-fabrication rules in system prompt
  → Cross-model consensus for P1/P2 (multi-model-consensus)
  → Storyline clustering (classifySignalIntoStoryline)
  → Returns: should_create_incident (boolean) + confidence (0-1)
        │
        ▼ (INCIDENT CREATION — THREE PATHS, ALL WITH GAPS)
  Path A: ai-decision-engine creates incident internally
  Path B: ingest-signal creates incident after calling ai-decision-engine
  Path C: ingest-signal fallback rules create incident
  → All three paths: no confidence threshold check, no provenance fields
        │
        ▼ (BYPASSES — ROOT CAUSE OF DUPLICATE INCIDENTS)
  monitor-canadian-sources → writes directly to signals + creates incidents
  → Bypasses ingest-signal entirely
  → Bypasses all 7 dedup layers
  → Bypasses relevance gate
  → Bypasses provenance requirement
```

---

## Deep Dive Findings — What's Working, What Isn't

### What's Working Well

**The ingest pipeline has extraordinary quality filters:**
- 7 sequential dedup layers (hash, URL, CVE, semantic 80%, same-story AI check)
- PECL-calibrated relevance gate (0.60 threshold, tested and working)
- Historical content guardrail (>90 days → force low severity, no incident)
- Anti-fabrication rules explicitly in the AI system prompt
- Cross-model consensus for P1/P2 signals
- Storyline clustering connects signals into narrative threads
- Client matching with scoring and AI fallback
- Expert knowledge enrichment (async)
- Learned patterns from analyst feedback injected into every AI call

**The learning infrastructure is real:**
- `learning-context-builder.ts` reads from `learning_profiles`, `source_reliability_metrics`, approved/rejected patterns, behavioral signals, seasonal data
- This context is injected into every AI call — the system knows what patterns analysts have approved and rejected
- `source-credibility-updater` uses Bayesian math to update source reliability scores

**The agent routing is sophisticated:**
- 15 specialized agents selected by signal characteristics
- LOCUS-INTEL, 0DAY, ECHO-WATCH, FININT, VERIDIAN-TANGO, SENTINEL-OPS, etc.

### What's Broken or Missing

**Gap 1 — `should_create_incident` boolean is the only incident gate**
```typescript
if (decision.should_create_incident) { create incident }  // no confidence threshold
```
No confidence threshold check. The AI's confidence score lives in `raw_json` but is never used as a gate. A signal the AI is 35% confident about creates an incident the same as one it's 95% confident about.

**Gap 2 — Three incident creation paths with no dedup between them**
- Path A: `ai-decision-engine` creates incident internally
- Path B: `ingest-signal` creates incident after calling `ai-decision-engine`
- Path C: `ingest-signal` fallback rules create incident

Path B can create a second incident for the same signal that Path A already created. The dedup check (`signal_id` FK) only exists inside `ai-decision-engine`, not in `ingest-signal`.

**Gap 3 — `monitor-canadian-sources` bypasses everything**
Writes directly to `signals` table and creates incidents without going through `ingest-signal`. This is the confirmed root cause of all duplicate incidents observed week of April 6.

**Gap 4 — No provenance chain on incidents**
Incidents are created with `signal_id`, `client_id`, `priority` but no:
- `provenance_type` (what kind of thing created this)
- `provenance_id` (which specific record)
- `provenance_summary` (what the triggering content said)
- `created_by_function` (which function created it)

When a source signal is deleted (even soft-deleted), the incident loses all traceability.

**Gap 5 — `incident_outcomes` table exists but nothing reads it for learning**
The table is created. The `source-credibility-updater` batch mode reads `signals.is_false_positive` and `signals.incident_id` — but NOT `incident_outcomes`. The feedback loop wire exists at the schema level but is not connected at the code level.

**Gap 6 — `confidence` column on signals is initialized to 0.0 and never computed**
The column exists. The AI classification sets a confidence value in the response. But the AI decision engine doesn't write a structured, queryable confidence score back to the signal row in a way the incident threshold can use.

---

## Build Plan — Four Phases

Each phase is verified before the next begins. Nothing marked complete until independently verified.

---

### PHASE 1 — FOUNDATION
**Goal:** Make root cause diagnosis possible. Stop evidence destruction. Wire the first feedback loop.

**Status: COMPLETE — Deployed and verified April 7, 2026.**

| Step | Change | Status | Verified |
|---|---|---|---|
| 1A | Soft deletes on signals + incidents | ✅ Done | `information_schema` confirmed — `deleted_at` + `deletion_reason` on both tables |
| 1B | Provenance chain on incidents | ✅ Done | `ai-decision-engine` writes `provenance_type`, `provenance_id`, `provenance_summary`, `created_by_function` on every new incident |
| 1C | Confidence threshold gate (0.65) | ✅ Done | `ai-decision-engine` logs to `incident_creation_failures` when confidence < 0.65, no incident created |
| 1D | `incident-action` writes to `incident_outcomes` | ✅ Done | Resolve action writes outcome row — feedback loop source wired |
| 1E | `monitor-canadian-sources` bypass closed | ✅ Done | Now routes through `ingest-signal` full 7-layer pipeline |

**What was actually verified:**
- DB: 4 incidents confirmed — 2 open (Coastal GasLink P2, Fortinet P2), 2 closed (clean titles)
- Signal JOIN: Coastal GasLink incident links to real non-deleted signal 7a8cae18
- `incident_creation_failures`: table queryable, total = 0 (gate wired, not yet fired against real data)
- All 9 Phase 1 columns confirmed in `information_schema`
- Watchdog updated and deployed — monitors Phase 1 health every 6 hours

**Known gaps carried forward:**
- 3 of 4 existing incidents have `provenance_type = null` — pre-Phase 1, expected, watchdog will tag as `legacy_unknown`
- Incident #3 (Fortinet) has no `signal_id` — created manually before Phase 1, not fixable retroactively
- `source-credibility-updater` does not yet read from `incident_outcomes` — this is Phase 3 work
- Confidence gate never fired against real data — will activate on first real signal through the engine post-deploy

---

### PHASE 2 — CONFIDENCE SCORING
**Goal:** Signals earn their way to incidents. Replace the binary AI boolean with a multi-factor score.

**Status: IN PROGRESS**

**Threshold model:**
- ≥ 0.70 → Auto-create incident
- 0.40–0.69 → Monitored queue (agents watch, no incident yet)
- < 0.40 → Archive, feed back to source reliability

**Confidence score inputs (weighted):**
- AI decision engine confidence (50%) — self-reported from analysis
- AI relevance gate score (35%) — computed independently in ingest-signal
- Source credibility score (15%) — from source_credibility_scores table, Bayesian history

| Step | Change | Status | Verified |
|---|---|---|---|
| 2A | Composite confidence gate in `ai-decision-engine` | ✅ Done | Source credibility lookup at line ~100; composite gate at line ~655; all three inputs logged to `incident_creation_failures` on rejection |
| 2B | `composite_confidence` written back to signal row | ✅ Done | Migration `20260407000003_phase2_composite_confidence.sql` applied; write-back fire-and-forget after gate computation; column `numeric`, nullable, indexed |
| 2C | Monitored queue view in AEGIS | ✅ Done | AEGIS calls `get_monitored_signals` tool; returns empty queue with correct explanation; will populate as signals flow through post-Phase 2 deploy |

**Design note:** Source credibility defaults to 0.65 (neutral) until enough outcome history accumulates. This is intentional — the weight increases as the feedback loop matures. The architecture doc will track weight adjustments as Phase 3 data arrives.

---

### PHASE 3 — OUTCOME FEEDBACK LOOP
**Goal:** Every closed incident teaches the system. Close the learning loop fully.

| Step | Change | Status | Verified |
|---|---|---|---|
| 3A | `incident-action` resolve writes to `incident_outcomes` | ✅ Done | Done in Phase 1D — resolve action inserts outcome row with `outcome_type`, `was_accurate`, `false_positive`, `lessons_learned` |
| 3B | `source-credibility-updater` reads `incident_outcomes` | ✅ Done | Migration `20260407000004_phase3_outcome_feedback.sql` applied — `credibility_updated BOOLEAN DEFAULT FALSE` added; `processIncidentOutcomes` function added and wired into `processBatch`; Bayesian update runs on each unprocessed outcome; stamps `credibility_updated_at` on completion |
| 3C | Relevance gate threshold adjusts per source | ✅ Done | `ingest-signal` looks up `source_credibility_scores` after gate score computed; threshold = `min(0.70, max(0.50, 0.60 + (0.65 - credibility) × 0.40))`; requires ≥5 signals before adjusting (thin data protection) |
| 3D | Learning profiles update from outcome data | ✅ Done | `process-feedback/handleIncidentFeedback` extracts keywords from linked signal text; pushes to `rejected_signal_patterns` on false positive, `approved_signal_patterns` on legitimate; non-blocking, additive to existing learning |

**Bounds:**
- Source reliability score: min 0.05, max 0.98 (Bayesian update math already in source-credibility-updater)
- Threshold adjustment: max ±0.15 per source (prevent runaway suppression)
- Minimum 5 signals before source reliability score is used (thin data protection)

---

### PHASE 4 — ENTITY GRAPH
**Goal:** Signals become events in an entity's history. Cross-signal pattern detection. Precursor detection.

| Step | Change | Status | Verified |
|---|---|---|
|---|
| 4A | Core entities seeded | ✅ Done | 23 duplicates/noise soft-deleted; 5 missing entities inserted (Houston BC, Wedzin Kwa, Peace River Region, First Nations LNG Coalition, PETRONAS Canada); 15 relationships wired; pg_trgm enabled; deleted_at + deletion_reason added to entities table; patch applied for Peace River restore + Wedzin Kwah dedup + HTML entity cleanup |
| 4B | Signal ingestion auto-tags entity references | ✅ Done | `correlate-entities` wired into `ingest-signal` (both fast-path and standard path); token boundary matching replaces fragile `\b` regex; PostgREST 1000-row cap fixed with pagination; alias collision fixed (Gidimt’en removed from Wet’suwet’en aliases); 7 entities tagged from single test signal |
| 4C | Cross-signal pattern detection | ✅ Done | `detect-threat-patterns` scheduled every 6h (migration 20260407000010); upgraded to read `entity_mentions` (Phase 4B resolved entity IDs) as primary source, falling back to raw `entity_tags`; pattern signal includes `entity_id` + `resolved_from_graph: true`; verified: frequency spike (48 vs 20 prior week) + Fort St. John entity escalation both detected with graph_resolved: true |
| 4D | Entity graph relationships | ✅ Done | `correlate-entities` traverses `entity_relationships` (one hop, strength ≥0.5) after writing mentions; checks related entities for activity in 72h window; corroboration boost = min(count × 0.05, 0.15) written to `composite_confidence` + `phase4d_traversal` in `raw_json`; verified: two related signals each received +0.15 boost with corroborating entities correctly identified via graph |

---

## Standing Regression Rules

Apply to every change, every deploy:

1. **Before any deploy:** snapshot open incident count + active signal count
2. **After every deploy:** verify counts unchanged unless expected change
3. **Any ingestion pipeline change:** manually trigger one run, check output counts at each stage
4. **Any schema change:** confirm existing records read correctly in the UI
5. **Any learning loop change:** verify source reliability scores are bounded (0.05–0.98)
6. **Nothing marked complete until independently verified** — summary not accepted, code/output proof required

---

## Key Files Reference

| File | Purpose |
|---|---|
| `supabase/functions/ingest-signal/index.ts` | Primary signal gatekeeper — 7 dedup layers, relevance gate, client matching |
| `supabase/functions/ai-decision-engine/index.ts` | Threat assessment, incident creation decision, agent routing |
| `supabase/functions/incident-action/index.ts` | Incident lifecycle actions + outcome recording |
| `supabase/functions/monitor-canadian-sources/index.ts` | **KNOWN BYPASS** — writes directly, must be routed through ingest-signal |
| `supabase/functions/source-credibility-updater/index.ts` | Bayesian source reliability updates |
| `supabase/functions/_shared/learning-context-builder.ts` | Injects learned patterns into every AI call |
| `supabase/functions/thread-weaver/index.ts` | Nightly narrative thread clustering (runs 2am UTC) |
| `supabase/functions/knowledge-synthesizer/index.ts` | Nightly knowledge synthesis (runs 5am UTC) |
| `supabase/migrations/20260407000002_phase1_foundation.sql` | Phase 1 migration — ready to deploy |

---

## DB Schema — Phase 1 Additions

### signals (additions)
```sql
deleted_at        TIMESTAMPTZ  -- Soft delete. NULL = active.
deletion_reason   TEXT         -- Why deleted (duplicate, noise, test, etc.)
```

### incidents (additions)
```sql
deleted_at            TIMESTAMPTZ  -- Soft delete. NULL = active.
deletion_reason       TEXT
provenance_type       TEXT         -- signal | aegis_conversation | human_report | external_tip | system_rule
provenance_id         TEXT         -- UUID of source record
provenance_summary    TEXT         -- Human-readable trigger description
created_by_function   TEXT         -- Which edge function created this
outcome_type          TEXT         -- legitimate | false_positive | duplicate | escalated_to_client | under_investigation
outcome_notes         TEXT
outcome_recorded_at   TIMESTAMPTZ
```

### incident_creation_failures (new table)
```sql
id                UUID
attempted_at      TIMESTAMPTZ
source_function   TEXT
failure_reason    TEXT
attempted_data    JSONB
signal_id         UUID → signals(id)
client_id         UUID → clients(id)
```

### incident_outcomes (ensure exists with learning fields)
```sql
id                          UUID
incident_id                 UUID → incidents(id)
signal_id                   UUID → signals(id)
outcome_type                TEXT
was_accurate                BOOLEAN
false_positive              BOOLEAN
response_time_seconds       INTEGER
lessons_learned             TEXT
improvement_suggestions     TEXT[]
source_reliability_impact   NUMERIC
created_at                  TIMESTAMPTZ
```

---

## The Devil's Advocate — Known Risks

**Risk 1 — Confidence scoring requires training data that doesn't exist yet**
A confidence score weighted by source reliability only works once enough outcomes have been recorded. In early operation, the score will have low precision. Mitigation: launch conservatively with only 2 inputs (relevance gate score + source type). Add more dimensions as outcomes accumulate.

**Risk 2 — The learning loop can develop biases**
If a legitimate source produces early noise, its reliability score drops, suppressing future signals from that source. The system can become more confident in a wrong belief. Mitigation: score is bounded (min 0.05), periodic human review of what the system has learned, minimum 5 signals before score is used.

**Risk 3 — Routing `monitor-canadian-sources` through `ingest-signal` adds latency**
The Canadian sources function currently writes directly. Routing through `ingest-signal` adds ~2–3 AI calls per article. For a function running every 30 minutes on a small number of articles, this is acceptable. Verify timing after change.

**Risk 4 — Three incident creation paths create race conditions**
Paths A and B can both execute for the same signal. The existing `signal_id` FK dedup check in `ai-decision-engine` partially prevents this but doesn't cover Path B's direct insert. Phase 1B must fix all three paths atomically.

**Risk 5 — The vision requires input volume that doesn't fully exist yet**
Social monitoring produces ~50 signals/week. Dark web has been offline since March 16. NAAD is broken. The architecture is right but needs healthy input pipes. Signal pipeline fixes and architecture work must proceed in parallel.

---

## April 8 Meeting Context

Platform is live at PETRONAS Canada (PECL) since January 2026 as proof-of-concept. Written authorization obtained for continued use without compensation (conflict of interest + IP retention concern). PETRONAS declined commercial arrangement.

Meeting April 8 with Edward Ostrowski (energy executive, Calgary), Vivek Nittoor (Himmel Secure, drone/UAS AI), Ryan Hofer (Workhaus, innovation connector). Strategy: listen first, present executive brief, ask "who else should see this?"

Current open incidents for demo:
- INC-5: Suspected Sabotage — Coastal GasLink Pipeline Near Fort St. John (P2, legitimate)
- INC-6: URGENT: Fortinet FortiClient EMS Vulnerability — CISA KEV BOD 22-01 Deadline April 8 (P2, **escalate to PETRONAS IT today**)

---

## PHASE 3.5 — SYNTHETIC INTELLIGENCE LOOP (north star, do not build yet)

> **STATUS: NORTH STAR — NOT IN THE BUILD QUEUE.** Recorded for direction only. Current priorities are unchanged: (1) Governance & data-handling one-pager, (2) WO-DATA-INTEGRITY, (3) Model failover map (see FORTRESS_VISION_UPDATE_2026-07-09.md). Standing rules (STANDING_RULES.md) apply to anything this phase would ever propose, machine-generated or not. Do not begin until the Phase 3 outcome feedback loop is live and accumulating.

Premise: Fortress currently learns at the speed of reality. Gate 3 calibration required five manual shadow-validation passes. The order-of-magnitude improvement is a simulation loop that lets AEGIS learn faster than reality.

Architecture, three components:

1. SYNTHETIC THREAT GENERATOR. Produces realistic labeled scenarios from real operational memory: SPIN incident patterns (302 incidents, repeat-hit sites, recurring plates), real client taxonomies (client_risk_categories), real geography (PostGIS assets and corridors), real signal shapes from the 940-signal backfill. Every synthetic scenario carries ground truth: the correct score, severity, and escalation are known because we generated it.

2. OVERNIGHT CALIBRATION LOOP. AEGIS scores thousands of synthetic scenarios per night. Misses and false alarms are graded instantly against ground truth. A proposer suggests rubric adjustments, tests against the synthetic stream, retains winners. Manual shadow passes become continuous automated shadow passes.

3. ADVERSARY MODEL. A red-team model whose objective is to construct synthetic threats that evade Gate 3. Detector and adversary co-evolve in-house, ahead of the real arms race.

Hard constraints, non-negotiable:

- Reality corrects the simulator, never the reverse. Real outcomes (Phase 3 feedback loop) continuously recalibrate the generator. A miscalibrated simulator produces a confidently wrong detector.
- Nothing the loop proposes goes live without a shadow pass against real signals. Standing rules apply to machine-proposed changes exactly as to human ones.
- Interpretability tax is paid: any detector the loop discovers must emit a human-readable signal trail. If AEGIS cannot show its work, it does not ship, regardless of benchmark performance.

Dependencies: Phase 3 outcome feedback loop must be live and accumulating first. The simulator is only as good as the operational memory calibrating it.

Moat statement: the generator is calibrated on proprietary incident-to-asset-to-outcome data that compounds monthly. The code is replicable; the calibration data is not.

---

## COGNITION LAYER — AGENT REGISTRY, BELIEFS, AND TRADECRAFT (doctrine; work orders to follow)

> **NOT IN THE BUILD QUEUE.** Doctrine of record for how the cognition layer is governed. Nothing here enters the current build queue; the active sequence (WO-DATA-INTEGRITY, then Gate-3 per-producer, then #83 slice 2) is unchanged. Work orders below are ordered for when this is taken up.

Premise: Fortress's durable asset is not models but the cognition layer above them — the agent roster, the knowledge bank, learned beliefs (source reliability, pattern priors), and investigative tradecraft. This layer gets the same discipline as data: provenance, scoping, versioning, verification.

### 1. Agent Registry (upgrade the roster from cast list to control surface)

Each roster entry becomes the single source of truth with enforced fields:

- persona — voice and narration only. Editing persona is a brand decision.
- specialty — what the agent is authoritative on; governs which knowledge partitions it may WRITE.
- mission_scope — what it may touch; enforced, not descriptive. Editing scope is a security decision. Persona edits and scope edits must be separate operations.
- data_classes (read) and tool_permissions (act) — split the current input_sources field; they are governed differently.
- consult_graph — which agents it may consult_agent. Effective scope is the closure over this graph; the graph is mapped, reviewed, and minimal.
- tenant_scope — enforced join to tenant IDs (formalizes the Client badge).
- task_class + model assignment — from the model-routing WO.
- knowledge_partitions — read/write partitions in the knowledge bank.
- golden_set — the eval cases that gate changes to this agent.
- status — production | experiment | fixture | retired. No unmarked entries.
- version — tradecraft doc version currently deployed.

First work item: ROSTER AUDIT. Inventory all agents; identify duplicates (multiple Oracle/Sentinel/Guardian/Wraith/Jack Ryan variants observed); classify status for every entry; retire or mark accordingly. Same doctrine as the Cascade finding: production registries contain only marked, verified entries.

### 2. Belief Provenance

Every learned artifact — source reliability score, pattern prior, knowledge bank entry, agent_investigation_memory row — must answer: what evidence produced you, which agent wrote you, under which tenant scope, when. Writes without provenance are prohibited (extends the Provenance Doctrine to cognition).

Immediate corollary — CONTAMINATION AUDIT: determine which learning loops and knowledge writers consumed Cascade Energy signals while it was mislabeled active, what they wrote, and reverse or flag those beliefs. The 595 orphaned agent_investigation_memory rows are the same debt in the memory layer; they enter WO-DATA-INTEGRITY's adjacent scope.

### 2b. Two-Layer Beliefs — Collective Learning Without Cross-Tenant Leakage

The rule: patterns may generalize, facts may not.

Beliefs exist in exactly two layers:

- CLIENT-SCOPED beliefs — everything learned ABOUT a client: risk category weights, asset relevance, entity relationships, signal-to-outcome history. Written to that tenant's knowledge partition, readable only by agents operating in that tenant's context. Never crosses. This is the default layer for all learning-loop writes.
- GLOBAL beliefs — facts about the world, not about a client: source reliability scores, detection tradecraft, signal-class base rates, injection patterns. Readable by all tenants' agents. Every client benefits; no client's facts are present.

Promotion gate (client-scoped → global) is an explicit operation, never automatic. The test: could a competitor of the contributing client read this belief and learn anything about that client? Two enforcement rules:

1. ABSTRACTION — promoted beliefs are stripped of entities, assets, locations, and identifiers; generalized to pattern level. "Decommissioned sites see recurring theft at elevated rates" promotes; "site B-089-J was hit twelve times" does not, regardless of phrasing.
2. CORROBORATION — prefer promotion only for patterns observed independently across multiple tenants or corroborated by public data. Single-tenant observations are presumptively client facts.

Enforcement rides on Belief Provenance (§2): every belief row carries tenant_scope and its evidence trail, so a global belief citing single-tenant evidence is a detectable invariant violation — a watchdog probe, not a policy hope. Promotion proposals are an operator worklist initially; a rules-gated pipeline only after safe-promotion patterns are established.

Commercial statement of this architecture: network effects without data commingling. Each client makes the collective tradecraft smarter; no client's data touches another's. The learning loop is owned per-client at the fact layer and owned by Silent Shield at the pattern layer — by architecture, not by promise.

> First enforcement action (2026-07-10): the Cascade belief containment (80 synthetic beliefs quarantined out of Petronas tenant retrieval) is this doctrine's first application — a single-tenant (indeed synthetic-tenant) fact set that had leaked into another tenant's retrieval scope, detected and contained. The WO-DATA-INTEGRITY contamination-audit brief is framed against this doctrine.

### 3. Tradecraft as Versioned Artifacts

One tradecraft document per production agent, in-repo, KB-registered: persona, specialty, mission scope, permissions, model assignment, golden set. Changes ship as reviewed diffs gated by the agent's golden set at the agent level (model + knowledge + prompt together), not the bare model. Phase 3.5's synthetic loop, when built, proposes diffs to these documents — reviewable, testable, revertible.

### Sequencing

Nothing here enters the current build queue. Order when taken up:
1. roster audit — cheap, high-yield, Cascade-pattern hygiene;
2. contamination audit + agent memory orphans — inside WO-DATA-INTEGRITY adjacent scope;
3. registry schema + enforcement — after WO-DATA-INTEGRITY completes;
4. tradecraft extraction to versioned docs — incremental, production agents first;
5. agent-level golden sets — prerequisite for the model-routing WO's swap testing.

---

*This document is the authoritative reference for Fortress AI architecture decisions. Update it when the architecture changes. The build plan is a living document — update status as phases complete.*
