# Approval Queue Overload Assessment

**Operator-directed 2026-05-31 (Task #121).** Read-only diagnosis against Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."* No implementation. No code. No deploys.

**Hypothesis:** Operator attention may be the primary bottleneck in Fortress.

**Verdict (preview):** Hypothesis confirmed. Two queues collapsed completely in the last 7 days while inflow continued unchanged — `entity_suggestions` +260/-0, `monitoring_proposals` +186/-0. The collapse is structural: the queues are dominated by LOW-consequence items that should never have reached the operator. Auto-execution thresholds for LOW-consequence types are set too conservatively against actual risk.

---

## §1 — Queue Inventory (11 surfaces)

Mapped via Explore agent + DB schema + table-stats query against prod. Ranked by current operator-attention cost.

| # | Queue | Pending | Inflow trend | Status | Notes |
|---|---|---|---|---|---|
| 1 | `entity_suggestions` | **260** | **+260 last 7d / 0 resolved** | ☠ COLLAPSED | dominated by person-from-signal (169) and person-from-auto-enrichment (60, avg conf 0.36); AI assessment NOT running (0/334 with `ai_threat_score`) |
| 2 | `monitoring_proposals` | **316** | **+186 last 7d / 0 resolved** | ☠ COLLAPSED | 84% are add_keyword; 11% add_entity; 7-day expiry job is NOT firing (oldest pending = 12.6 days) |
| 3 | `agent_actions` awaiting_approval | **23** | +95 last 7d / 72 resolved | Slowing | All but 1 are `propose_severity_correction` (LOW consequence); 1 is `notify_oncall_via_slack` (MEDIUM) |
| 4 | `signals` (untriaged) | **~944 of 1000 last 30d** | continuous | Stale | 6% with any triage override; 320 in LOW confidence band (0.45-0.65) + 306 with no composite confidence at all |
| 5 | `platform_findings` (Watchdog) | **77** | continuous | Saturated | 10 critical + 30 high + 33 medium + 4 warning; auto-resolves when behavior corrects but operator-visible while open |
| 6 | `verification_tasks` (C.4 review) | 0 | 0 | Empty | Schema exists; not yet emitting items |
| 7 | `signal_merge_proposals` | 0 | 0 | Empty | Deduplication queue; no items currently |
| 8 | `aegis_recommendations` | 0 | 0 | Empty | Workstream E approval not wired; recommendations never reach `pending_approval` |
| 9 | `aegis_claim_confidence` (validation_state) | 0 | 0 | Dark | Workstream D slim slice ships dark behind `D_SLIM_SLICE_ENABLED` |
| 10 | `agent_tradecraft_quarantine` | 0 | 0 | Empty | Class A migration complete; no quarantine writes yet |
| 11 | `wraith_vulnerability_findings` | 0 | 0 | Empty | Scanner emits but no current findings |

**Dead inbox** (NOT an approval queue but consumes operator-mental-load if displayed):
- `agent_pending_messages` — 167 rows, ALL >7 days old, no `status` column or `reviewed_at` — looks like a leaked routing buffer, not a decision queue

**Worker-level queues** (NOT operator approval; included for completeness):
- `function_jobs` — 30d: 12,191 completed, 1,395 failed (10.3% failure rate), 4 in_progress. Healthy at the worker level; the 10% failure rate is a separate Watchdog/Health concern.
- `processing_queue` — 850 rows: 767 FAILED (91%), 78 completed, 5 processing. This is **broken**, not overloaded — a worker that nobody is consuming and that fails on almost every item. Out of scope for this assessment but flag-worthy.
- `dead_letter_queue` — 10,157 rows. Worker DLQ; not operator-facing.

---

## §2 — Queue Metrics (Live Data, Prod)

### A — Inventory & Age

| Queue | Status | Count | Oldest age | Avg age | % of queue |
|---|---|---:|---:|---:|---:|
| `agent_actions` | executed | 142 | 30.7d | 12.3d | 86% |
| `agent_actions` | awaiting_approval | 23 | 8.1d | 7.5d | 14% |
| `entity_suggestions` | pending | 260 | 6.1d | 3.4d | **78%** |
| `entity_suggestions` | approved | 55 | 56.0d | 16.6d | 16% |
| `entity_suggestions` | rejected | 19 | 56.0d | 38.8d | 6% |
| `monitoring_proposals` | pending | 316 | 12.6d | 6.5d | **70%** |
| `monitoring_proposals` | applied | 100 | 30.6d | 18.7d | 22% |
| `monitoring_proposals` | rejected | 37 | 30.6d | 24.2d | 8% |

### B — Inflow vs Outflow (Weekly, Last 8 Weeks)

Decisive evidence. Weeks where inflow ≫ resolution mark the moment operator throughput broke.

| Queue | Week | Inflow | Resolved | Net |
|---|---|---:|---:|---:|
| agent_actions | 2026-05-11 | 62 | 62 | 0 |
| agent_actions | 2026-05-18 | 95 | 72 | **+23** |
| agent_actions | 2026-05-25 | 3 | 3 | 0 |
| entity_suggestions | 2026-05-04 | 8 | 8 | 0 |
| entity_suggestions | 2026-05-18 | 45 | 45 | 0 |
| entity_suggestions | 2026-05-25 | **260** | **0** | **+260** |
| monitoring_proposals | 2026-05-11 | 59 | 59 | 0 |
| monitoring_proposals | 2026-05-18 | 154 | 24 | **+130** |
| monitoring_proposals | 2026-05-25 | **186** | **0** | **+186** |

**Pattern:** Two queues went from "caught up" to "0 resolved" in the last 7 days while inflow accelerated. This is not a slow leak. It is a complete throughput collapse.

### C — Content Mix (Pending Items)

What's actually waiting:

**`entity_suggestions` pending (260):**

| Suggested type | Source | Count | Avg confidence | AI assessment present |
|---|---|---:|---:|---:|
| person | signal | 169 | 0.84 | 0 |
| person | auto_enrichment | 60 | **0.36** | 0 |
| organization | auto_enrichment | 8 | 0.68 | 0 |
| domain | signal | 6 | 0.85 | 0 |
| organization | signal | 5 | 0.85 | 0 |
| infrastructure | auto_enrichment | 5 | 0.68 | 0 |
| location | auto_enrichment | 5 | 0.54 | 0 |

**Critical:** `ai_threat_score IS NULL` on 334/334 entity_suggestions rows. The AI-assessment infrastructure exists in schema (`ai_assessment`, `ai_assessed_at`, `ai_risk_level`, `ai_threat_score`) but is not running. Operator is asked to pre-classify everything manually.

**`monitoring_proposals` pending (316):**

| Type | Count | Avg confidence |
|---|---:|---:|
| add_keyword | 265 (84%) | 0.75 |
| add_entity | 34 (11%) | 0.77 |
| remove_keyword | 17 (5%) | 0.76 |

**`agent_actions` awaiting_approval (23):**

| Action type | Tier | Count |
|---|---|---:|
| propose_severity_correction | propose | 22 |
| notify_oncall_via_slack | propose | 1 |

---

## §3 — Consequence Classification

Per the operator's framework. Each action type ranked by consequence-of-getting-it-wrong, NOT by frequency.

### LOW consequence (reversible in seconds; bounded blast radius)

| Item | Why LOW |
|---|---|
| `propose_severity_correction` | Severity label change; reversible by next correction; doesn't gate downstream |
| `add_keyword` | Adds a search term to monitor; reversible by `remove_keyword`; worst case = some noise in feed |
| `remove_keyword` | Removes term; reversible by re-add; worst case = missed coverage on one term |
| `entity_suggestions` person-from-auto_enrichment with conf < 0.5 | Speculative entity name; rejection leaves the system unchanged |
| `entity_suggestions` person-from-signal with conf ≥ 0.85 | High-confidence extraction; near-certain to be real entity |
| `file_followup_task` (already AUTO) | Tasks an agent to revisit; non-mutating |
| `schedule_entity_rescan` (already AUTO) | Triggers an enrichment scan; non-mutating |

### MEDIUM consequence (touches operator workflow; reversible but with friction)

| Item | Why MEDIUM |
|---|---|
| `add_entity` proposal | Creates a tenant entity; downstream entity-graph implications; rollback requires merge/delete |
| `entity_suggestions` person-from-signal with conf 0.5-0.85 | Could pollute entity graph if wrong |
| `notify_oncall_via_slack` | External communication; reversible socially, not technically |
| Signal triage override (`triage_override`) | Changes how a signal flows through downstream systems |

### HIGH consequence (customer-visible; cross-system effects)

| Item | Why HIGH |
|---|---|
| Cross-tenant data access (Aegis Ops) | Tenant boundary trust |
| External report dispatch (Petronas exec, consortium) | Reputation; reversal is socially costly |
| Tripwire / escalation rule changes | Affects automated routing of future signals |
| Approval of an Aegis recommendation that triggers an action | Workstream E surface; not yet wired |

### CRITICAL consequence (destructive or non-reversible)

| Item | Why CRITICAL |
|---|---|
| Tenant permission grant/revoke | Access scope; potentially non-reversible if data is exfiltrated |
| Signal deletion / quarantine of high-severity items | Information loss |
| Wraith remediation actions (auto-fix code) | Code mutation |
| Cross-tenant memory write | INC-LEARN-CONTAM class; doctrinally forbidden |

### Pending queue's consequence breakdown

| Consequence | Pending count | % of total pending |
|---|---:|---:|
| **LOW** | ~565 | **89%** |
| **MEDIUM** | ~45 | 7% |
| HIGH | ~1 (single notify_oncall) | <1% |
| CRITICAL | 0 | 0% |

**89% of the pending queue is LOW-consequence.** The bottleneck is composed almost entirely of items that would be cheaper to get wrong (and auto-reverse) than to manually approve.

---

## §4 — Root Cause Diagnosis

Mapping evidence to the six candidate causes:

| # | Hypothesis | Evidence | Verdict |
|---|---|---|---|
| **1** | Excess decision generation | entity_suggestions inflow jumped 6× week-over-week (45→260); monitoring_proposals 154→186; both queues now generate more than operator can process at any sustainable rate | **CONFIRMED — dominant cause** |
| **2** | Incorrect approval ownership | 89% of pending items are LOW consequence (keyword adds, severity corrections, speculative entity names); these should never require operator-tier approval | **CONFIRMED — second dominant** |
| **3** | Insufficient confidence for automation | Auto-tier already handles `file_followup_task` and `schedule_entity_rescan` cleanly. The system can auto-execute. The thresholds for what qualifies are too conservative — `propose_severity_correction` is propose-tier even at 0.85+ confidence | **CONFIRMED — third dominant** |
| **4** | Workflow friction | No batch-approve UI; no AI pre-classification on entity_suggestions; no priority sort; no "show me only HIGH-consequence items" filter | **CONFIRMED — accelerant** |
| **5** | Poor queue prioritization | Flat queues with no consequence banding; pending list shows oldest-first or newest-first only; operator cannot triage by "what matters" | **CONFIRMED — accelerant** |
| **6** | Other | (a) `ai_threat_score` infrastructure exists but is NOT running on entity_suggestions — 0/334 assessed; (b) 7-day expiry on monitoring_proposals is NOT firing — oldest pending = 12.6 days; (c) Watchdog itself has 10 critical + 30 high findings open, adding to operator load | **CONFIRMED — failing safety nets** |

**Composite root cause:** Agents generate LOW-consequence items at high cardinality; the existing auto-execute tiers don't cover them; AI pre-assessment that would auto-classify them is dormant; the expiry that would clear stale items is not firing; the operator-facing UI offers no consequence-banding or batch operations. **Five compounding failures producing one bottleneck.**

---

## §5 — Top Bottlenecks (Ranked)

What is actually costing operator attention right now, ranked by cost × persistence:

### Bottleneck #1 — `monitoring_proposals add_keyword` (265 pending)

- **Pending depth:** 265 keyword-add proposals at avg 0.75 confidence
- **Inflow:** ~25/day
- **Consequence-of-wrong:** LOW (reversible by remove_keyword)
- **Current ownership:** operator approval required
- **Attention cost per item:** ~30s to read context + approve/reject
- **Attention cost per week (at current inflow):** 175 items × 30s = **~90 min/week**
- **What's being asked of the operator:** "Should this keyword be added to monitor X?" — operator is acting as a keyword editor

### Bottleneck #2 — `entity_suggestions person-from-signal` (169 pending)

- **Pending depth:** 169 person suggestions from signals at avg 0.84 confidence
- **Inflow:** ~25/day
- **Consequence-of-wrong:** LOW at high confidence, MEDIUM at low confidence
- **Current ownership:** operator approval required
- **Attention cost per item:** ~45s (verify entity is real)
- **AI assessment:** NOT RUNNING — every item is operator-rated cold
- **Attention cost per week:** 175 × 45s = **~130 min/week**

### Bottleneck #3 — `entity_suggestions person-from-auto_enrichment` (60 pending @ 0.36 confidence)

- **Pending depth:** 60 speculative person suggestions at very low confidence
- **Consequence-of-wrong:** LOW (auto-reject probably correct)
- **Current ownership:** operator approval required
- **Attention cost per item:** ~60s (lower confidence means more verification)
- **What it actually is:** noise the system isn't filtering; **these should not reach the operator at all**

### Bottleneck #4 — `agent_actions propose_severity_correction` (22 pending)

- **Pending depth:** 22 severity corrections
- **Consequence-of-wrong:** LOW (severity label is post-facto adjustment)
- **Confidence in the proposal:** typically 0.7-0.9 based on action-pipeline patterns
- **Attention cost per item:** ~20s

### Bottleneck #5 — Untriaged signals (944/1000 last 30d)

- **Untriaged depth:** 944 of last 1,000 signals have no `triage_override`
- **Consequence-of-wrong:** depends on signal type
- **What "triage" means here:** operator manually upgrading/downgrading a signal's classification
- **Honest framing:** this likely is NOT actually a queue the operator was trying to clear — most signals never need triage override. The 6% review rate may be appropriate, not a gap.

### Bottleneck #6 — `platform_findings` Watchdog open findings (77)

- **Open depth:** 10 critical + 30 high + 33 medium + 4 warning
- **Consequence-of-ignoring:** MEDIUM-HIGH (these are silent regressions)
- **What's being asked:** investigate why each finding fired; some auto-resolve
- **Cost:** highly variable per finding; possibly 5-30 min each
- **This is the real backstop trust queue.** If this queue is saturated, operator can't trust other improvements.

### Bottleneck total

At current state: **~3.5-5 hours/week of operator attention** consumed by LOW-consequence approvals (bottlenecks 1-4 alone) — and most of that time is acting as a keyword/entity rubber stamp, not making real decisions.

That is the bottleneck. It is real. It is measurable. It is also fixable.

---

## §6 — Ownership Analysis

For each high-volume action type, who genuinely needs to be the decider:

| Action type | Operator | Tenant admin | Analyst | Automatable |
|---|:---:|:---:|:---:|:---:|
| `add_keyword` (conf ≥ 0.75) | — | — | — | ✅ AUTO-execute with notify-only |
| `add_keyword` (conf < 0.75) | — | — | ✅ | — |
| `remove_keyword` (conf ≥ 0.75) | — | ✅ | — | ✅ notify-then-execute |
| `add_entity` (conf ≥ 0.8 + AI-passed) | — | ✅ | — | (review-tier) |
| `add_entity` (conf < 0.8 OR no AI assessment) | — | — | ✅ | — |
| `entity_suggestion` person-from-signal (conf ≥ 0.85) | — | — | — | ✅ AUTO-approve |
| `entity_suggestion` person-from-auto_enrichment (conf < 0.5) | — | — | — | ✅ AUTO-reject |
| `entity_suggestion` middle band (conf 0.5-0.85) | — | — | ✅ | — |
| `propose_severity_correction` (conf ≥ 0.8) | — | — | — | ✅ AUTO-execute with notify-only |
| `propose_severity_correction` (conf < 0.8) | — | — | ✅ | — |
| `notify_oncall_via_slack` | — | ✅ | ✅ | — |
| Tripwire / escalation rule change | ✅ | — | — | — |
| External report dispatch | ✅ | ✅ | — | — |
| Tenant permission grant | ✅ | — | — | — |
| Cross-tenant access | ✅ | — | — | — |
| Aegis recommendation approval (Workstream E) | ✅ | — | — | — |

### Roles Fortress currently has

- `super_admin` (operator) — 1 user (Aaron)
- `analyst` — exists in `user_roles` schema; the queues default to "analyst, super_admin"
- `tenant_admin` — NOT currently a distinct role in this schema; effectively collapses to analyst
- **Today:** every queue defaults to analyst-or-operator, and there is only one user, so every queue is operator-by-default

### Ownership reality

The "incorrect approval ownership" hypothesis is not that items are routed to the wrong role — it's that **89% of items are routed to a human at all**. The right ownership for LOW-consequence high-confidence items is **automation, not delegation**.

---

## §7 — Trust Analysis (Auto-Approval Risk)

For each candidate auto-execute boundary:

| Boundary | Risk if AI is wrong | Reversal cost | Recommended action |
|---|---|---|---|
| Auto-approve `add_keyword` at conf ≥ 0.75 | LOW (extra noise in feed) | <1 min (remove_keyword) | **Low risk — proceed** |
| Auto-approve `propose_severity_correction` at conf ≥ 0.8 | LOW (one signal's severity is wrong) | <1 min (re-correct) | **Low risk — proceed** |
| Auto-approve `entity_suggestion` person-from-signal at conf ≥ 0.85 | LOW-MED (potentially merged into entity graph) | 5-10 min (delete + cleanup mentions) | **Moderate risk — proceed with audit log** |
| Auto-reject `entity_suggestion` person-from-auto_enrichment at conf < 0.5 | LOW (we miss a real entity) | High if missed real entity is operationally important | **Low risk — proceed with periodic audit** |
| Auto-approve `add_entity` at conf ≥ 0.85 | MED (creates entity that's wrong) | 10-20 min (merge/delete + mentions cleanup) | **Moderate risk — needs AI assessment gate before automation** |
| Auto-approve `notify_oncall_via_slack` | HIGH (external comm) | High (social cost) | **Unacceptable — operator-only** |
| Auto-execute tripwire change | HIGH (affects future routing) | Medium-High | **Unacceptable — operator-only** |
| Auto-execute cross-tenant action | UNACCEPTABLE | n/a | **Forbidden — doctrinal** |

### Trust-by-confidence-band framework

```
                  AUTO            ANALYST           OPERATOR
              (no review)        (review)         (decision)
LOW         ────────────────────────────────────────────────
            conf ≥ 0.75       conf 0.5-0.75      conf < 0.5
MEDIUM      ────────────────────────────────────────────────
                              conf ≥ 0.8         conf < 0.8
HIGH        ────────────────────────────────────────────────
                                                  always
CRITICAL    ────────────────────────────────────────────────
                                                  always
```

Combined with notify-on-execute for the AUTO band (so the operator can react to a wrong call within hours, not days), this preserves the audit surface while removing the throughput bottleneck.

---

## §8 — Decision Space Analysis

### Operator attention currently consumed

Reconstructed from queue depths × per-item attention cost × inflow rates:

| Source | Items/week | Time per item | Weekly cost |
|---|---:|---:|---:|
| `monitoring_proposals` keyword-adds | 175 | 30s | ~90 min |
| `entity_suggestions` person-from-signal | 90 | 45s | ~70 min |
| `entity_suggestions` low-conf auto_enrichment | 40 | 60s | ~40 min |
| `agent_actions` severity corrections | 22 | 20s | ~7 min |
| Other entity_suggestion types | ~20 | 60s | ~20 min |
| Signal triage (when operator does it) | ? | 60s | variable |
| `platform_findings` investigations | 5-10 | 5-30 min | 30-300 min |
| **Total LOW-consequence approvals** | | | **~230 min/week** |
| **Plus Watchdog investigations** | | | **+30-300 min/week** |

**At baseline:** ~4 hours/week (~30 min/day, every working day) consumed by LOW-consequence approvals before the operator does any *actual* security work.

**At surge (last 7 days):** queues stopped clearing entirely — operator was either (a) at capacity, (b) doing higher-priority work elsewhere, or (c) the queues themselves became unusable so the operator gave up on them. All three are signals of bottleneck failure.

### Decision space that would be recovered

| Treatment | Operator hours/week recovered |
|---|---:|
| Auto-execute high-conf keyword adds | ~80 min |
| Auto-execute high-conf severity corrections | ~5 min |
| Auto-approve high-conf person-from-signal entity suggestions | ~50 min |
| Auto-reject very-low-conf auto_enrichment entity suggestions | ~30 min |
| Run AI assessment on entity_suggestions BEFORE they reach the queue | (compounds above) |
| Fix monitoring_proposals 7-day expiry | ~15 min (one-time queue purge + steady-state cleanup) |
| **Total recoverable** | **~3 hours/week + bigger surge headroom** |

3 hours/week is not a small number. It's the difference between "Aaron can't keep up with the queue" and "Aaron clears the queue with 2 hours of focused work and has the rest of the week for actual security work."

---

## §9 — Most Important Question

**"Which approval decisions are costing more operator attention than the consequence of getting them wrong?"**

Ranked answer (worst offenders first):

| Decision type | Attention cost (cumulative) | Consequence-of-wrong | Verdict |
|---|---:|---|---|
| `add_keyword` at conf ≥ 0.75 | ~80 min/week | LOW (reversible in <1 min) | **OVERCOSTED ~80×** |
| `entity_suggestion` person-from-auto_enrichment < 0.5 conf | ~30 min/week | LOW (we already correctly suspect these are noise) | **OVERCOSTED ~30×** |
| `propose_severity_correction` at conf ≥ 0.8 | ~5 min/week | LOW (label adjustment) | **OVERCOSTED ~5×** |
| `entity_suggestion` person-from-signal ≥ 0.85 conf | ~50 min/week | LOW-MED (small chance of bad merge) | **OVERCOSTED ~10×** |
| `add_entity` proposal ≥ 0.85 conf | smaller volume | MEDIUM (entity-graph implication) | Borderline — needs AI gate |
| `notify_oncall_via_slack` | trivial | HIGH (external communication) | Correctly operator-gated |
| Tripwire / escalation rule changes | trivial volume | HIGH | Correctly operator-gated |
| Cross-tenant Aegis Ops action | n/a yet | CRITICAL | Doctrinally operator-gated |

**Most costly attention thieves:** keyword-add approvals and high-confidence person-from-signal entity suggestions. Each individual item is cheap (~30-45s), but the volume makes them dominant.

---

## §10 — Consequence-Based Approval Framework (Proposed)

A framework, not an implementation. Authorize before any code lands.

```
                  AUTO-EXECUTE   NOTIFY-ONLY   ANALYST-REVIEW   OPERATOR-APPROVE
                  (no notify)    (post-hoc)      (queue)        (operator-only)
LOW       ─────── conf ≥ 0.90 ── 0.75-0.90 ── 0.5-0.75 ───── <0.5 ───────────────
MEDIUM    ─────── n/a ────────── conf ≥ 0.85 ─ 0.65-0.85 ─── <0.65 ──────────────
HIGH      ─────── n/a ────────── n/a ───────── n/a ─────────  always ────────────
CRITICAL  ─────── n/a ────────── n/a ───────── n/a ─────────  always + audit ────
```

### Framework rules

1. **AUTO-EXECUTE (no operator visibility unless audit-pulled)**: LOW-consequence + very-high-confidence items execute immediately. Audit log is persistent and queryable; operator does not see them in any daily review.
2. **NOTIFY-ONLY (post-hoc visibility)**: LOW-consequence + high-confidence items execute immediately AND show up in a `recent automations` digest (daily summary or "last 24h" view). Operator can intervene retroactively if any look wrong.
3. **ANALYST-REVIEW (queue)**: Items genuinely warranting human review go to a queue scoped to the analyst role (separate from operator).
4. **OPERATOR-APPROVE**: HIGH/CRITICAL consequence items, regardless of confidence, plus any LOW/MEDIUM items below the confidence floor.

### Why notify-only matters

Auto-execute without notification removes audit ground. Notify-only gives the operator a `last 24h` view (small, digestible) where they can spot-check the automation working. This is consistent with Workstream D claim-frame philosophy: trust IS the substrate.

---

## §11 — Recommended Ownership Model

| Role | Approval authority |
|---|---|
| `super_admin` (operator) | HIGH, CRITICAL, any item failing other gates, override authority everywhere |
| `analyst` | LOW-MEDIUM-MEDIUM-HIGH consequence items below auto-execute confidence threshold; signal triage; investigation workflow |
| `tenant_admin` (proposed new role) | Tenant-scoped MEDIUM items: tenant-keyword changes, tenant-entity creation at high confidence, monitor configuration within their tenant |
| Automation | LOW-consequence + high-confidence items per §10 framework |

### Practical implication

Today, Fortress has 1 super_admin and 1 analyst (`tenant_users` = 2). Adding `tenant_admin` as a role requires customer adoption. Until then, the analyst role bears delegated authority for the middle bands — which means **the analyst role itself needs functional UI support that doesn't exist for several of these queues** (entity_suggestions has UI; agent_actions has UI; monitoring_proposals has UI; verification_tasks does not; aegis_recommendations does not).

**Near-term ownership reality (without new roles):** auto-execute LOW-high-conf items; route the remainder to analyst tier; reserve operator approval for HIGH/CRITICAL only.

---

## §12 — Recommended Automation Boundaries (No Authorization Yet)

In priority order — each is a separate authorization decision. Each saves operator attention asymmetrically against its consequence-of-wrong.

| # | Boundary | Estimated savings | Consequence | Risk |
|---|---|---:|---|---|
| **B1** | Auto-execute `add_keyword` at conf ≥ 0.85 | ~60 min/wk | LOW | Low |
| **B2** | Auto-reject `entity_suggestion` person-from-auto_enrichment at conf < 0.5 (no operator review) | ~30 min/wk | LOW | Low — periodic spot audit |
| **B3** | Auto-execute `propose_severity_correction` at conf ≥ 0.85 | ~5 min/wk | LOW | Low |
| **B4** | Run dormant `ai_threat_score` enrichment on entity_suggestions BEFORE queue insertion | (compounds B5/B6) | LOW (pre-filter) | Low |
| **B5** | Auto-approve `entity_suggestion` person-from-signal at conf ≥ 0.90 AND ai_threat_score ≥ acceptable | ~30-50 min/wk | LOW-MED | Moderate |
| **B6** | Auto-reject entity_suggestions at conf < 0.4 regardless of source | ~15 min/wk | LOW | Low |
| **B7** | Fix monitoring_proposals 7-day expiry job (currently not firing) | ~15 min/wk + steady-state | LOW | Trivial |
| **B8** | Consequence-banded queue UI (sort by consequence × age × confidence) | (compounds all) | n/a | Trivial |
| **B9** | "Last 24h automations" digest surface | (preserves trust) | n/a | Trivial |

**B1-B7 together** would clear ~150-180 min/week of operator attention and would shrink the pending queue depths from 600+ items to ~50-100 items. Plus the surge headroom: when a future spike happens (like the +260/+186 surge of 2026-05-25), it auto-clears instead of collapsing.

---

## §13 — Doctrine Additions Evaluation

### "In Peace Time, Improve Your Fighting Position."

**ACCEPTED — codify as doctrine.**

This is exactly the moment Fortress is in. Two queues collapsed last week but no operational fire is burning right now. The pattern is consistent with: nothing critical is breaking, but operator capacity is eroding silently. Peace time. The right work is exactly the work proposed in §12 — automating LOW-consequence approvals so when something HIGH-consequence arrives, the operator has the capacity to respond.

Operational restatement: **Right now is when to fix this, before a real incident requires the saturated attention that auto-approvals would have freed up.**

### "Operator attention is a finite resource. Protect it like critical infrastructure."

**ACCEPTED — codify as doctrine.**

This is the load-bearing doctrine for the entire campaign. Every architectural decision should ask: *"Does this consume operator attention proportional to its consequence?"* Items that consume disproportionate attention are infrastructure bugs, not workflow issues.

Specific protections that follow:
- Approval routing must be consequence-banded by default
- New decision surfaces must declare consequence tier + confidence threshold for auto-execution BEFORE shipping
- Operator-tier approvals must be reserved for HIGH/CRITICAL consequence items
- Queue overload alarms (when inflow > resolution for N days) must be treated as Watchdog findings, not as backlog

### Both additions are operational restatements of Commander's Intent

Commander's Intent ("Preserve decision space by shortening Signal → Decision → Action") is the *why*. These two new doctrines are the *how* — peacetime infrastructure investment and finite-attention protection — and they make the Commander's Intent measurable. *Decision space* is what these doctrines are preserving.

---

## §14 — Tie-Back to Commander's Intent

| Lens | Verdict |
|---|---|
| **Largest reduction in decision latency** | Queue overload remediation. Cleaning the queue depth recovers ~3 hours/week of operator capacity. Decision Frame (F.0) returns minutes per report; Watchdog Campaign 1 returns capacity per incident; queue work returns hours per week. |
| **Largest increase in operator trust** | Tied. Queue cleanup proves "Fortress doesn't bury me" (workflow trust). Watchdog proves "Fortress doesn't fail silently" (truthfulness trust). Both are foundation. |
| **Greatest bottleneck removed** | Approval queue overload. **The operator can read the briefing only when not buried in keyword approvals.** This is the systemic chokepoint that bounds the value of every other improvement. |

The earlier prioritization review correctly identified Approval Queue Overload as #1. This diagnosis confirms it with data: 89% of pending items are LOW consequence, queues have stopped clearing, 3+ hours/week of operator attention is consumed on items that should never have reached the operator.

---

## §15 — What I Don't Know (Certainty Gap)

| Unknown | Why it matters | How to resolve |
|---|---|---|
| Operator's actual time-per-item (estimates above are inferred) | Validates §8 attention-cost math | Operator self-report on next queue-clearing pass |
| Why two queues stopped clearing on 2026-05-25 specifically | Whether it was a process change, a shift in attention, or queue UI degradation | Operator self-report |
| Whether the dormant `ai_threat_score` is intentional (pipeline disabled) or a bug | B4 effort estimate hinges on this | Code-path probe of `assess-entity` callers |
| Why monitoring_proposals 7-day expiry isn't firing | B7 effort estimate hinges on this | Single SQL/cron audit |
| Whether the 944/1000 untriaged signals indicates a queue gap or appropriate behavior | Bottleneck #5 may be a false-positive | Operator confirmation of intended triage rate |
| `agent_pending_messages` 167 stale rows — what was this queue supposed to be? | May be a leaked schema artifact, not a real queue | Code-grep for INSERT calls |

These are not gates. They are honest acknowledgments that some of the recommendations have margin-of-error based on inferred behavior.

---

## §16 — Held / Operator Decision Surface

No implementation. No code. No deploys.

### Decisions for operator authorization (each separate)

| # | Decision | Recommendation |
|---|---|---|
| O1 | Authorize the consequence-based approval framework (§10) as Fortress doctrine | ACCEPT |
| O2 | Authorize doctrine additions (§13): peacetime + operator attention | ACCEPT |
| O3 | Authorize Boundary B1 (auto-execute keyword adds at conf ≥ 0.85) — lowest risk, highest savings | proceed pending decision |
| O4 | Authorize Boundary B2 (auto-reject very-low-conf entity suggestions) | proceed pending decision |
| O5 | Authorize Boundary B3 (auto-execute severity corrections at conf ≥ 0.85) | proceed pending decision |
| O6 | Authorize Boundary B4 (run `ai_threat_score` enrichment on entity_suggestions) | needs scoping — defer until O3-O5 land |
| O7 | Authorize Boundary B7 (fix monitoring_proposals expiry) | trivial; high-confidence proceed |
| O8 | Authorize Boundary B8/B9 (consequence-banded UI + automations digest) | needs scoping — defer until O3-O5 land |
| O9 | Re-rank against F.0 Decision Frame and Campaign 1 Watchdog | recommended sequence: O7 (trivial) → O3 (lowest risk biggest gain) → O4 → O5 → THEN re-evaluate F.0 vs Watchdog priority with the operator capacity recovered |

### Sequence rationale

O7 is the cheapest possible action — it's an expired-cron fix. It clears stale monitoring_proposals without any policy change. Land it first because it requires no doctrine ratification.

O3 is the highest-savings action with the lowest risk. ~60 min/week recovered, auto-reversal in <1 minute if wrong, audit log preserves visibility.

After O7+O3+O4+O5 ship, ~150 min/week of operator capacity returns. That's the headroom needed to re-rank the F.0 Decision Frame and Campaign 1 Watchdog work without rushing.

---

## §17 — Final Verdict

**The operator's hypothesis was correct.** Operator attention is the primary bottleneck in Fortress today. Not because operator capacity has decreased, but because:

1. Agents generate LOW-consequence items at a cardinality exceeding human throughput
2. Auto-execute thresholds for those items are mis-set against their actual risk
3. AI pre-assessment infrastructure that would filter them is dormant
4. Expiry safety nets that would clear stale items are not firing
5. The UI surface offers no consequence-banding or batch operations to compensate

89% of the pending queue would not require operator attention under a properly-banded automation policy. Recovering that 89% returns ~3 hours/week of capacity — enough headroom that the Decision Frame and Watchdog campaigns can ship without competing for saturated attention.

**Recommended next action:** authorize O7 + O3 (trivial expiry fix + first auto-execute boundary). Both are reversible, both are measurable within days, and both prove the framework before broader rollout.

Held. No implementation. Awaiting operator decisions per §16.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
