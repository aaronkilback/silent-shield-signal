# Existing Queue Cleanup Assessment

**Operator-directed 2026-05-31 (Task #131).** Read-only diagnosis of the three operator-facing pending queues. No implementation.

Note: "Suggested Rules" maps to `monitoring_proposals` (the add_keyword/remove_keyword/add_entity proposals). No UI surface named "Suggested Rules" was found in the codebase — operator terminology refers to monitoring-rule proposals.

---

## §0 — Headline

**One actionable finding requires operator attention TODAY:** a pending `notify_oncall_via_slack` action from 2026-05-23 with urgency=high carrying the message *"Urgent: Potential Petronas credential exposure identified in GitHub repository booluckgmie/malaysia-mobility-dashboard. Recommend immediate investigation and credential rotation."* — 7.9 days old, Slack ping never fired because the action sits awaiting approval.

If real, this is operationally relevant. If stale, it should be reviewed and rejected. This is the only pending item with named-actor consequence.

Everything else in the three queues is **queue overhead**, not active risk. Detail follows.

---

## §1 — Per-Queue Inventory

### A — monitoring_proposals (the "Suggested Rules" queue)

| Status | Count | <7d | 7–30d | >30d | Oldest | Avg age |
|---|---:|---:|---:|---:|---:|---:|
| pending | **312** | 186 | 126 | 0 | 12.7d | 6.5d |
| applied | 93 | 0 | 89 | 4 | 30.7d | 18.3d |
| rejected | 37 | 0 | 36 | 1 | 30.7d | 24.3d |
| superseded | 11 | 0 | 10 | 1 | 30.7d | 19.8d |

**Subtype breakdown of the 312 pending:**

| Subtype | Pending | Avg conf | Already past expiry |
|---|---:|---:|---:|
| add_keyword | 264 | 0.75 | **108** |
| add_entity | 31 | 0.77 | **10** |
| remove_keyword | 17 | 0.76 | **8** |

**90d reviewed-outcome rate:** 71.5% approval / 28.5% rejection.
**Unreviewed share of inflow:** 68.9%.
**Duplicate rate in pending:** 0% (QR1 cleanup eliminated existing dupes; new ones are blocked by the index).

### B — agent_actions (awaiting_approval only)

| Status | Count | <7d | 7–30d | >30d | Oldest | Avg age |
|---|---:|---:|---:|---:|---:|---:|
| awaiting_approval | **23** | 2 | 21 | 0 | 8.2d | 7.6d |
| executed | 142 | 10 | 131 | 1 | 30.7d | 12.4d |
| rejected | 0 | – | – | – | – | – |

**Subtype breakdown of the 23 pending:**

| Subtype | Pending |
|---|---:|
| propose_severity_correction | 22 |
| notify_oncall_via_slack | **1** ← see §0 |

**90d reviewed-outcome rate (propose tier):** 100% approval / 0% rejection.
**Unreviewed share:** 27.1%.

**0% rejection rate is uninformative** — per the prior validation, this could indicate AI accuracy, blind approval, or only-easy-cases-reviewed. Cannot distinguish.

### C — entity_suggestions

| Status | Count | <7d | 7–30d | >30d | Oldest | Avg age |
|---|---:|---:|---:|---:|---:|---:|
| pending | **260** | 260 | 0 | 0 | 6.1d | 3.5d |
| approved | 55 | 0 | 44 | 11 | 56.0d | 16.7d |
| rejected | 19 | 0 | 9 | 10 | 56.0d | 38.9d |

**Subtype breakdown of the 260 pending:**

| Subtype | Pending | Avg conf |
|---|---:|---:|
| person / signal | 169 | 0.84 |
| person / auto_enrichment | 60 | **0.36** ← speculative noise |
| organization / auto_enrichment | 8 | 0.68 |
| domain / signal | 6 | 0.85 |
| location / auto_enrichment | 5 | 0.54 |
| infrastructure / auto_enrichment | 5 | 0.68 |
| organization / signal | 5 | 0.85 |
| other / signal | 2 | 0.70 |

**90d reviewed-outcome rate:** 74.3% approval / 25.7% rejection.
**Unreviewed share:** 77.8%.
**Duplicate rate WITHIN pending:** **47.7%** (124 of 260 are exact duplicates that collapse to 136 unique).
**Match-existing-entity rate:** **41.2%** (107 of 260 already exist in `entities` for the same tenant).

The 260 pending suggestions effectively represent ~136 unique items, of which ~107 already exist in the graph. Real new-entity content: ~30–50 items.

---

## §2 — Per-Queue Consequence Analysis

### A — monitoring_proposals (LOW consequence)

| Item type | Consequence if approved-wrong | Consequence if ignored 30d |
|---|---|---|
| add_keyword | adds noise to monitor; reversible by remove_keyword in <1 min | keyword not added; client misses some search coverage |
| add_entity | creates entity in graph; reversible by delete | entity not added; intelligence gap if real |
| remove_keyword | drops coverage of a term; reversible by re-add | term stays under monitor |

All three are LOW consequence per the Approval Queue Overload framework (Task #121 §3).

### B — agent_actions — MIXED

| Item type | Consequence if approved-wrong | Consequence if ignored 30d |
|---|---|---|
| propose_severity_correction × 22 | one signal's severity is wrong; reversible | LOW: 22 signals at wrong severity affect downstream feed prioritization; downstream agents reason from stale labels |
| notify_oncall_via_slack × 1 | external Slack ping fires for a stale alert; mild social cost | **HIGH if alert is still relevant** (credential exposure scenario); zero if stale |

The Slack action is the only item in any of the three queues with clear ≥MEDIUM consequence.

### C — entity_suggestions (LOW consequence)

| Item type | Consequence if approved-wrong | Consequence if ignored 30d |
|---|---|---|
| Any suggested_type | wrong entity in tenant graph; reversible by delete + merge | real new entities go un-graphed; active monitoring of new persons-of-interest does not engage |

The downstream cost is **intelligence completeness**, not safety. POIs that should be tracked sit unrepresented.

---

## §3 — A. What Can Be Deleted?

| Target | Count | Why deletable |
|---|---:|---|
| entity_suggestions where suggested_name matches an existing `entities.name` for the same tenant | **107** | Already-decided; no operator decision adds value |
| entity_suggestions exact-duplicates beyond the canonical row in pending | ~63 (after subtracting overlap with match-existing) | Same canonical name extracted multiple times |
| entity_suggestions person/auto_enrichment at conf < 0.4 | ~24 (within the 60 person/auto_enrichment) | Extraction-noise floor; nothing at <0.4 has ever been approved |

Deletion is not the recommended action — moving them to `status='auto_merged'` or `status='rejected'` preserves audit while removing them from operator view. But the same outcome of "operator never sees these again" applies.

---

## §4 — B. What Can Be Merged?

| Target | Method |
|---|---|
| entity_suggestions pending exact-dupes (124 rows → 136 unique) | Pick highest-confidence per (tenant_id, suggested_type, normalized_name); mark others `superseded` with audit note — same deterministic-ranking pattern QR1 used for monitoring_proposals |
| entity_suggestions matching existing entities (107 rows) | Set `status='auto_merged'` + `matched_entity_id=<existing>` (the schema's design intent; QR2 covers this for future writes) |

A merge sweep on these two categories would clear ~170 of the 260 pending entity_suggestions in one transaction.

---

## §5 — C. What Can Expire Automatically?

| Target | Count | Why |
|---|---:|---|
| monitoring_proposals with `expires_at < NOW()` | **126** | All have explicit expires_at set ~7 days post-creation; the expiry job never fired |
| → add_keyword expired | 108 | |
| → add_entity expired | 10 | |
| → remove_keyword expired | 8 | |

**40% of the monitoring_proposals pending queue is already past its designed expiry deadline.** None are MORE than 7 days past expiry (oldest expired ≈ 2026-05-26) — the accumulation is recent. A single SQL UPDATE statement (`UPDATE … SET status='expired' WHERE status='pending' AND expires_at < NOW()`) would clear all 126.

The schema's `expires_at` design exists for exactly this purpose. The job that consumes it does not exist or is not scheduled.

---

## §6 — D. What Requires Human Review?

After applying §3–§5 cleanup:

| Item | Count | Why human-required |
|---|---:|---|
| `notify_oncall_via_slack` (the credential-exposure ping) | **1** | HIGH consequence; external communication; operator-only authority |
| monitoring_proposals add_keyword (not-yet-expired, post-dedup) | ~156 | LOW consequence; in scope for future automation per Task #122 V4 (auto-execute conditional) |
| monitoring_proposals add_entity (not-yet-expired) | ~21 | MEDIUM consequence (entity graph implications) |
| monitoring_proposals remove_keyword (not-yet-expired) | ~9 | LOW consequence but operator-tenant-knowledge required |
| agent_actions propose_severity_correction | 22 | LOW consequence; current schema lacks confidence field per Task #122 (O5 blocked) |
| entity_suggestions (post-merge, post-existing-match) | ~30–50 | Genuine new-entity decisions; operator-required |

After full cleanup, the operator-required surface drops from **595 items today** (312+23+260) to roughly **210–230 items** — a ~60–65% reduction in operator-attention load with zero new decisions made.

---

## §7 — E. What Is Preventing the Queue From Shrinking?

Five distinct blockers, ranked by visible impact:

| # | Blocker | Evidence |
|---|---|---|
| **1** | **Expiry job not running** for monitoring_proposals | 126 of 312 pending are past their `expires_at`; no automated process clears them |
| **2** | **Entity-match-existing not auto-merged** | 107 of 260 entity_suggestions match an existing entity but sit pending; the `matched_entity_id` design intent isn't wired at write time (QR2 addresses this for future writes; backfill for existing pending is separate) |
| **3** | **Pending-queue dedup never runs** | 124 of 260 entity_suggestions are exact dupes; no dedup pass collapses them |
| **4** | **Operator throughput dropped to 0 in last 7 days** | 260 entity_suggestions all <7 days old; 0 reviewed in same window. Same pattern Task #121 surfaced — operator hit attention limit |
| **5** | **AI threat-score enrichment dormant** | 0/334 entity_suggestions have `ai_threat_score` populated; would pre-filter ~24+ noise items if running |

Blocker #1 is mechanical — single SQL UPDATE.
Blockers #2 + #3 are mechanical — single SQL UPDATE/migration each.
Blocker #4 is the systemic constraint (operator attention).
Blocker #5 is pipeline-architectural (separate scope).

---

## §8 — The 30-Day No-Action Question

> *If Aaron took no action for 30 days, what negative consequences would occur?*

Honest answer by category:

### Real, named operational consequences

| # | Consequence | Severity |
|---|---|---|
| 1 | **The credential-exposure Slack ping** (notify_oncall_via_slack from 2026-05-23) never fires for the duration. If the credential is still exposed and being exploited, this is a real intelligence-gap defect. If already remediated by Petronas through other channels, zero impact. | HIGH if active; UNKNOWN until verified |
| 2 | 22 severity corrections stay unapplied; signals continue at original severity. Downstream agents reason from stale labels. Customer-visible signals may appear in feeds at higher priority than the AI thinks warranted. | LOW (noise; correctable later) |
| 3 | Real new persons-of-interest emerging in signals don't enter the entity graph; active monitoring for them doesn't engage; intelligence gap for the duration | LOW–MEDIUM (intelligence completeness) |
| 4 | No keyword/source rule changes get applied; client `monitoring_keywords` lists stay static for 30 days; coverage drift if the threat environment changes meaningfully | LOW (existing coverage works; missing new coverage) |

### Queue growth (the visible cost)

At current inflow rates:

| Queue | Today | Day 30 (estimate at current rate) |
|---|---:|---:|
| monitoring_proposals pending | 312 | ~600–800 (assuming ~155/wk inflow continues; minus QR1-blocked dupes) |
| agent_actions awaiting_approval | 23 | ~35–50 |
| entity_suggestions pending | 260 | ~1,300–1,500 |
| **Combined operator-decision surface** | **595** | **~1,900–2,300** |

The queue would grow ~3–4× without intervention. Most of the growth would be in entity_suggestions (the largest inflow). After 30 days, the operator-attention debt grows from ~3 hours/week to ~5–7 hours/week.

### Customer-visible failures

**Zero.** No customer (Petronas Canada, etc.) experiences a visible degradation from queue stagnation directly. The signals pipeline, dashboards, daily briefings, and active monitors all continue operating on whatever was in `clients.monitoring_keywords` and `entities` at T+0.

### Data loss

**Zero.** Every pending item persists. The decisions can be made at day 30 with the same fidelity as day 0 (modulo CRUCIBLE re-proposing things in the meantime — which QR1 now blocks for keywords).

### The honest summary

The 30-day no-action cost is:

1. **One named alert that may have real downside** (the credential-exposure Slack ping)
2. **Operator-attention debt that grows ~3–4×** before reaching the surface
3. **Intelligence completeness drift** on new persons-of-interest from the last 7 days of signals
4. **No catastrophic failure modes**

If forced to triage, the single action with non-trivial real-world consequence is reviewing the `notify_oncall_via_slack` alert. Everything else is recoverable later at the cost of operator time.

---

## §9 — Doctrine Alignment

| Doctrine | This assessment honored |
|---|---|
| Operator attention is critical infrastructure | Quantifies how much current queue depth is *real* operator work vs *cleanable* overhead (~60–65% is cleanable) |
| In peace time, improve your fighting position | The 30-day question proves peacetime — no fire is burning; this is the moment to fix the expiry/match/dedup mechanics |
| Address generation before approval | All three blockers #1–#3 are generation-side fixes |
| Measure before and after every intervention | Numbers in §1 form the baseline; any cleanup intervention will re-measure these |
| Confidence is not correctness | 100% approval rate on severity corrections is uninformative; not used as evidence here |
| Prefer defensive layers before prompt tuning | Not applicable here — this is a backlog cleanup question, not a generation-quality question |
| Measurability is part of the feature | §1's data IS the feature's measurement; same metrics can re-run after any cleanup intervention |
| No persistence without named consumer | n/a (no new persistence proposed) |

---

## §10 — Held / Out of Scope

Per operator directive (focus = QR1 observation):

- No QR3, EX-1, or Campaign 1 implementation begun
- No cleanup actions taken — diagnosis only
- No forecasts about QR1 outcomes
- No new tasks created beyond Task #131

The cleanup actions implied by §3–§5 are operator decisions, not commitments. The numbers and the 30-day-cost answer are the measured outcomes the operator asked for.

---

## §11 — Final Reading

The three queues today hold 595 items. After mechanical cleanup (§3 + §4 + §5), 365 of those (~61%) can be resolved without operator decisions:

- **126** monitoring_proposals via expiry sweep
- **107** entity_suggestions via match-existing auto-merge
- **63** entity_suggestions via pending-queue dedup
- **24** entity_suggestions via low-conf-auto_enrichment filter
- **+45** estimated overlap discount (some items counted in two categories)

The genuine operator-decision residue is ~210–230 items, of which:
- **1** is HIGH consequence (the Slack ping)
- **22** are agent severity corrections (blocked from auto-execute by missing confidence field per Task #122)
- **~30–50** are real new entities
- **~150** are LOW-consequence keyword proposals (future auto-execute candidates per Task #122 alternative paths)

If Aaron does nothing for 30 days, the system survives. The single tactical loss is the Slack ping (which may be a non-issue). Everything else is recoverable operator-attention debt.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
