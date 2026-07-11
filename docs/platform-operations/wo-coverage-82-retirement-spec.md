# WO-COVERAGE — #82 Acceptance Criterion Retirement + Volume-Band Replacement (spec)

**Status:** Design draft — for operator review. No build.
**Trigger:** #82's original acceptance criterion ("cisa-kev signals reaching Petronas") was diagnosed 2026-07-10 as a naive freshness proxy. Evidence: cisa-kev has been running successfully since deploy, correctly matching Petronas's 28-item tech_stack against KEV publications, and producing zero signals because the July 2026 KEV window was dominated by Joomla-ecosystem CMS vulnerabilities that don't touch ICS/OT + enterprise infra. Matcher is correct; publication rate is the constraint.
**Purpose:** replace the single-signal freshness proxy with a volume-band criterion derived from historical publication + tech-stack overlap rates.

---

## 1. What was wrong with the original #82 criterion

The original acceptance for #82 read (paraphrased): "when a signal from `monitor-cisa-kev` lands with `client_id = Petronas Canada`, mark #82 as accepted."

This is a **single-event freshness proxy**. It has two structural failure modes:

1. **False failure (dead-producer signal).** If the matcher is correct and Petronas's tech_stack aligns with KEV publications, but KEV happens to publish 0 Petronas-relevant CVEs for a 15-day window (as observed 2026-06-26 → 2026-07-10), the criterion fires as if #82 broke — but nothing is broken. Petronas gets alerted to a phantom failure. Operator investigates. False.
2. **False success (noise-tolerant).** If the matcher's substring inclusion accidentally matched an irrelevant vendor (a hypothetical Cisco Small Business RCE that Petronas doesn't run at all) and produced a spurious signal, the criterion would fire green even though the sensor is producing false positives. The failure mode we ACTUALLY care about — "the sensor produces accurate signals when accurate signals are warranted" — is not measured.

The fix is to move to a **rate-based criterion** grounded in historical publication data + client tech_stack overlap, evaluated over a window long enough to smooth out publication-cadence variance.

---

## 2. Proposed replacement — three-clause acceptance

**#82 is accepted when ALL three hold on a rolling 90-day window:**

### Clause A — Publication-rate baseline

CISA publishes an average of **~2-4 KEV entries per week** touching enterprise infrastructure or ICS/OT. Over 90 days, that's **26-52 entries** in Petronas's addressable universe (broad-vendor infra like Microsoft/Cisco/Fortinet/Ivanti + industrial like Siemens/Rockwell/Schneider).

Petronas's tech_stack has 28 items covering both categories. Historical KEV × tech_stack overlap rate (derived from 2024-2025 KEV catalog): **~30-50% of publishable KEV entries have at least one Petronas-tech-stack match.**

Expected 90-day match count for Petronas: **8-26 signals**. Wide range because publication cadence is bursty and product-name-granularity affects the substring match rate.

### Clause B — Matcher correctness

Over the same 90-day window, **≥95% of `monitor-cisa-kev` signals emitted for Petronas must reference a KEV entry whose `vendorProject` or `product` string genuinely appears in Petronas's tech_stack**. Measured by re-parsing `signals.raw_json.vendor_project` + `signals.raw_json.product` against `clients.tech_stack` at signal-inspection time. Missed matches or noise matches count against.

