# DGIC — Operational Health Integration (required, not optional)

**Status:** REQUIREMENT added to the DGIC plan. No mutations. No code this increment.
**Governing principle:** *If the client would notice first, the platform health system failed.* DGIC is not "done" when CI parity is green — it is done when the admission stamps it produces **feed Watchdog + Health Monitor with truth**, per tenant, before a feed goes visibly stale.
**Doctrine change:** `signals_created` is **retired as a health metric** (it counts ingest *calls*, inflated by dedup re-finds + fail-open floods — proven by the csis=120/rss=94 vs ~20-real-rows finding). Health is measured by **decision-grade output + quality completeness**.

This layer **consumes the DGIC substrate already designed** (`dgic_status`, `dgic.findings`, `dgic.mode/acquisition`, `publication_ts`, `connection_type`, `dgic_evaluations`, and the views `dgic_bypass_canary` / `dgic_baseline_24h` / `dgic_violation_histogram_24h` / `dgic_audit_error_rate_24h` / `dgic_latency_24h`). The contract produces its own observability — no parallel instrumentation.

---

## Layer 1 — CI protection (drift, pre-deploy)
The Phase B parity harness catches behavior drift before any deploy (byte-identical response/DB/telemetry/log, allowlist-only nondeterminism). **Necessary but not sufficient** — CI cannot see runtime degradation (quiet sources, expired tokens, allowlist misconfig, provider 429). That is Layers 2–4.

## Layer 2 — Runtime Watchdog checks (alert before CRT notices)
A new **DGIC behavioral-health phase** in `system-watchdog` (alongside the existing behavioral-health phase ~L143/L3057). Each check, its data source, provisional threshold (calibrated from the P1 baseline), and **the incident it would have caught**:

| # | Alert | Source | Threshold (provisional) | Catches |
|---|---|---|---|---|
| 1 | **Bypass canary > 0** | `dgic_bypass_canary` | any row → CRITICAL | active signal with no DGIC stamp = architectural defect (the `detect-threat-patterns`-class bypass) |
| 2 | **audit_error rate** | `dgic_audit_error_rate_24h` | > 1% → WARN, > 5% → CRIT | evaluator failing silently |
| 3 | **Decision-grade rate collapse** | `dgic_baseline_24h.dgr_pct`, per tenant | drop > 60% below trailing-7d median | the news-allowlist collapse (DGR would crater) |
| 4 | **Critical/high missing enrichment** | `crit_high_reasoning_pct` | < 100% (any crit/high sub_grade for reasoning) | the 86%-unreasoned-critical finding |
| 5 | **Operator-visible without DGIC stamp** | `signals` active + `dgic_status IS NULL` post go-live | any → CRIT | bypass + future direct-write regressions |
| 6 | **Source/provenance completeness collapse** | % decision-grade with source_url/publisher/publication present | drop > X% below baseline | the 30%-missing-source_url finding |
| 7 | **Monitor "succeeded" but decision-grade = 0** | heartbeat `status=succeeded` ⋈ 0 decision-grade attributed over N runs | ≥3 consecutive runs, 0 decision-grade | social fail-open ("succeeded" + junk) + news-allowlist + inflated counters |
| 8 | **Capability unavailable while fallback pretends healthy** | capability probe: social-unified Graph-API path used vs CSE-only; provider 429 state | Graph token off / API path unused while emitting "succeeded" | the social dry-up (Meta Graph token off, CSE returning homepages) |

Checks 7 & 8 are the heart of the principle: a monitor that runs and reports success while producing **zero decision-grade intelligence** is the exact "looks healthy, isn't" failure that has recurred all session.

## Layer 3 — Health Monitor truth (the funnel, not a boolean)
Health Monitor must expose, per monitor run **and** per tenant/source, the full admission funnel — replacing the single `signals_created` number:

```
monitor ran            (heartbeat exists, status)
  └─ candidates found       (items_scanned / urls_received)
       └─ candidates admitted    (passed pre-gates + dedup + relevance → reached insert)
            ├─ decision-grade accepted   (dgic_status = decision_grade)
            ├─ sub-grade / quarantined   (dgic_status = sub_grade)
            └─ rejected (with reason)    (filtered_signals reasons + admission reject codes)
  └─ last decision-grade signal   (max created_at where dgic_status=decision_grade, by tenant/source)
```
Every transition is a number with a reason, so "ran but produced nothing" is visible *and explained* (allowlist-rejected? relevance-rejected? deduped? fail-open-then-corrected?). Data is fully derivable from `signals(dgic_*)`, `filtered_signals`, the admission `AdmissionResult` outcomes (logged to telemetry), and heartbeats.

## Layer 4 — Tenant-level visibility (CRT + SSO)
A per-tenant health panel for the real tenants (Silent Shield Operations, Critical Risk Team):
- **Last decision-grade signal** (timestamp + age) — the freshness truth.
- **Last monitor run** per source.
- **Accepted vs rejected rate** (decision-grade / evaluated).
- **Top reject reasons** (from `filtered_signals` + admission reasons).
- **Source capability status** (e.g., Meta Graph token valid? news allowlist size? provider quota?).

This is the surface that makes "Petronas is dark today" obvious to *us* at 14:00, not to the client at 09:00 next day.

## Layer 5 — Alert principle + metric retirement
- **Per-tenant decision-grade freshness SLO** replaces the blunt global "0 signals in 6h": alert when a tenant's time-since-last-decision-grade exceeds *its own* normal cadence. (The original alert was correct about degradation but blunt about cause; DGR-per-tenant localizes it.)
- **Retire `signals_created`** from health logic (`system-watchdog` `recentSignalCount` ~L1206 and heartbeat counters). Rename heartbeat `signals_created` → `candidates_evaluated` so it never again implies ingestion = intelligence.
- The bar: **the platform must detect a decision-grade collapse before the affected tenant would.**

---

## Build sequencing (folds into the existing plan; gates updated)
1. **CI parity (Phase B)** — in progress; gates the controller cutover. (Layer 1.)
2. **P0 + P1 (audit-only stamps)** — produce the `dgic_*` substrate. Observability reads these in audit mode.
3. **Layers 2–4 built alongside P1**, reading the audit-only stamps; thresholds **calibrated from the P1 baseline** (same empirical approach as the relevance floors). No enforcement needed — these are *observability*, safe to light up in audit mode.
4. **Metric retirement (Layer 5)** lands with the watchdog cutover to DGR-based health.

## Definition of done (updated — DGIC is not done until ALL hold)
- CI parity green (Layer 1).
- Bypass canary green; every operator-visible signal carries a DGIC stamp.
- Watchdog checks 1–8 live and alerting on the DGIC substrate (Layer 2).
- Health Monitor shows the full funnel per monitor + per tenant/source (Layer 3).
- CRT + SSO tenant health panels live (Layer 4).
- `signals_created` retired from health; per-tenant decision-grade freshness SLO active (Layer 5).
