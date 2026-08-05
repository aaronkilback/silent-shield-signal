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

## RULING 2026-08-02: APPROVED, sequenced (no hot-swap). Progress:

### Phase 1 — FALSE-POSITIVE AUDIT — DONE (fabrication confirmed at scale)
Substring client-match doesn't just *miss* nexus, it *fabricates* it. Of **2,312** keyword-attributed signals (90d), **611 (26.4%) matched ONLY on a ≤5-char keyword** → fabricated. **609 to Kilbacks** (via "home"/"cabin"), 2 BC Place. Garbage-keyword volume: **"home" 544, "cabin" 104**. All 10 sampled were UNANCHORED — "home" matched inside `homelessness` / `hometown` / `Chomedey` (a place) / not in the signal text at all. **No deletions** (immutable chain); correction = superseding attribution (operator ruling pending).

### Phase 4 — REGISTRY TRIAGE — DONE (108 → 92 active feeds)
16 sources soft-removed (`status='paused'` + `config.registry_triage` tag; hard-delete avoided for FK-safety + provenance): **A** out-of-scope (9: FIFA×5, BC Lions, sports×2, TransLink), **B** dedup (6: Canadian Press ×2, Metro Vancouver ×3, NEB/CER ×1 — canonical kept), **C** broken-URL (1: US Wildfire → nifc.gov homepage). **Group D HELD** untouched pending the Phase-2 baseline (gate-blocked ≠ dead).

### Watchdog — DONE (Phase-1 probe)
`agent-sentinel` **Probe 2d** — fires a `high` `data_integrity` finding if any client-attributed signal in the last 24h matched ONLY on a ≤5-char substring keyword (the fabrication signature). To be re-verified after any matcher change.

### SUPPRESSION (ruling 2026-08-02) — DONE, PROVEN
The 611 fabricated-match signals are **flagged + excluded from every client-facing surface, not deleted** (immutable chain).
- **Flag:** `signals.quality_status = 'quarantined'` + `signals.quarantine_reason = 'fabricated_client_match_phase1 …'` (the existing benchmark/quarantine mechanism). 611 rows set (609 Kilbacks, 2 BC Place). Rows remain in the chain.
- **Retrieval paths (all now filter `quality_status='active'`):** frontend dashboards (`SignalHistory` via `_shared`/`src/lib` signal-query-filters) ✓ · `generate-executive-report:287` ✓ · AEGIS `dashboard-ai-assistant:6294` ✓ · **`generate-report` — patched** (added `.eq('quality_status','active')`, deployed; it previously filtered relevance but not quarantine). `ai-tools-query` no longer reads `signals` (refactored) — not a path.
- **Proof:** client-facing fetch for Kilbacks (`client_id + quality_status='active'`) → **0 of 611 flagged returned** (706 legit active remain); generate-report filter → **0 flagged**.

### CORRECTION (ruling 2026-08-02) — HELD until Phase 3
Do NOT write superseding attribution records yet — the 611 were flagged by the same matcher being replaced. After the Phase-3 shadow run, correct **once from evidence**: for each of the 611, did the semantic matcher also reject (confirmed fabrication) or accept on semantic grounds (right answer, wrong reason)?

### REGISTRY (ruling 2026-08-02) — leave soft-removed
The 16 stay `paused` + `registry_triage` tagged. No hard-delete of Group A — a paused row explains itself; a deleted row doesn't. Better artifact for the provenance-scored comparison.