This is a quality gate on the matcher itself. If the substring matcher starts producing hallucinated matches (e.g., "microsoft" in "microsoft-branded-generic-consumer-tool" that Petronas doesn't run) we catch that here even if raw volume looks OK.

### Clause C — Watchdog visibility

The `producer_yield_below_band` probe from the `source_health_registry` spec must be armed for `monitor-cisa-kev` with `expected_daily_min=0, expected_daily_max=6, window_days=30`. #82 is not accepted until:
- the registry row exists and is active,
- the probe has run at least 30 times,
- the probe correctly transitions from below-band → in-band and back as the 30-day yield window rolls forward (verified by simulating one drop-out and one recovery in staging).

This ensures we've replaced the naive freshness proxy with a probe that actually understands the producer's shape.

---

## 3. Rollout mechanic — how #82 transitions

Assuming operator approves this spec:

1. **Immediately:** update the `#82` entry in `ops/ledger/WORK-ORDERS.md` — mark original acceptance criterion RETIRED with a pointer to this doc. Add a new "acceptance under revised criterion" section citing Clauses A/B/C.
2. **On source_health_registry ship (whenever that lands):** insert `monitor-cisa-kev` row with the values from §3.1 of the registry spec. Add a `notes` field: "#82 acceptance depends on this row per WO-COVERAGE 82-retirement spec."
3. **30 days after registry ships:** compute Clauses A and B against the actual observed data. If both pass, evaluate Clause C. If all three pass, #82 is closed.
4. **If any clause fails at day 30:** the failure mode identifies the next fix:
   - **Clause A low:** either CISA publication rate is genuinely below baseline (log and re-derive) OR Petronas's tech_stack has drifted (client-config work).
   - **Clause B low:** matcher is producing hallucinations OR product-name granularity has shifted. Sample the failing signals, characterize, patch matcher.
   - **Clause C failure:** watchdog probe is misconfigured. Adjust bands and re-verify.

The whole point is that "failure" now produces a specific next-fix pointer instead of a generic "cisa-kev broken" alarm.

---

## 4. Retiring the old ledger acceptance

The current `WORK-ORDERS.md` reference for #82 says the acceptance criterion is "cisa-kev signals reaching Petronas." Proposed ledger delta:

```markdown
## #82 — CISA KEV ingest for Petronas Canada

### Original acceptance criterion — RETIRED 2026-07-11
"cisa-kev signals reaching Petronas" was a naive freshness proxy.
Cannot distinguish healthy quiet (publication drought) from structural
failure. Diagnosed 2026-07-10 as unmeetable in a 15-day window when
KEV publications happened to be Joomla-CMS-dominated.

Retired in favor of the three-clause volume-band criterion below.
Retirement backed by observed evidence:
  - 2026-06-26 to 2026-07-10 (15d): 0 signals reaching Petronas
  - Matcher verified correct: 4 recent KEV entries checked against
    Petronas tech_stack (28 items) — zero overlap. All 4 entries were
    web-CMS extensions, not ICS/OT / enterprise infra.
  - #82 was NOT structurally broken during that window; the acceptance
    criterion was.

### Replacement acceptance — WO-COVERAGE 2026-07-11
See `docs/platform-operations/wo-coverage-82-retirement-spec.md`.
Clauses A/B/C summarized:
  A. Publication-rate baseline: Petronas should see 8-26 cisa-kev
     signals per rolling 90d based on historical KEV × Petronas
     tech_stack overlap.
  B. Matcher correctness: ≥95% of emitted signals reference a KEV
     vendorProject/product that genuinely appears in Petronas
     tech_stack (measured at signal-inspection time).
  C. Watchdog visibility: `producer_yield_below_band` probe for
     monitor-cisa-kev in source_health_registry, exercised through
     one below-band → in-band transition and one in-band → below-band
     recovery.

All three must hold; failure of any clause names its own next fix.
```

---

## 5. Adjacent producers that need the same reframe

`#82` is not unique. Any producer whose acceptance was measured by "first signal lands" without a rate model has the same structural weakness. Candidates for the same retirement pattern:

- `#10` — monitor-instagram-2h "never produced a signal" → same pattern (matcher may be correct, publication/query yield is the constraint). Under this doctrine, #10's real acceptance is a rate criterion after debugging the empty-query issue.
- Any future "single-signal-proves-capability" acceptance in the WO series.

Recommend a standing note in `STANDING_RULES.md` (or a new memory) that acceptance criteria for cadence-driven producers must use a rate window, never a single-event proxy.

---

## 6. Open decisions for your review

1. **Clause A range (8-26 signals / 90d for Petronas).** This is my read from KEV historical publication rate. Is that plausible to you? I can tighten with a more careful historical derivation if you want a firmer number.
2. **Clause B threshold (95% matcher correctness).** Is 95% right, or do we want tighter (98%) to catch subtle matcher drift, or looser (90%) to tolerate expected substring-fuzziness?
3. **Clause C staging simulation.** Do you want to explicitly simulate both transitions (below→in-band recovery + in-band→below drop) in staging before #82 closes, or is the arming + one observed transition sufficient?
4. **Retroactive application.** Do we retire all similar "first-signal" acceptance criteria in the ledger backlog (Q&A #10 etc.) as a batch, or handle case-by-case?
5. **Standing rule.** Add "acceptance criteria for cadence-driven producers must use a rate window" to STANDING_RULES.md as a new rule?
