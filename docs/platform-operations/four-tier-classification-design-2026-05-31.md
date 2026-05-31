# Four-Tier Classification Design — Mapping All Alert-Generation Pathways

**Operator-directed 2026-05-31 (Task #143).** Read-only design assessment per ratified doctrine *"Protect Attention Like Critical Infrastructure"* and accepted operator decisions:

- **AV.1 — Accepted in principle:** four-tier hierarchy (LOG / FINDING / NOTIFICATION / INTERRUPTION)
- **AV.3 — Accepted:** no Teams/Slack/SMS wiring until classification ships

No implementation. No configuration changes. No channel activation. Assessment only.

---

## §0 — Most Important Question Answered

> *How should existing alert-generation pathways be mapped into the four-tier hierarchy?*

**See §3 master classification table.** Of 22 identified pathways, the proposed distribution:

| Tier | Pathway count | % of generators | Daily volume estimate |
|---|---:|---:|---:|
| **LOG** | 12 | 55% | Unbounded (telemetry, audit) |
| **FINDING** | 6 | 27% | ~3-8/day reaching operator review queue |
| **NOTIFICATION** | 2 | 9% | ~1-3/business-day push |
| **INTERRUPTION** | 2 | 9% | ~0-2/day, peak ~5 during incidents |

The current implementation effectively conflates these into one tier ("alert"). The classification design is the most consequential lever for closing the gap between the operator's lived experience (notification fatigue) and the system's stated function (preserve decision space).

---

## §1 — Classification Methodology

For each pathway, apply the five-step doctrinal filter from `feedback_protect_attention_like_critical_infrastructure.md`:

1. **What decision is expected?** If none → not a notification at all (LOG).
2. **What action is expected?** If none-immediate → not interruption-tier (FINDING at most).
3. **What happens if ignored?** Maps to consequence-class (LOW/MEDIUM/HIGH/CRITICAL).
4. **Volume × consequence:** if a pathway would fire interruption-tier 100×/month, it's miscategorized.
5. **Mute test:** if the operator would mute this channel after a week, the design violates the doctrine.

The tier mapping is **consequence × time-sensitivity**, not severity-label-alone:

| Consequence-class | Time-sensitive? | Tier |
|---|---|---|
| LOW (no material outcome) | n/a | LOG |
| LOW-MEDIUM (delayed review acceptable) | hours-days | FINDING |
| MEDIUM-HIGH (same-business-day matters) | same business day | NOTIFICATION |
| HIGH-CRITICAL (minutes matter for preserving options) | minutes-hours | INTERRUPTION |

---

## §2 — Empirical Reference Data (Prod, 2026-05-31)

### Current operator-facing queue stocks

| Surface | Open count | Last 30d new | Health |
|---|---:|---:|---|
| `platform_findings` | 9 | 82 | Active; ~3/day creation rate |
| `agent_actions` awaiting | 23 | n/a | Stale (avg 7.5d) |
| `entity_suggestions` pending | 261 | n/a | Severe overload (Task #131) |
| `monitoring_proposals` pending | 312 | n/a | Severe overload (QR1 addresses going forward) |
| `alerts` failed (backlog) | 13,868 | (active gen) | 100% failed since 2025-10-03 |
| `agent_pending_messages` (chat) | 167 | **0** | **Chat-push pipeline has stopped writing** |
| `incidents` open | 69 | 69 | All last 30d (high recent activity) |

### Cron pathway frequencies (30d runs vs expected)

| Pathway | Schedule | Expected 30d | Actual 30d | Status |
|---|---|---:|---:|---|
| `proactive-intelligence-push-15min` | every 15 min | ~2,880 | 350 | **Sub-firing** (12% of expected) |
| `send-daily-briefing-13utc` | daily | 30 | **4** | **Sub-firing** (13% of expected) |
| `system-watchdog-daily` | daily | 30 | **6** | **Sub-firing** (20% of expected) |
| `autonomous-operations-loop-15min` | every 15 min | ~2,880 | **0** | **DISABLED or broken** |
| `alert-delivery-2min` | every 15 min* | ~2,880 | **0** | No heartbeats |

These sub-firing rates reveal **multiple silent-execution failures** that compound the broader attention-architecture problem. They are not in scope for this assessment but are flagged in §8.

---

## §3 — Master Classification Table

All 22 identified alert-generation pathways, classified.

### TIER 1 — LOG (12 pathways)

Persistent storage; no operator surface; queryable on demand.

| # | Pathway | Type | Current state | Why LOG |
|---|---|---|---|---|
| L1 | `function_telemetry` | Telemetry table | Existing | Per-call observability; consumed by debugging, not decisions |
| L2 | `cron_heartbeat` | Heartbeat table | Existing | Health monitoring substrate; consumed by watchdog |
| L3 | `audit_events` | Audit trail | Existing | Compliance / forensic record; never operator-facing |
| L4 | `edge_function_errors` | Error log | Existing | Diagnostic; watched in aggregate by watchdog |
| L5 | `aegis_request_trace` / `aegis_retrieval_trace` / `aegis_prompt_trace` / `aegis_tool_trace` | Flight Recorder | Existing (PR #25/#26) | Chain-of-custody replay; operator-pulled only |
| L6 | `aegis_decision_threshold_trace` | R1.0 audit | Existing | Decision-layer observability; not yet behavioral |
| L7 | `aegis_grounding_trace` | Grounding audit | Existing | Per-claim provenance log |
| L8 | `aegis_tool_calls` | Tool-invocation log | Existing | Audit only |
| L9 | `aegis_claim_confidence` | Append-only confidence snapshots | Existing | Workstream D substrate; operator-pulled |
| L10 | `autonomous_actions_log` | Autonomous-action history | Existing | UI history view; not push-notified |
| L11 | **Strategic Intelligence Alerts** `[LOW] reputational-risk` from `ai-decision-engine` | Currently emits to `alerts` table | **Currently miscategorized as INTERRUPTION-tier output** | **No decision is expected. No action is expected. Ignoring has no consequence. Volume 11,914/year is 86% of all alerts. Textbook LOG content.** |
| L12 | `aegis_invocations` | Aegis-call audit | Existing | Telemetry only |

**The most consequential reclassification in this table is L11** — moving the 86%-of-volume "Strategic Intelligence Alert" stream from interruption-tier-by-fan-out to LOG-only. This single change rights-sizes the entire alert pipeline.

### TIER 2 — FINDING (6 pathways)

Operator-pull queue; reviewed during dedicated review window; no push.

| # | Pathway | Type | Current state | Why FINDING |
|---|---|---|---|---|
| F1 | `platform_findings` (system-watchdog) | Findings table; Neural Constellation UI | Existing | Operator-pulls when reviewing system health; not push-notified |
| F2 | `agent_actions` (propose tier) — severity corrections, false-positive flags, dismissals | Approval queue | Existing | Decisions expected but not time-sensitive; queue review |
| F3 | `entity_suggestions` pending | Approval queue | Existing | Operator decides; not time-sensitive |
| F4 | `monitoring_proposals` pending | Approval queue | Existing | Operator decides; not time-sensitive |
| F5 | `verification_tasks` pending (C.4 Commitment Review) | Verification queue | Existing schema; pipeline emitting | Reliability-First substrate; operator-pulled |
| F6 | **Strategic Intelligence MEDIUM** — `[MEDIUM] *` AI Decision Engine emails | Currently fan-out push | **Reclassify from push to FINDING** | Decision possibly expected ("should I look into this?") but not time-sensitive; operator decides during daily/weekly review |

### TIER 3 — NOTIFICATION (2 pathways)

Slack/Teams push (no SMS, no oncall page). Same-business-day awareness.

| # | Pathway | Type | Current state | Why NOTIFICATION |
|---|---|---|---|---|
| N1 | **`send-daily-briefing`** (Resend email) | Daily intelligence product | Existing — sub-firing 13% of expected | The daily briefing IS the operator's primary intelligence push. Designed-for-and-by the operator. Already a single daily artifact (one ping, predictable cadence). |
| N2 | **Strategic Intelligence HIGH** — `[HIGH] active_threat / wildfire / malware / sabotage` (non-physical) | Currently fan-out push | **Reclassify**: route to a daily-briefing "watch list" section OR a per-business-day Slack ping | Decision expected: "real / actionable / for which client?" Same-business-day operator-visible. NOT SMS-worthy. |

### TIER 4 — INTERRUPTION (2 pathways)

Teams + Slack + SMS + oncall page. Response in minutes.

| # | Pathway | Type | Current state | Why INTERRUPTION |
|---|---|---|---|---|
| I1 | **`notify_oncall_via_slack` agent_action** (operator-approved) | Currently propose-tier action | Existing | Designed-for-interruption; rare; gated by operator approval today |
| I2 | **`alert-delivery-secure` for CRITICAL or HIGH operational-physical-safety** | Currently broken (Task #141) | Reclassify: fire only for `priority='p1'` AND (active fire near facility ∨ active sabotage ∨ confirmed credential exposure) | Time-sensitive, customer-visible, preserving-options requires minutes-scale action |

### NOT YET CLASSIFIED — Pathways requiring further design (3)

| # | Pathway | Why deferred |
|---|---|---|
| ? | `proactive-intelligence-push` (every-15-min cron) | Volume 12/day intended; currently sub-firing 12% (= ~1.5/day actual). Writes to `agent_pending_messages` (chat surface). Unclear if it should be LOG (chat history), FINDING (operator-pulled chat insight), or NOTIFICATION (push). Needs separate decision. |
| ? | `incident-manager` (signal → incident promotion) | Creates incident DB rows. Whether incident creation itself is a notification surface depends on what consumes the `incidents` table for push. Today: none. Tomorrow: TBD. |
| ? | `auto-orchestrator` + `autonomous-operations-loop` | Currently zero runs in 30d (DISABLED or broken). Latent pathway. Reclassify when re-enabled. |

---

## §4 — Per-Pathway Decision/Action/If-Ignored Matrix

For the pathways most likely to require operator-decision-level review:

### L11 — Strategic Intelligence Alerts (`[LOW] reputational-risk`)

| Question | Answer |
|---|---|
| **Decision expected?** | None |
| **Action expected?** | None |
| **What happens if ignored?** | Nothing material. Reputational atmospherics; awareness item at best. |
| **Recommended tier** | **LOG** — store in `strategic_intelligence_log` view; queryable on demand; no push, no FINDING queue |
| **Volume** | 11,914 over 8 months = 86% of all generated alerts |
| **Rationale** | The content is AI-generated analysis using pattern detection across 20 recent signals. By the writer's own self-classification (`priority='P4'`, `threat_level='LOW'`), it is awareness content. Sending it as an alert violates principle 2 (no interruption without a decision). |

### F1 — platform_findings (system-watchdog)

| Question | Answer |
|---|---|
| **Decision expected?** | "Investigate or accept?" (e.g., agent-enrichment-coverage low → investigate pipeline) |
| **Action expected?** | Diagnosis + remediation; not time-sensitive (24h-grade) |
| **What happens if ignored?** | Silent regressions accumulate; eventually a real failure surfaces |
| **Recommended tier** | **FINDING** — current behavior is correct (operator-pull via Neural Constellation UI) |
| **Volume** | 82 in 30d (~3/day creation rate) |
| **Note** | The DAILY EMAIL summary that operator stopped reading (per their observation) is over-pushed at NOTIFICATION-tier. Recommend: remove the email; rely on UI surface. |

### F2 — agent_actions (propose tier)

| Question | Answer |
|---|---|
| **Decision expected?** | "Approve or reject?" for severity-correction / false-positive / dismiss |
| **Action expected?** | Operator approves; system executes |
| **What happens if ignored?** | After 24h, eligible for `auto_approve_safe_actions()` (when fixed per Task #132) |
| **Recommended tier** | **FINDING** — operator-pull; not push; auto-approve provides safety net |
| **Volume** | 23 currently awaiting; ~2-3/week new |

### F6 — Strategic Intelligence MEDIUM

| Question | Answer |
|---|---|
| **Decision expected?** | "Should this be on the watch list?" |
| **Action expected?** | Optional: add entity/keyword to monitoring; flag for further analysis |
| **What happens if ignored?** | Pattern data continues to accumulate; possibly missed early warning over weeks |
| **Recommended tier** | **FINDING** — accumulate to daily-briefing "watch list" section OR a low-priority operator-pull surface |
| **Volume** | ~937/year MEDIUM + ~600/year other = ~1,500/year = ~4/day |

### N1 — Daily Briefing

| Question | Answer |
|---|---|
| **Decision expected?** | "Is there anything in today's intelligence that needs my action?" |
| **Action expected?** | Read; possibly act on REQUIRED-tier items (per Decision Frame doctrine) |
| **What happens if ignored?** | Operator falls behind on situational awareness; real REQUIRED items may sit |
| **Recommended tier** | **NOTIFICATION** — single daily email at consistent time; predictable cadence; aligned with Decision Frame doctrine |
| **Volume** | 1/day designed; currently 4/30d = sub-firing |
| **Note** | The Decision Frame work (F.0 plan) will make this briefing more decision-actionable; the operator's chosen primary intelligence product |

### N2 — Strategic Intelligence HIGH (non-physical-safety)

| Question | Answer |
|---|---|
| **Decision expected?** | "Real / actionable / for which client?" |
| **Action expected?** | Operator review same business day; possibly incident creation or client coordination |
| **What happens if ignored?** | Real risk if missed >24h on active threat items |
| **Recommended tier** | **NOTIFICATION** — Slack/Teams push during business hours (no SMS, no oncall) |
| **Volume** | ~250/year HIGH = ~1-2/business-day across all clients |

### I1 — notify_oncall_via_slack (agent_action)

| Question | Answer |
|---|---|
| **Decision expected?** | Operator approves the agent's proposal to page oncall |
| **Action expected?** | Approval → Slack ping fires |
| **What happens if ignored?** | The credential-exposure case (Task #132) — silent 8-day delay; real threat goes unactioned |
| **Recommended tier** | **INTERRUPTION** — but the AGENT'S PROPOSAL is a FINDING-tier event that creates an interruption-tier output when operator approves |
| **Volume** | Rare (1 in current backlog over months) |

### I2 — alert-delivery-secure for CRITICAL operational-physical-safety

| Question | Answer |
|---|---|
| **Decision expected?** | "Confirm and respond to the real-world event" |
| **Action expected?** | Operator engages client + emergency response; minutes-scale |
| **What happens if ignored?** | Real safety incident; customer-visible failure |
| **Recommended tier** | **INTERRUPTION** — Teams + Slack + SMS + oncall page |
| **Volume** | ~50-300/year (CRITICAL category, properly filtered) |

---

## §5 — How to Codify the Tiers

The classification needs to live somewhere. Five options ranked by invasiveness:

### Option A — Generator-side decoration (LIGHTWEIGHT, RECOMMENDED FIRST)

Each generator function annotates the row it writes with a `tier` field:

```typescript
// In ai-decision-engine, when writing the alerts table:
await supabase.from('alerts').insert({
  // ... existing fields ...
  tier: 'log',  // NEW
  classification_reason: 'LOW reputational-risk; awareness only',  // NEW (optional)
});
```

- **Schema change:** add `tier text` column to `alerts` (+ to `platform_findings`, `agent_pending_messages`, etc.)
- **Allowed values:** `'log' | 'finding' | 'notification' | 'interruption'`
- **CHECK constraint** enforces the value set
- **Migration backfill:** default existing rows to `'log'` (the most conservative); update specific generators to write the right tier going forward

**Pros:** minimal change; doctrine-aligned (Provenance + Measurability); easy to query for tier-distribution metrics.

**Cons:** trust placed in each generator to classify correctly — needs governance.

### Option B — Centralized router (heavier, follow-on)

A single `_shared/alert-router.ts` function takes a "raw alert intent" and returns the tier + the routing decision. All generators call this router instead of writing directly.

- **Pros:** central policy; easy to retune
- **Cons:** much bigger refactor; every generator changes

### Option C — Tier resolved at delivery time (DEFERRED to Phase 2)

Delivery functions (`alert-delivery`, `alert-delivery-secure`, future Slack-pinger) inspect the row's content and decide the tier on egress.

- **Pros:** no generator-side change
- **Cons:** classification logic duplicated across egress paths; harder to evolve

### Option D — Severity-class lookup table

Add a `tier_policy` table mapping (`category` × `severity_label` × `client_id`) → `tier`. Egress paths consult the table.

- **Pros:** per-tenant policy possible
- **Cons:** another lookup, another consistency surface

### Option E — Implicit by writer-target (NO-OP, accept current state)

Don't add a tier column. Instead, the writer's target table implies the tier:
- Write to `platform_findings` → FINDING
- Write to `alerts` → INTERRUPTION (or NOTIFICATION)
- Write to `function_telemetry` → LOG

**Pros:** no schema change
**Cons:** the current 13,868 backlog proves this doesn't work — `alerts` is being used for LOG-tier content

### Recommendation: Option A + a small migration

The right minimum design is:
1. Add `tier text` column to `alerts`, `platform_findings`, and `agent_pending_messages` (the three operator-surface tables)
2. CHECK constraint on allowed values
3. **Default `'log'`** for existing rows (most conservative; current 13,868 backlog becomes LOG-tier — no longer an "alert" deserving any push)
4. Update `ai-decision-engine` and other writers to set the right tier going forward
5. Egress functions (`alert-delivery-secure`, future Slack pinger) read the tier and gate behavior

**This is doctrine-aligned:** the tier is explicit, measurable, non-bypassable (CHECK constraint), and queryable. It's the "Measurability is part of the feature" principle applied to alert classification.

---

## §6 — Migration Roadmap (Description Only; No Authorization)

Six steps, smallest first. Each is operator-decision-gated.

| Step | What | Effort | Effect |
|---|---|---|---|
| **C-0** | Migration: add `tier text` column + CHECK constraint to `alerts`, `platform_findings`, `agent_pending_messages`. Default `'log'`. | 30 min | Schema substrate in place; zero behavioral change yet |
| **C-1** | Update `ai-decision-engine` to set `tier='log'` for `[LOW] reputational-risk` writes; `tier='finding'` for MEDIUM Strategic Intel; `tier='notification'` for HIGH non-physical; `tier='interruption'` for CRITICAL + HIGH operational | 2-4h | Future writes correctly classified |
| **C-2** | Update `alert-delivery-secure` to gate by `tier` — only attempt Teams/Slack/SMS for `tier IN ('notification', 'interruption')`; LOG/FINDING tiers skip channel attempts entirely | 1-2h | Egress respects classification; LOG content stops creating delivery failures |
| **C-3** | Backfill: classify existing 13,868 alerts table rows by subject pattern (`[LOW] reputational-risk` → log; `[HIGH] active_threat` → notification; etc.) | 1h | Historical data correctly tier-annotated; reporting becomes meaningful |
| **C-4** | Update P1.4 watchdog check to filter `WHERE tier IN ('notification', 'interruption')` — stop counting LOG tier failures against the SLA | 30 min | Watchdog stops complaining about LOG content failing to deliver (correct — LOG shouldn't deliver) |
| **C-5** | Daily-briefing integration: a section listing recent `tier='finding'` items (the operator-pull surface) | half-day | Findings become operator-visible without push |

**Total effort: ~1-1.5 days of work to fully codify the four-tier model.** No new tables. No new persistence surfaces. Uses existing `intelligence_config` for any per-tenant overrides.

---

## §7 — The 10x Question Revisited

> *If Fortress became 10x larger tomorrow, would this notification model preserve operator attention or destroy it?*

### Current model (pre-classification)

- LOW-priority strategic intelligence emits at ~50/day per client
- 10 clients × 50/day × 6 recipients fan-out = 3,000 push events/day
- Even if 90% are filtered, that's 300 INTERRUPTION-class events/day reaching the operator
- **Operator capacity: ~10-20 decisions/day**
- **Result: 15-30× over capacity. Channels muted within a week. Doctrine violated.**

### Post-classification model (4-tier)

- LOW → LOG: zero push regardless of volume → 0 operator events
- MEDIUM → FINDING: queue review; ~10/day × 10 clients = 100/day in queue, reviewed in batches → ~1 operator review session/day
- HIGH → NOTIFICATION: ~1-2/business-day per client × 10 clients = 10-20 Slack/Teams pings/day → ~15 events
- CRITICAL → INTERRUPTION: ~0.1-0.3/day per client × 10 clients = 1-3 oncall pages/day → ~2 events
- **Operator capacity required: ~15-20 decisions/day**
- **Result: matches capacity. Channels stay trusted. Doctrine honored.**

### The key insight

Notification volume scales as `clients × (tier rate per client)`. The only way to make this sustainable at 10x scale is to **drop the per-client volume by 10x** through aggressive classification. Putting 86% of generated content into LOG-tier accomplishes exactly that.

**The four-tier model is the only model that scales linearly in clients while staying constant in operator burden.**

The current model scales linearly in client count for notification VOLUME but operator capacity is constant — at 10x scale, the system becomes structurally unusable.

---

## §8 — Surfaced Side-Findings (NOT in classification scope)

The inventory work surfaced silent execution failures that are not classification problems but should be operator-visible. Reported here for awareness; remediation is separate:

| Pathway | Issue | Severity |
|---|---|---|
| `autonomous-operations-loop-15min` | **0 runs in 30d** despite 15-min cron schedule. Disabled or completely broken. | HIGH (Tier 4 mission-critical loop offline) |
| `send-daily-briefing-13utc` | Only **4 runs in 30d** (expected 30). 13% firing rate. | HIGH (operator's primary intelligence product mostly silent) |
| `system-watchdog-daily` | Only **6 runs in 30d** (expected 30). 20% firing rate. | HIGH (mission-success monitor mostly silent) |
| `proactive-intelligence-push-15min` | Only **350 runs in 30d** (expected ~2,880). 12% firing rate. | MEDIUM |
| `alert-delivery-2min` | **0 heartbeats in 30d**. May not be writing heartbeats, OR may not be running. | UNKNOWN |
| `agent_pending_messages` | **0 new rows in 30d** despite `proactive-intelligence-push` partially firing | MEDIUM (chat-push pipeline broken downstream) |

These are W-MISSION Phase 2 candidates. **The current Phase 1 doesn't cover them** — Phase 1 covers `auto_approve`, `monitor-news-google`, `stuck-running`, undispatched alerts, quarantine spike. Add to the W-MISSION roadmap when scoping Phase 2.

---

## §9 — Doctrine Alignment Check

| Doctrine | This design honors it because… |
|---|---|
| **Protect Attention Like Critical Infrastructure** | Codifies the 4-tier hierarchy with explicit CHECK constraint enforcement; classification is non-bypassable |
| Every notification spends trust | LOG tier produces zero notifications; trust is preserved |
| No interruption without a decision | Interruption-tier requires "what decision is expected" filter to pass |
| No decision without consequence | Finding-tier requires "what happens if ignored" filter to pass |
| Silence is acceptable; noise is not | LOG is silent by design |
| Escalate only when preserving options requires action | Interruption-tier explicitly time-sensitive |
| Attention preservation is a security function | The 13,868-row backlog IS the security failure — the operator stopped reading the channel; codifying the tier prevents that pattern |
| Address generation before approval | The classification is at GENERATION time (Option A) — generators decide tier; delivery respects it |
| Confidence is not correctness | Tier is determined by consequence-class, not AI confidence score |
| Measurability is part of the feature | `tier` column makes per-tier volume queryable; reporting becomes possible |
| No persistence without named consumer | The `tier` column has named consumers: `alert-delivery-secure` (egress gate), watchdog (per-tier monitoring), daily-briefing (FINDING aggregation) |

Every ratified doctrine predicts this design.

---

## §10 — Operator Decision Surface

Codification design only; no implementation. Operator decisions:

| # | Decision | Recommendation |
|---|---|---|
| **TC.1** | Approve Option A (generator-side `tier` column) as the codification mechanism | YES |
| **TC.2** | Approve the master classification in §3 (the 22-pathway tier mapping) | YES — flag any specific reclassifications |
| **TC.3** | Authorize C-0 migration (schema substrate only; zero behavioral change) | recommend GO when ready |
| **TC.4** | Authorize C-1 through C-5 in sequence (writer updates + egress gate + daily-briefing integration) | recommend stepwise GO |
| **TC.5** | Accept Strategic Intelligence Alerts → LOG-tier reclassification (L11 — the 86% of volume) | YES — this is the load-bearing reclassification |
| **TC.6** | Defer Tier-A channel-wiring (Task #141) until C-1 and C-2 ship | reaffirms AV.3 |
| **TC.7** | Treat §8 side-findings (silent cron failures) as W-MISSION Phase 2 candidates | recommend separate scoping |
| **TC.8** | Remove the daily watchdog email summary (the one operator stopped reading); rely on Neural Constellation UI for findings | recommend (matches operator's revealed preference) |

---

## §11 — Honest Limits

| Gap | Impact |
|---|---|
| Caller-side audit of `ai-decision-engine` not completed | The exact set of subjects/categories needs verification before C-1 backfill rules ship |
| Per-tenant tier-policy overrides not designed | Different clients may want different LOW/HIGH thresholds; this design assumes uniform policy. Per-tenant comes later if needed. |
| Time-of-day routing not designed | "Same business day" interpretation depends on operator timezone; CRITICAL during business hours vs after-hours differ. Out of scope for this assessment. |
| Tier escalation paths not designed | If a FINDING ages without operator review, should it auto-promote to NOTIFICATION? Out of scope. |
| Migration cost for historical 13,868-row reclassification | Could be done in C-3 as one bulk UPDATE; not specified per-rule yet |

These don't block the core design. They're follow-up scoping items.

---

## §12 — Constraints Honored

- Assessment only — no code, no configuration changes, no channel activation
- AV.3 reaffirmed: no Teams/Slack/SMS wiring
- No backlog cleanup
- No alert-generation pipeline changes
- W-MISSION Phase 1 GREEN; QR1 observation continues on schedule
- 12 ratified doctrines in memory; this design honors all of them

---

## §13 — Final Statement

The current model treats "alert" as a single tier. The operator's lived experience (muted notifications, ignored watchdog emails) is the evidence that this model is structurally broken.

The four-tier model — codified via a single `tier` column with CHECK enforcement — is the **smallest possible change that makes attention preservation a property of the system, not a property of operator self-discipline.**

The 86% of generated content reclassified from "alert" to "LOG" is the single biggest lever. After that change, every other pathway falls naturally into place.

**Classification before delivery. The operator's instinct was correct.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
