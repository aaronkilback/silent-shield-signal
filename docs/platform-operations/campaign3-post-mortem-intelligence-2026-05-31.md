# Campaign 3 — Post-Mortem Intelligence

**Strategic planning only.** No implementation, code, branches, or deploys. Tied to Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."*

**Mission framing:** Watchdog (Campaign 1) detects active failures. Executive Reporting (Campaign 2) compresses *Signal → Decision*. Post-Mortem Intelligence closes the third leg: *after* an incident or near-miss, reconstruct the full evidence chain, identify what should have triggered earlier intervention, and codify it into a future tripwire. Without Campaign 3, the Decision Layer learns nothing from its mistakes — it just keeps making them at the same rate.

---

## §1 — Concept assessment

### What "post-mortem intelligence" means in Fortress context

Three distinct sub-capabilities:

1. **Incident reconstruction.** Given an incident (a real one like Trent Reznor methodology-injection, or a customer-reported issue like the Vince V1 entity-count overcount), reconstruct the full chain: what signals existed, what retrieval surfaces were queried, what Aegis traces ran, what decisions were made, what the operator did, and what the outcome was.

2. **Missed-signal detection.** For incidents that *should have* triggered a Decision Frame earlier but didn't, identify the latency and the missing tripwire. (Example: INC-CTX-CONTAM phrase appeared in an Aegis response 2026-05-25; operator caught it via chat; should have been caught by a grounding tripwire — see Campaign 1 W.4.)

3. **Tripwire codification.** Given a reconstructed near-miss, derive a future-detector specification: *"if pattern X recurs, fire alert Y."* These tripwires become Watchdog inputs.

### Why this is operationally critical for Fortress

- The 2026-04 → 2026-05 failure cluster (Vince V1-V4, R1-R6, INC-LEARN-CONTAM, INC-CTX-CONTAM, Path A) all share a pattern: **detected reactively, fixed forensically.** Each cost the operator hours-to-days of investigation.
- Post-mortem Intelligence converts each incident from a one-time investigation into a permanent system asset (a tripwire). After 50 incidents codified, Watchdog covers 50 class-instances of failure.
- The Decision Layer cannot learn from operator behavior unless it can *audit* operator behavior. Flight Recorder gives the audit; Post-Mortem makes the audit operationally useful.

### What this campaign is NOT

