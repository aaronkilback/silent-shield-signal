# WO-INCIDENT-DISPOSITION-TIMESTAMP-GAP-01 — 74% of closed incidents have no closed_at

**Logged:** 2026-08-01. **Class:** MEASUREMENT GAP (not a live defect). Recorded so it is not mistaken for a working metric.

## Finding
Of **516 closed non-test incidents, 384 (74%) have `closed_at IS NULL`** — they were transitioned to `status='closed'` by paths that never stamped the disposition timestamp. Consequence: **historical time-to-disposition is unmeasurable** for three-quarters of the corpus. The median that *can* be computed (from the 132 with a timestamp) is ~12.8 days, and 0 were closed within an hour — but that is a minority sample and should not be quoted as the platform's disposition latency.

## Why it's a measurement gap, not a live defect
- Nothing is broken operationally — the incidents are correctly closed; only the *timing metadata* is missing.
- The current `incident-lifecycle-sweep` and this session's manual closes DO set `closed_at`/`resolved_at`/`outcome_recorded_at`, so the gap is historical (legacy closure paths + the 363 ownerless batch, which have null `closed_at`).

## Scope
- Do NOT backfill `closed_at` with a fabricated time (that would invent disposition latency that was never measured — a temporal-integrity violation). Leave historical nulls as honestly-null.
- Ensure every *current* closure path stamps `closed_at` (audit the incident-close call sites; the sweep + manual path already do). Once all live paths stamp it, disposition latency becomes measurable going forward — report it only from the timestamped set, labelled as such.
