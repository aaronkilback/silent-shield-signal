# SOCIAL-ENRICH (deferred) — Instagram media capture + OG-image wiring for social monitors

**Status:** Deferred backlog. Logged 2026-07-15 per operator ruling during social ingestion audit.
**Ratified rationale:** enrichment of a pipeline currently yielding 0.09 docs/run (Instagram) and 0 signals across 172 runs (monitor-social-unified) decorates an empty stream. Fix the upstream signal-yield first.
**Blocks on:** WO-CRT-READINESS Items 3-5. **No build authorized until those land.**

---

## Items to build (when unblocked)

### 1. Instagram media_urls + thumbnail_url capture

`monitor-instagram/index.ts` writes to `ingested_documents` (lines 291, 318) but does NOT insert `media_urls` or `thumbnail_url` — despite Instagram being a media-first platform. Compare to `monitor-facebook/index.ts` which does write both (`media_urls`: 1 insert, `thumbnail_url`: 1 insert, `engagement_metrics`: 1 insert, at line ~347). Instagram monitor has 0 of these.

**Result:** any Instagram post ingested arrives as caption-only. Downstream image-recognition, visual entity resolution, and evidence-package image attachments all miss the media even when it exists.

**Fix shape:** mirror the monitor-facebook pattern. Extract post-media-URL fields from the CSE result / Instagram Basic Display API response; write to `ingested_documents.media_urls`, `.thumbnail_url`, and any per-post engagement_metrics available.

### 2. OG-image wiring for social monitors

`_shared/og-image.ts::extractOGImage()` helper exists and is used by `monitor-rss-sources/index.ts:251`. **Zero social monitors call it.** Grep confirms `extractOGImage`: 0 in each of `monitor-facebook`, `monitor-instagram`, `monitor-twitter`, `monitor-social-unified`, `monitor-linkedin`.

**Result:** social docs stored without `metadata.image_url`. Downstream UI-render fallback loses the article/post thumbnail even when the OG tag exists on the target page.

**Fix shape:** call `extractOGImage(item.link)` at ingest time in each social monitor's insert path; store the result in `metadata.image_url` (matches monitor-rss-sources line 267 pattern).

---

## Why deferred

Corrected 14-day yield audit (2026-07-15) after precise `source_type='social_media'` filter:

| Monitor | 14d runs | 14d docs (`source_type='social_media'` or 'web') | 14d signals |
|---|---:|---:|---:|
| monitor-social-unified | 172 | **0** | **0** |
| monitor-instagram-2h | 43 | **0** | **0** |
| monitor-facebook | 0 | — | — |
| monitor-twitter (retired) | 0 | — | — |
| monitor-linkedin | 0 (no cron) | — | — |

`monitor-social-unified` most-recent-run rejection counters: `items_returned=28, ai_rejected=12, generic_x_profile=6, duplicate_db=1, empty_payload=1, signals_created=0`. 28 items fetched from Google CSE per run, all rejected by AI classifier or by structural filters (`generic_x_profile` = generic X/Twitter profile page with no post-specific content).

**Signal yield = 0.** Enriching zero yields zero. The productive path is: (a) fix the classifier or the query shape upstream, then (b) enrich the resulting stream.

---

## Cross-references

- **LinkedIn regex-scrape follow-on:** `monitor-linkedin/index.ts:179` uses `html.matchAll(/<div class="g"[^>]*>(.*?)<\/div>/gs)` to scrape Google search HTML — same defect class as the RSS parser bug (external-HTML-shape dependence, silent drop on structure change). Instance #8 of the 7-regex-fix follow-on PR's scope. **Deprioritized** because monitor-linkedin has no cron entry and is dormant code; do not fix dormant code ahead of live code.
- **Vocabulary defect:** all social monitors stamp `source_type = 'social_media'` (single value). Platform-specific attribution requires parsing `metadata.source_name` (currently set from `search.sourceName`, which is tenant-scoped like "BC Place" or "Trent Reznor", not platform-named). If per-platform yield is needed, either (a) add `metadata.platform` at ingest time, or (b) derive platform from `source_url` domain post-hoc. Not blocking on SOCIAL-ENRICH.

---

## Ready-to-build criteria

Before this WO enters the queue:

1. WO-CRT-READINESS Items 3-5 land (per operator ruling).
2. Upstream signal-yield problem in `monitor-social-unified` is diagnosed and either (a) fixed OR (b) explicitly accepted as steady-state (with the classifier tuned to produce non-zero throughput).
3. If yield remains zero after diagnosis, this WO becomes moot — remove instead of build.
