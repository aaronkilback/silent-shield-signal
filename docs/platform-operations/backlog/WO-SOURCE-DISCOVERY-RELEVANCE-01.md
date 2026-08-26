# WO-SOURCE-DISCOVERY-RELEVANCE-01 — autonomous-source-discovery has no relevance gate

**Logged:** 2026-08-02. **Status:** SCOPE + triage-marking done; fix HELD. **Priority:** HIGH. **Defect family:** same as WO-CLIENT-THREAT-RELEVANCE-01 and WO-RSS-SEVERITY-CALIBRATION-01 — **the system cannot distinguish client-relevant from topically-adjacent.** Here it manufactures the noise at the *source* layer instead of the signal layer.

## Trigger
The 2026-08-02 03:00 UTC weekly run added **3 sports feeds + 1 cybersecurity feed** to a security-intelligence platform (`total_sources_added=4`). The sports-feed rationales are textbook topical-adjacency: *"sports events that could result in security incidents"*, *"fan gatherings and venue safety"*, *"security concerns at BC Place."*

## 1. The discovery relevance gate — what actually determines whether a source is added
`autonomous-source-discovery/index.ts` (270 lines). Per-client loop; for each active client:
1. **AI suggestion** (`gpt-4o-mini`, `skipGuardrails:true`, lines 140–174): "suggest 15 high-value monitoring sources" given `industry` + `monitoring_keywords`. Relevance is **entirely delegated to this one model call.**
2. **Syntactic filter** (182–184): has `url`+`name`, `url` starts with `http`.
3. **Dedup** (194–203): skip if URL or name already tracked.
4. **`isAccessible(url)`** (206): HTTP reachability probe.
5. **INSERT `status='active'`** (214–226): immediately live.

**There is NO relevance gate.** The only hard gates are **valid-URL-shape + not-duplicate + HTTP-reachable.** "Accessible" is treated as "should be added." The AI's `rationale` is **stored but never checked**; there is no relevance score, no threshold, no second-pass verification, no human review.

