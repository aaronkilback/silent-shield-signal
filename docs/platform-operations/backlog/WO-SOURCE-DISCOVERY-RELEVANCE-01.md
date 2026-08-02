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
~~The 3 sports feeds… Deactivate now, or hold?~~ **RESOLVED 2026-08-02** — see AMENDMENT 1.

---

## AMENDMENT 1 (2026-08-02) — actions taken + root-defect reframe

### ROOT DEFECT REFRAME (the important correction)
**The root defect is the missing `client_id` on insert, NOT the weak relevance gate.** A *perfect* relevance judgment still produces cross-tenant noise if the output is client-agnostic: the discovery loop knows which client it is processing, but the INSERT discards that and writes an ownerless global source that then feeds every tenant's matcher. **Client scoping is the prerequisite; the relevance gate is the refinement.** Ordering:
1. **Prerequisite — client scoping.** Every discovered source must be bound to the client it was discovered for (`client_id`/`tenant_id`, or `discovered_for_client_id` on a candidates row). Without this, a discovered source is a Provenance-Doctrine-class ownerless artifact and its noise is *unmeasurable* (see §3 finding below).
2. **Refinement — relevance gate.** Only once sources are client-scoped does a relevance score (sector/asset/keyword match, event-signal) meaningfully filter *within* the owning client. A relevance gate on an ownerless source just picks which tenants get polluted more evenly.

This also reframes §4: `status='proposed'` (shipped below) stops autonomous *activation*, but the durable fix is **client-scoped candidates**, not merely a review queue of still-ownerless sources.

### c1 — 3 sports feeds deactivated
Set `status='paused'` on Global News Sports, Vancouver Sun Sports, The Province Sports (reason recorded in `config.deactivated_reason`). **Constraint finding:** `sources_status_check` allows only `active`/`paused`/`failed` — **`inactive` is not a legal status**, so `paused` was used (semantically "deactivated, not-deleted, not-error"; inert because `monitor-rss-sources` filters `status='active'`). Canadian Press Cybersecurity left `active`.

### §2/§3 — the standing population + the cross-tenant number
`discovered_by='autonomous-source-discovery'` is **~55 sources** (this job has been the platform's primary source-populator since March). 30-day signal yield by discovery intent × landing client:

| intent | landed on | signals 30d | note |
|---|---|---|---|
| **venue** (FIFA/BC Lions/sports/TransLink/FanZone/Stadium) | **BC Place = 17** | **17, 100% correct** | FIFA/sports/TransLink/FanZone/Stadium all yield **0**; only BC Lions (12) + Google-News-BC-Place (5) produce, both land on BC Place. **Cross-tenant venue noise = 0.** |
| energy | PECL 9, Cascade 7, Kilbacks 2 | 18 | on-sector |
| cyber | Kilbacks 36, PECL 6, BC Place 3, Cascade 1 | 46 | cross-relevant |
| general_news | Kilbacks 151, PECL 129, BC Place 36, Cascade 9 | **325** | 9 client-agnostic sources fanning across all 4 clients |

**The cross-tenant number, stated honestly:** the exact "discovered-for vs landed-on" split **cannot be computed** — `discovered_for_client` was never persisted (the root defect even prevents *measuring* the damage). What is measurable: (a) the venue feeds the trigger flagged produce **0** cross-tenant signals (they're near-inert); (b) **325 general-news signals** fan across 4 tenants from client-agnostic sources — that is the *structural* cross-tenant exposure the missing `client_id` creates, though it can't be cleanly labeled "noise" per-signal precisely because scope was never recorded. The surprising truth: the flagged venue sports feeds were **not** the noise engine; the ownerless general-news population is, and it's invisible to measurement.

### §4 — minimal propose path SHIPPED (2026-08-02)
- **Audit (printed before deploy): PASS.** The **only ingestion enumerator** of `sources` is `monitor-rss-sources:123` (`.in('type',[rss,url_feed]).eq('status','active')`) — status-filtered. All other readers are `.eq('status','active')` (support-chat, system-watchdog×2, fortress-qa-agent, map-policy-to-controls), by-id/by-name specific-source lookups (process-security-report, process-intelligence-document, detect-threat-patterns, correlate-signals, process-feedback, test-osint, update-osint, unified-monitoring), or **diagnostic listings with no status filter** (dashboard-ai-assistant 2815/3134, handlers-signals-incidents:780) — which are display/health surfaces, not ingestion, and where showing `proposed` is *desirable* (that's the review surface). **No ingestion reader selects all-status → `proposed` is inert.**
  - *Side finding (separate bug):* `autonomous-source-health-manager:39` queries `.eq('source_type','rss').eq('is_active',true)` — columns that **do not exist** on `sources` (real cols are `type`/`status`). That query is broken/no-op; unrelated to this WO but worth a ticket.
- **Migration:** `20260802140000_add_proposed_to_sources_status_check.sql` — adds `'proposed'` to `sources_status_check` (was required: `proposed` was illegal, same as `inactive`). Applied prod single-file.
- **Code:** `autonomous-source-discovery/index.ts` insert `status: "active"` → `"proposed"`. Deployed.
- **Effect:** the next weekly run (Sun 03:00 UTC) inserts discovered sources as `proposed` — inert until promoted. Autonomous global activation is stopped.
- **Still needed (NOT built):** a promotion surface (list `status='proposed'` → approve/reject) — currently proposed sources have no operator path to activation; and the durable client-scoped-candidates + relevance-score fix (the prerequisite reframe above). Logged, not built.
