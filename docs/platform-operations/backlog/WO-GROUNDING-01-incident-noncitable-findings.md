# Open findings — active incidents resting on non-citable evidence (probe (a))

**Surfaced:** 2026-07-30 by system-watchdog probe (a). **Tracked as findings, NOT a test pass.**
The probe's negative test uses a seeded fixture (proven: fires on fixture → 23, clean → 22).
These 22 are the real backlog the probe found; the render gate correctly holds ALL of them out of
report bodies (each has 0 citable supporting signals → body_eligible=false).

## Count: 22 active incidents, each with exactly 1 supporting signal, non-citable, 0 citable.
- **Petronas Canada (PECL): 12** — fd190ff4, 88e72851, d1e1ab24, 11e3f9dd, 0ee5685f, 5797b50b,
  d648f1c5, 2a6614e4, fb471f0e, 9efb3626, b7599079, d59e46ed
- **BC Place: 3** — 704b2b43, 29e52bbe, 5ee64cad
- **Kilbacks: 7** — 77703365, c0b5c502, 42b7b787, 8a57214e, be09a472, 8929d477, e7ea707d

## Reconciliation with the earlier "0 violations across 026411/026847/026848"
No contradiction — scope widened. The earlier answer examined 3 hand-picked body-eligible PECL
incidents (single citable supporting signals) and reported 0 violations among those three. Probe (a)
scans the full active population and finds 22 with non-citable primary/only evidence — a different,
non-overlapping set, all correctly body-ineligible. "3 checked, 0 bad" → "22 with non-citable
evidence" is a lens change, not a regression.

## Durable fix (not this WO): citable-evidence gate at incident CREATION.
An incident should not be created on a single non-citable signal; or, if created, must be marked
provisional and excluded from any client-facing surface until corroborated by a citable signal.
