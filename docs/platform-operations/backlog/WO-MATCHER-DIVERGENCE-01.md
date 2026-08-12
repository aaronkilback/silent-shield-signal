# WO-MATCHER-DIVERGENCE-01 — the monitor→ingest-signal path does not run the deterministic matcher

**Logged 2026-08-12. Open hole, not tech debt. Do not start (logged per operator ruling).**

## Finding
There are two client matchers:
- **Deterministic (authoritative):** `_shared/deterministic-matcher.ts` (extracted 2026-08-12 from process-intelligence-document, parity-proven). Token-boundary + tightened `REGIONAL_ANCHORS` + tier-2 named-anchor. Used by the RSS/document funnel.
- **Loose (deprecated):** `_shared/keyword-matcher.ts`. Includes-based, no token-boundary, no tightened anchors. `ingest-signal` imports only its `isFalsePositiveContent`; the monitors themselves attribute by "this monitor searched this client's keywords" (searched-keyword → attributed), which is looser still.

## Why this is a live hole
The monitor→`ingest-signal` path (all monitor-created signals) does **not** run the deterministic matcher. **Live ingest is still producing loose attributions today** — the same class of over-attribution the deterministic cutover fixed for the RSS path is still happening on the monitor path. Re-attribution (in progress) corrects STORED signals; this WO is about NEW signals still arriving mis-attributed.

## Scope (when started, separately)
Route the monitor→ingest attribution through the deterministic matcher (or verify each monitor's per-client search is anchored). Do not conflate with the re-attribution build (that is stored-row correction; this is the live ingest path).
