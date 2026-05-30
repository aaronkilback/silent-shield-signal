# ADR — Decision Layer R1: Threshold Detection (C1 ∧ C2 ∧ C3)

**Status:** PROPOSED 2026-05-29 — design-only ADR for operator ratification. **No code, no prompt changes, no behavioral changes are authorized by this document.** This is the implementation-design ADR for **R1 only** — the threshold-detection layer named in the ratified Decision Layer Doctrine (`decision-layer-doctrine-2026-05-29.md`, §10 + §12). R2–R6 remain held until R1 is ratified and observed.

**Locked principle when ratified:** Aegis emits a Decision Frame **only** when all three threshold conditions (C1 change, C2 principal-level stake, C3 live decision with future deadline) are independently and provenance-attached confirmed. Anything else falls back to the current FORTRESS_CORE_DIRECTIVE 5-step response format. **The threshold's job is to prevent intelligence theater, not to maximize frame firing.**

## Problem (formalized)

The ratified Decision Layer Doctrine names six elements of the Decision Frame and one threshold (C1 ∧ C2 ∧ C3) that gates whether the frame fires. The threshold is the load-bearing safety property: without it, the Decision Frame either becomes intelligence theater (fires on every query and pads routine outputs into decision shape) or remains dormant doctrine (never fires because no one defined when it should).

The two failure modes are asymmetric:

| Failure mode | Symptom | Why it's worse than the other |
|---|---|---|
| **Theater (over-fire)** | Every "hi" produces a Decision Frame; routine status checks get padded into option sets and deadlines; the principal stops reading because every response looks like a critical decision | **Erodes trust permanently.** Once the frame is the boy-who-cried-wolf, even genuine frames are skimmed and discounted. |
| **Dormancy (under-fire)** | The Decision Frame never fires because the detector is too conservative; doctrine is ratified but invisible in practice; ~33% Commander's Intent fulfillment persists | **Recoverable.** Operator can observe and lower the threshold. |

R1 therefore adopts a deliberate **conservative cold-start + audit-only** posture: better to underfire and observe than overfire and erode trust. This mirrors the N+1 retrieval cutover's "0-items-is-valid" doctrine — applied at the threshold layer instead of the retrieval layer.

R1's scope is narrow: produce, for each Aegis query/turn, a single `ThresholdResult{ c1, c2, c3, frame_fires, signals }` artifact with provenance for each axis. R1 does **not** change prompt assembly, output shape, or Aegis behavior. R2 will consume R1's output once R1's behavior is observed and tuned.

## Principle (PROPOSED)

The threshold detector evaluates three axes independently per Aegis query/turn:

| Axis | Definition (from ratified doctrine) |
|---|---|
| **C1 — Change is present** | A material delta against the principal's working model has occurred. Not just a signal; a delta that would justify reconsidering at least one prior commitment OR change which option in the prior option set the principal should prefer. |
| **C2 — Stake is principal-level** | The change implicates the principal's commitments, posture, exposure, or duty-of-care position. Tactical-only changes do not satisfy C2 even when they satisfy C1. |
| **C3 — A live decision exists** | At least one prior commitment is invalidated by the change AND that decision's deadline has not yet passed. |

`frame_fires` is `(C1 ∧ C2 ∧ C3)` — three booleans, ANDed. Each axis must be **independently confirmed with provenance**. Failure on any axis means no frame; the response falls back to the current FORTRESS_CORE_DIRECTIVE format.

**Default posture: NO frame.** If any axis cannot be confidently asserted with provenance, the axis evaluates `false` and the frame does not fire. Ambiguity is fail-closed, not fail-open. This is the anti-theater discipline at the principle level.

**Audit-only first.** R1's first deployed iteration logs `frame_fires` to Flight Recorder but does **not** trigger any output-shape change. The operator observes 7+ days of audit data, evaluates fire rate and per-query reasonableness, then ratifies promotion to behavioral effect (which is when R2 takes the output and changes prompt assembly).

## §1 — C1 detection (Change against principal's working model)

### What needs to be true

For C1 to evaluate `true`, the detector must find at least one **material delta** between (a) the principal's current **working model** and (b) the **new evidence** that has arrived since that working model was last grounded.

### Components

**(a) The working model** — what the principal currently believes / has committed to. The R1 working-model surface composes from existing tenant-scoped, certified-safe data:

