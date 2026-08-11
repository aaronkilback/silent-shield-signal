# WO-OUTPUT-ASSERTION-MONITORING — assert PRODUCTION, not execution (SCOPE, do not build)

**Ruling 2026-08-05 (operator). The parent of every finding this week.** Every monitor Fortress has checks whether code **RAN**, not whether it **PRODUCED** anything. That one gap explains all of it:

| Symptom | Ran? | Produced? | Board said |
|---|---|---|---|
| monitor-social-unified | 164 successful runs | **0 signals/30d** | healthy |
| monitor-instagram-2h | runs | **never produced a signal** | healthy |
| dr-storage-backup | (cron fires) | **ran+copied daily 07-07→07-31 with 0 heartbeats, then ~11-day 503 gap** [corrected 2026-08-11] | registry: active |
| aegis-chat | — | **5-day 503 outage** | invisible |
| composite_confidence scorer | runs | **85% → 0% over 3 months** | "dormant fleet" |

A green heartbeat on a producer that produced nothing is a **false all-clear**. This WO makes zero-output a first-class FAILURE.

**Sequence: ABOVE `WO-METRIC-PROVENANCE-AUDIT`.** The audit tells us which numbers *currently* lie (retrospective cleanup). This stops *new* lies forming (prospective — every producer must declare and be asserted). Fix the factory before cataloguing the defects.

## Three invisibility modes (added 2026-08-07) — the coverage boundary, not just the check
The produced-leg probe assumed a job is registered with a declared schedule. This week surfaced **three distinct ways a producer goes invisible** — the probe as originally scoped catches only the third:

1. **NO EXPECTATION DECLARED — benchmark.** Triggered by a CI deploy hook, never in `cron_job_registry` → nothing to compare against → its silence is unobservable. *The watchdog can only see jobs that declared a schedule.*
2. **FAILS BEFORE INSTRUMENTATION — source-discovery-weekly.** The heartbeat write sits **after** `requireInternalCaller` (gate L72 < heartbeat L81), so an auth rejection is identical to never-invoked (0 heartbeats either way). **Audit (2026-08-07): 9 of 38 heartbeat-emitting functions have this pattern** — `alert-delivery` · `auto-enrich-entities` · `auto-summarize-incident` · `autonomous-source-discovery` · `detect-threat-patterns` · `dispatch-critical-sms` · `knowledge-synthesizer` · `monitor-community-outreach` · `monitor-court-registry` (gate line < heartbeat-call line in each).
3. **EXPECTATION DECLARED, OUTPUT NEVER CHECKED — dr-storage-backup, monitor-social-unified, monitor-instagram.** Registered + "active" with zero production, indefinitely. *(The leg this WO originally scoped.)*

## Added requirements
- **(Mode 1) Every scheduled producer is in `cron_job_registry` regardless of trigger.** A CI hook is not a schedule. If it should run weekly, the registry says so and the probe checks it. Registration is non-optional — a producer can't ship without a registry entry + output contract (same spirit as RLS-at-Creation / Two-Successes-Before-Close). Prefer converting deploy/hook-triggered producers to real cron; if a hook must trigger, still register the expectation so absence is observable.
- **(Mode 2) Record the ATTEMPT before any auth/precondition gate.** `startHeartbeat(status='attempted')` **first**, then the gate, then the outcome (`succeeded`/`failed`/`rejected`). A rejected invocation must be distinguishable from no invocation. **Fixed the 9 audited functions 2026-08-07 — see "Mode 2 resolution" below.**
- **(Mode 3) Assert production, not execution** (the original produced-leg model below).

## Mode 2 resolution (2026-08-07) — the pattern is not "always move the heartbeat"
All 9 audited functions are now handled, deployed to prod. **The fix is NOT mechanical.** Operator ruling: *"an invocation that arrives must be distinguishable from one that never happened"* — and there is **more than one correct way to satisfy that.** Blanket-moving `startHeartbeat` above the gate would have **broken two working designs**. Two of the nine were deliberate placements with real reasons, **not defects**:

| Function | Disposition | Why |
|---|---|---|
| `dispatch-critical-sms` | FIXED (attempt-before-gate) | commit `f56d256d` |
| `autonomous-source-discovery` | FIXED | `a4f86067` |
| `detect-threat-patterns` | FIXED | `a4f86067` |
| `monitor-court-registry` | FIXED | `a4f86067` |
| `alert-delivery` | FIXED | `a4f86067` (attempt hb before `authorizeInternal`) |
| `knowledge-synthesizer` | FIXED (careful pass) | `b2e23c42` — also fixed a pre-existing `loadErr` orphan + a catch using a synthetic `{id:null}` handle that mis-recorded every failure; reap-guard + INC-LEARN-CONTAM freeze-skip both already terminate the running row |
| `monitor-community-outreach` | FIXED (Pattern-B → A) | `b2e23c42` — end-of-run `recordHeartbeat` was the exact silent-crash shape that hid `monitor-social-unified` |
| **`auto-enrich-entities`** | **LEAVE + lightweight write** | Deliberate design: `startHeartbeat` sits **after** input validation on purpose, so a 400 / JSON-parse error never orphans a `'running'` row (the nightly cron always sends `batch_mode`, so its path always heartbeats). Moving it up would re-introduce the orphan. **Ruling: do not reshape.** Added only a separate best-effort **terminal `'failed'` `recordHeartbeat`** on the gate-deny path (`b2e23c42`) — records that a rejected invocation arrived, without a `'running'` orphan. This was the cheap option; taken. |
| **`auto-summarize-incident`** | **LEAVE (known gap logged)** | The heartbeat is written only inside `if (batch_mode)`, and `batch_mode` is a **post-gate body field**. A rejected **non-cron** call must **NOT** write the cron heartbeat (that would fabricate a cron run that never happened). Correct long-term answer: the **cron path gets its own attempt record keyed to the cron**, independent of the body field — deferred, not fixed today. **Known gap, recorded here, intentionally left.** |

**Doctrine recorded:** the Mode-2 pattern is *"an invocation that arrives must be distinguishable from one that never happened,"* **not** *"always move the heartbeat above the gate."* The satisfying mechanism varies: attempt-before-gate for machine-only cron functions; a separate terminal rejection record where the normal-path heartbeat placement is load-bearing (`auto-enrich`); a cron-keyed attempt record where the existing heartbeat legitimately carries post-gate data (`auto-summarize`, deferred). A blanket transform would have created orphans and fabricated cron runs. Two of nine were **correct as written** and only needed an *additive* visibility hook, not a restructure.

## Meta-point (record) — the real limit is the registry, not the probes
**The watchdog cannot report on what was never declared. Its coverage is bounded by `cron_job_registry`, which is maintained by hand.** Every probe is downstream of a human remembering to register the expectation. The systemic fix is not a better probe — it's making declaration structurally non-optional at ship time, and periodically **auditing the registry against reality** (Registry-is-a-Promise, extended: not only "registered jobs kept their promise" but "every real producer is registered at all"). Until then, board completeness = registry hygiene.

## PROVING CASE (2026-08-10) — an output contract caught a real silent-failure on its FIRST run
The new `monitor-geo-wildfire` shipped with the contract from §"The probe": *BCWS order/alert within a client's radius + 0 emitted = FAILURE.* On its **first real run** the emit path was broken (`ingest-signal` rejected an unregistered `source_key`, then `functions.invoke` returned non-2xx), and the function would otherwise have **completed 'succeeded' having produced nothing** — the exact invisible failure mode this WO exists to kill (monitor-social 164 green runs/0 signals; dr-backup (ran+copied 3wk with 0 heartbeats, then ~11-day real gap — corrected 2026-08-11); composite scorer 85%→0%). Instead it **failed loudly**: `"6 order(s)+4 alert(s) in radius but 0 emitted (errors=15)"`, with the captured cause. It fired on attempt #1, before a single quiet day could hide it. **This is the reference implementation of the doctrine: the producer asserts its own production, in-band, and refuses to report success while producing nothing.** Every scheduled producer's contract should look like this.