- Not a real-time alerting system (that's Watchdog).
- Not an incident-management ticketing system (that's separate IRT scope if ever built).
- Not customer-facing (operator-only forensic surface).
- Not a SIEM (no log aggregation beyond what Fortress already records).

---

## §2 — Existing components already present in Fortress

The forensic substrate exists in pieces. Campaign 3 binds them together — does not build new collection infrastructure.

| Component | What it captures | Coverage |
|---|---|---|
| **Aegis Flight Recorder** (`aegis_request_trace` + `aegis_trace_replay()`) | Per-Aegis-call: prompt assembled, retrieval surfaces hit, tools fired, grounding outcome, response emitted | Operational prod 2026-05-27 PR #25/#26; **only `dashboard-ai-assistant` wired today** |
| **Aegis Decision Threshold Trace** (`aegis_decision_threshold_trace`) | Future C1/C2/C3 detector audit foundation; zero rows today | R1.0 schema deployed 2026-05-29; behavioral effect locked behind R1.1+ |
| **`cron_heartbeat`** | Per-function-execution: start, finish, status, duration, result_summary | Comprehensive across cron'd functions |
| **`signal_agent_analyses`** | Per-signal: agent decision metadata; tenant-scoped 2026-05-30 (task #60) | Comprehensive for signals processed via agent review tier |
| **`universal_learning_log`** | Per-feedback: what learning was attempted | 225 rows / 30d; comprehensive when feedback fires |
| **`self_improvement_log`** | Per-agent-prompt-evolution: which agent's prompt changed, when, why | 83 rows / 30d; Path B working |
| **`agent_tradecraft`** + `agent_tradecraft_quarantine` | Class A tradecraft + quarantine state | 15,418 legacy rows migrated; ongoing write coverage |
| **`incidents`** + `incident_signals` | Linkage between incidents and feeding signals | Comprehensive |
| **`investigations`** + `cop_timeline_events` (C.1) | Per-incident workflow: timeline events, recommendations | C.0-C.4 commitment data; adoption window active |
| **`feedback_events`** + `implicit_feedback_events` | Operator dismissal / confirmation events | 267 / 30d explicit + 136 / 30d implicit |
| **`generated_reports`** (Provenance-compliant) | Per-report: tenant, user, output | Reports persisted with tenant_id NOT NULL |
| **`monitoring_history`** | Per-scan execution metadata | Comprehensive for scheduled monitors |
| **`decision_layer_audit_alerts`** (C.1) | Per-drift event: tenant-drift on cop_timeline_events | Operational |
| **GitHub commit history + PR history** | Per-change provenance | Git is the canonical timeline |
| **Supabase Function Logs** (via MCP) | Per-invocation: method, status, duration, deployment_id | 24h rolling window via `get_logs` |
| **Cloudflare Pages deploy artifacts** | Per-frontend-deploy: bundle hash, route accessibility | Manual probe |
| **`docs/RELEASE_LEDGER.md`** | Operator-curated change log | Hand-maintained; partial coverage |
| **`docs/platform-operations/incidents/`** | Per-incident postmortem docs | INC-AEGIS-TRUST, INC-AEGIS-ACTION-INTEGRITY, INC-CRT-DOCUMENT-SCOPE, INC-CTX-CONTAM — already established pattern |

**Summary:** the data is captured. The integration plane and the tripwire-codification plane do not yet exist.

---

## §3 — Data requirements

### What a complete forensic chain must include

Per-incident, retrievable in one query:

1. **Incident anchor** — incidents row + linked signals + timestamps + tenant_id
2. **Feeding signals** — every signal that contributed via incident_signals OR via correlated_entity_ids OR via temporal proximity (e.g., signals in the tenant in ±24h around incident.opened_at)
3. **Aegis traces in window** — every aegis_request_trace row in the tenant during the incident lifespan
4. **Agent decisions** — every signal_agent_analyses row tied to the feeding signals
5. **Tools fired** — captured by Flight Recorder; what mutated, what surface read
6. **Operator actions** — feedback_events, implicit_feedback_events, investigation creations/updates, cop_timeline_events
7. **Decision-Frame fires** — aegis_decision_threshold_trace rows (when R1.1+ ships)
8. **Outcome state** — incident status transitions, recommendations executed, alerts dispatched

Plus a **near-miss anchor** for cases where an incident *should have* existed but didn't:

9. **Near-miss anchor** — operator-curated entry indicating *"this should have surfaced as a Decision Frame at time T but didn't"*
10. **Counterfactual chain** — what would have needed to be different to produce the correct outcome (specific signal, tripwire, retrieval surface, doctrine invariant)

### Coverage gaps in the current data

| Gap | Mitigation in MVP |
|---|---|
| Aegis Flight Recorder wired only to `dashboard-ai-assistant` | Phase 3.M.2 (below) extends wiring to `agent-chat`, `generate-poi-report`, `generate-fortress-report`. Not strictly MVP-blocking. |
| `aegis_decision_threshold_trace` empty (R1.1+ locked) | MVP does not depend on Decision Layer detector traces. R1.x integration is a long-horizon enhancement. |
| `agent_beliefs` 99.3% NULL ownership (Class B) | Forensic chain may surface ownerless rows. MVP labels them as "ownerless / pre-Provenance-Doctrine" rather than discarding. |
| `archival_documents` has no tenant_id (INC-CRT-DOCUMENT-SCOPE) | Forensic chain joins archival_documents via client_id IN scopedClientIds with explicit `[scope-known-imperfect]` annotation. |
| Operator actions outside Fortress (e.g., a phone call to the customer) | Out of scope; rely on operator-curated near-miss entries to capture human-side context. |

### Append-only discipline

All forensic surfaces must be append-only (mirrors `aegis_request_trace` + `aegis_decision_threshold_trace` + `decision_layer_audit_alerts`). No edits. No deletes (except cron retention purge — 30 days per Flight Recorder pattern). A post-mortem that can be rewritten is not a post-mortem.

---

## §4 — Architecture proposal

### High-level shape

```
Operator triggers "Open Forensic Timeline"
  ├── on an incident (incident_id provided)
  ├── on a near-miss (operator manually marks: "Decision Frame should have fired at T")
  └── on a customer complaint (free-text → AI extracts entity / time window)
       ↓
ForensicTimelineComposer (new edge function)
  ├── 1. Resolve scope: tenant_id, time window, incident_id (if any)
  ├── 2. Join all evidence tables per §3 data requirements
  │    (signals, incidents, traces, agent_analyses, feedback_events,
  │     tools_fired_via_FlightRecorder, decision-frames, outcomes)
  ├── 3. Reconstruct chronological chain — every event in window with
  │      type tag (signal-ingested, agent-decided, aegis-call,
  │      operator-action, tool-fire, outcome-state-change)
  ├── 4. Identify gaps — "between time A and time B, no Aegis trace
  │      / no agent decision / no operator action; was Fortress blind?"
  ├── 5. Emit forensic report + structured timeline JSON
  └── 6. Persist to forensic_timelines (append-only; tenant_id NOT NULL)
       ↓
Operator reviews timeline
  ├── Highlight missed signal: "this should have fired Decision Frame"
  ├── Codify tripwire: free-text → structured tripwire-spec
  └── Submit tripwire → tripwire_registry (gated by operator approval)
       ↓
Tripwire Registry
  ├── Tripwire-spec format: condition + action + scope + cadence + owner
  ├── Reviewed + activated → Watchdog input (Campaign 1 W.5 doctrine sweeps consume)
  └── Outcome tracked: "of the 50 tripwires armed, X fired correctly, Y false-positived,
       Z never fired"
```

### Surface-level pieces (operator-only)

- **Forensic Timeline view** — chronological event chain, expandable per-event
- **Gap Detector** — auto-flag intervals where Fortress "went quiet" on an active tenant
- **Tripwire Codification UI** — translate operator narrative into structured spec
- **Tripwire Registry table** — append-only; rows track activation, fire history, drift

### Permissions model

- **Read:** super_admin only (consistent with Aegis Flight Recorder)
- **Write to `forensic_timelines`:** service-role only (composer writes; operator never edits)
- **Write to `tripwire_registry`:** operator via UI; service-role for tracking activation history
- **Customer access:** None. Forensic surface is internal-only.

---

## §5 — MVP definition

### What ships in the MVP

1. **`forensic_timelines` table** (append-only, tenant_id NOT NULL + named CHECK backstop per Provenance Doctrine).
2. **`ForensicTimelineComposer` edge function** — accepts `{tenant_id, time_window, incident_id?}` and emits the chronological chain over the existing evidence tables.
3. **Single operator-only UI route** — `/forensic/<incident_id>` rendering the timeline.
4. **Manual tripwire-codification text field** — captures operator-curated description; persisted to `tripwire_registry` as draft. No automatic translation to Watchdog yet.
5. **One pilot incident** — regenerate the Trent Reznor report post-mortem with full forensic timeline + tripwire draft.

### What is NOT in the MVP

- Automatic gap detection (manual operator review for first cohort)
- Tripwire-spec → Watchdog auto-wiring (manual hand-off)
- Aegis Flight Recorder integration beyond `dashboard-ai-assistant`
- R1.1+ Decision Layer threshold-trace integration
- Customer-facing post-mortem renders
- Multi-tenant trend detection
- Recommendation grounding from forensic timelines

### Acceptance criteria for the MVP

| # | Criterion |
|---|---|
| MVP.1 | Pilot incident reconstructed: full Aegis trace chain, signal inputs, agent decisions, operator actions, outcome states — all in one screen, ≤10 seconds to render |
| MVP.2 | Provenance: every row in the forensic timeline carries its source table + row_id (no orphan claims) |
| MVP.3 | Tenant isolation: super_admin probe from outside CRT → forensic timeline for CRT incident → 403 forbidden |
| MVP.4 | Append-only verified: timeline row created during pilot cannot be edited or deleted via any API surface |
| MVP.5 | Tripwire draft persisted + visible in `tripwire_registry` table |
| MVP.6 | Operator approves the pilot reconstruction as "matches my forensic understanding of what happened" — qualitative human-validation step |

### Estimated MVP duration

3–5 weeks: 2 weeks composer + UI; 1 week tripwire-codification minimal UX; 1–2 weeks pilot validation.

### MVP gating

- Campaign 1 (Watchdog) W.0 + W.1 acceptance — establishes the observability substrate
- Operator BC Place / FIFA delivery window not active — MVP requires operator review cycles

---

## §6 — Relationship to Watchdog, Learning, and Executive Reports

### To Watchdog (Campaign 1)

**Bidirectional.** Post-Mortem produces tripwires; Watchdog activates them. Watchdog detects current failures; Post-Mortem reconstructs them retrospectively. Combined, they form a complete *detect → understand → prevent* loop.

- Watchdog W.4 (Aegis grounding tripwire) was conceived from observing INC-CTX-CONTAM in Post-Mortem-style retrospective; in the future, Post-Mortem would produce W.4 automatically.
- Watchdog W.5 (doctrine-compliance sweeps) consumes tripwire-specs from `tripwire_registry`.

### To Learning Systems (Path A status)

**Complementary, not overlapping.** Learning systems improve detection by accumulating statistical patterns from operator feedback. Post-Mortem improves detection by identifying *what was missed* — a different evidence type.

- Path A (broken; backlog) → statistical adaptation per-tenant
- Path B (working) → per-agent prompt evolution
- Post-Mortem → tripwire codification per-incident-class

Path A + Post-Mortem together produce: *system learns from both successful detections AND missed ones.*

### To Executive Reports (Campaign 2)

**Sequential, with shared substrate.** Both consume Flight Recorder + decision-threshold traces.

- Executive Reports = *forward-facing* decision artifact (60-second Decision Frame, what to act on now)
- Post-Mortem = *backward-facing* learning artifact (what happened, what should have happened differently)

Same evidence chain, different temporal framing. The 60-Second Brief format (Campaign 2 §5) is the *decision* layer; the Forensic Timeline is the *audit* layer.

### Bound by Commander's Intent

Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."* Each campaign addresses a different stage:

- **Watchdog** — shortens *Failure → Detection* (Campaign 1)
- **Executive Reports** — shortens *Signal → Decision* (Campaign 2)
- **Post-Mortem** — shortens *Future-Signal → Future-Detection* (Campaign 3, via tripwire codification)

Without Campaign 3, Campaigns 1 and 2 each plateau at the operator's manual-investigation capacity. Campaign 3 is the compounder — every incident processed permanently expands the system's automatic-detection surface.

---

## §7 — Implementation sequence (recommended)

| Phase | Scope | Gating prerequisite |
|---|---|---|
| **P.0** | Schema design: `forensic_timelines` (tenant_id NOT NULL + CHECK backstop + append-only) and `tripwire_registry` (operator-curated entries; activation-history tracking) — design ADR, NO migration | Operator GO on architecture proposal |
| **P.1** | MVP composer + UI — chronological chain over existing evidence tables; operator-only access | P.0 ADR ratified |
| **P.2** | Pilot incident — Trent Reznor methodology-injection (already cured per task #56); reconstruct + operator validation | P.1 deployed; pilot operator review cycle |
| **P.3** | Three-incident retrospective batch — INC-CTX-CONTAM, INC-LEARN-CONTAM, Path A learning loop break; each gets a forensic timeline + tripwire codification | P.2 validated |
| **P.4** | Tripwire-spec → Watchdog auto-wiring — translate `tripwire_registry` entries into Watchdog probes | Campaign 1 W.5 (doctrine sweeps) in progress |
| **P.5** | Flight Recorder wiring extension — `agent-chat`, `generate-poi-report`, `generate-fortress-report` add Flight Recorder traces | P.3 stable |
| **P.6** | Gap detector automation — Forensic Timeline auto-flags "silent intervals" where Fortress went quiet on an active tenant | P.4 stable |
| **P.7** | Decision-Threshold integration — when R1.1+ ships, post-mortem timelines include `aegis_decision_threshold_trace` rows | Decision Layer R1.x landed |
| **P.8** | Multi-incident trend detection — operator can ask "show me all near-misses of pattern X over the last 60 days" | P.5–P.7 stable |

**Total estimated duration:** 6–10 weeks for P.0–P.3 (MVP + first retrospective cohort); P.4+ longer-horizon.

---

## §8 — Success metrics

| Metric | Target |
|---|---|
| **Time to reconstruct an incident** (operator triggers → timeline rendered) | < 60 seconds for incidents in retention window |
| **Tripwire activation rate** — tripwires codified that successfully fire on future occurrences | ≥ 70% after 6 months |
| **Tripwire false-positive rate** | ≤ 10% |
| **Coverage of historical incidents** — fraction of prior named incidents with a forensic timeline | 100% of P0/P1 incidents within 90 days |
| **Customer-incident-to-tripwire latency** — customer-reports issue → tripwire armed | < 14 days |
| **Operator review acceptance rate** — fraction of forensic timelines operator confirms as "matches my understanding" | ≥ 90% |
| **Learning-loop integration** — fraction of tripwires that influenced a future detection success | ≥ 30% within first year |

---

## §9 — Risks + open questions

| Risk | Mitigation |
|---|---|
| Operator-curated near-miss anchors are subjective | Pair with structured criteria (e.g., "should-have-fired-Decision-Frame" must reference at least one signal that was admitted but didn't surface a Decision Frame); reviewed in pairs |
| Forensic timelines surface ownerless content (Class B gap) | Annotate `[scope-known-imperfect]` rather than discard; surface the audit gap rather than hide it |
| Tripwire registry becomes noisy | Operator-approval gate before activation; activation history tracks fire rate; auto-suspend tripwires with > 10% false-positive rate |
| Post-Mortem creates pressure to "blame" specific events | Doctrine: every timeline closes with *"what would a tripwire have caught?"* — not *"who/what failed?"* — structural reframing |
| Customer asks to see post-mortem on their incident | Operator-only by design; customer-facing transparency is a future-decision (Campaign 2 E.7) |
| Class B Provenance gap means forensic timeline cannot fully attribute ownerless agent_beliefs rows | Class B remediation (Campaign 2 E.3) is the structural fix; pre-remediation MVP labels rows honestly |

---

## §10 — Held

- No implementation
- No code, branch, migration, deploy
- No schema design beyond ADR draft (gated on operator GO)
- No customer-facing surface
- No automatic gap detection (MVP is manual operator review)
- No automatic tripwire → Watchdog wiring (MVP is manual hand-off)
- Pilot incident selection (Trent Reznor) is a recommendation; operator may pick a different pilot
- P.4+ phases are future-gated on prior campaign progress

🤖 Generated with [Claude Code](https://claude.com/claude-code)
