# WO-SILENT-ZERO-PROBE — monitor-level "ran but produced nothing" detection (design, no build)

**Status:** Design draft for operator review. No build.
**Extends:** `wo-coverage-source-health-registry-spec.md` (WO-COVERAGE #156). This is the **monitor-level** silent-zero probe; WO-COVERAGE's per-source counters are the **feed-level** track. Same doctrine, two granularities.
**Ratified inputs it must obey:** (a) count **terminal signals landed**, never `result_summary.signals_created` (WO-COVERAGE Case #2 — that counter is misnamed/optimistic); (b) per-producer **expected band**, never absolute zero (healthy-quiet ≠ broken); (c) **one finding per producer per window**, consequence-banded (attention doctrine).

## Why this outranks any individual monitor fix
The check that would have caught **court-registry at 806 runs / 0 signals**, **instagram at 84 days silent**, and the **five orchestrator monitors (~240 invocations/day, 0 signals, invisible)** — all by the same probe, because the current success criterion everywhere is **HTTP `response.ok`**, which is blind to yield. A monitor returning 200 with zero signals is counted as success by both the cron path and `auto-orchestrator`. Fixing one monitor closes one hole; this probe makes the *class* visible.

## The three states to distinguish (operator requirement)
| State | Definition | Data source | Existing coverage |
|---|---|---|---|
| **did-not-run** | 0 invocations in window W | run-record ledger (below) | WO-COVERAGE `freshness_stale` |
| **ran-and-failed** | ≥1 invocation with status=failed | run ledger + `edge_function_errors` | partial (`error_message`, circuit breaker) |
| **ran-and-produced-nothing** | ≥N successful invocations in W, **0 terminal signals** | run ledger ⨝ signals(origin) | **NONE today — this probe** |

## Two prerequisites (both are real gaps found 2026-08-14)

### P1 — durable run-record coverage for BOTH caller paths
No single existing table covers all invocations:
- `cron.job_run_details` — **cron only** (misses orchestrator fan-out; this is why the earlier "never ran" read was wrong).
- `cron_heartbeat` — only monitors that call the heartbeat helper. **Confirmed 2026-08-14: `monitor-weather / -earthquakes / -domains / -linkedin / -social` write NO heartbeat** — exactly the five the orchestrator drives ~48×/day. So heartbeat misses the motivating cases.
- edge access logs — all invocations but **24h retention** (can't see instagram's 84 days or court-registry's 806 runs).

**Requirement:** every monitor invocation emits a durable row `{monitor, caller ∈ (cron|orchestrator|manual), status ∈ (ok|failed), started_at}`. Cheapest closure: (i) have the 5 orchestrator-owned monitors call the existing heartbeat helper (they already have it as a dependency), OR (ii) have `osint-collector.delegateToFunction` write a heartbeat on the delegated function's behalf (one write, covers all router-dispatched monitors at once). Option (ii) is preferred — it also captures caller=orchestrator without touching each monitor.

### P2 — reliable per-monitor terminal-yield attribution
Yield = **count of `signals` rows attributed to the monitor in W**, via `raw_json->>'signal_origin'` (or `monitor_name`). Confirmed 2026-08-14: most discrete monitors DO stamp origin (`naad_emergency_alerts`, `monitor-cisa-kev`, `monitor-csis`, `facebook`, `instagram`, `canadian_news_rss`…), so the finding cases are covered. **Gap:** the bulk RSS path lands as `(unset)` origin (3,279 rows) — that granularity belongs to WO-COVERAGE's **per-source** counters, not this monitor-level probe. Scope this probe to **origin-stamped monitors**; any monitor whose signals are unattributable is itself a finding ("producer emits unattributed signals — cannot be yield-checked").

## The precision-feed declaration is EVIDENCE-BOUND and EXPIRES (operator amendment 2026-08-14)
`is_precision_feed` **cannot be a bare boolean** — as a bare flag it is an unfalsifiable silencer (court-registry could have been declared "precision" and run another 806 times invisibly). A declaration that a producer is legitimately-quiet requires, alongside the flag, three mandatory fields:

- **`expected_yield`** — a stated rate, not just "low". E.g. cisa-kev: `"0–5/month, gated on new-KEV cadence × client tech_stack intersection"`; darkweb: `"~0 for clients without a cataloged breach; bursty on a new breach"`.
- **`basis`** — how that expectation was *established*, as a verifiable artifact. Darkweb's is the required standard: `"verified 2026-08-14: HIBP_API_KEY set; breaches?domain= returns 200+[] for petronas.ca/bcplace.com/coastalgaslink.com and the real Adobe breach for adobe.com — endpoint discriminates, corporate domains genuinely unbreached"`. A `basis` that is not an empirical check is not a valid declaration.
- **`review_by`** — a date. **On expiry the declaration lapses and the probe fires until re-verified.** A precision feed that has never produced is re-proven periodically, never exempted permanently.

Enforcement: Variant B treats a precision-feed exemption as valid **only if `review_by >= today` AND `basis` is non-empty**. An expired or basis-less precision declaration is ignored → the producer is treated as a normal `expected-to-yield` producer and Variant B fires. This makes the silencer falsifiable and self-expiring: the same discipline as darkweb's verification today, required on a clock.

## The probe (two variants — the band is the discriminator)
Both gate on a `source_health_registry` row per producer (WO-COVERAGE substrate): `expected_daily_min`, `expected_daily_max`, and the evidence-bound precision declaration `{is_precision_feed, expected_yield, basis, review_by}` above.

**Variant A — regression (was-producing, now silent).** Band-independent, HIGH confidence.
> Producer has **≥1 terminal signal in its trailing baseline** (e.g. prior 30–90d) BUT **0 in the last W** AND ran ≥N successful times in W. → finding. Catches **instagram (84d)** and **csis (produced 19 to 2026-06-23, then 0)**. A producer that used to yield and stopped is a regression regardless of its declared floor.

**Variant B — never-yielded despite sustained runs.** Needs the declared expectation to avoid false positives.
> Producer has **0 terminal signals over its entire run history** despite **≥N lifetime successful runs**, AND it has **no *valid* precision-feed declaration** (i.e. not `is_precision_feed=true` with non-empty `basis` and `review_by >= today`). → finding. Catches **court-registry (806 runs / 0 ever)** and the **five orchestrator monitors** once P1 gives them run records. **Does NOT fire on darkweb (498 runs / 0)** while its declaration is live — declared `is_precision_feed=true`, `basis` = the 2026-08-14 HIBP verification, `review_by` = e.g. 2026-11-14. **When darkweb's `review_by` lapses, the probe fires again until someone re-runs the verification** — no permanent exemption. The *valid, unexpired, evidence-backed* declaration is the discriminator between broken-silent and legitimately-sparse.

## Applies to both caller paths
Because yield is measured from `signals` (caller-agnostic) and runs from the P1 ledger (which stamps caller), the same probe covers cron-called (court-registry, csis) and orchestrator-called (weather, earthquakes, domains, linkedin, social) monitors identically. The `caller` field is carried into the finding so the operator knows whether to look at cron or the orchestrator's hardcoded array.

## Output / attention discipline
- One finding **per producer per run**, never one-per-missed-window (attention doctrine). Severity banded: Variant A regression on a critical producer → higher; a `never-yielded` on a low-value producer → informational.
- Finding payload: `{producer, caller, runs_in_W, ok_runs, failed_runs, signals_in_W, baseline_signals, variant, shape_hint}`. `shape_hint` reuses WO-COVERAGE's four zero-shapes where the per-source counters exist (parser-0 / classifier-0 / empty-feed-0 / feed-blocked-0); for monitor-level it degrades to ran-ok-zero vs ran-failed vs did-not-run.
- Home: a new watchdog probe alongside WO-COVERAGE's `yield_below_band`. In fact **Variant A/B are special cases of `yield_below_band`** where the band floor is >0; the only genuinely new machinery is **P1 (run-record coverage for orchestrator monitors)** and the **caller attribution**. Recommend landing P1 first (it is independently valuable — it makes orchestrator-driven collection observable at all) then the two variants as registry-gated probes.

## Build order (when authorized)
1. **P1** — `osint-collector.delegateToFunction` writes a caller-stamped run record (closes the orchestrator blind spot; independently valuable).
2. Seed `source_health_registry` rows for the discrete monitors with `is_precision_feed` correctly set (darkweb/cisa-kev/naad = true; court-registry/weather/earthquakes/domains/linkedin/social = false; instagram/csis = false with baseline).
3. **Variant A** (regression) — highest value, band-independent, catches instagram/csis.
4. **Variant B** (never-yielded) — catches court-registry + the five orchestrator monitors.
5. Audit-only first (per the audit-before-blocking rule); promote to notification after the first surfaced set is triaged.

**No build until operator approves this design.**