### Phase 2 — INSTRUMENT THE DROPS — DONE 2026-08-02 (forward-only, live). 72h clock started **2026-08-02T19:36:11Z** → B re-run **~2026-08-05T19:36Z**
Per-item funnel recorder `public.ingest_decisions` (RLS-enabled) + RPC `record_ingest_decision` (upsert-increment on `(source_id, content_hash, stage)`; content_hash = sha256(title||source_url)). `process-intelligence-document` instrumented at all four stages (parse · client_match {drop: `no_client_match`/`false_positive_content`, pass} · relevance_score · insert). **`relevance_score` NULL-vs-numeric survives the whole path — NEVER coalesced** (pre-score client_match drops stay NULL; that's the finding). Every write is swallow-on-failure (`recordDecision` never throws → cannot fail ingest). 180-day nightly purge cron `purge-ingest-decisions-nightly` (active). `agent-sentinel` **Probe 2e** = high finding if monitor-rss ran in 6h but `ingest_decisions` got 0 writes (gated on table-ever-written to avoid day-one false positive). RPC locked to `service_role` only.

**Proof (captured live 2026-08-02):**
- **(a)** table has 17 cols, RLS=on, 5 indexes (pkey + `item_stage_uq` unique + source/first_seen + stage/outcome + first_seen), 2 CHECK constraints (stage, outcome).
- **(b)** diff: +120 lines process-intelligence-document (helper + 4 stage writes + accumulators), +36 agent-sentinel (Probe 2e).
- **(c)** first-window sample: **8 client_match/dropped rows ALL with relevance_score=NULL, scorer_reached=false, clients_evaluated=9** (Calgary fire, Midland shooting, Montreal, In-N-Out, Pear Lake wildfire, Meta protest…); relevance_score/passed rows carry the **numeric** score (0.5, scorer_reached=true); insert/passed rows written. Real semantic-adjacency example: "Dozens protest Meta data centre" matched client via **tier-2 fuzzy** (`natural gas,grid+alberta`) → scored 0.5 → inserted.
- **(d)** upsert dedupe proven: repeated doc → seen_count 3→4, original decision unchanged.
- **(e)** Probe 2e deployed + first scan ran clean (200, 7 findings — none the ingest-silent finding; correctly silent with 24 writes/6h).
- **(f)** deploy timestamp **2026-08-02T19:36:11Z**.

**Deviation flagged:** unique index is `(source_id, content_hash, STAGE)` not `(source_id, content_hash)` — the §8 funnel query counts per stage; one-row-per-item would return zeros. One row per item per stage.

**§8 B re-run query — DO NOT RUN NOW; run at T+72h (~2026-08-05T19:36Z):**
```sql
select s.name,
  count(*) filter (where stage='parse' and outcome='passed')            as parsed,
  count(*) filter (where stage='client_match' and outcome='dropped')    as dropped_pre_score,
  count(*) filter (where stage='client_match' and outcome='passed')     as reached_scorer,
  count(*) filter (where stage='relevance_score' and outcome='dropped') as dropped_low_score,
  count(*) filter (where stage='insert' and outcome='passed')           as inserted
from ingest_decisions d join sources s on s.id = d.source_id
where d.first_seen_at > now() - interval '72 hours'
group by s.name order by parsed desc;
```

### Auto-quarantine (forward-only) + pre-fix sweep — DONE 2026-08-02
- **Born-quarantine at write time:** `process-intelligence-document` now writes any signal whose client attribution matched ONLY on a ≤5-char keyword as `quality_status='quarantined'`, `quarantine_reason='fabricated_client_match_auto'` (matcher unchanged; historical 611 untouched). Proven in prod: a synthetic doc matching only `asset:Home`/`asset:cabin` scored 0.9 (would have gone ACTIVE) and was born quarantined + excluded from client-facing fetch; fixture cleaned up.
- **Probe 2d now scans ACTIVE rows only** (`.eq('quality_status','active')`) — a hit now means a fabricated match reached a client-facing row DESPITE the gate (born-quarantine failed), not noise on correctly-quarantined rows.
- **Pre-fix sweep:** 4 pre-deploy active fabricated Kilbacks signals (cabin-crew / homeless junk) quarantined with `quarantine_reason='fabricated_client_match_phase1_gap'` (deploy-timing gap, not the Phase-3 correction). Probe 2d 24h count → **0**.
- **KNOWN LIMITATION — ≤5-char false positive on legitimate short acronyms:** 2 active PECL signals matched only on real `LNG` (3 chars) were **left active** (legitimate LNG Canada coverage — not fabrication). The ≤5-char heuristic (both born-quarantine and Probe 2d) will misfire on short-but-real acronyms; needs a per-client short-acronym allowlist or the Phase-3 semantic matcher to resolve. Tracked in **WO-CLIENT-THRESHOLD-BYPASS-01**.

### Adjacent defect — WO-CLIENT-THRESHOLD-BYPASS-01 (per-client threshold inert on RSS path)
Score-scale resolution (Phase 2, item 2) surfaced that `process-intelligence-document` gates on a **hardcoded 0.3 (0–1)** for every client and **never reads per-client `min_relevance_score`** (0–100; PECL 30) — only `monitor-canadian-sources`/`agent-chat` do. So on the dominant RSS path, **client-aware relevance is client-aware in neither the match nor the threshold**. Separate fix from Phase 3 (semantic match decides WHICH client; this decides whether that client's threshold applies). Full scope: `docs/platform-operations/backlog/WO-CLIENT-THRESHOLD-BYPASS-01.md`.

### Phase 2 — original spec (PENDING → superseded by the above)
Persist a drop record per item (source_id, title, url, stage reached [keyword-gate/scorer/insert], drop reason, relevance_score NULL-vs-numeric, client_id evaluated, ts). No backfill. Then re-run B: parsed vs reaching-scorer vs scored vs inserted, by source. This is the baseline the rebuild is measured against.

### ROOT-CAUSE CORRECTION — it's ASSET-LABEL free-text matching, not keyword config (2026-08-02)
The 611 (and the 4, and the 6) matched on **`asset:Home` / `asset:cabin`** — those are `high_value_assets` entries, **not** `monitoring_keywords`. The matcher pushes `asset:${asset}` and matches it by `lowerText.includes(asset)` against the **article body** (`index.ts` ~L345). So the root cause is **asset labels matched as free text**, not keyword configuration. **Kilbacks took ~99% of the damage because their asset list is domestic property with common-noun names (`Home`, `cabin`).** PECL was spared because its assets are **proper nouns** (`Kitimat`, `PAN-OS`, `LNG Canada`) that don't collide with ordinary English.

**Implication — PECL's clean config is NOT evidence the system is safe.** Any future client with an asset named **Ranch, Lodge, Shop, Yard, Plant, Mill, Camp, Site, Barn, Well** reproduces the full failure on **day one**. This is a latent defect gated only by the current clients' asset-naming luck, not by any control.

### Phase 3 REQUIREMENT — word-boundary matching retires the length heuristic, but is NOT sufficient alone (2026-08-02)
The ≤5-char rule is a **short-keyword detector, not a fabrication detector**. Word-boundary / whole-token matching retires the length heuristic AND its `SHORT_KW_ALLOWLIST` (seeded `lng`, applied lockstep in `process-intelligence-document` + Probe 2d — transitional scaffolding): `"home"` inside `homelessness` is a **boundary violation**; `"LNG"` in `"LNG Canada"` is a **whole-token match**.

**But word-boundary matching ALONE does NOT fix the asset-label problem.** `Home` **as a whole token** still appears in thousands of unrelated articles ("... at home ...", "Home Depot", "home team"). The semantic matcher must **distinguish an asset label used as a proper noun (this client's named asset) from the same string as a common noun.** Options to evaluate in the shadow run:
- **Geo/entity co-occurrence:** asset labels only match when co-occurring with a client geo/entity anchor (e.g. `cabin` counts only near "Kaleden" / "White Lake Road" / a Kilback name).
- **Specificity threshold:** asset labels below a specificity threshold (common-noun / high corpus frequency) are **excluded from text matching entirely** and used only for **geo/spatial correlation**.
- **Per-asset match-mode flag:** each asset tagged `text-matchable` vs `spatial-only`; common-noun assets are spatial-only.

Acceptance: a boundary-anchored + proper-noun-aware matcher needs no length rule and no acronym allowlist, and a `Ranch`/`Lodge`/`Plant` asset does not fabricate nexus on day one.

### PRE-ONBOARDING CHECKLIST ITEM (process, not code) — 2026-08-02
**Audit every existing client's `high_value_assets` for common-noun labels, and add asset-list review to the client-onboarding checklist.** Before any new client goes live, flag any asset whose label is an ordinary English common noun (Home, cabin, Ranch, Lodge, Shop, Yard, Plant, Mill, Camp, Site, Well, Barn, …) — those must be geo/spatial-only or anchored, never free-text matched. This is a standing pre-onboarding gate, independent of the Phase-3 matcher work.

### KNOWN GAP — fabrication counts only cover ≤5-char matches (2026-08-02)
Every fabrication figure to date — the **611** (Phase 1), the **4** (phase1_gap sweep), the **6** (all-time active audit) — was found by the **≤5-char signature ONLY**. **Fabrications on 6+ char keywords have never been searched for.** A multi-word keyword can still fabricate nexus by substring (e.g. a keyword appearing inside an unrelated longer phrase, or matching an off-topic sense). This is a blind spot in the current audit, not a proven absence. **Quantify during the Phase-3 shadow run** (compare semantic verdict vs keyword match for ALL attributions, not just short-keyword ones) — NOT now.

### Phase 3 REQUIREMENT (2) — RSS path MUST score + dispatch, not just match (2026-08-04, finding-of-the-week)

**`process-intelligence-document` is now implicated in FIVE defects — one function starving the platform's second pillar (agent reasoning) AND flooding the first (severity signal):**
1. keyword string-overlap client matching (this WO).
2. per-client `min_relevance_score` never read (WO-CLIENT-THRESHOLD-BYPASS-01).
3. asset-label collision producing fabricated attributions (born-quarantine, DIAG-2026-08-04 §2).
4. **never writes `composite_confidence`** → **84% of signal volume (RSS, 273/324 in a 7d sample, 0% scored) bypasses `ai-decision-engine` and `review-signal-agent` entirely** → tier-2 reasoning starved → `signal_agent_analyses` 0/24h → "fleet dormant." Diagnosis: `DIAG-2026-08-04-dr-backup-and-quarantine.md` §3b. Evidence: composite_confidence scored-rate fell 85.7% (May) → 0% (this week); `signal_agent_analyses`/day 104 (Jul 17) → 0 (Aug 4).
5. **severity scorer rates 88% high/critical** (`process-intelligence-document:1075-1076`: severity from an AI `severity_score`, `≥80 critical / ≥50 high`; ~88% of RSS signals clear 50). On the dominant path the severity field **carries no information** — 67% → 76.6% high/crit and climbing as RSS's share grows. Born-quarantine is a ~2pt nudge, not the driver. (WO-WATCHDOG-FINDING-DISCIPLINE §severity-distribution.)

**Scope change:** Phase 3 **cannot just replace the matcher.** The RSS path must ALSO **score (`composite_confidence`) and dispatch through `ai-decision-engine`** on the **same terms as the `ingest-signal` path**, or the semantic gate will feed agents that still never run. A better matcher that admits more signals, all unscored, still yields 0 reasoning. **Requirement:** RSS-path signals receive `composite_confidence` and route through `ai-decision-engine` (→ tier-2 `review-signal-agent` dispatch) identically to `ingest-signal`-path signals. This closes the pillar-2 starvation, not just the attribution defects.

### Phase 3 REQUIREMENT (3) — recalibrate RSS severity so the field discriminates (2026-08-05)

`process-intelligence-document:1075-1076` sets severity from a **single AI `severity_score`** (`≥80 critical / ≥50 high`); ~88% of RSS signals clear 50, so the severity field is uninformative on the dominant path. **Requirement:** recalibrate so severity **discriminates** —
- **`critical` requires corroboration, not a single model score** (≥2 independent sources / cross-source confirmation / an incident linkage), never one LLM number.
- **Target the #83 ceiling of ~18% high/crit** (the pattern-signal cap precedent) as the sane upper bound for the dominant path, not 88%.
- **Shadow-first, same discipline as the matcher:** BEFORE cutover, run the new thresholds against the **last 30 days** and **report the distribution they would have produced** (per origin, % critical/high/medium/low) vs the current 88%. Cutover ruling gated on the shadow distribution landing near the ~18% target without dropping genuinely-critical items. No signals writes during shadow.

**Timing:** Phase 2 **B-query re-run ~2026-08-05T19:36Z** (72h clock from 2026-08-02T19:36:11Z) — **that starts Phase 3.** Do not build before then.

### Phase 3 — SHADOW RUN — PENDING (build → 7-day parallel, no signals writes)
Semantic client-match as a parallel path writing to a shadow table only. After 7 days: recall gain / false-positives removed / both-accept / new-gate volume per client per day. **Cutover ruling gated on: new-gate volume must not exceed ~3× old, else tighten first.**

### Sequencing note
This gate is **upstream of WO-OUTPERFORM** — the four-lane comparison does NOT start until Phase 3 cutover is ruled on (the harness only sees what the gate admits).

## Fix direction (design only — NOT built)
- Move client-relevance to a **semantic** match (embed doc vs client profile/taxonomy) OR broaden keyword→concept expansion, so meaning decides client nexus, not verbatim phrases.
- **Audit RSS drops** (write dropped items + reason + would-be score to a `filtered_signals`-equivalent) so this is measurable, not console-only — you cannot calibrate a gate whose rejections are invisible (fail-loud / measurability doctrines).
- Kill garbage short-term matches (min token length / word-boundary, not substring).
- Re-measure parsed→matched→scored→inserted after — success = relevant US-CERT OT/KEV advisories reach the scorer.
