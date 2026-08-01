# WO-RSS-SEVERITY-CALIBRATION-01 — monitor-rss-sources is the severity inflation source

**Logged:** 2026-08-01. **Priority:** HIGH — the biggest real finding on the watchdog page (the "Severity distribution 85% high/crit vs ~18% target" finding). **Status:** read-only diagnosis done; **tuning HELD pending operator grading of the sample** (operator ground truth before any severity-logic change — same discipline as the incident grading).

## The number
High/critical signals by `signal_origin`, last 30 days: **`monitor-rss-sources` = 809 high/crit of 931 (87%)**; `unknown-legacy` = 548/753 (73%). Together ≈97% of all high/critical. RSS is the single dominant contributor.

## 1. How severity is assigned (the actual path)
`monitor-rss-sources` sets **no** severity itself — it ingests via `ingest-signal`, which computes severity **hybrid**:
- **Keyword rules** (`ingest-signal:67`, substring match on text): **p1 → critical** on `['credible threat','weapon','kidnap','active shooter','bomb']`; **p2 → high** on `['suspicious','prowler','tamper','breach attempt','intrusion']`. The p2 terms are broad and hit a lot of security/news copy.
- Else the **AI model** classifies (pyramid rubric at `ingest-signal:944–965`: "the large majority must be low/medium; grade CLIENT impact not headline drama"), with **analyst-feedback few-shot** injected (`862–899`). Default `medium` if unset.
- **Governance caps:** opinion-piece URLs forced to low (`489`); historical (>90d) forced to low (`1024`).
- **Not capped:** there is NO #83 producer ceiling on RSS (see §5). RSS emits high/critical freely.

## 2. Distribution per feed — UNIFORM, not a few feeds
Nearly every general-news feed is 70–96% high/crit: Energeticcity 96%, CityNews 94%, Global News Vancouver 93%, CBC National 92%, Vancouver Is Awesome 92%, 660 News 91%, Western Standard 91%, CBC BC 88%, APTN 83%, Calgary Herald 78%, Daily Hive 54%. **Systematic over-grading of general news, not feed-specific content** — the assignment layer, not the feeds.

## 3. Sample (20 random high/crit RSS, for operator grading — 2026-08-01)
Clear over-grades in the sample: "Home Price Forecast Increase" (high), "Plush red dragon toy sales surge" (high), "Cenovus Q2 Profit" (high), "Stolen Jewellery" (high), "Mobile veterinary clinic for animals affected by wildfires" (high), "CrossRoads Brewing location for sale after fire" (high), "Exploration of Nuclear Power" (high), "wildfire pact with Brazil" (high). These are news drama / general coverage, not client-impact threats — exactly what the rubric forbids. **Operator to grade before tuning.**

## 4. unknown-legacy — STILL being created (not purely historical)
1,475 total, 2026-04-02 → **2026-08-01 16:16 (today)**; **7 in last 48h, 65 in last 7d** (~9/day). Some signal path still emits signals with `signal_origin='unknown-legacy'` (an instrumentation gap — a creator not setting origin, coerced/defaulted to unknown-legacy). 73% high/crit. This is a SEPARATE producer contributing to inflation and needs its own origin-attribution fix.

## 5. #83 ceilings do NOT cover RSS
The #83 recalibration (2026-07-09) is **producer-specific**: `detect-threat-patterns`/`[PATTERN]` capped at MEDIUM (`patternSeverity`) + common-noun suppression; `monitor-domains` LOW-only. The watchdog #83 regression probe checks only those two. **`monitor-rss-sources` (and news generally) was never brought under any ceiling** — so the aggregate ≤18% target is measured, but the biggest producer has no cap. This is the structural gap.

## Candidate fixes (design; HELD until the sample is graded)
- Bring RSS/news under a producer-aware severity discipline (the #83 model, extended): news coverage defaults low/medium; high/critical requires a client-impact pathway (ties to WO-CLIENT-THREAT-RELEVANCE-01 — magnitude ≠ client-relevance).
- Narrow the p2 keyword rule (`suspicious`/`intrusion`/`breach attempt` are too broad for news text).
- Restart analyst feedback (the few-shot calibration is starved — feedback stopped 2026-07-15; the AI has no `wrong_severity` corrections to learn from).
- Fix the `unknown-legacy` origin gap so its producer is identifiable and cappable.
- **Do not tune the model prompt first** — grade the sample, define the target distribution empirically, then apply a deterministic ceiling + measure (measure-before-and-after).