## Core model — an output contract per scheduled producer
Each scheduled job declares **what it produces**, not just that it ran:
- `output_table` / `output_metric` — where production lands (`signals`, `signal_agent_analyses`, an R2 object count, `entities`, a scored-rate, …).
- `window` — the assertion window (24h, 7d).
- `mode` + threshold:
  - **`rate`** — "≥ N outputs per window." `0 < min` over the window ⇒ **FAILURE**. (monitor-social: ≥1 signal/24h. dr-storage-backup: ≥1 R2 object/24h. scorer: scored-rate ≥ X%/24h.)
  - **`conditional`** — "output only when input present" — the probe asserts an **output/input ratio**, not an absolute. This is the quiet-but-working guard: `review-signal-agent` producing 0 analyses is **OK if 0 eligible signals**, **FAILURE if eligible > 0 and analyses = 0**. Declared via an `input_predicate` (e.g. `signals.composite_confidence ≥ 0.60 in window`).
- **Intermittent-but-working is declared, not inferred** — a legitimately sparse producer sets a long window (`≥1 / 7d`) or `conditional` mode. **A job that has *told us* it may be quiet does not page; a job that was expected to produce and didn't, does.** This is the operator's hard requirement: quiet-but-working must never page.

## The probe
Reads each producer's contract, queries the actual output over the window, and emits a finding when the contract is violated:
- **Zero declared output over the window (rate mode) = FAILURE (high)** — the silent non-delivery this week was full of.
- **Conditional violation (input present, output absent) = FAILURE (high)** — catches the composite→review starvation *and* distinguishes it from "nothing to do."
- Distinct from the existing watchdog (did the cron *run*) and from `WO-PUBLIC-ENDPOINT-UPTIME` (did a *visitor* get a real 200). Three legs: **executed · produced · reachable.** This WO is the **produced** leg.

## Where contracts live
Extend `cron_job_registry` (or a new `job_output_contract` table) with: `output_source`, `window_minutes`, `mode`, `min_expected`, `input_predicate` (conditional), `owner_agent`. **Registration of a scheduled producer is incomplete without an output contract** — same spirit as the Two-Successes rule (a cadence isn't proven by one run) and "Measurability is part of the feature." Candidate standing rule once built: *no scheduled producer registers without declaring what it produces and how much.*

## What each finding's contract would have caught
- monitor-social-unified / monitor-instagram-2h → `rate: signals ≥1/24h` → fired months ago (→ retire, which we just did for social).
- dr-storage-backup → `rate: R2 objects ≥1/24h` → an R2-object assertion would have shown the truth the heartbeat hid BOTH ways: green (objects landing) 07-07→07-31, then red (0 objects) from the 07-31 503 — instead of the heartbeat's flat 'never', which read as a 34-day gap that was really ~11 days (corrected 2026-08-11). Needs the non-LLM/R2 spend+object tracking from WO-METRIC.
- composite_confidence scorer → `rate: scored-rate ≥ (declared floor)/24h` → fired as it slid 85%→0%, not 3 months later as "dormant fleet."
- review-signal-agent → `conditional: analyses ≥ 1 when eligible>0` → fired the day scoring stopped feeding it, correctly silent while genuinely no eligible input.
- aegis-chat → **not** this WO (request-driven, not scheduled) → `WO-PUBLIC-ENDPOINT-UPTIME`. Boundary noted so nothing falls between them.

## Anti-fatigue
Findings aggregate (one per producer per run, not per missing row), severity-banded, and route per surface (public-facing → SMS critical; internal producer → email/dashboard). Consistent with the attention doctrine and `WO-WATCHDOG-FINDING-DISCIPLINE` (ruled findings don't re-escalate; intermittent-declared producers never page).
