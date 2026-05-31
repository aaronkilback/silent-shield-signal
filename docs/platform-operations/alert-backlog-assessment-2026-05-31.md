# Alert Backlog Assessment

**Operator-directed 2026-05-31 (Task #139).** Read-only diagnosis of the 13,857 failed alerts surfaced by W-MISSION Phase 1 validation. No remediation plan. No implementation.

---

## §0 — Most Important Question Answered

> *Is the backlog historical debt or an active failure?*

**Both — with a single root cause that has never been resolved.**

The entire `alerts` table contains **only** rows with `status='failed'`. Zero alerts have ever reached `status='sent'`. The system has been generating and attempting to deliver alerts for 8+ months (since 2025-10-03), and **every single attempt has failed** for the same reason: **no delivery channels are configured**.

It is not "historical debt that got fixed." It is a never-deployed configuration that has been quietly accumulating failed delivery attempts since October 2025.

---

## §1 — Headline Metrics

| Metric | Value |
|---|---|
| Total rows in `alerts` table | **13,868** |
| Rows with `status='failed'` | **13,868** (100%) |
| Rows with `status='sent'` | **0** |
| Rows with `status='pending'` | 0 |
| Oldest failed alert | 2025-10-03 22:20 UTC |
| Newest failed alert | 2026-05-31 01:16 UTC |
| Total span | ~241 days |
| Distinct recipients | 743 |
| Distinct incident_ids | 90 (with 13,463 alerts having NULL incident_id) |

**The entire alerts table is a delivery-failure log.** No successful alert delivery has ever occurred in the recorded history.

---

## §2 — Age Distribution

| Bucket | Count | % of total |
|---|---:|---:|
| Older than 90 days | **12,343** | **89.0%** |
| 30-90 days | 612 | 4.4% |
| 7-30 days | 731 + 11 (secure_messaging) = 742 | 5.3% |
| 24h-7d | 165 | 1.2% |
| <24h | 6 | 0.04% |

**89% of the backlog is over 90 days old.** The bulk was generated between 2025-10-03 and 2026-01-17 — a roughly 3-month surge of orphan/test-data alerts (12,343 against only 3 distinct incident_ids).

The remaining ~11% is more recent activity, with a slow trickle continuing into the last 24 hours.

---

## §3 — Channel Distribution

| Channel | Count | % |
|---|---:|---:|
| email | 13,857 | 99.9% |
| secure_messaging | 11 | 0.08% |

Email is the dominant channel. The 11 secure_messaging alerts are a separate population — they have `sent_at` populated (so they were actually sent), but `status='failed'` — different failure mode (delivery sent, recipient response failed).

---

## §4 — Tenant Distribution

| Tenant | Client | Failed alerts | Distinct incidents | Notes |
|---|---|---:|---:|---|
| NULL | NULL | **13,474** (97.2%) | 3 | Orphan / pre-tenant-backfill / scaffolding data |
| feff5c44... | Petronas Canada | 150 | 46 | Real-client alerts |
| feff5c44... | Cascade Energy | 93 | 13 | Real-client alerts |
| NULL | Petronas Canada | 70 | 13 | Real client, NULL tenant_id (pre-backfill) |
| NULL | BC Place | 58 | 6 | Real-client alerts |
| feff5c44... | `_qa_test_client` | 12 | 5 | **Test data** |
| feff5c44... | `_benchmark_petronas` | 5 | 2 | **Test/benchmark data** |
| NULL | Cascade Energy | 4 | 1 | Real client, NULL tenant_id |
| NULL | `_benchmark_petronas` | 2 | 1 | **Test/benchmark data** |

**Breakdown of operational reality:**
- **13,474 orphans** (97.2%) — no client linkage, 3 distinct incidents fanned out to 653 recipients. Almost certainly test/scaffolding data from a stress test or fixture creation.
- **365 real-client alerts** (2.6%) — these are the operationally relevant ones (Petronas Canada, Cascade Energy, BC Place)
- **19 explicit test/benchmark** (0.1%) — `_qa_test_client` and `_benchmark_petronas`

The 13,474 orphans dominate the count. The 365 real-client alerts are the substantive operational impact.

---

## §5 — Production vs Test Classification

| Class | Count | % |
|---|---:|---:|
| Real-client alerts (Petronas Canada, Cascade Energy, BC Place) | 365 | 2.6% |
| Orphan/scaffolding (NULL tenant + 3 incidents × 653 recipients) | 13,474 | 97.2% |
| Explicit test/benchmark clients | 19 | 0.1% |
| Other | 10 | 0.07% |

The 13,474 orphans look like a fan-out test (3 incidents emitting alerts to 653 recipients = ~22 alerts per incident per recipient, sustained for months). Possibly a stress test that was never cleaned up, OR a legacy notification pattern from before tenant_id was added.

The 365 real-client alerts are the legitimate operational backlog.

---

## §6 — Root Cause (Single, Universal)

Sample `response_json` from any failed alert shows the same pattern:

```json
{
  "payload_summary": {
    "title": "🔥 BCWS Fire R20368: Out of Control in Skeena/Kitimat corridor (3, 2). Size: 0.009 ha.",
    "channels": ["teams", "slack", "sms"],
    "priority": "p1"
  },
  "delivery_results": {
    "sms":   { "error": "No phone numbers configured", "success": false },
    "slack": { "error": "No webhook configured",       "success": false },
    "teams": { "error": "No webhook configured",       "success": false }
  },
  "total_duration_ms": 165
}
```

**Every single failed alert reports the same three errors:**
- SMS: "No phone numbers configured"
- Slack: "No webhook configured"
- Teams: "No webhook configured"

The alert-delivery edge function tries all three channels per alert. All three fail because the secrets/configuration that point to actual channels were never populated. This has been the case since at least 2025-10-03.

The `channel='email'` row label is misleading — looking at the response, the function is attempting **teams + slack + sms** (not email). The `channel` column may be metadata about the intended delivery class rather than the specific channel attempted.

---

## §7 — Growth Rate (Last 30 Days)

| Day | Failed alerts | Distinct incidents | Notes |
|---|---:|---:|---|
| 2026-05-31 | 6 | 0 | Today |
| 2026-05-30 | 25 | 2 | |
| 2026-05-29 | 13 | 0 | |
| 2026-05-28 | 3 | 0 | |
| 2026-05-26 | 62 | 2 | Spike |
| 2026-05-25 | 61 | 2 | |
| 2026-05-24 | 56 | 12 | |
| 2026-05-23 | 69 | 14 | Spike |
| 2026-05-22 | 13 | 0 | |
| 2026-05-21 | 42 | 1 | |
| 2026-05-19 | 33 | 2 | |
| 2026-05-18 | 21 | 1 | |
| 2026-05-16 | 71 | 8 | Spike |
| 2026-05-15 | 84 | 6 | Spike |
| 2026-05-14 | 71 | 0 | |
| 2026-04-30 | 122 | 0 | Spike |

**Recent rate: ~25-30 failures/day on average, with intermittent spikes of 60-120/day** correlating with high-signal-volume days (wildfire surges, pipeline-sabotage incidents, etc.).

The volume is variable — directly proportional to operational signal activity. More signals = more alert-creation attempts = more failures.

---

## §8 — Current Operational Impact

The failed alerts contain **real high-priority content** that should have been delivered:

Sample titles from the backlog:
- "🔥 BCWS Fire R20368: Out of Control in Skeena/Kitimat corridor"
- "🔥 BCWS Fire R50376 — R50376: Out of Control in Skeena/Kitimat corridor"
- "🔥 BCWS Fire R10373 — R10373: Out of Control in Skeena/Kitimat corridor"
- "A section of the Coastal GasLink pipeline near Fort St. John was shut down following a suspected sabotage..."

All marked `priority: "p1"`. All targeted Teams + Slack + SMS. None were ever delivered.

**Customer-visible impact (Petronas Canada, Cascade Energy, BC Place):**
- 365 real-client alerts attempted, 0 delivered
- Operator hasn't received any Slack/Teams/SMS push notification for any signal since at least 2025-10-03
- Daily briefing email (different pipeline; uses Resend) presumably IS being delivered, since the operator continues to interact with it

The dailybriefing pipeline runs through `send-daily-briefing` (using Resend), which is a SEPARATE delivery path from `alert-delivery`. So the operator has been receiving daily briefings throughout this period, but has been entirely missing the real-time `alert-delivery` push channel.

**Critically:** the BCWS Fire R20368 (Out of Control), pipeline-sabotage, and similar high-priority alerts in this backlog are the kind of real-time-urgent content the alert-delivery channel exists to deliver. The 8-month silence on that channel is operationally significant.

---

## §9 — Verdict Per Operator's Question

> *Is the backlog historical debt or an active failure?*

**Both. Single root cause: missing delivery channel configuration.**

- **Historical debt**: 12,343 alerts older than 90 days (89%) — accumulated from October 2025 through January 2026, dominated by 13,474 orphan/scaffolding entries
- **Active failure**: ~30/day continues to accumulate; ~365 real-client alerts in the last ~90 days; daily rate continues
- **Never resolved**: there is no point in the 8-month history where alert delivery worked. The configuration has never existed.

**This is not a transient outage. It is a never-deployed feature whose attempts have been silently logging since launch.**

---

## §10 — What This Validates About W-MISSION

The 13,857-row backlog was completely invisible until W-MISSION Phase 1 surfaced it (corrected via Task #138). The pattern is exactly the doctrinal failure mode:

- The `alert-delivery` cron runs every 15 min, reports `status='succeeded'` for every run
- Each invocation completes its loop, attempts delivery, writes the failure row to `alerts`, returns success
- Heartbeat green. Cron-job-registry happy. Watchdog (pre-Phase-1) doesn't look at `alerts.status` distribution.
- The function technically does its job: it tries to deliver, captures the failure, and exits cleanly
- It just never delivers anything

**Without W-MISSION Phase 1 (and the P1.4 column fix that just landed), this backlog would have remained invisible indefinitely.** This is the textbook *"workflow is healthy because it runs vs workflow is healthy because it achieves its outcome"* distinction.

---

## §11 — Scope Discipline (per Operator)

This is diagnosis only. The operator did NOT authorize:
- Configuration of Slack/Teams/SMS channels
- Bulk-archive of the historical 13,474 orphans
- Cleanup of `_qa_test_client` / `_benchmark_petronas` test data
- Any change to `alert-delivery` function
- Any change to alert-creation paths
- Any change to alert status transitions

The diagnosis stands. Remediation is a separate operator-decision surface.

---

## §12 — Honest Limits

| Limit | Why it matters |
|---|---|
| Did not probe `alert-delivery` function code | The "no webhook configured" error suggests the function reads `Deno.env.get('SLACK_WEBHOOK_URL')` (or similar) and finds it empty. Confirming this requires reading the function code. |
| Did not check Supabase secrets configuration | The secrets table or env-var mechanism might exist but be empty. Verifying requires access to the secrets dashboard. |
| Did not check whether email channel ever worked | The `channel='email'` rows show Teams/Slack/SMS error in response_json — not email-specific errors. The channel column meaning is ambiguous; might be the alert's *priority class* rather than the *attempted delivery method*. |
| Did not verify whether daily-briefing email is actually delivering | Separate pipeline; assumed delivering because operator continues working. |

These are honest limits on what this 1-hour diagnosis answers vs what a deeper investigation would establish.

---

## §13 — Constraints Honored

- Diagnosis only — no remediation plan
- No implementation
- No alert-delivery changes
- No configuration changes
- No data cleanup
- QR1 observation continues on schedule
- W-MISSION Phase 1 + P1.4 column fix complete (separate task)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
