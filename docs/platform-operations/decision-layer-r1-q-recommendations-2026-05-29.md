# Decision Layer R1 — Q1–Q10 Recommendations + Audit Watchlist

**Status:** PROPOSED 2026-05-29 — pre-implementation planning artifact. Companion to `architecture-decisions/decision-layer-r1-threshold-detection-2026-05-29.md` (ratified in principle 2026-05-29). **No code, no implementation, no schema changes are authorized by this document.** This artifact is the resolved-questions-and-tracked-observations basis that R1.0 implementation will be authorized against, once the operator ratifies the recommendations.

The R1 ADR itself is **not modified** by this document per operator directive ("Do not change the ADR"). Resolutions and watchlist items captured here are durable companion notes that R1.0 implementation will consult.

## How this document is structured

| Part | Purpose |
|---|---|
| **§A** | Q1–Q10 recommendations, one section per question, each with: question · options considered · recommendation · rationale · risks · evidence rule that would force re-evaluation |
| **§B** | Audit watchlist — explicit classes of behavior to track during R1's audit-only period. **§B.1 holds the operator-flagged false-negative class** (significant-signal-without-explicit-commitment-to-invalidate). |
| **§C** | Resolution matrix — one-line resolved-state for each Q + watchlist item, for fast operator scan |
| **§D** | Pre-R1.0 authorization checklist — what the operator confirms before R1.0 is authorized |

## §A — Q1–Q10 recommendations

Each recommendation is annotated with the **evidence rule** that would force re-evaluation. The intent is that R1's audit data answers the open question empirically — recommendations here are starting points, not lock-ins.

### Q1 — Authority map

**Question.** Who decides which decisions belong to the principal vs supporting roles? For R1 cold-start: a minimal hard-coded mapping is acceptable. But the full operator-configurable authority map is its own ADR.

**Options considered.**
- (A) Minimal hard-coded mapping for R1 cold-start
- (B) Wait for the full authority-map ADR (operator-configurable per role, per change-class)
- (C) Inferred from chat history / org-chart heuristics

**Recommendation: (A) — minimal hard-coded mapping for R1 cold-start.**

The minimal map is short and defensible:

| Indicator class | Maps to |
|---|---|
| Personal exposure (principal/family/VIP entity match) | Principal-level |
| Strategic / publicly-announced commitment | Principal-level |
| Duty-of-care surface (legal disclosure, fiduciary) | Principal-level |
| P1 incident, principal-linked | Principal-level |
| P2 incident, principal-linked | Principal-level |
| P3 / P4 incident | Tactical (below-principal) |
| Routine monitor signal within trailing-28d baseline | Tactical |
| Within active playbook response | Tactical |

**Rationale.** R1 is audit-only first. The minimal map is a starting point that gets the detector running; operator observation of `c2_matched_indicator` and `c2_rejected_reason` patterns in Flight Recorder is the empirical input that designs the full authority-map ADR. Designing the full authority map before observation is speculative and likely to be wrong in ways that only data reveals.

**Risks.**
- Minimal map mis-classifies categories the operator notices. *Mitigation:* Flight Recorder records the matched_indicator + rejected_reason per evaluation; operator review surfaces mis-classifications by pattern.
- Operator wants per-role authority granularity earlier than the minimal map supports. *Mitigation:* the minimal map can be extended row-by-row in a follow-on PR without breaking the audit contract.

**Re-evaluation trigger.** If >15% of frames-that-should-have-fired-but-didn't trace to "C2 false because minimal map didn't match a real principal-level indicator," upgrade Q1 to the full authority-map ADR before R1.7 promotion.

---

### Q2 — Detector runtime location

**Question.** In-process inside `dashboard-ai-assistant`, separate edge function (`aegis-decision-threshold`), or Postgres RPC?

**Options considered.**
- (A) In-process
- (B) Separate edge function
- (C) Postgres RPC

**Recommendation: (A) — in-process for R1 cold-start, with a refactor path to a shared `_shared/decision-threshold.ts` library if multiple surfaces need it later (R3+).**

**Rationale.** R1 is read-only — it consults tenant-scoped tables and emits a JSONB artifact. In-process is the simplest deployment with no cross-function latency, no per-call auth plumbing, no deployment-ordering risk. Co-locating with the existing tenant + auth resolution in `dashboard-ai-assistant` means R1 runs in the same scope as the COP / tradecraft retrieval blocks — same provenance regime, same Flight Recorder threading.

