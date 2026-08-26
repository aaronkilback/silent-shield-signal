# WO-WATCHDOG-AUTORESOLVE — verifiable findings must resolve on positive verification, never on non-detection

**Opened:** 2026-08-22. **Do not work tonight** (operator ruling). Priority: high.

## Trigger
Critical finding `29a46878-3880-4df0-a4b0-8d51da28b9fe` — "Anon-surface invariant breached: SECURITY DEFINER
function EXECUTE-able by anon (not allowlisted)" — **self-cleared to RESOLVED at 2026-08-22 13:00** with
`resolution_note = "auto-resolved: not detected in subsequent watchdog run"`, roughly **five hours** after it
was last seen at 08:00 the same morning. **The underlying grants were still open** the entire time: all four
functions (`purge_report_access_log`, `silent_zero_scan`, `silent_zero_variant_a`, `child_safety_guidance_stale`)
retained `anon` EXECUTE and were live-reachable via public REST RPC until manually revoked at ~22:00. The
watchdog reported "gone" while the door was still open.

## The invalid pattern
**Auto-resolve on absence-from-scan is invalid for any finding class whose underlying condition is directly
verifiable.** Non-detection in a later run is not evidence the condition is gone — it can equally mean the probe
flaked, the scan set shifted, the run was skipped, or the query changed. Treating "I didn't see it this time" as
"it's fixed" manufactures a false all-clear over a still-live critical. This is the **same failure family as
fabricated confidence asserted over an empty signal set** (`feedback_confidence_is_not_correctness`,
`feedback_negative_finding_needs_complete_search`): a positive claim ("resolved") produced from an absence of
evidence rather than evidence of absence.

## Requirement
For findings of this class — **directly-verifiable conditions** (grant present/absent, RLS on/off, policy
scope, cron exists, row present) — resolution MUST come from a **positive verification** that the condition is
actually gone, re-checked at resolve time, never from mere absence from a subsequent scan.

- **Verifiable-class findings:** resolve only when a targeted re-check confirms the condition is cleared (e.g.
  re-run `security_anon_surface_scan()` and confirm the *specific* item is absent AND, ideally, assert the
  concrete post-condition — `has_function_privilege('anon', …) = false`). Store the verification in the
  resolution note. Absence-from-a-broad-scan alone MUST NOT resolve them.
- **Non-verifiable / transient-class findings** (e.g. a one-off latency spike) may still auto-age-out, but that
  path must be explicitly gated to that class — not the default for everything.
- A critical that flips RESOLVED must record *what was verified*, not *what wasn't seen*.

## Forensic-trail retention must outlast the exposure it evidences (added 2026-08-22)
The only forensic evidence of whether `purge_report_access_log` was invoked off-schedule is its per-invocation
`cron_heartbeat` row — but `heartbeat-cleanup-daily` purges `cron_heartbeat` to **~3 days**. This finding was
**open ~11 days (2026-08-11 → 2026-08-22)**, so the heartbeat trail could evidence only the last ~3 of them,
leaving an **unclosable forensic window over most of the exposure**: an anon invocation between Aug 11 and
Aug 19 would have left a heartbeat that was already cleaned up before anyone looked.

**Requirement:** retention on any forensic/audit trail MUST exceed the worst-case detection-to-remediation
window for the finding class it is meant to evidence. A 3-day trail cannot evidence an 11-day (or longer)
exposure. When a finding class depends on a trail (heartbeat, decision log, access log) to prove
tamper/invocation history, the trail's retention is part of that finding class's contract — audit them
together, and either lengthen the trail or add a durable, non-purged record of the sensitive invocations.

## Also consider (scoping notes for when this is worked)
- The current auto-resolver appears to blanket-apply non-detection resolution across all finding categories.
  Partition by whether the finding carries a machine-checkable post-condition.
- Consider a guard: a `critical`/`high` finding may not auto-resolve within N hours of `last_seen_at` without a
  positive re-check — the 5-hour flip here is the tell.
- Cross-check the twin surface: `agent-sentinel` Probe 2f also scans the anon surface; ensure its
  resolve/clear logic has the same discipline.

## Provenance
Discovered 2026-08-22 during an operator-requested status check on the 2026-08-11 anon-surface critical. The
grants were verified still-open, revoked (`revoke_anon_execute_four_secdef_functions`), and the scan confirmed
empty — at which point the finding became *genuinely* resolved. The WO is about the resolver logic that
declared victory early, not the (now-closed) grant exposure.