**The structural defect (worse than the missing gate):** the INSERT writes **no `client_id` and no `created_by_tenant_id`** (confirmed: all 4 new rows have `created_by_tenant_id = null`). Discovery is *per-client* (it loops clients and uses each client's keywords), but the **output is client-agnostic** — a source discovered while processing **BC Place's** venue keywords is inserted **globally** and then feeds **every** client's monitors, including **PECL** (an energy client), where a sports feed is pure noise. The per-client intent is lost at the write. This is the same shape as the nullable-FK / provenance gaps elsewhere: the relevance context exists at discovery time and is thrown away at persistence.

## 2. Is this job the origin of the 2026-07-31-marked out-of-scope sources? — YES
The FIFA / BC Place / BC Lions / TransLink / DriveBC set marked out-of-scope on 07-31 (created earlier; *marked* 07-31). Origin by `config.discovered_by`:

| Source | Created | `discovered_by` |
|---|---|---|
| FIFA News Releases | 06-07 | **autonomous-source-discovery** |
| FIFA Official Website / BC Lions News | 06-14 | **autonomous-source-discovery** |
| FIFA Official News / BC Place Stadium Events | 06-21 | **autonomous-source-discovery** |
| FIFA Official website news / BC Lions Official News | 07-26 | **autonomous-source-discovery** |
| Google News: BC Place/FIFA / TransLink News & Alerts | 05-24 | **autonomous-source-discovery** |
| TransLink (manual) / FIFA Vancouver 2026 / BC Place Official | 05-21 | manual (type=`manual`) — NOT this job |
| DriveBC Traffic Alerts | 03-05 | no `discovered_by` — manual/older (and PECL-relevant: pipeline/hazmat/highway keywords) |

**Verdict:** this cron is the origin of the FIFA×n, BC Lions×2, BC Place Stadium Events, TransLink News, and Google-News-BC-Place sources. The `manual` BC Place / FIFA / TransLink rows and DriveBC are **not** from it (legitimate client setup). So the job has been **recurrently generating venue-adjacent sources for months** — the 08-02 sports feeds are the newest instance of a standing pattern, not a one-off.

## 3. Triage-marking applied (2026-08-02) — `config.relevance_scope`
No `relevance_scope` column exists; marked in `config` jsonb (same place as `discovered_by`/`rationale`). **Client attribution is inferred from the rationale text — it is NOT stored on the row** (see §1 defect).

| Source | inferred client | `relevance_scope` |
|---|---|---|
| Vancouver Sun Sports | **BC Place** (rationale names it) | `venue_security` |
| Global News – Sports Updates | BC Place (fan gatherings / venue safety) | `venue_security` |
| The Province – Sports | BC Place (generic sports, venue-adjacent) | `venue_security` |
| Canadian Press Cybersecurity News | ambiguous / cross-client | `in_scope` |

Per the operator rule ("sports feeds are out_of_scope **unless** discovered for a venue-security client — then say so"): the 3 sports feeds **were** discovered for **BC Place, a venue-security client**, so they are marked `venue_security` (valid for BC Place only) rather than blanket `out_of_scope`. **Caveat:** even for BC Place these are low-signal — a general sports/scores feed is not a security-event source (the venue's own `BC Place Stadium Events` calendar is the right instrument). **They are still `status='active'` and — because of the §1 no-client-scope defect — currently feed the global pipeline including PECL.** The marker is inert until a gate consumes it; marking scope did **not** deactivate them.

## 4. Insert-directly vs propose-to-a-review-queue — what "propose rather than add" takes (design, do not build)
Until the relevance gate exists, an autonomous job inserting `status='active'` global sources on one unverified AI call is the wrong default. Options to make it **propose**:

- **Minimal (status-based):** insert with `status='proposed'` instead of `'active'`; monitors already filter on `status='active'`, so proposed sources are inert until an operator flips them. Requires: (a) change the one INSERT; (b) an operator review surface (list `status='proposed'` + approve/reject); (c) confirm every monitor's source query is `status='active'`-scoped (audit — a monitor reading all-status would defeat this). Smallest change; reuses the existing status field.
- **Cleaner (review-queue table):** a `source_candidates` table (url, name, config, discovered_for_client_id, rationale, ai_relevance_score, state) — discovery writes candidates; an approval step promotes to `sources`. Requires the table + promotion path + review UI. Also the natural home to finally **record `discovered_for_client_id`** (fixes the §1 provenance defect) and an actual relevance score.
- **Either way, add the missing relevance gate** so the queue isn't just deferred noise: (a) **scope the source to the discovering client** (write `client_id`/`tenant_id` — stop global inserts); (b) a **relevance check beyond accessibility** — the same client-relevance primitive this defect family needs (sector/keyword/asset match, not "is it reachable"); (c) sports/scores/entertainment feeds should fail it even for a venue client unless they carry security-event signal.

**Recommendation to weigh:** ship `status='proposed'` first (hours, reuses status, immediately stops autonomous global activation), then build `source_candidates` + client-scoping + a real relevance score as the durable fix. Do not build until authorized.

## Cross-references
- **WO-CLIENT-THREAT-RELEVANCE-01** — magnitude ≠ client-relevance (signal layer); this is the same failure at the source layer.
- **WO-RSS-SEVERITY-CALIBRATION-01** — topical-adjacency drama inflation (severity layer). All three are one defect: *adjacent ≠ relevant.*
- **§1 no-client-scope** is a Provenance-Doctrine-class gap (ownerless global artifact from per-client intent).

## Immediate open question for the operator
The 3 sports feeds + the recurrent FIFA/BC-Lions/TransLink set are `active` and feeding **all** clients now. Marking scope did not deactivate them. Deactivate the sports feeds (and scope the venue set to BC Place) now, or hold until the propose-queue lands? Not actioned pending ruling.
