# WO-ENTITY-MENTION-CONTAMINATION — report only (2026-09-01)

**Status:** SCOPED / DO NOT CLEAN. Report-only per operator. Cleanup rule: report blast radius first (same as WO-TEST-DATA-ISOLATION).

**Trigger:** during WO-TEST-DATA-ISOLATION cleanup, three real Petronas entities were found majority test-sourced — Coastal GasLink 65%, Houston BC 98%, Wet'suwet'en 72%. The operator escalated: "that is the four-signal problem at fifty times the scale, and it is worse in kind: entity mention counts feed whatever reasons about entity significance." This WO measures the true population and, critically, what consumes it.

**Bottom line:** SERIOUS, not cosmetic. **467 real entities carry test-sourced mentions; 278 are majority test-sourced; 173 (all owned by Petronas) are 100% test-sourced.** Entity mention count feeds **8 decision surfaces** — incident admission, entity quality/visibility scoring, narrative confidence, threat-radar client threat level, correlation confidence boosting, pattern-signal creation, agent context, precursor prediction — and **none of them filter `is_test`.** No *persisted/cited* client artifact has rendered a majority-test entity yet (0 provenance bindings; only 3 reports exist platform-wide), but the live scoring surfaces are contaminated now.

---

## Item 1 — Full population (is it 3 entities or 300?)

Of **1,693** real (`is_test=false`) entities that have any mentions:

| tier | entities |
|---|---|
| ≥1 test-sourced mention | **467** |
| ≥25% test-sourced | 365 |
| ≥50% (majority) test-sourced | **278** |
| ≥90% test-sourced | 174 |
| **100% test-sourced (evidence base entirely fixtures)** | **173** |

It is not three. It is **467**, of which **278 are majority-fixture** and **173 exist entirely on fixture evidence.** All 173 fully-test entities are owned by **Petronas Canada** (the flagship client) — names like "activist investor group", "Alberta energy industry", "Alberta King's bench", "Alberta oilsands", "Alberta-BC coast pipeline": plausible energy/activism entities whose entire evidentiary basis is synthetic.

## Item 2 — Source: which test signals, which fixture clients

The mentions on real entities come overwhelmingly from **test clients running through the REAL monitor pipeline**:

| source client (all `is_test=true`) | origin | mention rows on real entities | distinct real entities |
|---|---|---|---|
| **Cascade Energy** | monitor-rss-sources | **2,101** | **408** |
| _qa_test_client | qa-test | 305 | 10 |
| _benchmark_petronas | qa-test | 257 | 60 |
| Cascade Energy | monitor-wildfires | 118 | 19 |
| Cascade Energy | monitor-news-google | 65 | 27 |
| Cascade Energy | monitor-cisa-kev / unknown-legacy | 31 | 17 |
| _qa_test_client / _benchmark_bcch / _qa_cipher | monitor-csis, qa-test | ~20 | ~19 |

