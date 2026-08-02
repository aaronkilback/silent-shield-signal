# WO-CLIENT-THRESHOLD-BYPASS-01 — per-client `min_relevance_score` is inert on the dominant RSS ingest path

**Logged:** 2026-08-02. **Status:** SCOPE — do not build. Document only. **Priority:** HIGH — client-facing relevance configuration is silently ignored on the path that produces most signals. **Origin:** WO-GATE-KEYWORD-PRESCORE-01 Phase 2 score-scale resolution.

## Finding
On `process-intelligence-document` (the RSS/url_feed path — see WO-GATE-KEYWORD-PRESCORE-01), the relevance gate is a **hardcoded `0.3` on a 0–1 scale** (`index.ts` ~L916: `if ((signal.relevance_score || 0) < 0.3) continue;`), plus a **`0.6`** historical-content gate (`if (signal.is_historical_content === true && (signal.relevance_score || 0) < 0.6)`). It is **identical for every client**. The per-client `clients.monitoring_config.min_relevance_score` (0–100 scale; PECL = 30) is **never read** on this path.

`min_relevance_score` is honoured in only two functions:
- `monitor-canadian-sources` — `if (match.score >= (client.monitoring_config?.min_relevance_score || {20,25,30,35}))` on a **0–100** `match.score`.
- `agent-chat` — reads it for its own filtering.

## Two scales, one converted, one not
- **0–1 scale:** the AI extraction scorer in `process-intelligence-document` (`relevance_score: { type:"number", minimum:0, maximum:1 }`). Gated at hardcoded 0.3/0.6.
- **0–100 scale:** `min_relevance_score` (PECL 30), `monitor-canadian-sources` `match.score`.
- **Precedent that the mismatch is known:** `ingest-signal:574-578` already normalizes — `if (relevance_score > 1) { relevance_score_raw = orig; relevance_score = min(orig/100, 1.0); }`. So one path converts 0–100→0–1; `process-intelligence-document` does not, and neither applies the per-client 0–100 threshold.

## Ingest-path threshold enumeration (which read per-client `min_relevance_score`)
| Path | Relevance gate | Reads per-client `min_relevance_score`? |
|---|---|---|
| `process-intelligence-document` (RSS/url_feed — dominant) | hardcoded 0.3 (0–1) + 0.6 historical | **NO** |
| `ingest-signal` (monitor→ingest direct) | `scoreSignalRelevance` (`_shared/signal-relevance-scorer.ts`) + `skip_relevance_gate`; normalizes >1→/100 | **NO** (own gate) |
| `monitor-canadian-sources` | `match.score >= min_relevance_score` (0–100) | **YES** |
| `agent-chat` | reads `min_relevance_score` | **YES** |

## Impact
On the **dominant** RSS ingest path, per-client relevance configuration is **inert**. Combined with keyword string-overlap client matching (WO-GATE Phase 1), **client-aware relevance is not client-aware on this path — in neither the match nor the threshold**: the match is decided by literal substring overlap, and the threshold is a global constant that ignores the client's configured value. A client that sets `min_relevance_score = 30` (or 70) sees no behavioural change on RSS.

## Scope for the fix (design questions — NOT decided here)
- **Enumerate/confirm** every ingest path that writes `signals` and whether it reads `min_relevance_score` (table above is the starting set; verify `monitor-news-google`, `monitor-social-unified`, `investigate-poi`, `monitor-wildfires`, `ingest-ioc-csv`, etc.).
- **Unify or convert:** decide whether to (a) unify on one scale end-to-end, or (b) explicitly convert at each gate (the `ingest-signal:574` ÷100 pattern). If converting, `process-intelligence-document`'s 0–1 score compares against `min_relevance_score/100`.
- **Calibration provenance:** determine what the `0.3` and `0.6` constants were calibrated against (if anything). No calibration record has been found — they appear to be hand-set. A per-client threshold cannot be honoured coherently until the global constant's basis is known.
- **Historical-content gate (0.6):** decide whether that also becomes client-relative or stays a global floor.

## Dependency vs WO-GATE Phase 3 (separate fixes)
This **interacts with but is distinct from** the Phase 3 semantic matcher:
- **Phase 3 (semantic match)** decides **WHICH client** an item belongs to (replaces substring overlap).
- **This WO (threshold)** decides **whether that client's configured threshold is applied** once the client is known.
Fixing one does not fix the other. A perfect semantic match still gates every client at a global 0.3 until this is addressed; a per-client threshold on top of fabricated string-overlap matches would just threshold the wrong client. Sequence: Phase 3 first (correct client), then this (correct threshold for that client) — but the design can be scoped in parallel.

## Adjacent defect surfaced same session (record here)
The **≤5-char fabrication heuristic** (born-quarantine in `process-intelligence-document` + `agent-sentinel` Probe 2d) has **false positives on legitimate short acronyms**: PECL's real `LNG` (3 chars) keyword matches genuine "LNG Canada" coverage and would be flagged/born-quarantined. Observed: 2 active PECL signals ("LNG Canada Prepares for Phase 2", "LNG Canada selects Técnicas Reunidas") matched only on `LNG` — legitimate, deliberately **left active** during the 2026-08-02 sweep. In practice recent PECL LNG news co-matches longer keywords ("LNG Canada", "Coastal GasLink"), so 0 such false positives landed in the 90-day window — but the risk is real. A real fix needs a per-client legitimate-short-acronym allowlist, or the Phase 3 semantic matcher (which removes the length heuristic entirely). Tracked as a known limitation in WO-GATE-KEYWORD-PRESCORE-01.
