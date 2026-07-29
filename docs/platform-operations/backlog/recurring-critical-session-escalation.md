# Backlog: recurring-critical findings need an escalation path beyond daily email

**Raised:** 2026-07-29 (watchdog meta-note during WO-LEARNING-LOOP triage)

## The gap

The watchdog did its job — a 37-day (really 63-day) learning-loop stall surfaced because the daily report exists. But **"recurring with no successful remediation" recurred silently for weeks**: the learning-stall finding was logged 92 times (2026-04-05 → 2026-07-28) and the knowledge-synthesizer stuck-running finding since 2026-05-31, each landing only in the daily email — a channel the operator has (correctly, per attention doctrine) largely muted.

A finding that is critical AND recurring AND un-remediated for >7 days is exactly the class that must break out of the inbox. Per the Protect-Attention doctrine: an alert that is muted is operationally equivalent to one never sent. The daily email is the wrong tier for a weeks-old unresolved critical.

## Proposal

**Recurring-critical findings older than 7 days surface in the operator's session-start context, not just the inbox.**

- Definition: `platform_findings` where `severity IN ('critical','high')` AND `resolved_at IS NULL` AND `first_seen_at < now() - interval '7 days'` AND still seen in the last 48h (still active).
- Surface: a compact session-start block (the same channel these WO reports are read in), one line per stale-critical: title, age, occurrence count, whether any remediation was ever attempted.
- This is the INTERRUPTION tier of the 4-tier hierarchy (LOG/FINDING/NOTIFICATION/INTERRUPTION) — reserved for the genuinely un-ignorable.

## Prerequisite defect (found during WO-LEARNING-LOOP)

`platform_findings.occurrence_count` reads **1** for each recurrence — the fingerprint/dedup is not collapsing repeats, so a 3.7-month-recurring finding looks like 92 one-offs. **Fix the fingerprint dedup first**, or the "older than 7d, still recurring" query cannot be written reliably (there is no single row whose `first_seen_at` is old and `last_seen_at` is recent — they are scattered across near-duplicate rows).

## Sequencing

1. Fix `platform_findings` fingerprint dedup (collapse recurrences into one row with a real `occurrence_count` + moving `last_seen_at`).
2. Build the stale-critical session-start surface on top of the deduped findings.

Related: WO-LEARNING-LOOP Phase 1 (`docs/reports/WO-LEARNING-LOOP-phase1-2026-07-29.md`) §3–4.