Refactor path: If R1.7 promotes and R3 (Flight Recorder surface) or other Aegis surfaces (Q10) need to consume the same detector, extract to `_shared/decision-threshold.ts` first. Only escalate to a separate edge function if multiple non-shared surfaces need it (and that's a separate operator-gated decision).

**Risks.**
- In-process adds to the dash-ai handler size. *Mitigation:* the detector is small (200–400 lines estimated) and read-only; no behavior risk.
- Refactor cost later if multiple surfaces consume it. *Mitigation:* refactor-to-`_shared/` is cheap (no API change); refactor to separate function is the operator-gated step.

**Re-evaluation trigger.** If R1.7 promotes and ≥2 surfaces beyond dash-ai need the detector (per Q10 expansion), refactor to `_shared/` library before adding the second surface.

---

### Q3 — `principal_commitments` table vs dynamic derivation

**Question.** R1 needs a structured commitments inventory. New table or derive dynamically?

**Options considered.**
- (A) New `principal_commitments` table with explicit schema
- (B) Dynamic derivation from existing surfaces (incidents, itineraries, briefings, conversation memory, action receipts) at each evaluation

**Recommendation: (B) — dynamic derivation for R1 cold-start. Defer dedicated table to a follow-on ADR after observation.**

**Rationale.** We don't yet know what commitments actually look like in tenant data — what classes exist, what deadlines, what underlying assumptions. Designing a schema speculatively will produce a wrong schema. Existing surfaces already contain commitment-shaped rows:

| Existing surface | Commitment derivation |
|---|---|
| `itineraries`, `personal_trips` | Travel commitments — deadline = departure date minus go/no-go window |
| `incidents` (open) | Response posture commitments — deadline = incident SLA or `next_escalation_at` |
| `investigations` (active) | Hypothesis-testing commitments — deadline = `next_review_at` per Q7 |
| `executive_intelligence_reports` (recent) | Published intelligence position — deadline = next report cycle (typically known) |
| `autonomous_actions_log` (status='pending' or 'in_progress') | Action commitments — deadline = action's `due_at` |
| `send-daily-briefing` outputs (last 7 days) | Working-picture commitments — implicit, expire on next briefing |
| `ai_assistant_messages` (last N turns or since-last-summary) | Stated preferences / commitments in conversation — deadline derivation is per-mention |

R1.1's C1 detector derives the commitments inventory from these surfaces at evaluation time. Observation tells us which derived commitments are useful, which produce noise, and what's structurally missing.

**Risks.**
- Derivation is noisy or incomplete (the operator-flagged false-negative class). *Mitigation:* §B.1 audit watchlist tracks this class explicitly.
- Re-derivation on every evaluation has cost. *Mitigation:* the surfaces are indexed; cap with the working-model snapshot bound (Q4) so the query scope is small.

**Re-evaluation trigger.** If §B.1 watchlist shows ≥10 distinct false-negative cases over the 7-day audit period that trace to "no commitment derived but a real commitment existed," design and ship the dedicated `principal_commitments` table before R1.7 promotion.

---

### Q4 — Working-model snapshot bound

**Question.** How far back does the working model reach? Recommended default: `min(last_briefing, 30 days)`.

**Options considered.**
- (A) `min(last_briefing, 30 days)`
- (B) Per-tenant configurable
- (C) Per-evaluation dynamic (e.g., adaptive based on activity level)

**Recommendation: (A) — `min(last_briefing, 30 days)` globally for R1 cold-start.**

**Rationale.** Keep it simple, observe, tune. Two-condition bound handles the typical cases:
- Active tenant with regular briefings: snapshot = last briefing (commitments before that are presumed reviewed and either renewed or expired).
- Quiet tenant with no recent briefing: snapshot = 30 days (long enough to capture meaningful commitments without dragging in stale ones).
- New tenant with no briefings yet: snapshot = 30 days (effectively the lifetime of the tenant).

Per-tenant configurability adds complexity before we know whether it's needed. Per-evaluation dynamism adds nondeterminism that's hard to audit.

**Risks.**
- A material commitment older than 30 days is silently dropped. *Mitigation:* tenants with stable long-term commitments (e.g., recurring events) should also have recent briefings that re-include those commitments. If observation shows a class of commitments aging out incorrectly, raise the bound.

**Re-evaluation trigger.** If §B.1 watchlist shows false-negatives traceable to "commitment fell out of the 30-day window but is still actively live," raise the bound or add per-tenant configurability before R1.7.

---

### Q5 — Baseline computation for trend deltas

**Question.** How is "trend change" baselined? Rolling N-day mean vs absolute threshold vs z-score per-keyword?

**Options considered.**
- (A) Rolling 28-day median for cadence + z-score ≥ 2 for severity bins
- (B) Absolute thresholds (e.g., "cadence > N/day")
- (C) Per-keyword baseline

**Recommendation: (A) — rolling 28-day median for cadence, z-score ≥ 2 for severity-bin shifts.**

**Rationale.**
- 28-day median matches the 30-day working-model bound — same lookback frame.
- Median (not mean) is robust to outliers — a single burst doesn't shift the baseline; sustained shift does.
- z-score ≥ 2 is industry-standard for "statistically anomalous" — and at z=2 false-positive rate is ~5% for normally-distributed observations.
- Per-keyword baseline (option C) would be more precise but requires pre-computation infrastructure that's premature for R1 cold-start.

Pinned at `evaluator_version` tag per ADR §6/§7 so tuning audits can A/B against versions.

**Risks.**
- 28-day baseline can mask slow, sustained trend changes. *Mitigation:* this is a known limitation; observation may surface it as a false-negative class.
- z=2 fires on ~5% of normal observations. *Mitigation:* z-score alone doesn't fire C1 — the materiality test (commitment-linkage) is the second gate.

**Re-evaluation trigger.** If §B.1 watchlist shows false-negatives traceable to "slow sustained trend was real but baseline masked it," extend to multi-window baselines (e.g., 7-day vs 28-day comparison) before R1.7.

---

### Q6 — Cold-tenant first-query handling

**Question.** A brand-new tenant with no working model and no commitments inventory — what does R1 do?

**Options considered.**
- (A) `frame_fires=false` (no possible invalidation; no commitments to invalidate)
- (B) Special bootstrap path

**Recommendation: (A) — `frame_fires=false` for cold tenants. Falls back to current FORTRESS_CORE_DIRECTIVE format.**

**Rationale.** Doctrine principle: no commitments → no live decision → no frame. A new tenant has no working model to delta against, no commitments to invalidate. Producing a Decision Frame on a cold tenant would be intelligence theater by definition — there's nothing to preserve decision space *for*.

A tenant "warms up" implicitly when one of the following first occurs:
- First daily briefing runs (populates the working-model snapshot)
- First incident opens (creates a commitment-shaped row)
- First travel itinerary parses (creates a commitment-shaped row)
- ≥3 substantive chat turns establish stated commitments

No explicit threshold needed — the existing surfaces naturally populate as the tenant becomes active.

**Risks.**
- A cold tenant's principal asks a question that *should* produce a frame (e.g., "I'm attending a high-profile event next month, what should I think about"). *Mitigation:* this is the operator-flagged false-negative class. Tracked in §B.1.

**Re-evaluation trigger.** If §B.1 watchlist shows ≥3 cold-tenant cases where a frame should have fired but didn't, design a bootstrap-conversation flow before R1.7.

---

### Q7 — Investigation-hypothesis commitment expiry

**Question.** A long-running investigation's working hypothesis is a commitment. When does it expire as "live" for C3?

**Options considered.**
- (A) Tied to `investigations.next_review_at` if set; treat as expired if unset
- (B) Tied to explicit operator close
- (C) Configurable default (e.g., 30 days)

**Recommendation: (A) — Use `investigations.next_review_at` as the deadline. If unset, treat the commitment as expired (operator hasn't actively kept it live).**

**Rationale.** Investigations should already have a review cadence in the data model. If `next_review_at` is populated, it's the natural deadline. If unset, the absence of a review date is itself a signal that the commitment isn't being actively maintained — treating it as expired forces healthy investigation hygiene (operators must explicitly extend `next_review_at` to keep an investigation's hypothesis alive).

**Risks.**
- Investigations with `next_review_at = NULL` could be actively-live but un-tagged. *Mitigation:* §B.1 watchlist tracks this; if observation shows a meaningful population of null-next-review-at active investigations, ship a backfill migration before R1.7.

**Re-evaluation trigger.** If §B.1 watchlist surfaces ≥5 false-negative cases traceable to "investigation has no `next_review_at` but is genuinely live," design and ship the backfill before R1.7.

---

### Q8 — Detector budget / latency

**Question.** Hard cap on detector runtime. On timeout, fail-closed.

**Options considered.**
- (A) 200ms cap, fail-closed to `frame_fires=false`
- (B) Stricter (100ms)
- (C) Looser (500ms)

**Recommendation: (A) — 200ms cap, fail-closed to `frame_fires=false`. Every timeout event Flight Recorded with `short_circuit_axis='timeout'`.**

**Rationale.** 200ms is well below user-perceived chat latency (typical loop is 2–30s). Detector is read-only against indexed tables; should comfortably hit this. Fail-closed-to-false is the anti-theater discipline applied to budget: a timeout produces no frame rather than a partial/inconsistent one.

The `short_circuit_axis='timeout'` annotation in Flight Recorder makes timeout-driven non-fires distinguishable from genuine C1/C2/C3 short-circuits, which is essential for tuning.

**Risks.**
- 200ms is too tight for some queries with deep history. *Mitigation:* timeout rate is itself a Flight Recorder metric; if it exceeds ~2%, raise the budget or optimize the query.
- The detector adds 200ms to every Aegis turn even when frames don't fire. *Mitigation:* it runs in parallel with COP / tenant context loading; the marginal latency cost is near zero in the parallel path.

**Re-evaluation trigger.** If timeout rate exceeds 2% over 7 days, optimize before raising the cap. If after optimization the rate is still high, raise to 300ms; never beyond 500ms without re-architecting.

---

### Q9 — `audit_only` flag mechanism

**Question.** Per-tenant feature flag + global kill switch + row-level field?

**Options considered.**
- (A) Per-tenant feature flag + global kill switch
- (B) Global flag only
- (C) Row-level field only

**Recommendation: (A) — per-tenant feature flag + global kill switch. Row-level `audit_only` field on `aegis_decision_threshold_trace` records the persisted state per evaluation.**

**Rationale.** Staged rollouts need per-tenant granularity. Start with one tenant for the 7-day audit; expand explicitly. Global kill switch is the emergency revert path (one row update, immediate behavioral revert). Row-level field is the analytics record — every trace knows what mode it was evaluated under.

Implementation pattern (out of scope here, but signposted): use the existing feature-flag mechanism if one exists in Fortress (need to verify); otherwise a simple `tenant_feature_flags(tenant_id, flag_name, enabled)` lookup.

**Risks.**
- Per-tenant flag complexity adds operational surface. *Mitigation:* the flag set is small (one flag: `decision_frame_enabled`); the kill switch overrides.
- Misconfiguration (flag accidentally set globally on without per-tenant rollout). *Mitigation:* the kill switch is a one-toggle revert; misconfiguration is recoverable.

**Re-evaluation trigger.** If R1.7 promotes and operator wants to roll out by surface (Q10 expansion) rather than by tenant, design a per-surface flag layer.

---

### Q10 — Surfaces beyond `dashboard-ai-assistant` in R1 scope

**Question.** Daily briefings? `aegis-chat` (mobile)? Briefing-room sessions?

**Options considered.**
- (A) dash-ai only for R1 cold-start
- (B) dash-ai + send-daily-briefing (proactive briefing surface)
- (C) All Aegis surfaces

**Recommendation: (A) — `dashboard-ai-assistant` only for R1 cold-start. Expansion to other surfaces is a separate operator-gated decision per surface.**

**Rationale.** Observe in one surface first. The detector is read-only and side-effect-free, so expansion is structurally simple — but each surface has a different consumption model:

- `send-daily-briefing` — proactive, scheduled, no user query (the briefing IS the query). The C1/C2/C3 semantics need to be re-derived for the proactive case (no "last user message" exists). This is a separate analysis.
- `aegis-chat` (mobile) — same surface model as dash-ai but mobile UI consumes different output shape. R2 territory.
- Briefing-room sessions — multi-user, shared context. Authority Modes considerations.

Each of these deserves its own scoped expansion gate.

**Risks.**
- Operator wants R1 visible in mobile or briefings sooner. *Mitigation:* per the doctrine's gated rollout, expansion is a small operator-gated PR per surface; nothing about R1 cold-start precludes expansion.
- Single-surface observation may not generalize. *Mitigation:* the per-axis observations (commitment-linkage hit rate, materiality threshold tuning) generalize even if surface-specific consumption doesn't.

**Re-evaluation trigger.** Operator GO after R1.7 to expand to a second surface; that surface becomes R1's "R1-on-`send-daily-briefing`" follow-on ADR.

---

## §B — Audit watchlist (durably tracked classes for the 7-day audit period)

The R1 ADR's §7 7-day review protocol defines six promotion criteria. This watchlist is the **operator-flagged classes** to track *in addition to* the six criteria, captured durably so the watchlist survives the audit period and is consulted at promotion-gate time.

### §B.1 — Significant-signal-without-explicit-commitment-to-invalidate (operator-flagged 2026-05-29)

**Operator observation (verbatim from ratification message):**

> *"Watch for potential false negatives where a significant signal exists but no explicit commitment exists to invalidate."*

**Why this class is load-bearing.** R1 cold-start enforces a strict commitment-linkage requirement for C1 materiality (§1 of the R1 ADR). This is the strictest, most theater-resistant test — but it has a known structural blind spot: a genuinely significant signal that does not happen to map onto an explicit prior commitment in the working model will produce `C1.candidate_deltas[].invalidated_commitment_id = null`, which fails materiality, which produces `C1=false`, which produces `frame_fires=false`. The frame does not fire even though it arguably should.

This is the false-negative class on the audit-only-first-deployment trade-off. It exists by design — we chose to bias toward dormancy over theater. But we **must measure it**, because if the class is large, the doctrine's coverage gap is exposed and the commitment-derivation logic (Q3 dynamic vs Q3 dedicated table) needs to be hardened before R1.7.

**What we measure.** A new Flight Recorder field on `aegis_decision_threshold_trace`:

```
c1_significant_no_commitment: jsonb
```

Populated when:
- `c1_candidate_deltas` contains at least one entry where `materiality_score >= MATERIALITY_THRESHOLD`
- AND every such entry has `invalidated_commitment_id = null`
- AND therefore `c1_asserted = false`

The field captures: the candidate delta(s) that scored materially but lacked commitment linkage, the highest-materiality such delta, the working-model surfaces consulted, and the rejection reasons per candidate (e.g., `'no_matching_commitment_in_window'`, `'commitment_inventory_empty'`).

**Operator review cadence.** Daily during the 7-day audit. The operator reads the top N entries in `c1_significant_no_commitment` and judges per-row: "should a frame have fired here?"

**Tuning rules (if the class is large).**

| Observed pattern | Tuning response |
|---|---|
| Cold tenant cases ("no commitments at all") — ≥3 in 7 days | Design bootstrap-conversation flow before R1.7 (Q6 re-evaluation) |
| Commitment exists in tenant data but derivation missed it — ≥10 in 7 days | Design dedicated `principal_commitments` table before R1.7 (Q3 re-evaluation) |
| Commitment fell outside the 30-day working-model window — any meaningful count | Raise the bound or add per-tenant config before R1.7 (Q4 re-evaluation) |
| Investigation hypothesis lacks `next_review_at` but is actively live — ≥5 in 7 days | Backfill `next_review_at` before R1.7 (Q7 re-evaluation) |
| Significant signal class is genuinely outside the doctrine (no prior commitment, never will be) — and the operator agrees it shouldn't fire | Class confirmed as intentional dormancy; no tuning |
| Significant signal class is genuinely outside the doctrine — but the operator believes it SHOULD fire | **Doctrine-level question** — escalate to a Decision Layer Doctrine amendment (a new C-class or relaxed materiality test). NOT a Q-question; the ADR itself needs revisiting. |

**Promotion gate dependency.** R1.7 promotion is **not blocked** by this class existing — only by the operator's judgment after observing it. If the operator reviews the §B.1 entries and concludes the dormancy is acceptable for the cold-start, R1.7 proceeds. If the operator concludes that the class is materially under-firing, the appropriate Q is re-evaluated per the tuning rules above before R1.7.

### §B.2 — Same-surface cross-tenant variance (per the R1 ADR §6 sanity check)

Not operator-flagged, but the R1 ADR §6 already calls for per-tenant fire-rate variance auditing. Captured here as a watchlist item to ensure the variance audit actually runs daily during the 7-day period.

**What we measure.** Per-tenant fire rate, normalized by tenant query volume. Flagged if any tenant's normalized fire rate is >2× the median of active tenants.

**Tuning rule.** Variance >2× median → investigate tenant-specific anomaly before promotion (could indicate a data-quality issue, a misconfigured authority-map row, or a genuine tenant-specific pattern).

### §B.3 — Ungrounded firing (zero-tolerance per the doctrine)

The R1 ADR §10 names this as a P0 contamination incident. Captured here as a watchlist item to ensure it's actively audited rather than passively assumed.

**What we measure.** Per evaluation, validate that every `c1_evidence_row_ids`, `c2_evidence.row_ids`, `c3_live_decisions[].commitment_id` resolves to a real, currently-existing, tenant-scoped row. Any failure is an ungrounded firing.

**Tuning rule.** Zero tolerance. Any single ungrounded firing during the audit period stops the clock — R1.7 promotion is blocked until the root cause is identified and remediated.

## §C — Resolution matrix (fast-scan)

| Item | Resolution | Re-evaluation trigger |
|---|---|---|
| Q1 (authority map) | Minimal hard-coded for R1; full ADR follows | >15% of false-negatives trace to map miss |
| Q2 (runtime location) | In-process; refactor to `_shared/` if ≥2 surfaces consume | R3 or Q10 expansion |
| Q3 (commitments inventory) | Dynamic derivation from existing surfaces; dedicated table deferred | §B.1 ≥10 misses in 7 days |
| Q4 (snapshot bound) | `min(last_briefing, 30 days)` globally | §B.1 shows aging-out false-negatives |
| Q5 (baseline) | Rolling 28-day median + z-score ≥ 2 | §B.1 shows slow-sustained-trend false-negatives |
| Q6 (cold tenant) | `frame_fires=false` | §B.1 ≥3 cold-tenant cases |
| Q7 (investigation expiry) | `next_review_at` if set, else expired | §B.1 ≥5 null-next-review cases |
| Q8 (latency cap) | 200ms, fail-closed, timeout traced | Timeout rate >2% |
| Q9 (audit flag mechanism) | Per-tenant flag + global kill + row field | Q10 expansion needs per-surface granularity |
| Q10 (surfaces) | dash-ai only for cold-start | Operator GO per-surface after R1.7 |
| §B.1 (operator-flagged FN class) | Tracked via `c1_significant_no_commitment` field | Class size + operator judgment at R1.7 gate |
| §B.2 (cross-tenant variance) | Per-tenant fire-rate, flagged >2× median | Variance triggers investigation |
| §B.3 (ungrounded firing) | Zero-tolerance, P0 incident on any single occurrence | Any occurrence stops R1.7 clock |

## §D — Pre-R1.0 authorization checklist

Before R1.0 (the schema + initial detector phase) is authorized, the operator confirms:

| Item | Confirmation requested |
|---|---|
| 1. Q1–Q10 resolutions | Operator agrees with each recommendation in §A (or names specific overrides) |
| 2. Audit watchlist §B.1–§B.3 | Operator agrees the three classes are tracked durably as defined |
| 3. R1.0 scope | Operator confirms R1.0 = schema (`aegis_decision_threshold_trace` table + RLS + provenance assertion) + nothing else; NO detector code in R1.0 |
| 4. R1.1–R1.6 sequencing | Operator confirms phases are individually gated, not bundled — R1.0 GO does not authorize R1.1 |
| 5. Per-tenant pilot tenant | Operator names which tenant gets `decision_frame_enabled = true` first (the audit-only canary). Recommendation: a non-customer-facing test tenant or operator-internal tenant for the first day, then promote to a real tenant for the full 7-day audit. |
| 6. Audit cadence | Operator confirms the daily-review-during-7-days cadence is acceptable; if the operator wants a different cadence, name it |
| 7. Promotion gate authority | Operator confirms R1.7 promotion (audit-only → behavioral effect) requires explicit operator GO, not an automatic threshold |
| 8. Held items unchanged | Operator confirms P5, P6, Class B, PR #36, and R2/R3/R4/R5/R6 remain held |

## §E — Held

- P5 / P6 / Class B / PR #36 — unchanged
- R2 / R3 / R4 / R5 / R6 — held until R1.7 promotion gate
- The R1 ADR itself — unchanged per operator directive
- This document does not authorize implementation; it is the resolved-questions basis for the future R1.0 implementation gate.

## Changelog

- **2026-05-29 v1** — initial Q1–Q10 recommendations + audit watchlist + resolution matrix + pre-R1.0 authorization checklist. Includes the operator-flagged false-negative class as §B.1 with explicit Flight Recorder field, daily review cadence, and per-pattern tuning rules.
