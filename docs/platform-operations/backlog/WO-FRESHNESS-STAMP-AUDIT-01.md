# WO-FRESHNESS-STAMP-AUDIT-01 — freshness fields that advance on no-op copies/polls (the timestamp lie)

**Logged:** 2026-08-02. **Status:** SCOPE + first measurement. **Priority:** HIGH. Enforces the **timestamp-lie variant** of the Fail-Loud Doctrine (`architecture-decisions/fail-loud-doctrine.md`): *a freshness field must derive from the content, not the copy operation.*

## Priority instance — `sources.last_ingested_at` advances on every poll, even a zero-item one
`monitor-rss-sources` (and other monitors) stamp `last_ingested_at = now()` after polling a feed **regardless of whether any item was fetched or any signal was created**. So "we polled it" is recorded as "it's fresh." A dead, empty, broken-parse, or mis-linked feed reads as healthy. This masks real source rot across the registry.

### The size of the lie (measured 2026-08-02)
| | count |
|---|---|
| active sources | 142 |
| `last_ingested_at` within 24h (look "fresh") | 98 |
| **look fresh but 0 signals in 7 days** | **67** |
| **look fresh but 0 signals EVER** | **58** |

**67** actively-polled sources produced nothing in a week; **58** have never produced a signal yet still stamp a fresh `last_ingested_at`. `last_ingested_at` cannot distinguish "polled and healthy" from "polled and dead" — exactly the timestamp lie. (Caveat: a low-volume feed legitimately yielding nothing for a week is possible; the **58 with zero signals ever** is the strong-evidence subset of dead/broken/mis-linked feeds.)

## Manual fetch of 3 high-volume "0-signal" feeds (2026-08-02) — it's the GATE, not silence
Fetched by hand (curl, RSS UA); `rows inserted` from the signals table (all 0):
| feed | HTTP | bytes | items parsed | rows inserted | verdict |
|---|---|---|---|---|---|
| **TechCrunch** `techcrunch.com/feed/` | 200 | 16,882 | **20** | **0** | **GATE bug** — items parse, nothing inserts |
| **US-CERT** `cisa.gov/uscert/…current-activity.xml` | 200 (→`…/cybersecurity-advisories/alerts.xml`) | 100,007 | **30** | **0** | **GATE bug** — items parse, nothing inserts |
| **Canadian Press Cyber** `thecanadianpress.com/rss/` | 200 (→`/feed/`) | **811** | **0** | 0 | **URL/feed dead** — empty feed, nothing to parse |

So group D is **not** "genuinely quiet": two high-volume publishers (20 + 30 items) parse cleanly and insert **zero** — the relevance gate is rejecting 100% of their items, or a dispatch/`source_id`-linkage bug drops them. One feed is genuinely dead (empty after redirect). **The threshold** (for the operator's follow-up): PECL `monitoring_config.min_relevance_score = 30`, plus ingest-signal's AI relevance gate (opinion-piece→low, CVE-staleness, null-result gates) — the next step is per-item instrumentation (HELD per operator: report first) to see items-parsed → passed-gate → inserted, and read the exact score each TechCrunch/US-CERT item receives. US-CERT producing 0 cyber signals is the strongest defect signal (PECL has active cyber concerns: PAN-OS/Palo Alto).

## Fix (design — do not build yet)
1. **Split "polled" from "produced."** Keep `last_ingested_at` = last poll attempt, but add/derive a **content-based freshness** signal: `last_item_at` (last time the feed returned ≥1 item) and/or `last_signal_at` (last signal from this source). Consumers of "is this source healthy" read the content-based field, never the poll timestamp.
2. **Source-rot probe:** active source with `last_ingested_at` recent but `last_item_at` (or `last_signal_at`) stale beyond a threshold → one aggregated finding. The 58-ever-zero set is the immediate backlog — triage: dead feed (retire), broken parse (fix), or mis-linked `source_id` (signals exist but not attributed).
3. Ties to the source-health-manager (WO-SOURCE-HEALTH-MANAGER-BROKEN-01, the autonomous healer that never worked) and WO-SOURCE-DISCOVERY-RELEVANCE-01 (discovery adds sources; nothing prunes the dead ones).

## Broader audit targets (same shape)
Grep hits where a freshness/currency field is stamped on a copy/sync/refresh/poll that may be a no-op, and a consumer reads it as staleness:
- **`codebase_snapshots.snapshotted_at`** — the origin instance; fixed via `git_sha` + refuse-if-stale (WO-SNAPSHOT-STALENESS-01).
- **`sources.last_ingested_at`** — this WO (monitor-rss-sources:225, ingest-expert-media:118, ingest-world-knowledge:307).
- **`flight-auto-scan.last_checked_at`** — verify it advances only on a real check.
- Any entity/report "freshness"/"generated_at" column set on regeneration regardless of input change.
Each: gate the stamp on an actual content change, or pair it with a content-derived provenance field consumers check instead.