**Root mechanism:** **Cascade Energy is a full `is_test=true` client that is wired into the production monitors** (`monitor-rss-sources`, `-wildfires`, `-news-google`, `-cisa-kev`). Every signal those monitors produce for Cascade is `is_test=true` but still writes `entity_mentions` against **real, shared entities** (Coastal GasLink, Wet'suwet'en, and 400+ others in Petronas's graph). Cascade alone touches **408** of the 467. The `qa-test` fixtures (`_qa_test_client`, `_benchmark_petronas`) are the secondary source. Nothing filters `is_test` on the mention-write path.

## Item 3 — Consumers (THE decider) — 8 surfaces, none filter `is_test`

Mention count/recency/density is **not display-only.** It feeds, in descending severity:

1. **Incident admission — `_shared/incident-creation-gate.ts:304-321` (`countCorroboration`).** VERIFIED against source. Counts OTHER signals sharing a mentioned entity in a 7-day window (`.neq('signal_id', self)`, **no `is_test` filter**). On the confidence-null branch, corroboration ≥2 admits the signal as an incident. ⇒ **two test signals mentioning the same entity can promote a real signal to an incident.**
2. **Entity `quality_score` — migration `20260403000002_entity_quality_score.sql`.** `COUNT(entity_mentions) * 3` feeds `entities.quality_score`, which drives UI visibility (low-score entities hidden), weekly auto-archive, and significance ranking. **No `is_test` filter** ⇒ fixture mentions keep fixture-only entities visible and unarchived.
3. **`synthesize-entity-narratives`** — ranks top-20 entities by mention COUNT, synthesizes LLM narratives, writes `agent_beliefs` with confidence. No filter ⇒ narrative confidence inflated by fixtures.
4. **`threat-radar-analysis`** — entity mentions feed the client threat-level computation (critical/high/elevated). No filter ⇒ client threat level inflated by test noise.
5. **`correlate-entities` Phase 4D** — recent related-entity mentions boost `composite_confidence` by 0.05–0.15. No filter.
6. **`detect-threat-patterns`** — ≥3 co-occurring entity signals in 7d creates a PATTERN meta-signal with severity. No filter ⇒ false escalation patterns from repeated fixtures.
7. **`agent-tools-core` `query_entity_relationships`** — returns `mentions_last_90d` into agent decision context. No filter.
8. **`identify-precursor-indicators`** — mention frequency feeds early-warning LLM predictions. No filter.

(Display/context-only, lower risk: `dashboard-ai-assistant`, `briefing-chat-response`, `auto-enrich-entities`, `data-quality-monitor`.) **No materialized view / DB function aggregates mentions** — all counting is in edge-function TypeScript, so there is no single DB chokepoint today.

> The two most consequential (incident admission #1, quality/visibility #2) are the ones that mean the platform's *judgment* about real Petronas entities — which are significant, which corroborate, which to escalate — has partly rested on fixtures.

## Item 4 — Has a client-facing surface rendered a majority-test entity?

- Report claims bound to any test signal (`report_claim_manifest`): **0**.
- Briefing sources pointing at any test signal (`briefing_query_sources`): **0**.
- Stored `generated_reports` naming any 100%-test entity: **0** (but only **3** reports exist platform-wide, **0** for Petronas — so absence-of-stored-evidence is weak proof, per Absence-Is-Not-A-Value).

**No persisted/cited client artifact has rendered these.** But the surfaces that *would* — the entity-graph UI, `threat-radar-analysis`, `synthesize-entity-narratives` — read the entity graph and mention counts **live** and do not persist a searchable citation. 173 fixture-only entities sit in Petronas's live graph right now, and the 8 consumers above process them on every run. The exposure is present and live; it simply hasn't been frozen into a delivered report yet.

---

## DID IT MATTER? — measured impact (the answer)

**Yes. Fixture corroboration was admitting real signals as incidents.** Replaying `countCorroboration`'s exact logic in the correct 7-day point-in-time window over a 500-signal sample of real (`is_test=false`) signals from the test-active period (May–Jul 2026):

- **13 / 500 sampled real signals flip admit→reject** once test mentions are excluded — i.e. their corroboration cleared the incident-admit bar (≥2) *only* because test-provenance mentions were counted. Via the confidence-null fallback branch, these would have been (or were) admitted as incidents on fixture corroboration.
- 243 / 500 had test corroboration inflating their count; 452 would-admit on the base table.
- **Sampled, not exhaustive — 13 is a floor for the sample.** Upper bound on the confidence-null-branch harm, not proven-shipped incidents.

This is the finding of the workstream. The number to remember is **13/500 flips**.

## Fix status (2026-09-03)

- **Step 1 (generator) — DONE, prod.** Migration `20260901000000_entity_mentions_stamp_is_test.sql`: `entity_mentions.is_test` stamped by BEFORE INSERT trigger; backfill 2,897 test / 9,345 real / 0 unresolved; ownerless mentions RAISE. Verified (content-probe + 3-case behavioural test + row count unchanged).
- **Step 2 (seam) — IN PROGRESS.** Migration `20260901000100_entity_mentions_real_seam.sql`: `entity_mentions_real` view (single filtered count path) + `notify_entity_mentioned` neutralized (refuses test mentions). First consumer converted: **`countCorroboration`** → reads the seam. Deployed + 4-point-verified in prod: `ai-decision-engine` v182, `check-incident-escalation` v127 (both verify_jwt=false, served bundles confirmed to contain `entity_mentions_real`).
- **Remaining consumers (step 2 cont.):** `refresh_entity_quality_score` (DB fn), `synthesize-entity-narratives`, `threat-radar-analysis`, `correlate-entities` Phase 4D, `detect-threat-patterns`, `agent-tools-core`, `identify-precursor-indicators`, plus the `check-incident-escalation` post-admission "related signals" linker (a second base-table read in its own index). CI grep-guard backstop after.
- **Step 3 (cleanup) — NOT STARTED.** Report blast radius on the 467 first (esp. the 173 fully-test Petronas entities → recompute/archival decision).
- **Sibling finding split out to `WO-ENTITY-PROVENANCE-GAP`.**

## Step-3 review populations (recorded 2026-09-03 — do not re-derive)

`quality_score < 5` both hides an entity from the default UI and makes it auto-archive-eligible (weekly cron `auto-archive-stale-entities`, >30d old, no watch/photos/relationships). Recomputing the (now seam-reading) score in step 3 will move scores. Two DISTINCT populations, recorded so step 3 doesn't re-derive them:

**Population A — real entities held visible ONLY by fixture inflation (44 entities).** Have some real evidence (real_m > 0) but their `quality_score ≥ 5` drops `< 5` once test mentions are excluded. Top 20 by inflation:

| entity | id | current | test_m | real_m | → after |
|---|---|---|---|---|---|
| BC coast | 5ce66554-3942-42a3-9feb-4e5afdff7367 | 21 | 6 | 1 | 3 |
| federal government's Major Projects Office | 7f5f1b1e-495a-49bb-aa19-64011c6ed90f | 21 | 6 | 1 | 3 |
| energy sector | 785058ab-1a55-4597-bfef-0d180d6e6c49 | 21 | 6 | 1 | 3 |
| Nisga'a Nation | c8226a50-9288-4e56-9586-cfbbf37c931b | 18 | 5 | 1 | 3 |
| Energy Security and Climate Change Program | 86225d22-3f70-4d9a-982a-a5f1e9c46c31 | 18 | 5 | 1 | 3 |
| Alberta's energy minister | 0fd6b53f-7e8b-4b9d-ae81-94c70a2e5949 | 18 | 5 | 1 | 3 |
| Lytton, B.C. | 6fd30fe4-b5a1-4127-852f-10bdc67028ef | 15 | 4 | 1 | 3 |
| fossil fuel projects | d952aae3-f3e4-424a-abb3-45ab4bbc691d | 15 | 4 | 1 | 3 |
| Northern British Columbia | 6dac9d49-1ba9-4260-b264-87cf395d6bb8 | 15 | 4 | 1 | 3 |
| Adrian Wyld | d099538c-6d0c-4668-a252-a967b7c2b8b6 | 12 | 3 | 1 | 3 |
| German utility | 02d75310-e92d-480e-a61a-f72642cb02d7 | 12 | 3 | 1 | 3 |
| UCP government | 5afca0d6-d9d8-480f-9fd2-5b755acc1514 | 12 | 3 | 1 | 3 |
| energy industry | d21a117b-5cc9-4e73-841e-677a828d4569 | 9 | 2 | 1 | 3 |
| BC Lower Mainland | c8f64457-8976-4086-8f8e-fac00bda44d8 | 9 | 2 | 1 | 3 |
| Steven Guilbeault | b4753b89-ab53-479b-914e-78a1e3a0c804 | 9 | 2 | 1 | 3 |
| Commerce | ea981d6d-0ab9-4ac6-8c37-c5701ce4c8ee | 9 | 2 | 1 | 3 |
| KAPLAN | 6ad89a92-233f-40f3-8caa-3b40a1ac8e05 | 9 | 2 | 1 | 3 |
| Port Alberni | 554056a4-206e-42b9-a1e3-12ca9dbe3cc6 | 9 | 2 | 1 | 3 |
| artificial intelligence | 4cbc582c-c154-4534-9387-56b8df276b10 | 9 | 2 | 1 | 3 |
| U.S. Gulf Coast | e21adee8-0219-48ea-91ba-9914aa618878 | 9 | 2 | 1 | 3 |

Full A (44) reproducible: `entities is_test≠true, test_m>0, real_m>0, qs>=5, qs-test_m*3<5`.

**Population B — zero-real-evidence entities (173 entities) — a DIFFERENT class.** `real_m = 0`: their *entire* mention evidence is fixtures. These are not "inflated real entities" — they are entities with **no real evidence at all**, all owned by Petronas, created off Cascade/qa-test fixtures. Mostly low-score noise (many at `quality_score = 3`, already below the visibility floor), but **33 of the 173 currently cross the `≥5` threshold** (these 33 are the `real_m=0` slice of the 77). Sample: Wyoming, Wyandot Nations, West Moberly First Nations, University of Ottawa, Trans-Canada Highway, Transportation Safety Board of Canada, "two fallen N.W.T. wildfire fighters", Western provinces and territories, Wendat. Full B reproducible: `entities is_test≠true joined to entity_mentions, having real_m = 0`.

**The 77 "visible only because of fixtures" = 44 (Pop A) + 33 (Pop B ∩ threshold).** Step-3 decision differs by population: **A** → recompute (score drops, some hide/archive — a real entity, just under-evidenced); **B** → decide whether the entity should *exist* (zero real evidence under a real client is itself an artifact of the leak — remove / archive / relabel, not merely rescore).

## Root-cause shape (three layers, all the same defect)

1. **A test client (Cascade Energy) is plumbed into production monitors.** This is the generator-level defect — the 4-signals-under-real-clients problem at scale. Test signals are born correctly flagged `is_test=true`, but they mention real shared entities.
2. **`entity_mentions` writes carry no test provenance and are never filtered on read.** The link table flattens test and real provenance into one undifferentiated count.
3. **8 scoring/correlation/admission consumers count that undifferentiated total.** Because no consumer filters `is_test`, the contamination propagates into confidence, priority, visibility, and incident admission.

## Blast radius for the eventual cleanup (report-first, DO NOT execute)

- Deleting test-sourced `entity_mentions` would change `quality_score` on up to 467 entities, could auto-archive the 173 fully-test entities (correct outcome), and would re-derive corroboration/threat/narrative outputs. **Must be measured before/after per entity, same discipline as the 3 already done (CGL 132→131 etc.).**
- The 173 fully-test Petronas entities themselves are candidates for archival/deletion once their only evidence is removed — but that is a second-order decision (an entity with zero real evidence under a real client is itself an artifact of the leak).
- **Nothing here is authorized.** The cleanup competes with the guard work (item 2) — fixing the generator (unplumb Cascade from real monitors, or filter `is_test` at the mention-write/read seam) must precede any mass mention deletion, or the contamination simply refills.

## Companion doctrines
Population-Before-Check (the aperture was 3, the population is 467), Absence-Is-Not-A-Value (only 3 reports exist — clean ≠ safe), Confidence-is-not-correctness (inflated corroboration/quality is confidence resting on fixtures), and the guard-design WO (canonical `is_test` discriminator + DB-level enforcement).
