# WO-PROBE-DEFERRAL-CENTRALIZE-01 — two watchdog probes carry drifted deferral lists

**Logged:** 2026-08-01. **Class:** watchdog finding-duplication / hardcoded-knowledge drift. **Log only — do not build yet.**

## Finding
Two system-watchdog probes each maintain their OWN hardcoded "known-deferred / known-limitation" list, and they have DRIFTED — producing duplicate, contradictory findings for the same subject:
- **`monitor-instagram-2h`:** the **deferred-monitors probe** (`system-watchdog:2989`, map at `3006`) knows it's a deferred keyword-CSE monitor → emits **LOW "KNOWN LIMITATION (deferred by ruling)"**. The **never-produced/pipe-rot probe** (`3267`) does NOT have it in its `SOCIAL_ALREADY_CHECKED` set (`3292` = only `monitor-social-unified`, `monitor-social-hourly`, `monitor-social`) → emits **HIGH "structurally broken, pipe-rot"**. Same subject, contradictory rulings.
- **`monitor-social-unified`:** similarly carries two findings (the "fixture clients in iteration" MEDIUM and the "0 signals — KNOWN LIMITATION" LOW).

This is NOT the containment substring-matcher — `monitor-instagram-2h` isn't in `containment_registry` at all; both findings come from independent probes.

## Fix (design)
One **deferred / known-limitation** source of truth that BOTH probes read — e.g. a `deferred`/`known_limitation` state in `containment_registry` (or a shared const), so the never-produced probe defers to it and never re-rules a monitor the deferred-monitors probe already classified. One subject → one finding → one ruling. Generalizes the containment-registry pattern to "known-limitation" states.
