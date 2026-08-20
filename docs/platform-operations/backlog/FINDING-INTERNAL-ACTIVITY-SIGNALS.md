# FINDING — platform-activity audit records surfacing as priority intelligence (2026-08-20)

**Type:** FINDING (report-before-fix, operator-requested). No fix applied yet.

## Observed
The daily briefing's single PRIORITY SIGNAL was Fortress reporting on itself:
> "A VIP Deep Scan has been initiated for Aaron Kilback with standard priority under investigation
> INV-2026-0078" — rendered as intelligence, with the LLM inventing "…indicating potential concerns
> regarding the individual's security posture."

## What creates it
`vip-deep-scan/index.ts` **§5 "Tracking signal — via ingest-signal per doctrine"** (lines 383–407):
every scan intake deliberately emits a signal via `ingest-signal` with **`skip_relevance_gate: true`**
(marked pre-vetted, so it bypasses the relevance filter that would otherwise drop it). Signal
`1765b1f8`: `category='other'`, `signal_type=null`, `severity='low'`, no `signal_origin`, client=Kilbacks.

## Why it reaches a briefing
It is `quality_status='active'`, so the exec/daily pull includes it. It carries no marker distinguishing
an **audit/activity record** from an **observed-threat finding**. On a low-volume day (≈2 signals/24h) a
lone low-severity tracking record becomes the top item by default, and the narrative LLM then invents a
threat interpretation of an internal event. Platform-activity tracking should be an audit record, not a
finding — it should never enter the intelligence surface a client reads.

## Class scan — what else of this shape exists
Corpus scan (active, briefable): **19 signals** of this class —
- **18 `social_monitoring_status`** — "social intelligence search conducted … no results" / "monitoring
  for '_benchmark_bcch'" (a monitor RAN and found nothing, stored as a signal). category `other`/`social_sentiment`, `low`.
- **1 `vip_scan_initiated`** — the record above.
No `report_generation` / `watchdog` / `heartbeat` signals exist (those stayed out of the signals table — good).
So the class is small (19) but real, and it is exactly the "scan initiations / monitoring runs as signals"
shape flagged: internal events dressed as intelligence.

## Fix options (NOT built — for ruling)
Candidates, in defensiveness order: (a) stop emitting the vip-deep-scan tracking signal into `signals`
(it's an investigation/audit event — belongs in an activity log, not the intelligence feed); (b) if kept,
mark the class (`signal_type='platform_activity'` or a category) and EXCLUDE it from brief/exec pulls at the
read seam (the same tier gate that drops <0.30 relevance); (c) the "found nothing" social-monitoring status
messages should not be signals at all — a null result is heartbeat data, not a finding. Report-only per ruling.
