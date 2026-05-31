# Watchdog Email — Exception-Only Delivery Assessment

**Operator-directed 2026-05-31 (Task #145).** Assessment only. No implementation. No configuration changes.

Operator constraint: do NOT remove watchdog email outright. Convert to exception-only delivery: new critical findings, severity escalations, long-lived unresolved critical findings.

Doctrine basis: *Protect Attention Like Critical Infrastructure*. Preserve operator attention while maintaining awareness.

---

## §0 — Current State

The `system-watchdog-daily` cron emails `ak@silentshieldsecurity.com` every day at 13:00 UTC with a comprehensive findings report covering:
- Cron health
- Behavioral health (4 phases)
- Mission health (new in Phase 1)
- Open `platform_findings`
- Recurring issues
- Per-agent activity

**Operator-observed result:** "I stopped reading Watchdog emails for the same reason" (attention exceeded value).

### 30-day findings distribution (prod, 2026-05-31)

| Category | Severity | Total in 30d | Currently open | Open >24h | New in last 24h |
|---|---|---:|---:|---:|---:|
| behavioral_health | medium | 33 | 3 | 3 | 0 |
| behavioral_health | high | 27 | 2 | 1 | 2 |
| QA Tests | critical | 7 | 0 | 0 | 0 |
| security | high | 4 | 0 | 0 | 0 |
| Bug Reports | warning | 4 | 0 | 0 | 0 |
| mission_health | critical | 3 | 3 | 0 | 3 |
| Signal Pipeline | critical | 2 | 0 | 0 | 0 |
| mission_health | high | 1 | 1 | 0 | 1 |
| Agent Learning | critical | 1 | 0 | 0 | 0 |

**Pattern:** most findings auto-resolve within 24h. Only ~9 findings remain open at any moment. The daily email reports ALL of them every day regardless of whether they're new or changed.

### Why the operator muted it

- Every email reports the same chronic findings ("Tier-2 review gap: 67% reviewed") repeated daily
- New events (e.g., 3 new mission_health criticals today) are buried in the recap of resolved + chronic items
- The signal-to-noise ratio is poor: 90% recap, 10% new content
- No notification when something changes; same content most days

This is the *Every notification spends trust* principle in action — daily-same-content burns the channel.

---

## §1 — Proposed Exception-Only Model

### Three trigger conditions (any one fires the email)

| # | Trigger | Rationale |
|---|---|---|
| **T-NEW** | One or more NEW critical findings in the last 24h | New = `first_seen_at > NOW() - 24h`; high-consequence + time-relevant |
| **T-ESC** | Severity ESCALATION on any finding in last 24h (warning→high, high→critical) | Same fingerprint, severity bumped — meaningful state change |
| **T-LONG** | Long-lived unresolved critical (open > 7 days AND still critical) | Operator may have missed it; weekly re-surface to prevent oversight |

If **none** of the three trigger conditions hold: send NOTHING. The daily run still happens (watchdog continues writing findings to `platform_findings`); just no email goes out.

### What the exception email contains

A focused subject + body covering ONLY the triggered findings:

#### Email shape (proposed)

**Subject pattern:**
```
[Fortress] {N} new critical · {M} escalated · {K} long-lived unresolved
```
e.g., `[Fortress] 3 new critical · 0 escalated · 1 long-lived unresolved`

If subject is `[Fortress] 0 new · 0 escalated · 0 long-lived` → email is NOT sent (assertion).

**Body sections (each conditional):**

```
═══════════════════════════════════════════
NEW CRITICAL FINDINGS (3)
═══════════════════════════════════════════
[mission_health/critical] auto_approve_safe_actions: 0 approvals in 24h while 22 eligible actions await
  First seen: 2026-05-31 18:18 UTC
  Action: Investigate auto_approve_safe_actions predicate (broken INNER JOIN).
  Link: <dashboard URL with finding ID>

[mission_health/critical] stuck-running: monitor-github-6h has 14 invocation(s) running > 10 min
  First seen: 2026-05-31 18:18 UTC
  Action: Reset stuck rows; investigate function hang.

[mission_health/critical] alert-delivery: 1000 undispatched alert(s) older than 30 min
  First seen: 2026-05-31 18:18 UTC
  Action: See Task #141 remediation assessment.

═══════════════════════════════════════════
SEVERITY ESCALATIONS (0)
═══════════════════════════════════════════
(none)

═══════════════════════════════════════════
LONG-LIVED UNRESOLVED CRITICAL (1)
═══════════════════════════════════════════
[behavioral_health/high] Tier-2 review gap: only 33% of eligible signals reviewed
  Open since: 2026-05-24 (7 days, 4 occurrences)
  Status: chronic; not in current investigation scope
  Action: Awareness only; remediation tracked separately.

═══════════════════════════════════════════
Watchdog run: 2026-05-31 13:00 UTC
Total findings open: 9 | All findings: <dashboard URL>
This email is exception-only. No new actionable events = no email.
═══════════════════════════════════════════
```

**Properties:**
- Each section has an explicit count in the header — operator sees "(0)" at a glance for empty sections
- Each finding includes: severity, category, title, age, action, link
- Footer reminds the operator: silence = no actionable events (no email anxiety about "did I miss one")

### What gets logged vs notified

| Class | What happens |
|---|---|
| Chronic findings (Tier-2 review gap, etc.) | Continues writing to `platform_findings`; visible in Neural Constellation UI; **NOT emailed** unless they cross the long-lived-critical threshold |
| Auto-resolved findings (e.g., behavioral_health medium that clears in <24h) | Logged; never emailed |
| Resolution events (a critical clears) | Logged; **NOT emailed** (no decision required) |
| New criticals | Logged + emailed (T-NEW) |
| Escalations | Logged + emailed (T-ESC) |
| Long-lived unresolved critical (>7d) | Logged + emailed weekly (T-LONG) |

The Neural Constellation UI remains the comprehensive operator-pull surface. Email becomes the exception-only push.

---

## §2 — Projected Email Volume Under Exception-Only Model

Based on the 30-day historical data:

| Trigger | Historical occurrence rate |
|---|---|
| T-NEW (new critical/24h) | 3 mission_health critical in past 24h. Pre-Phase-1, rate was much lower. Estimated steady-state: ~1 critical/week |
| T-ESC (escalation/24h) | Data not directly available; severity-bump tracking isn't recorded today. Conservative estimate: ~1-2/month |
| T-LONG (long-lived/weekly) | 1-3 chronic findings could qualify weekly (Tier-2 review gap is the obvious one) |

**Estimated email frequency under exception-only model:** ~2-4 emails per week (steady-state), down from ~7 per week (daily) — a 50-70% reduction in volume with a 10× increase in signal density.

**Days with zero email:** ~40-50% of days (most days have no new critical, no escalation, no new long-lived hits its weekly anniversary).

---

## §3 — How Each Trigger Maps to the Doctrine

| Principle | T-NEW | T-ESC | T-LONG |
|---|---|---|---|
| Every notification spends trust | New critical = high refund (operator was likely unaware) | Escalation = high refund (state changed) | Long-lived = small refund (operator may have missed; weekly cadence respects fatigue) |
| No interruption without a decision | Decision: investigate / acknowledge / dismiss | Decision: respond to elevated risk | Decision: review chronic; reassess |
| No decision without consequence | New critical = real consequence | Escalation = real consequence | Long-lived = consequence accumulating |
| Silence is acceptable; noise is not | Silent on quiet days → trust accrues | Same | Same |
| Escalate only when preserving options requires action | Critical needs minutes-grade attention | Escalation flags time-sensitive change | Long-lived: 7-day cadence is appropriate |
| Attention preservation is a security function | YES — operator-mute pattern is the failure mode | YES | YES |

All three triggers pass all six principles. The model is doctrine-aligned.

---

## §4 — Edge Cases + Honest Limits

### Edge case A — Re-resolution flapping

A finding clears then re-opens within 24h (e.g., a stuck job that completes then re-stalls). Currently the watchdog's auto-resolve pattern handles this via `last_seen_at` updates. The exception-only model should treat re-emergence within 24h as T-NEW (the operator should know).

**Recommendation:** consider `first_seen_at` reset when resolved_at was previously populated and now NULL again. Or check `occurrence_count` going up after a prior resolution.

### Edge case B — Single-day batch of criticals

If 10 new critical mission_health findings fire on the same day (as nearly happened post-Phase-1), the email reports all 10 in one focused message — not 10 separate emails.

This batching is built into the daily cron cadence and matches doctrine.

### Edge case C — Pre-existing chronic critical

The current state already has 3 critical mission_health findings open. Under the new model, these would have been emailed once (when they first appeared at T-NEW), then silent unless escalation OR they cross the 7-day long-lived threshold. The 30-day-distribution data shows current 3-critical-open is the post-deploy expected state for W-MISSION Phase 1 — they should email once then go quiet until resolved.

### Edge case D — System-watchdog itself fails

If the watchdog cron fails to run, the operator gets nothing — same as today. The watchdog's own health is part of W-MISSION Phase 2 (the 20% firing rate observed in Task #143 §8 is itself a problem).

### Honest limits

| Limit | Note |
|---|---|
| Severity-escalation tracking | Today's schema doesn't directly record severity changes; `platform_findings` upsert overwrites severity in place. T-ESC implementation needs either an audit table or comparing-to-prior-run state. |
| 7-day "long-lived" threshold is a guess | Could be 3d, 14d. Operator may tune. |
| No proposed time-of-day intelligence | Email always at 13:00 UTC daily run; emergencies in between aren't escalated faster. Real-time interruption is a separate path (W-MISSION P1.3 stuck-running, or future Slack push). |
| The 13:00 UTC slot itself may need review | UTC 13:00 = 6am Mountain. Operator may prefer different timing. Out of scope. |
| Dashboard link URL pattern not yet defined | The "Link: <dashboard URL>" placeholder needs a concrete URL shape — likely `https://fortress.silentshieldsecurity.com/findings/{id}` |

---

## §5 — Implementation Sketch (Description Only, No Authorization)

Three-line plan when the operator approves:

1. **In `system-watchdog/index.ts`**, after the persist block, add a query: did THIS run write any rows that match T-NEW or T-ESC or T-LONG? Build the exception-email-body if any triggers fire.
2. **In the email-send block**, gate on `if (exceptionBody) sendEmail(...) else log('no exceptions; email skipped')`.
3. **Schema-side**, optionally add `platform_findings.severity_at_first_seen` (immutable) to enable T-ESC detection by comparing current severity to first-seen severity.

**Estimated effort:** 2-4 hours implementation; 30 min staging validation; 1-day observation before declaring success.

**Rollback:** revert the gating logic; daily-comprehensive email resumes.

---

## §6 — Operator Decision Surface

| # | Decision |
|---|---|
| WE.D1 | Approve the three triggers (T-NEW + T-ESC + T-LONG) as the exception-only criteria |
| WE.D2 | Approve the email shape (subject pattern + body sections + "silence = no events" footer) |
| WE.D3 | Approve the 7-day "long-lived unresolved critical" threshold |
| WE.D4 | Approve "no email = no events" semantic (silence is the success state) |
| WE.D5 | Defer implementation until after C-0/C-1/C-2 stabilize (per operator sequential discipline) |
| WE.D6 | Optional: schema add `severity_at_first_seen` to enable T-ESC detection |

---

## §7 — Doctrine Alignment

| Doctrine | Alignment |
|---|---|
| Protect Attention Like Critical Infrastructure | The exception-only model IS the doctrine made operational for watchdog email |
| Every notification spends trust | Daily-same-content burns trust → exception-only refunds it |
| Silence is acceptable; noise is not | "No new events = no email" is silence as a feature |
| No interruption without a decision | Three triggers each carry an implied decision |
| Address generation before approval | The classification "should this fire an email?" lives in the generator (watchdog), not at egress |
| Measurability is part of the feature | Email frequency becomes measurable: track sent_emails/week; success = volume decline + operator engagement |
| Maintenance debt is operational risk | Today's daily-flood IS the maintenance debt; conversion paves it down |

Every ratified doctrine predicts the exception-only model.

---

## §8 — What Would Make This Effort Successful

Per the operator's revealed preference (started muting these emails), success looks like:

- **Volume**: 2-4 emails/week, down from 7
- **Open rate**: operator reads >80% of exception emails (vs current ~0% per operator's self-report)
- **Action rate**: at least one operator-visible action follows >50% of exception emails
- **Trust recovery**: operator self-reports the channel is again worth attention

Each of these is measurable post-deploy with simple metrics. Failure mode (still too noisy) → tighten the thresholds (7d → 14d; etc.). Failure mode (missing real events) → broaden them or add a fourth trigger.

---

## §9 — Constraints Honored

- Assessment only; no implementation, no configuration changes
- Per operator: do NOT remove the email outright
- Per operator: convert to exception-only with the three named triggers
- Per operator: preserve operator attention while maintaining awareness
- C-0/C-1/C-2 sequencing respected — this is parallel design, not in-line implementation
- W-MISSION Phase 2 separation respected — silent cron failures from Task #143 §8 are a separate prioritization

🤖 Generated with [Claude Code](https://claude.com/claude-code)
