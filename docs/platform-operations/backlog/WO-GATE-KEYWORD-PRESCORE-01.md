# WO-GATE-KEYWORD-PRESCORE-01 — relevant items dropped by an exact-phrase keyword gate BEFORE scoring

**Logged:** 2026-08-02. **Status:** DIAGNOSED (do not fix yet — operator: report first). **Priority:** HIGH — bears directly on what coverage Fortress can honestly claim, and on the CRT stress test.

## The pipeline (RSS/url_feed)
`monitor-rss-sources` does **not** call `ingest-signal`. It writes items to `ingested_documents` and enqueues **`process-intelligence-document`**, whose order of operations is:
1. **Client match (KEYWORD, exact-phrase substring)** — for each active client, `lowerText.includes(keyword)` over `monitoring_keywords` + `high_value_assets`; a tier-2 industry+regional fuzzy fallback only if score==0. If **no client scores > 0** → `return []` → doc marked `processing_status='completed'`, **no signal, never scored** (index.ts ~L258–442, drop at ~L385/406).
2. **AI relevance scorer** — runs **only after** a client matches; threshold **0.3** (L826: `if ((relevance_score||0) < 0.3) skip`).
3. **RSS relevance-rejects are console-only** — not written to any audit table (unlike ingest-signal's `filtered_signals`). So for RSS, a dropped item's `relevance_score` is **NULL by construction** — never computed, never stored.

## A — per-item trace (TechCrunch + US-CERT, 2026-08-02) — PIPELINE, not calibration
Faithful replication of gate #1. **11 of 12 items: NO CLIENT MATCH → never reached scorer → `relevance_score = NULL`** (not a low score — no score). Examples:
- US-CERT **"CISA Urges Water/Wastewater Sector to Protect OT…"** → no match → dropped. This is OT/critical-infrastructure security — squarely PECL-relevant (energy/SCADA) — dropped because it lacks a **literal** PECL keyword phrase.
- US-CERT "CISA Adds N Known Exploited Vulnerabilities to Catalog" (the KEV feed, ×5) → no match → dropped. PECL's cyber keywords are over-specific (`"Palo Alto Networks PAN-OS vulnerability"`, `"Cybersecurity vulnerabilities SimpleHelp"`) and never appear verbatim in a generic CISA advisory.
- TechCrunch general tech (5/6) → no match → dropped (mostly correct — not client-relevant).
- 1 false match: TechCrunch "App Store hidden gems" → **Kilbacks** via the substring `home` — the opposite failure (garbage match from a short/common term).

**Two failure modes in one gate:** over-specific multi-word keywords miss relevant content (false negatives), and short/common terms create garbage matches (false positives). Both happen *before* the AI scorer, so the scorer never sees the items.

## B — blast radius (30 days, 108 active feeds)
| metric | value |
|---|---|
| items parsed (`ingested_documents`) | **10,191** |
| signals inserted | **960** |
| **overall insert rate** | **9.4%** (90.6% dropped) |
| sources producing ≥1 signal | **38** (not ~84) |
| high-volume feeds with 0 inserts | 2 (TechCrunch 387 docs, US-CERT 79) |

The gate drops **~9,200 items/30d**. "Scored vs dropped-pre-score" can't be split without instrumentation (the audit gap). **Only 38 of 108 feeds produce anything** — the honest producing count is 38, and even those sit inside the 9.4% overall rate.

## Root cause (operator's suspect confirmed: Gate 3 client-aware relevance)
The client-selection gate is **keyword-exact-match and precedes relevance scoring**, so client context (the *reason* to score) is decided by literal string overlap, not meaning. Relevant cyber/OT/energy advisories that don't contain a client's exact keyword phrase are dropped before the AI ever assesses them.

## Fix direction (design only — NOT built)
- Move client-relevance to a **semantic** match (embed doc vs client profile/taxonomy) OR broaden keyword→concept expansion, so meaning decides client nexus, not verbatim phrases.
- **Audit RSS drops** (write dropped items + reason + would-be score to a `filtered_signals`-equivalent) so this is measurable, not console-only — you cannot calibrate a gate whose rejections are invisible (fail-loud / measurability doctrines).
- Kill garbage short-term matches (min token length / word-boundary, not substring).
- Re-measure parsed→matched→scored→inserted after — success = relevant US-CERT OT/KEV advisories reach the scorer.