| Surface | What it contributes to the working model | Source of truth |
|---|---|---|
| Prior chat turns (`ai_assistant_messages`, tenant + user-scoped, post-RLS fix 2026-05-25) | Stated beliefs, named priorities, ongoing investigations | Last N turns OR since-last-summary cutoff |
| Last daily briefing (`send-daily-briefing` output) | Last-known risk picture | Most recent briefing timestamp |
| Open incidents | Incidents the principal has been notified about + their last state | `incidents.status` + `incident_signals` |
| Active investigations | Hypotheses being tested | `investigations.status='active'` |
| Travel plans | Committed travel | `itineraries` (operational) + `personal_trips` (personal, RLS-scoped) |
| Recently generated reports | Last-published intelligence | `executive_intelligence_reports.created_at` |
| Confirmed actions | Action receipts the principal has implicitly endorsed | `autonomous_actions_log.status='succeeded'` |
| L1 tenant memory | (per the 3-Layer Memory ADR) | Tenant-scoped facts in `agent_chat_beliefs` / `conversation_memory` |
| Explicit prior commitments (potential new surface) | Named principal commitments with deadlines and underlying assumptions | New `principal_commitments` table (see §11 Q3) |

The working-model snapshot is **bounded** — open question Q4. Default bound proposed: since the most recent briefing or 30 days, whichever is shorter, to avoid stale-commitment false positives.

**(b) The new evidence** — what has arrived since the working model was last grounded:

| Surface | What it contributes as new evidence |
|---|---|
| New signals (`signals.created_at > working_model.last_grounded_at`) | Fresh OSINT / monitoring observations |
| Incident state changes | New incidents, escalations, status changes |
| Entity state changes (`active_monitoring_enabled` flips, severity ratings) | Tracked-entity status deltas |
| Threshold crossings | Cadence spikes, severity-bin shifts, geographic concentration changes |
| Tool result deltas (recent N tool calls) | Investigation findings since last conversation turn |

### Delta classes (from ratified doctrine §1)

