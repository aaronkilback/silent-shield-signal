# Watchdog Trigger — Doctrinal Deep-Assessment

**Operator-directed 2026-05-31 (Task #147).** Apply the *Protect Attention Like Critical Infrastructure* doctrine **recursively** to the exception-only watchdog email triggers themselves. Assessment only. No implementation.

Operator framing: silence should remain the default state.

---

## §0 — The Doctrinal Test

Even the exception-only triggers (T-NEW / T-ESC / T-LONG) must each pass the doctrine's six-principle filter. Otherwise we have only moved the bloat from "daily email" to "exception email" without honoring the principle.

For each trigger, three doctrinal questions:

| # | Question | Doctrine principle |
|---|---|---|
| 1 | What operator decision is expected? | Principle 2: *No interruption without a decision* |
| 2 | What operator action is expected? | Principle 3: *No decision without consequence* |
| 3 | Would operator behavior change after reading it? | Principle 1: *Every notification spends trust* — if behavior doesn't change, the trust was burned for nothing |

**If a trigger fails any of the three, silence is the correct outcome.** Drop the trigger or tighten it.

---

## §1 — T-NEW: One or more NEW critical findings in last 24h

### Decision expected

"Is this a real new condition I haven't already seen? If yes — investigate or accept?"

For the current 3 mission_health criticals (auto_approve / monitor-github / alert-delivery), each has a documented action path in Task #132 + Task #141. The operator either:
- Acknowledges + schedules remediation (decision: schedule)
- Triggers immediate remediation (decision: act now)
- Marks as known/accepted with audit note (decision: defer with reason)

**This is a real decision surface.** ✓ Passes Principle 2.

### Action expected

For a new critical:
- **High-volume case** (e.g., a new wave of stuck-running jobs in another category): operator investigates the new failure class; possibly opens a remediation task
- **Low-volume case** (one critical per quarter): operator processes immediately

In both cases, an operator-visible artifact follows: a new task, a code change authorization, or a session like the ones in this campaign. **Real action expected.** ✓ Passes Principle 3.

### Behavior change after reading?

**Yes — measurably.** The three current criticals are the empirical proof: the operator authorized Tasks #136 (Phase 1), #138 (P1.4 fix), #141 (alert-delivery assessment), #143 (4-tier classification), #144 (C-0 pre-flight), and #146 (C-0 staging apply) **specifically because** those findings surfaced. Without the W-MISSION Phase 1 work, the 87/87 auto-approve case would have remained invisible.

**Trust was spent and refunded with operator-visible work.** ✓ Passes Principle 1.

### Volume forecast

- Steady-state: ~1 new critical per week (after current W-MISSION Phase 1 fires resolve)
- Per-event trust impact: HIGH positive

### Verdict for T-NEW

**RETAIN.** Doctrine-aligned on all three axes. The three current criticals are the exemplar.

---

## §2 — T-ESC: Severity escalation in last 24h

### Decision expected

"Has this finding gotten worse? Does the escalation change my priority?"

Concrete example: P1.1 auto-approve fires at warning (24h zero) then escalates to high (eligible≥5) then critical (7d zero). Each escalation is a state-change worth knowing.

**The escalation IS the decision-relevant content.** The same finding firing at the same severity day after day is what burns trust; an escalation reverses the burn — it's the rare state-change worth surfacing.

✓ Passes Principle 2.

### Action expected

- Warning→high: operator may reorder remediation priority
- High→critical: operator may trigger immediate remediation (or auto-approve-style action)

Without escalation visibility, a slow-burning critical condition could be missed for days. The escalation event itself is what creates urgency the operator can act on.

✓ Passes Principle 3.

### Behavior change after reading?

**Yes — by definition.** Escalation IS a behavior-changing event. If the operator's behavior doesn't change between warning and critical, then the severity ladder itself is meaningless — and the issue is upstream in the severity-calibration logic, not in the trigger.

**However**, T-ESC has an implementation prerequisite: today's `platform_findings` upsert overwrites severity in place, so detecting a severity bump requires either:
- An audit table tracking severity changes (heavy)
- A `severity_at_first_seen` immutable column compared to current `severity` (light — recommended in Task #145 §5)
- Comparing-to-prior-watchdog-run state (works but stateful)

Without one of these, T-ESC can't fire. The trigger is **doctrine-aligned but operationally blocked** until the substrate exists.

### Volume forecast

- Steady-state with severity_at_first_seen: ~1-2 escalations/month
- Per-event trust impact: HIGH positive

### Verdict for T-ESC

**RETAIN IN DESIGN; DEFER IMPLEMENTATION** until the schema substrate (`severity_at_first_seen`) is added. Note in the implementation plan that T-ESC is degraded-to-not-firing until then.

---

## §3 — T-LONG: Long-lived unresolved critical (open > 7 days)

### Decision expected

"Did I forget about this? Should it be tracked or accepted-as-chronic?"

Empirically, the current `Tier-2 review gap` finding has been open for ~7 days (per Task #143 §2 — 33% reviewed; older finding). It IS chronic. The decision is:
- **Acknowledge** — explicit accept-as-known (changes status or adds operator note)
- **Investigate** — start a fix workstream
- **Dismiss** — explicit reject (rare for critical)

The 7-day cadence puts a re-decision point on the calendar. Without it, chronic items can sit open for months unacknowledged.

✓ Passes Principle 2.

### Action expected

- **Acknowledge:** operator adds a `resolution_note` like "accepted-chronic, tracked in backlog #X"; finding stays open but the acknowledgment debits the "did you know?" question
- **Investigate:** new task created
- **Dismiss:** mark resolved with reason

In each case, an operator-visible artifact follows. ✓ Passes Principle 3.

### Behavior change after reading?

**Conditional.** If T-LONG fires every 7 days with the same content and the operator never acknowledges, behavior doesn't change — and the trigger violates Principle 1.

The fix is **cumulative state**: once an operator has explicitly acknowledged a long-lived critical (via `resolution_note` populated), T-LONG should NOT re-fire for THAT finding even after another 7 days. Re-fire only if:
- Severity escalates (which is T-ESC, separate)
- `resolution_note` is cleared (operator wants to re-surface)
- New evidence accumulates (e.g., `occurrence_count` grew significantly)

Without acknowledgment-aware suppression, T-LONG becomes daily-flood-by-7-day-cadence — same anti-pattern in slower clothes.

### Volume forecast (with acknowledgment-aware suppression)

- Steady-state: ~0-2 unique findings per quarter that reach 7-day-open AND aren't acknowledged
- Per-event trust impact: MEDIUM positive (lower than T-NEW; chronic-by-definition)

### Verdict for T-LONG

**RETAIN — but require acknowledgment-aware suppression.** Without that, T-LONG would silently morph into a weekly version of the muted-email problem.

**Additional sub-requirement:** T-LONG should support an "acknowledge as chronic" affordance in the Neural Constellation UI so operator can suppress re-fires explicitly. This is design work, not in T-LONG's core trigger logic.

---

## §4 — Cross-Trigger Properties

### What's good across all three triggers

- Each carries a **decision relevant** to operator action
- Each carries an **action expected** beyond "noted"
- Each has empirical evidence of refund (T-NEW: this campaign's authorizations; T-ESC: severity-bump is rare and meaningful; T-LONG: weekly re-decision prevents drift)

### What's risky across all three

- **Compound firing**: 1 new + 1 escalation + 1 long-lived in the same day = 3 separate triggers in one email. Doctrine principle 4 (silence acceptable, noise not) says this should still be ONE email with three sections, not three emails. This is built into the daily-cron cadence (Task #145 §4 Edge case B).
- **Backlog re-fire on deploy**: when T-LONG first ships, every existing long-lived critical fires at once. **Mitigation:** seed all currently-long-lived criticals as `acknowledged_at = deploy_timestamp` on day 1; only fire for net-new long-lived from there.
- **Severity-label drift**: if the upstream severity classifier changes its calibration, T-NEW and T-ESC fire spuriously. **Mitigation:** monitor false-positive rate post-deploy; tighten thresholds if needed.

---

## §5 — Doctrinal Risk Matrix

For each trigger, the failure mode if doctrine is violated:

| Trigger | Failure mode | Detection | Mitigation |
|---|---|---|---|
| T-NEW | Spurious new criticals fire (severity miscalibration) | Operator reports same-issue-multiple-emails | Tighten severity threshold upstream; not a trigger problem |
| T-ESC | Severity flapping (high→critical→high→critical) generates noise | Track count_of_escalations per fingerprint per week; flag flappers | Suppress T-ESC for findings that have flapped >3x in 7d |
| T-LONG | Same chronic re-surfaces every 7d unacknowledged | Per-finding fire count per quarter | Acknowledgment-aware suppression (required, not optional) |

The T-LONG mitigation is **required**, not optional. Without it, T-LONG violates the doctrine.

---

## §6 — Combined Volume Forecast (Revised)

With all three triggers honoring the doctrine:

| Period | T-NEW | T-ESC | T-LONG | Total emails |
|---|---:|---:|---:|---:|
| Steady-state week | ~1 | ~0.5 | ~0-1 | **~1-3 emails/week** |
| Heavy week (campaign in flight) | 3-5 | 1-2 | 1 | ~5-8 |
| Quiet week | 0 | 0 | 0 | **0 — silence is success** |

The "0 emails per quiet week" outcome is what makes this doctrine-aligned. The pre-conversion daily model never reaches 0 — it reaches "muted by operator."

---

## §7 — Honest Limits

| Limit | Note |
|---|---|
| T-ESC needs schema work (`severity_at_first_seen` or audit table) | Implementation prerequisite; design retained, ship deferred |
| T-LONG needs acknowledgment-aware suppression | Required, not optional; needs UI affordance design |
| 24h windows are clock-driven, not operator-driven | If operator works irregular hours, "new in last 24h" may straddle session boundaries; minor edge case |
| Trigger weights not yet calibrated | Real volume may differ from forecast; first 30 days post-deploy is calibration window |
| Doctrinal recursion has practical limits | At some depth ("is the meta-doctrine on the doctrine doctrinal?") the recursion adds no value; one level (this assessment) is enough |

---

## §8 — Operator Decision Surface

Building on prior WE.D1-D6:

| # | Decision |
|---|---|
| **WE.D1** | RECONFIRM: approve the three triggers (T-NEW + T-ESC + T-LONG) |
| **WE.D2** | RECONFIRM: approve the email shape from Task #145 §1 |
| **WE.D3** | RECONFIRM: approve the 7-day long-lived threshold |
| **WE.D4** | RECONFIRM: approve "no email = no events" semantic |
| WE.D5 | RECONFIRM: defer implementation until C-0/C-1/C-2 stabilize |
| **WE.D6** | RECONFIRM: optional schema add `severity_at_first_seen` to enable T-ESC |
| **WE.D7** | **NEW**: ratify acknowledgment-aware suppression as REQUIRED (not optional) for T-LONG |
| **WE.D8** | **NEW**: on initial T-LONG deploy, seed all currently-long-lived criticals as `acknowledged_at = deploy_timestamp` to prevent backlog re-fire |
| **WE.D9** | **NEW**: monitor false-positive rate per trigger in first 30 days; calibration window |

The new decisions (WE.D7, WE.D8, WE.D9) emerged from the recursive doctrinal application.

---

## §9 — The Recursive Conclusion

Applying the doctrine recursively to its own implementation surfaced one **required** addition (acknowledgment-aware suppression for T-LONG) and one **deployment-time** addition (seed-backlog suppression). Without these, T-LONG would become weekly-flood — the same anti-pattern in slower clothes.

This is the doctrine working as designed. Even the implementation of "protect attention" must itself be tested against the principle "every notification spends trust." Two levels of recursion was sufficient.

The doctrine is internally consistent. The exception-only model is ratifiable.

---

## §10 — Constraints Honored

- Assessment only — no implementation
- C-0 staging apply already complete (Task #146); prod gated separately
- C-1 + C-2 NOT begun; await separate authorization
- AV.3 reaffirmed (no Teams/Slack/SMS wiring)
- W-MISSION Phase 1 GREEN; QR1 observation continues on schedule
- Operator's "silence is default state" framing honored

🤖 Generated with [Claude Code](https://claude.com/claude-code)
