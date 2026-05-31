# Mission Success Prioritization — W-MISSION Phase 1

**Operator-directed 2026-05-31 (Task #134).** Read-only ranking. Synthesis of Task #133 (18-workflow silent-failure inventory). No implementation.

Operator framing: *Fortress currently measures workflow execution more effectively than workflow outcomes.* Focus first on workflows where **mission failure can persist while health remains green**.

---

## §0 — Methodology

Each workflow scored on five dimensions:

| Dimension | Scale | Meaning |
|---|---|---|
| **Business consequence** | L/M/H | Damage to Fortress strategic position, product capability, or operator-attention capacity |
| **Customer consequence** | L/M/H | What the customer (e.g., Petronas) experiences directly |
| **Security consequence** | L/M/H | Real-world threat exposure if failure goes undetected |
| **Detection latency** | hours/days/weeks/indefinite | How long until the failure surfaces without active mission monitoring |
| **Existing mission-success metric** | yes/partial/no | Whether data already exists that a Watchdog phase could read |

**Composite priority logic for W-MISSION Phase 1:**

A workflow is high-priority for Phase 1 when ALL of:
- Security or customer consequence ≥ M
- Detection latency ≥ days (mission failure can persist undetected)
- An existing or near-existing metric exists (Phase 1 should target the cheapest data-already-there cases)

Workflows where mission failure is already operator-visible same-day (e.g., empty daily briefing) get lower Phase 1 priority — operator naturally notices.

---

## §1 — Per-Workflow Scoring Table

Ranked roughly by composite priority. Workflows numbered to match Task #133 §1.

| # | Workflow | Biz | Cust | Sec | Detect latency | Existing metric | Notes |
|---|---|:-:|:-:|:-:|---|---|---|
| 1 | `auto_approve_safe_actions` | M | L | **M** | **indefinite** (proven 87/87 unnoticed) | YES — `result_summary.approved_count` already written | Includes the credential-exposure Slack ping; broken predicate; data ready |
| 14 | `ingest-signal` quarantine | M | M | **H** | days–weeks | partial — `quality_status` tracked; reasons not aggregated | A spike in silent quarantines hides real threats from the analyst feed |
| 16 | `alert-delivery` | M | **H** | **H** | days | partial — `alerts.dispatched_at` exists; not monitored | Direct safety pipeline; missed alert = customer unaware |
| 12 | `monitor-github-6h` | M | M | **H** | days | partial — `cron_heartbeat.status='running'` | Currently 14 stuck-running invocations; credential-leak source per Task #132 |
| 9 | `monitor-news-google` | H | **H** | **H** | days–weeks | YES — signals_created per run | Task #100 (Track G allowlist) already proved this can go zero-yield invisibly |
| 15 | Incident promotion (signal → incident) | M | M | **H** | **weeks–indefinite** | NO — would need new ratio metric | High-severity signals not being promoted = real threats unactioned |
| 13 | `knowledge-synthesizer-nightly` | L | L | L | days | partial — same stuck-running pattern as #12 | 3 stuck-running invocations; lower consequence |
| 8 | `send-daily-briefing` | H | **H** | **H** | **hours** — operator usually notices same morning | NO — Resend delivery receipts not read | High consequence BUT operator-visible same day; lower Phase-1 marginal value |
| 7 | `generate-daily-briefing` | H | **H** | **H** | **hours** — operator usually notices | partial — agent-enrichment-coverage only | Same as #8 — high consequence + operator self-detects |
| 11 | `monitor-darkweb-6h` | M | M | **H** | days | YES — signals_created (similar to monitors above) | Specialized intel source; extend existing watchdog pattern |
| 17 | `auto-enrich-entities-nightly` | L | L | L | weeks | YES — function returns enrichment count | Low consequence |
| 5 | QR1 dedup gate | L | L | L | days | YES — `function_telemetry.context->>'event'='qr1_dedup_blocked'` (after Task #130 deploys) | Already in T+24h/72h/7d observation window |
| 6 | `generate-monitoring-proposals` (CRUCIBLE) | L | L | L | weeks | NO — `totalProposals` returned but not persisted | Low priority |
| 18 | `system-watchdog-daily` (meta) | H | L | M | indefinite | NO — recursive | Best fix: implement W-MISSION/COVERAGE/PIPELINE phases (i.e., this work itself) |
| 10 | `monitor-instagram-2h` | L | L | L | already covered | YES (social-monitor behavioral health check) | Already addressed |
| 2 | monitoring_proposals expiry (MISSING) | L | L | L | indefinite | n/a (W-COVERAGE territory, not W-MISSION) | 126 stale rows; operator-attention cost |
| 3 | entity_suggestions match-existing (MISSING) | L | L | L | indefinite | n/a (W-COVERAGE) | 107 rows; operator-attention cost |
| 4 | entity_suggestions dedup (MISSING) | L | L | L | indefinite | n/a (W-COVERAGE) | 124 rows; operator-attention cost |

---

## §2 — Phase 1 Selection Rationale

The operator's filter is decisive: **workflows where mission failure can persist while health remains green**.

That filter excludes:
- Daily-briefing surfaces (#7, #8) — operator notices same morning
- Already-covered cases (#10) — social-monitor watchdog handles
- Already-observed cases (#5) — QR1 in active T+24h/72h/7d window
- W-COVERAGE territory (#2, #3, #4) — different watchdog phase

The filter retains the cases where failure could persist for days/weeks/indefinite without operator awareness. Within that set, security-consequence and existing-metric availability sort the priority.

---

## §3 — Recommended W-MISSION Phase 1 Priority Order

### Tier 1 — proven failure + data already exists (ship first)

| Rank | Workflow | Why first |
|---|---|---|
| **P1.1** | `auto_approve_safe_actions` | 87/87 proven failure; `result_summary.approved_count` is already written. The cheapest possible win — single SQL against existing column. |
| **P1.2** | `monitor-news-google` | Task #100 proved zero-yield invisibility; signals_created per run already in heartbeat result_summary. Same pattern. |
| **P1.3** | `monitor-github-6h` (stuck-running detector) | 14 currently-stuck invocations; pattern detection is `started_at < NOW() - 2× expected_interval AND status='running'`. Single query. |

These three deliver the maximum visibility return for minimum implementation surface. Each uses data that exists today.

### Tier 2 — high consequence + partial metric (Phase 1 stretch)

| Rank | Workflow | Why second |
|---|---|---|
| **P1.4** | `alert-delivery` (dispatched_at coverage) | Safety pipeline; `alerts.dispatched_at IS NULL AND created_at < NOW()-1h` is the SQL. Existing column. |
| **P1.5** | `ingest-signal` quarantine spike detector | Security consequence; `quality_status='quarantined'` rate over 24h compared to 7d baseline. Existing column. |

These add a security-pipeline checkpoint and a quarantine-spike alarm. Both read existing columns; both could detect failure modes that would otherwise persist for days.

### Tier 3 — Phase 2 candidates (need new metric)

| Rank | Workflow | Why later |
|---|---|---|
| P1.6 | Incident promotion (signal→incident ratio) | HIGH consequence but no current metric; needs design |
| P1.7 | `monitor-darkweb-6h` and other non-social monitors | Same shape as P1.2; bundle when expanding pattern |
| P1.8 | `monitor-news` (Canadian / RSS / court / csis / cisa-kev / macro / community-outreach / wildfires) | Same shape as P1.2; bundle the family |

### Tier 4 — defer

| Workflow | Reason |
|---|---|
| `send-daily-briefing` (#8) + `generate-daily-briefing` (#7) | High consequence but operator self-detects same morning; W-PIPELINE phase (separate from W-MISSION) for downstream-confirmation |
| `knowledge-synthesizer-nightly` (#13) stuck | Low consequence; cover via the general stuck-running pattern from P1.3 |
| `auto-enrich-entities-nightly` (#17) | Low consequence; defer |
| QR1 dedup gate (#5) | Already in T+24h observation; defer until that window closes |
| `generate-monitoring-proposals` (#6) | Low consequence + no current metric |
| `system-watchdog-daily` (#18) | Implementing Phase 1 IS the fix for this; meta |
| `monitor-instagram-2h` (#10) | Already covered |

---

## §4 — Phase 1 Concrete Description (Shape Only)

Five SQL-pattern checks, one watchdog phase. All read existing columns.

| Check | Pseudocode | Flag condition |
|---|---|---|
| **P1.1 empty-approval** | `SELECT SUM((result_summary->>'approved_count')::int) FROM cron_heartbeat WHERE job_name='agent-action-auto-approve-hourly' AND started_at > NOW()-INTERVAL '24h'` | Sum = 0 AND awaiting_approval count > 0 |
| **P1.2 zero-yield news** | `SELECT SUM((result_summary->>'signals_created')::int) FROM cron_heartbeat WHERE job_name LIKE 'monitor-news%' AND started_at > NOW()-INTERVAL '24h'` | Sum = 0 AND inflow has been non-zero previously |
| **P1.3 stuck-running** | `SELECT job_name FROM cron_heartbeat WHERE status='running' AND started_at < NOW()-INTERVAL '2 hours'` | Any rows returned |
| **P1.4 undispatched alerts** | `SELECT COUNT(*) FROM alerts WHERE dispatched_at IS NULL AND created_at < NOW()-INTERVAL '1 hour'` | Count > 0 |
| **P1.5 quarantine spike** | `SELECT (rate_24h / rate_7d) FROM (per-window quarantine rate)` | Ratio > 2× |

Each check writes a row to `platform_findings` when triggered. The watchdog already does this pattern for its behavioral-health phase; W-MISSION extends with these five queries.

**Estimated implementation effort:** ~4–6 hours total (single watchdog edit + 5 queries + test).

---

## §5 — What Phase 1 Does NOT Solve

Honesty about scope:

- **Pipeline-output verification** (e.g., Resend delivery receipts) — that's W-PIPELINE territory, separate phase
- **Missing-job detection** (the W-COVERAGE category — expiry, match-existing, dedup) — separate phase
- **Incident-promotion ratio** — needs design before implementation
- **Recursive watchdog-checks-watchdog** — Phase 1 doesn't solve; implementing Phase 1 IS partial mitigation

Phase 1 surfaces five specific silent-failure types. The other 13 surfaces from §1 remain uncovered until later phases.

---

## §6 — Doctrine Alignment

| Doctrine | How this prioritization honors it |
|---|---|
| Measurability is part of the feature | Phase 1 uses metrics that already exist (cheapest data-already-there cases first) |
| Maintenance debt is operational risk | The 87/87 case is the canonical example of unmaintained monitoring |
| Confidence is not correctness | Heartbeat success is the failed self-report; mission metric is the verified outcome |
| In peace time, improve your fighting position | Watchdog enrichment compounds — every future feature benefits |
| Measure before and after every intervention | Phase 1 establishes mission baselines for future intervention measurement |
| Address generation before approval | Indirect — Phase 1 surfaces broken approval automation, addressing it at source |

---

## §7 — Constraints Honored

- No implementation
- No QR3 / EX-1 / Campaign 1 work begun
- QR1 observation continues on schedule (T+24h check still pending)
- Diagnosis only

---

## §8 — Summary Recommendation

W-MISSION Phase 1 = **five SQL-pattern checks in a new watchdog phase**:

1. Empty-approval detector (`auto_approve_safe_actions` is the proven case; pattern generalizes)
2. Zero-yield monitor extension to news/court/csis/cisa-kev/macro families
3. Stuck-running invocation flagger
4. Undispatched-alert backlog
5. Quarantine-rate spike

All read existing columns. Estimated ~4–6h effort. Catches the highest-consequence silent-failure cases that exist today.

Phase 2 (separate, later) — design + add: incident-promotion ratio, downstream-confirmation pipeline checks, broader monitor coverage.

Phase 3 (separate, later) — W-COVERAGE: missing-job detection (expiry, match-existing, dedup).

This is the prioritization. Implementation is operator-decision-gated.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