| Class | Detection signal |
|---|---|
| **Status change** | Entity / signal / incident moves between states. (e.g., monitored entity escalates from `latent` → `active` per `entity_status`; incident state moves from `monitoring` → `confirmed`.) |
| **Trend change** | Quantitative shift in a tracked metric against baseline. (e.g., signal cadence on a monitoring keyword triples in 72h vs trailing-28d baseline; severity distribution shifts.) |
| **Frame change** | The meaning of an existing signal shifts due to new context. (e.g., a monitored entity's prior-routine signature re-classifies after a connected named-incident.) |

### Materiality test

A candidate delta is **material** only if it satisfies at least one of the two ratified doctrine conditions:

1. **The delta would justify reconsidering at least one prior commitment** (links a candidate delta to a specific named commitment in the working model — feeds C3).
2. **The delta would change which option in the prior option set the principal should prefer** (assumes the prior decision was option-set-articulated — requires R5 cross-turn state to be available; for R1 cold-start, this branch is dormant and only condition 1 is operative).

R1 cold-start materiality test: **commitment-linkage required.** A candidate delta only counts if the detector can name a specific prior commitment it invalidates. This is the strictest possible test — and the most theater-resistant.

### C1 output shape

```
C1Result {
  asserted: boolean,
  candidate_deltas: [
    {
      class: 'status' | 'trend' | 'frame',
      evidence_source: 'signals' | 'incidents' | 'entities' | …,
      evidence_row_ids: [uuid],
      delta_summary: string,
      invalidated_commitment_id: uuid | null,  // populated only if commitment-linkage found
      materiality_score: 0..1,
      grounding_state: 'grounded',
    }
  ],
  rejected_deltas: [ { …, rejection_reason: 'no_commitment_linkage' | 'below_materiality' | 'inside_baseline' } ],
}
```

C1 = `true` iff at least one entry in `candidate_deltas` has `invalidated_commitment_id != null` and `materiality_score >= MATERIALITY_THRESHOLD` (cold-start: 0.5; tunable per §7).

### Anti-theater for C1

- A "signal exists" is NEVER a delta. A signal that fits the existing pattern is not a change.
- A delta with no commitment linkage is rejected (`rejection_reason: 'no_commitment_linkage'`) — surfaced in Flight Recorder for operator review but does not fire C1.
- A delta that fails materiality (e.g., a single new signal that matches a known monitoring keyword without exceeding cadence baseline) is rejected.
- The working-model snapshot is bounded; very old commitments don't generate phantom invalidations.

### Open issues for C1

- Bounding the working-model snapshot (Q4)
- Bootstrapping the prior-commitments inventory (Q3)
- Baseline computation for trend deltas (rolling N-day vs absolute thresholds — Q5)

## §2 — C2 detection (Principal-level stake)

### What needs to be true

For C2 to evaluate `true`, the candidate delta from C1 must implicate the principal's commitments, posture, exposure, or duty-of-care position — **not** a tactical change that supporting stakeholders handle within delegated authority.

This is the *whether the principal should be the decision owner* test, not the *whether the change matters at all* test. A change can matter (and have a real decision frame) without rising to principal level — that frame routes to the supporting stakeholder, which is R6's job. R1 only detects principal-level stakes; sub-principal stakes evaluate `C2 = false` and the frame does not fire from R1.

### Stake classification signals

**Principal-level indicators (any one is sufficient):**

| Indicator | Detection mechanism |
|---|---|
| Personal exposure | Change implicates principal's calendar, location, public visibility, family, residence. Match against `entities` with `role IN ('principal', 'family', 'vip')` and the tenant's executive/VIP entity list. |
| Strategic commitment | Change implicates a publicly-announced position, board-approved posture, regulated disclosure obligation, or contractual commitment. Match against `principal_commitments.scope='strategic'` (proposed surface). |
| Duty-of-care surface | Change implicates the principal's legal/fiduciary duties (employee safety, shareholder communications, regulatory obligation). Match against `principal_commitments.legal_implications=true`. |
| Crisis severity | Incident has escalated to P1 or P2 with the principal in the loop. Match `incidents.priority IN ('P1','P2')` AND incident is principal-linked. |
| Authority boundary | The decision is above the in-house security lead's delegated authority. Match against an **authority map** (proposed config — see Q1). |

**Below-principal-level indicators (any one is sufficient to evaluate C2 = false):**

| Indicator | Detection mechanism |
|---|---|
| Within-playbook adjustment | The change has a known tactical response in the active playbook. Match against `playbook_responses` (existing). |
| Below severity floor | Signal/incident sits at P3/P4 or below the configured floor. Match `signals.severity` / `incidents.priority`. |
| Inside delegated authority | The change-and-response fits a routine pattern explicitly delegated to a non-principal role. Match against authority map (Q1). |
| Routine-pattern signature | The change matches a recurring monitoring pattern with established handling. Match against historical handling cadence. |

### C2 output shape

```
C2Result {
  asserted: boolean,
  matched_indicator: 'personal_exposure' | 'strategic_commitment' | 'duty_of_care' | 'crisis_severity' | 'authority_boundary' | null,
  matched_evidence: { source: string, row_ids: [uuid] },
  rejected_reason: 'within_playbook' | 'below_severity_floor' | 'inside_delegated_authority' | 'routine_pattern' | null,
  grounding_state: 'grounded',
}
```

C2 = `true` iff `matched_indicator != null` AND `rejected_reason == null` (a below-principal-level match short-circuits, regardless of any above-principal-level match — fail-closed).

### Anti-theater for C2

- A high-severity signal is not automatically principal-level. Severity feeds C2 but is not sufficient — must also satisfy the principal-linkage / commitment-linkage test.
- An entity being in the monitoring system is not automatically principal-level — the entity must be principal-class (configured `role`).
- C2 NEVER fires from a query about *another* tenant's exposure (per Tenant Isolation preservation contract).
- C2 defaults to `false` if no indicator is confidently matched.

### Open issues for C2

- The **authority map** surface (Q1) — needs operator-configured mapping of "this kind of decision belongs to which role." For R1 cold-start, a minimal hard-coded map is acceptable (e.g., "personal exposure → principal," "P3/P4 → tactical") with the full authority-map ADR following.
- Bootstrapping for new tenants without an authority map configured (Q6).

## §3 — C3 detection (Live decision with future deadline)

### What needs to be true

For C3 to evaluate `true`, the detector must find:

- **C3a** — At least one *invalidated commitment* (already produced by C1's `invalidated_commitment_id`), AND
- **C3b** — That commitment's effective **decision deadline** is in the future (not yet passed).

C3 is therefore a thin extension of C1's output, plus a deadline check.

### Decision-deadline derivation

For each invalidated commitment, the deadline is derived from the commitment's nature:

| Commitment shape | Deadline derivation |
|---|---|
| Scheduled event the principal will attend | Event date minus announcement-window (default 4 weeks before, configurable per commitment) |
| Scheduled public statement / press release / messaging | Statement publication date minus prep window (default 48–72h) |
| Strategic posture commitment (e.g., "we always attend AGMs in person") | The next instance trigger (next scheduled AGM) |
| Open commitment in `autonomous_actions_log` | The action's stated due date |
| Investigation hypothesis being tested | The investigation's stated review date / SLA |
| Travel plan | Departure date minus go/no-go window (default 1 week) |
| Regulated disclosure | The regulatory deadline (hard) |

If a commitment has no derivable deadline, C3b evaluates `false` for that commitment (the change may matter, but no time-bounded decision exists; that's a long-tail strategic question, not R1's threshold).

### Past-deadline handling

If the only invalidated commitments have past deadlines, the change is **retrospective** — it points to a stale decision that the principal could not now reopen. Retrospective frames are out of R1's scope; they may be valuable for post-mortem learning but C3 = `false` for them, and the response falls back to the current format.

### C3 output shape

```
C3Result {
  asserted: boolean,
  live_decisions: [
    {
      commitment_id: uuid,
      commitment_summary: string,
      derived_deadline: timestamptz,
      time_to_deadline: interval,
      deadline_basis: 'event_date_minus_announcement' | 'publication_minus_prep' | …,
    }
  ],
  past_deadline_decisions: [ { commitment_id: uuid, expired_at: timestamptz } ],
  grounding_state: 'grounded',
}
```

C3 = `true` iff `live_decisions.length >= 1`.

### Anti-theater for C3

- A commitment is only "invalidated" if C1's commitment-linkage test passed. C3 does not generate new invalidations independently.
- Hypothetical "what if I had committed to X" queries never satisfy C3 — the commitment must be a specific named one with provenance.
- A change that points to a stale commitment whose deadline has passed is retrospective, not a live decision; C3 = false (frame does not fire; retrospective handling is out of R1 scope).
- "Strategic posture" commitments (no instance trigger date) evaluate C3 = false unless an explicit instance trigger date exists.

### Open issues for C3

- Where do prior commitments live? (Q3 — `principal_commitments` table proposal.)
- Default deadline-derivation windows (announcement window, prep window) — operator-configurable per commitment-class or globally? (Q5.)
- For long-running investigations: when does an investigation hypothesis "expire" as a commitment? (Q7.)

## §4 — Combination (the threshold aggregator)

### Logic

```
ThresholdResult {
  frame_fires: boolean,        // (C1.asserted && C2.asserted && C3.asserted)
  c1: C1Result,
  c2: C2Result,
  c3: C3Result,
  short_circuit_axis: 'c1' | 'c2' | 'c3' | null,  // first axis to evaluate false (for diagnosis)
  evaluation_order: ['c1', 'c2', 'c3'],
  evaluated_at: timestamptz,
  tenant_id: uuid,
  debug_trace_id: uuid,
}
```

The detector evaluates axes **in order** (C1 → C2 → C3) and **short-circuits** on the first `false`. This is:

- Cheaper (no need to run C2/C3 if C1 already failed).
- Diagnostically clean (the `short_circuit_axis` field tells the operator exactly where evaluation stopped).
- Preserves the asymmetry of evidence requirements (C3 is the strictest, C1 is the broadest — you can't prove C3 without C1's invalidation set).

### Where the detector runs

R1's detector runs **per Aegis query/turn**, in the `dashboard-ai-assistant` request handler (and any other Aegis surface that becomes wired in later — wired-in scope is gated on operator ratification per surface).

It runs **after** the existing tenant + auth resolution (so `userTenantId` / `authenticatedUserId` are known) and **before** the prompt assembly. R1 itself does not modify prompt assembly — but R2 will read R1's output at this seam.

### What happens to `frame_fires=true` in R1 cold-start

**Audit-only.** R1 logs the `ThresholdResult` to Flight Recorder. It does **not** change prompt assembly, response shape, or any user-visible behavior. The operator observes 7+ days of fire-rate and per-query reasonableness, then ratifies promotion to behavioral effect.

This mirrors the user's "audit-before-blocking CI guards" memory-stated preference.

## §5 — Anti-theater discipline (load-bearing)

The operator's stated load-bearing constraint: "ensure the Decision Frame fires only when appropriate and does not become intelligence theater."

R1's anti-theater discipline is structurally encoded in seven points:

| # | Discipline | Where enforced |
|---|---|---|
| 1 | **Default to NO frame.** All three axes evaluate `false` by default; each requires positive, provenance-attached evidence to flip to `true`. | §1, §2, §3 axis definitions |
| 2 | **Commitment-linkage required for C1.** A delta without a named invalidated commitment is rejected, even if quantitatively significant. | §1 materiality test |
| 3 | **Fail-closed on ambiguity.** If an axis cannot be confidently asserted (e.g., ambiguous severity, unclear commitment match), it evaluates `false`. | All three axes |
| 4 | **Short-circuit on first failure.** The detector stops at the first `false` axis — no compensatory inflation of remaining axes. | §4 evaluation order |
| 5 | **Audit-only first deployment.** No behavioral effect until operator observes the fire pattern. | §7 cold-start posture |
| 6 | **Flight Recorder both fires AND non-fires.** Empty-result traces are the load-bearing data for measuring false-negative rate. (Same pattern as N+1 retrieval.) | §6 |
| 7 | **Conservative cold-start thresholds.** Materiality threshold, deadline-window defaults, severity floor — all start conservative; tuning follows 7-day Flight Recorder observation. | §7 |

These seven points are NOT separately tunable knobs. They are the structural contract — anti-theater is a property of the system, not a parameter.

## §6 — Observability (Flight Recorder)

### New surface (proposed): `aegis_decision_threshold_trace`

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Surrogate key |
| `tenant_id` | uuid | Inherits from the Aegis request |
| `debug_trace_id` | uuid | Threads to existing Flight Recorder traces |
| `evaluated_at` | timestamptz | When the detector ran |
| `frame_fires` | boolean | Final aggregator result |
| `short_circuit_axis` | text | `'c1' | 'c2' | 'c3' | null` |
| `c1_asserted` | boolean | |
| `c1_candidate_deltas` | jsonb | The candidate_deltas + rejected_deltas arrays |
| `c1_materiality_threshold` | real | The threshold used at evaluation time (for tuning audits) |
| `c2_asserted` | boolean | |
| `c2_matched_indicator` | text | |
| `c2_rejected_reason` | text | |
| `c2_evidence` | jsonb | |
| `c3_asserted` | boolean | |
| `c3_live_decisions` | jsonb | |
| `c3_past_deadline_decisions` | jsonb | |
| `evaluator_version` | text | R1 build identifier (for A/B tuning audits) |
| `user_query_summary` | text | Short truncation of the user query, for human review |
| `audit_only` | boolean | `true` during R1 cold-start; `false` after operator promotion to R2 |

### What gets traced

Every R1 evaluation, whether `frame_fires=true` or `false`. The empty/false-firing traces are the **load-bearing** data for:

- Fire rate over time
- False-positive review (frame fired on a query the operator agrees did not deserve one)
- False-negative review (frame did not fire on a query the operator agrees should have)
- Per-axis fail rate (which axis short-circuits most often — informs tuning)
- Per-tenant fire-rate variance (sanity check that the detector behaves similarly across tenants)

### Tenant isolation

`aegis_decision_threshold_trace` is tenant-scoped via `tenant_id NOT NULL` per the Provenance Doctrine. RLS forces tenant scope on read; service-role writes go through the same provenance-assertion seam as other audited surfaces.

## §7 — Cold-start calibration + 7-day review

### Cold-start posture

| Knob | Cold-start value | Rationale |
|---|---|---|
| C1 materiality threshold | 0.5 | Conservative — easier to lower if observed under-fire |
| Severity floor for C2 (crisis-severity branch) | `P1` only | The strictest reading — only critical-priority crises auto-satisfy C2 via severity |
| Default announcement window (deadline derivation) | 4 weeks | Matches the exec-protection doctrine example |
| Default prep window (statements/press) | 48–72h | Industry default |
| Default travel go/no-go window | 1 week | Industry default |
| Working-model snapshot bound | min(last_briefing, 30 days) | Avoids stale-commitment false positives |
| Audit-only flag | `true` | No behavioral effect until promoted |
| Detector version tag | `r1.cold-start.2026-05-29` | Pins observed behavior for the 7-day review |

These values are deliberately conservative. The expectation is that the cold-start fires LESS than the eventual tuned threshold — and the operator observes which queries *should have* fired, lowering thresholds as the data accumulates.

### 7-day review protocol

After R1 ships in audit-only mode, a 7-day Flight Recorder accumulation period precedes any tuning:

| Metric | Question it answers | Tuning rule |
|---|---|---|
| Fire rate (`frame_fires=true` / total evaluations) | Is the detector live without being noisy? | If <5% over 7 days, investigate under-fire; if >40%, investigate over-fire |
| Short-circuit distribution (which axis blocks most often) | Is one axis disproportionately conservative? | Identifies tuning targets |
| Per-tenant fire-rate variance | Does the detector behave consistently across tenants? | Variance >2× median → investigate tenant-specific anomaly |
| Operator false-positive rate | Of frames that fired, how many were theater? | If >20%, raise threshold OR strengthen anti-theater rules |
| Operator false-negative rate | Of queries that should have fired, how many didn't? | If >20%, lower threshold OR widen detection rules |
| Per-axis evidence-quality audit | Are the cited `evidence_row_ids` actually grounded? | Spot-check; any ungrounded firing is a P0 contamination incident |

### Promotion criteria (R1 → R2)

R1 graduates from audit-only to behavioral effect (i.e., R2 reads its output) **only** when:

1. 7+ days of audit data accumulated.
2. False-positive rate ≤ 20% (operator review).
3. False-negative rate ≤ 20% (operator review).
4. Zero ungrounded firings.
5. Per-tenant variance within normal bounds.
6. Operator GO.

This is the same gated, observation-first deployment posture as the N+1 retrieval cutover (Class A), applied at a different layer.

## §8 — Failure modes

| Failure mode | Mechanism | Mitigation |
|---|---|---|
| **Detector over-fires (theater)** | C1/C2/C3 thresholds too loose; or false commitment matches | §5 anti-theater discipline + §7 cold-start conservative defaults + audit-only first deployment |
| **Detector under-fires (dormancy)** | Conservative defaults plus missing prior-commitments inventory leaves nothing to invalidate | §7 7-day review with false-negative tuning rule |
| **Cross-tenant evidence leak** | Detector pulls evidence from another tenant's surface | All evidence-source queries are tenant-scoped at the query level (Tenant Isolation contract) |
| **Ungrounded firing** | Detector asserts an axis without provenance | Every axis evaluation must populate `evidence_row_ids` or evaluate `false` (Provenance contract) |
| **Stale commitment generates phantom invalidation** | Working-model snapshot includes an obsolete commitment that the principal has already reversed | Snapshot is bounded (min(last_briefing, 30 days)); commitments are marked `superseded` when re-decided (future R5 surface) |
| **Detector becomes the decision-maker** | Detector ranks options or eliminates them based on its own scoring | R1 does NOT score options — that's R2's territory. R1 only outputs `frame_fires` boolean. |
| **Detector latency dominates the request** | Computing C1/C2/C3 takes longer than the user expects | Detector runs in parallel with COP / tenant context loading; budget cap (e.g., 200ms) with fail-closed-to-false-fires on timeout |
| **Promotion before observation** | Operator promotes R1 → R2 without 7-day review | Gated on operator GO with the 6 promotion criteria in §7 |
| **Audit-only flag accidentally inverted** | A code change flips audit-only off without promotion | R1's `audit_only` is set in a flagged config surface that requires operator change-control; promotion is a deliberate operator action, not an inferred state |

## §9 — Non-goals (explicit)

R1 explicitly does NOT:

| Non-goal | Why |
|---|---|
| Modify any prompt | R2's territory. R1 emits a boolean + provenance; the prompt is unchanged. |
| Modify any Aegis output text | R2's territory. |
| Change tool selection / dispatch | Out of scope. |
| Score, rank, or eliminate options in any decision | R1 has no option-set awareness. That's R2. |
| Make any decision on the principal's behalf | The Decision Layer Doctrine forbids this at every layer; R1 inherits the prohibition. |
| Generate the option set | R2's territory. |
| Generate decision-conditional action sets | R2/R6 territory. |
| Define the prior-commitments inventory schema | Acknowledged as needed (Q3) but is its own ADR; R1 designs against the *interface* of the commitments inventory, not its schema. |
| Define the authority map schema | Same — Q1 + future authority-map ADR. |
| Implement cross-turn state | R5's territory. |
| Implement the UI for showing Decision Frames | R4's territory. |
| Route below-principal-level changes to supporting stakeholders | R6's territory. |
| Define the refusal posture for ungrounded-evidence cases | Q7 in the Decision Layer Doctrine; out of R1 scope. |
| Replace, change, or subsume any existing doctrine | All preservation contracts in §10 are additive. |
| Commit to an implementation timeline | This ADR is design-only; implementation is gated on ratification. |

## §10 — Preservation contracts (every ratified doctrine, restated for R1)

R1 must preserve every ratified Fortress doctrine. Each preservation contract is named explicitly:

| Doctrine | R1-specific preservation contract |
|---|---|
| **Tenant isolation** | All evidence-source queries in §1/§2/§3 are tenant-scoped at the SQL level via `tenant_id = $1` (not RLS-only — per the [[feedback-tenant-isolation-checklist]] discipline). The detector NEVER pulls evidence from a surface that lacks tenant scope. Cross-tenant evidence is structurally unreachable from R1. |
| **Provenance Doctrine** | Every axis evaluation populates `evidence_row_ids` for the rows it cites. No bare ownerless evidence. The `aegis_decision_threshold_trace` row itself carries `tenant_id NOT NULL`. |
| **Anti-Fabrication Doctrine** | An axis cannot evaluate `true` from parametric / world-knowledge reasoning. Each `true` requires named, grounded evidence from a certified tenant surface. |
| **Grounding-State Doctrine** | C1/C2/C3 axes each emit `grounding_state: 'grounded'` and the cited row ids. An axis cannot fire on an ungrounded inference. This is the load-bearing rule for preventing the Class B (parametric) contamination class from re-emerging at the Decision Layer. |
| **Tradecraft separation** | Tradecraft retrieval (Class A) does NOT participate in R1's threshold detection. Tradecraft is methodology, not evidence — and R1 is an evidence-only detector. (Tradecraft enters via R2, where it informs option-set generation, not threshold evaluation.) |
| **Recommendation → Approval → Execution separation** | R1 produces a detection artifact. It does not produce a recommendation, request approval, or execute anything. Naming the threshold is NOT taking the decision. |
| **Flight Recorder observability** | R1's primary externalized surface IS Flight Recorder (`aegis_decision_threshold_trace`). Every detector run is observable; audit-only deployment posture makes the layer's behavior visible before any user-facing effect. |
| **Aegis Authority Modes (tenant vs Ops)** | R1 is a tenant-mode-only detector. Operator-mode (Aegis Ops) decisions are out of scope — Aegis Ops has its own decision surface (`aegis-ops-control-plane.md`). The two surfaces are physically partitioned. |
| **Commander's Intent** | R1 implements the threshold layer named in the Decision Layer Doctrine. It does not deviate from "Preserve decision space by shortening Signal → Decision → Action" — it operationalizes the gating function that determines when the Decision phase becomes visible. |

## §11 — Open questions for R1 ratification

These are scoped questions that should be resolved before R1 implementation begins. They are not blockers to ratifying the threshold-detection principles; they are the scoped follow-on artifacts.

| # | Open question |
|---|---|
| **Q1** | **Authority map.** Who decides which decisions belong to the principal vs supporting roles? For R1 cold-start, a minimal hard-coded mapping is acceptable ("personal exposure → principal," "P3/P4 → tactical"). But the full authority-map ADR — operator-configurable per role, per change-class — is a separate artifact. Does R1 ship with the minimal map, or wait for the authority-map ADR? |
| **Q2** | **Detector runtime location.** Does R1 live in-process inside `dashboard-ai-assistant`, as a separate edge function (`aegis-decision-threshold`), or as a Postgres RPC? In-process is simplest; separate function is testable; RPC is reusable across surfaces. **Recommendation: in-process for R1 cold-start, with a clear refactor path to separate function if R2/R3 need reuse.** |
| **Q3** | **`principal_commitments` table.** R1 needs a structured commitments inventory. Should this be a new table, OR derived dynamically from existing surfaces (incidents, itineraries, briefings, conversation memory) at each evaluation? **Recommendation: derived for R1 cold-start (no new schema); separate ADR for explicit `principal_commitments` table follows R2.** |
| **Q4** | **Working-model snapshot bound.** Default: `min(last_briefing, 30 days)`. Should this be globally configured, per-tenant, or per-evaluation dynamic? |
| **Q5** | **Baseline computation for trend deltas.** Rolling N-day mean vs absolute threshold vs z-score against per-keyword baseline? **Recommendation: rolling 28-day median for cadence, z-score ≥ 2 for severity bins; pinned at evaluator-version-tag for tuning audits.** |
| **Q6** | **First-query / cold-tenant handling.** A brand-new tenant with no working model and no commitments inventory. R1 default: `frame_fires=false` (no possible invalidation). Is that correct, or should there be a different bootstrap path? **Recommendation: default no-fire is correct — cold tenants get the current format until their working model is populated.** |
| **Q7** | **Investigation-hypothesis commitment expiry.** A long-running investigation's working hypothesis is a commitment. When does it expire as a "live" commitment for C3 purposes? Tied to `investigations.next_review_at`? To explicit operator close? |
| **Q8** | **Detector budget / latency.** Hard cap on the detector's runtime (e.g., 200ms). On timeout, fail-closed to `frame_fires=false`. Acceptable? |
| **Q9** | **Audit-only flag mechanism.** Should `audit_only` be a row-level field, a global flag, a feature flag (per-tenant), or all three? Recommendation: per-tenant feature flag for graceful rollout, with a global kill switch for emergency revert. |
| **Q10** | **What surfaces beyond `dashboard-ai-assistant` are in R1 scope?** Daily briefings? `aegis-chat` (mobile)? Briefing-room sessions? **Recommendation: R1 cold-start ships only in `dashboard-ai-assistant`; expansion to other surfaces is a separate operator-gated decision per surface.** |

## §12 — Post-ratification implementation sketch (non-commitment)

If and only if this R1 ADR is ratified, implementation work would follow this phased sequence. **Nothing in this section is authorized by this ADR.** This is included so the operator can see the implementation surface before deciding whether to ratify.

| Phase | Scope | Gate |
|---|---|---|
| **R1.0 — `aegis_decision_threshold_trace` schema** | Add the audit-only Flight Recorder surface (table + RLS + provenance assertion). Tenant-scoped, no behavioral effect. | Ratification + Q9 resolved. |
| **R1.1 — C1 detector (commitment-linkage + materiality)** | In-process detector for §1 with derived commitments (Q3 derived path) + the materiality threshold. Audit-only. | R1.0 green + Q3/Q4/Q5 resolved. |
| **R1.2 — C2 detector (stake classifier)** | Minimal hard-coded authority map (Q1 minimal path) + stake-indicator classifier. Audit-only. | R1.1 green + Q1 resolved (minimal). |
| **R1.3 — C3 detector (deadline derivation + live-decision identification)** | Deadline-derivation per commitment-class. Audit-only. | R1.2 green + Q7 resolved. |
| **R1.4 — Aggregator + Flight Recorder integration** | Combine C1∧C2∧C3, write to `aegis_decision_threshold_trace`, surface the result on the existing Aegis request handler. Still audit-only. | R1.3 green + Q8 resolved. |
| **R1.5 — 7-day audit observation** | No code changes. Operator reviews Flight Recorder weekly per §7 review protocol. | R1.4 green; 7+ days elapsed. |
| **R1.6 — Tuning iteration** | Adjust thresholds per §7 false-positive / false-negative rules. Repeat audit period as needed. | R1.5 evidence shows tuning is required. |
| **R1.7 — Promotion gate to R2** | Operator GO. R1's `audit_only` flag flips per Q9 mechanism. R2 takes R1's output and changes prompt assembly. | All §7 promotion criteria met + operator GO. |

R1.0–R1.4 are the detector itself. R1.5–R1.6 are pure observation/tuning. R1.7 is the handoff to R2 (which is its own ratification gate — a separate ADR will design R2's prompt-assembly consumption of R1's output).

**No phase beyond R1.7 is authorized by this ADR.** R2 has its own design ADR (forthcoming, gated on operator GO after R1.7).

## Success criterion

R1 is successful when:

1. Every Aegis query/turn produces a `ThresholdResult` with provenance.
2. The fire rate, after 7 days of observation, sits in a defensible band (target ~5–25% — but the target is a calibration outcome, not a design fiat).
3. False-positive rate (frames that fired but shouldn't have) ≤ 20%.
4. False-negative rate (queries that should have fired but didn't) ≤ 20%.
5. Zero ungrounded axis firings.
6. Per-tenant fire-rate variance is within expected bounds (no tenant-specific anomalies).
7. The detector runs within budget (≤ 200ms typical) without blocking the response.
8. Operator confirms the detector "behaves like the Intelligence Officer Test §7 anticipates" — i.e., the queries that should produce Decision Frames do, and routine queries do not.

When all eight hold, R1 graduates from audit-only to behavioral input for R2.

## Held

- P5 / P6 / Class B / PR #36 — all explicitly held per standing operator directive.
- R2 / R3 / R4 / R5 / R6 — all held until R1 ratifies and observes per §7.
- This ADR does not unblock or modify any of the above.

## Changelog

- **2026-05-29 v1** — initial R1 design ADR. Defines the C1/C2/C3 detection model, the aggregator, the anti-theater discipline, the Flight Recorder observability surface, the cold-start posture, the 7-day review protocol, the 10 open questions, and the 8-phase post-ratification implementation sketch.
