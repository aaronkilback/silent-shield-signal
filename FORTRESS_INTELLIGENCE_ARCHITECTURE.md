# Fortress AI — Compounding Intelligence Architecture
## Vision, Analysis & Build Plan
**Last updated: 2026-04-07**

---

## The Vision

Fortress is not a dashboard. It is a **compounding intelligence organism**.

### What That Means in Practice

It is 3:47am. A Wet'suwet'en hereditary chief posts a video announcing a surprise blockade of the Coastal GasLink access road near Houston, BC. Within four minutes — before any human at PETRONAS is awake — Fortress has:

- Detected the post through social monitoring
- Cross-referenced the location against the asset registry (12km from active CGL construction)
- Pulled the chief's historical activity from the entity graph — three prior blockades, escalation pattern, average 72h duration
- Checked weather: -18°C overnight (historically accelerates resolution)
- Scanned for corroborating signals — two other social accounts reposting, a CBC journalist following the account
- Computed confidence score: 0.84 → threshold exceeded → incident created automatically with full provenance chain

The duty officer's phone at 3:51am shows not an alert but a **briefing**:

> *"Confirmed blockade, CGL access road km 42 near Houston. High confidence. Estimated 40-60 personnel. LOCUS-INTEL recommends liaison contact with CGL site manager within 2 hours. Historical pattern suggests 48-72h duration. Weather forecast favors resolution. No credible escalation indicators."*

The duty officer types one word: "Acknowledged."

That single feedback event writes back. The source reliability score for that social monitoring channel goes up fractionally. The confidence threshold calibration improves. The pattern for Wet'suwet'en blockades gets stronger.

Six months later, Fortress detects the **precursor** — not the blockade, but the pattern that precedes one. A cluster of private messages between known activists, a spike in searches for CGL site locations, a land defenders forum post asking about road conditions. Confidence: 0.61 — below the incident threshold. Signal enters monitored queue. Agents watch it. Three days later the blockade happens and the confidence score retrospectively recalibrates. Next time the precursor appears, confidence will be 0.74. One day it exceeds 0.70 and Fortress creates an incident **before the blockade begins**.

That is early cancer detection. That is compounding intelligence.

---

## Three Pillars

### 1. Immutable Event Chain
Nothing is ever deleted. Everything is traceable. Every signal ingested, every dedup decision, every relevance gate score, every incident created, every agent dispatched, every feedback submitted — permanently recorded. You can always answer: what signal created this incident, what was in that signal, where did it come from, what did the agent conclude, was the conclusion right.

### 2. Bayesian Confidence Scoring
Signals earn their way to incidents. No single AI boolean decides. Confidence is computed from multiple independent factors — source reliability history, corroboration count, relevance gate score, entity proximity to known assets — and only signals exceeding a threshold automatically create incidents. Below threshold: monitored queue. Agents watch for corroborating signals. Confidence updates as new evidence arrives.

### 3. Outcome Feedback Loop
Every closed incident teaches the system. When an incident closes, the outcome — legitimate, false positive, duplicate, escalated — writes back to the signal that created it, adjusting source reliability scores and relevance gate thresholds. Human feedback is the training signal, not the approval gate. The loop runs nightly. The system gets measurably more accurate every week.

---

## Core Principles

| Principle | What It Means |
|---|---|
| **Autonomous by default** | Humans provide feedback, not approvals. The system acts; humans calibrate. |
| **Human feedback = training signal** | Every analyst action (acknowledge, close, flag) is a data point that improves future decisions. |
| **No hard deletes** | Soft deletes only. Evidence is never destroyed. Root cause diagnosis must always be possible. |
| **Provenance required** | Every incident traces to a real source. No orphaned incidents. |
| **Confidence before action** | Below threshold = monitored, not ignored. Above threshold = acted on. |
| **Early detection over false precision** | Catch weak signals early. Let confidence build. Better a monitored signal that becomes an incident than a missed threat. |

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

*This document is the authoritative reference for Fortress AI architecture decisions. Update it when the architecture changes. The build plan is a living document — update status as phases complete.*
