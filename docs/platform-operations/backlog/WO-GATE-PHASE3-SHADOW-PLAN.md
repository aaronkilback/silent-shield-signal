# WO-GATE-PHASE3-SHADOW-PLAN — Phase 3 shadow build plan (PLAN, ruling before build)

**Released 2026-08-07.** Parent: WO-GATE-KEYWORD-PRESCORE-01 (3 requirements). B-query at n=5,208 confirmed **86.4% dropped pre-score at `client_match`, 11% end-to-end yield.** Build all three **shadow-first, no writes to `signals`, 7-day comparison against the same window, operator rules cutover.**

## Core principle — shadow is structurally write-isolated
The shadow computes matcher + score + severity for **every RSS item** alongside the live gate, and writes **only** to a new shadow table. **The shadow code path has no `signals` insert and does not invoke the live `ai-decision-engine`/`review-signal-agent`** — write-isolation is a property of the code path (no capability), not discipline. Live behaviour is unchanged during the 7 days.

## Where it runs — BOTH paths (operator change 1, 2026-08-07)
Run the shadow in **both** `process-intelligence-document` (RSS) **and** the `ingest-signal` path — each after its live gate — writing `ingest_shadow` rows tagged `path='rss'|'ingest_signal'`. **Report the two paths separately.** Rationale (operator): the benchmark exercises ingest-signal, so comparable numbers on both are needed before WO-OUTPERFORM; and **if the new matcher behaves differently on a path that already works (ingest-signal), that indicts the matcher, not RSS.** Same input stream per path → apples-to-apples within each. Shadow compute adds AI cost (semantic match + composite scoring per item) — budget it; if cost forces sampling, fix the rate and `log()` it (no silent cap). Swallow-on-failure like the existing instrumentation — the shadow can never fail the live ingest.

## Substrate — `ingest_shadow` table (RLS-at-creation, named consumer = the 7-day comparison)
One row per item (either path): `path ('rss'|'ingest_signal'), source_id, content_hash, item_title, item_url, first_seen_at,` **live side:** `live_matched (bool), live_client_id, live_outcome, live_severity,` **shadow side:** `shadow_matched (bool), shadow_client_ids[], shadow_match_basis (semantic|token|asset_geo), shadow_match_confidence, shadow_geo_suppressed (bool), shadow_asset_label, shadow_composite_confidence, shadow_tier2_eligible (bool), shadow_severity, shadow_severity_basis, shadow_corroboration_count`. RLS enabled + service-role/SECURITY-DEFINER writes only, deny-by-default (RLS-at-Creation standing rule). Consumer = the cutover comparison query (satisfies no-persistence-without-named-consumer). Forward-only, no backfill; 30-day retention.

## Requirement 1 — semantic client matcher (shadow)
Replace `lowerText.includes(keyword)` with a semantic verdict per (item × client):
- **Token-boundary anchoring** first — a keyword matches only as a whole token (`home` ≠ `homelessness`, `LNG` = whole token). Retires the ≤5-char length heuristic + allowlist.
- **Semantic match** — embed the item, compare to each client's keyword/asset/monitoring-context embeddings (or an LLM classifier "does this item concern client X"), producing a match confidence.
- **Asset-label geo/entity anchor** — a common-noun asset label (`asset:Home`, `asset:cabin`) counts **only if** the item also matches the client's geography or a linked entity. **Dependency: client asset geography (`client_geo_assets`/locations) is sparse/missing today** — for clients without geo, asset-label matches **fail closed (suppressed)** in shadow, flagged `geo_pending`. Provisioning client geography is a prerequisite for the geo-anchor to *add* recall; the shadow proceeds on token+semantic meanwhile.
- **`geo_pending` COST COUNTER (operator change 2):** record `shadow_asset_label_geo_suppressed` per item + the matched asset label, so the 7-day compare reports **how many items would have matched on an asset label but were suppressed for `geo_pending`, per client.** Large for Kilbacks → provisioning asset geography moves up the queue; near-zero → the asset-matching path was noise and we say so.
- Output: `shadow_matched`, `shadow_client_ids[]`, `shadow_match_basis`, `shadow_match_confidence`, `shadow_geo_suppressed (bool)`, `shadow_asset_label`.

## Requirement 2 — composite_confidence + tier-2 routing (shadow)
For each shadow-matched item, compute **`composite_confidence`** with the **same `computeComposite`** the ingest-signal path uses (relevance × source-credibility × AI-confidence), and compute the **tier-2 eligibility** (`≥0.60`) — i.e. record whether it *would* dispatch to `review-signal-agent`. **Replicate the scoring/tier logic in the shadow — do NOT call the live `ai-decision-engine`** (avoids any live write/dispatch). Record `shadow_composite_confidence`, `shadow_tier2_eligible`. Closes the pillar-2 starvation projection: today RSS composite coverage = 0%; shadow target ≈ 100%.

## Requirement 3 — severity recalibration (shadow)
Replace the single `severity_score` (≥80 crit / ≥50 high) with:
- **`critical` requires corroboration** — ≥2 independent source domains, or cross-source confirmation, or an incident linkage — **never a single model score.** Record `shadow_corroboration_count`.
- Calibrate high/medium/low to a **~18% high+critical ceiling** (the #83 precedent), not 88%.
- Record `shadow_severity` + `shadow_severity_basis` alongside the live severity for distribution comparison.

## 7-day comparison (the cutover evidence) — report per client per day
1. **Recall gain:** items the new matcher admits that the keyword gate DROPPED (`no_client_match`) — sample judged real vs noise (human/LLM adjudication on the held-out rule).
2. **False-positive rate:** shadow-admitted items that are actually noise.
3. **Both-accept / agreement.**
4. **Volume ceiling:** new-gate admits **must not exceed ~3× old** per client per day (WO-GATE cutover gate) — else tighten before cutover.
5. **Severity distribution:** shadow high+crit % vs the live 88% — target ~18%.
6. **composite coverage + tier-2 projection:** % scored (target ~100%), # that would reach review (vs 0 today).

7. **★ 611-fabrication verdict (operator change 3 — the held-back Phase-1 correction):** for **each of the 611 previously-quarantined fabricated attributions**, run the new semantic matcher and record **accept vs reject**. This is the evidence-based correction held back in Phase 1 (CORRECTION ruling in WO-GATE-KEYWORD-PRESCORE-01: "correct once from the matcher's verdict, not twice"). Report: of 611, how many the new matcher **also rejects** (confirmed fabrication) vs **accepts on semantic grounds** (right answer, wrong original reason). This closes the 611 from evidence, not re-inference. Run as a batch pass over the stored 611 (they carry their original item text), separate from the live 7-day stream.

## Cutover ruling (operator, after 7 days)
Gated on: recall gain is real (not noise), false-positives acceptable, **volume ≤ ~3× old**, severity ≈ 18%, composite coverage ≈ 100%. Only then flip the live path. **No `signals` writes until the operator rules cutover.**

## Sequencing
This is item (a) of the recorded build order; (b) synthetic-activity-removal, (c) watchdog-discipline, (d) metric-audit, (e) DR follow. **WO-OUTPERFORM stays gated behind the benchmark rebuild (separate ruling).**

## Build status
**GO ruled 2026-08-07** (operator: "GO on WO-GATE-PHASE3-SHADOW-PLAN with three changes" → the three changes are folded in above as operator change 1/2/3 → "start the Phase 3 shadow build"). Build order + status:
1. ✅ **`ingest_shadow` substrate table** — RLS-at-creation, forward-only, 30-day retention. Applied prod, RLS verified.
2. ✅ Shadow matcher module (`_shared/shadow-matcher.ts`) — token-boundary + injectable semantic + asset-geo(fail-closed geo_pending) — pure, no writes.
3. ✅ Shadow scorer (`_shared/shadow-scorer.ts`) — canonical `computeComposite` + tier-2 eligibility + severity recalibration (corroboration-gated critical).
4a. ✅ Wire the **deterministic** shadow into `process-intelligence-document` (path='rss'), every item at client_match, write-isolated + swallow-on-failure. Deployed. **+ durable swallowed-failure counter** (`edge_function_errors` `error_code='phase3_shadow_swallowed'`) so broken ≠ idle. Empirically write-isolated (signals grew only by live insert passes).
4b. ⚠️ **Semantic recall leg** = `classify-shadow-semantic-nightly` (registered cron 09:15 UTC, attempt-first heartbeat, output assertion, ITEM_CAP=2000 + $1.00/run spend ceiling, **measured** spend logged). 100% coverage, off the hot path, LLM multi-class (gpt-4o-mini). **First real run 2026-08-08 09:15Z SIGKILLed at ~198s edge wall-clock** after classifying 317 items (4 semantic matches), **actual spend $0.0416 = $0.00013/item** (BELOW the $0.00021 estimate; full-run ≈ $1.95/mo). NEITHER cap hit — the failure is TIME, not spend/volume: a serial per-item LLM loop can't clear the backlog in one edge invocation (~200s ceiling ⇒ ~320 items max). Two bugs: (1) ITEM_CAP is a spend governor, not a wall-clock governor; (2) NO reap-on-next-start guard, so the killed run's heartbeat sat 'running' 7.2h. Stuck heartbeat reset to 'failed' (operator-authorized). **FIX PENDING OPERATOR RULING before re-run:** add a ~150s wall-clock budget + concurrency (batch ~8) so ~500/day clears in one run + reap-on-start guard + complete heartbeat with partial/remaining + measured spend. 186 candidates currently unclassified.
    - *Remaining 4b detail:* live per-item model severity + corroboration capture for matched RSS items (currently null / corroboration=0).
5. ✅ 30-day purge cron (`purge-ingest-shadow-nightly`, 04:23 UTC, pure-SQL, mirrors `purge-ingest-decisions-nightly`). Retention decided up front.
6. ⏳ 611-fabrication batch pass (separate from the live stream) — **held for after the 48h report** (operator sequencing).
7. ⏳ 7-day compare query → operator cutover ruling — **held for after the 48h report**.

**Also (ruling 1, 2026-08-07):** `monitor-community-outreach` DE-REGISTERED (phantom; never had a prod cron) — registry row deleted, heartbeat allowlisted as retired. Re-register deliberately with an output contract if it matters later.

## 48h RESULTS + CUTOVER RECOMMENDATION (2026-08-09, 54h window, 870 rows)
| Criterion | Threshold | Result | Met? |
|---|---|---|---|
| 1. Recall gain (real vs noise) | real, low-noise | 12 recalls, ALL semantic; **low precision** (7 B.C. Lions game recaps, 1 junior-hockey mis-attribution) | **NO** |
| 2. False-positive rate | acceptable | semantic recall majority not genuine security nexus | **NO** (semantic leg) |
| 3. Both-accept agreement | — | 2 both-matched | n/a |
| 4. Volume ceiling ≤ ~3× old | ≤3× | shadow admits **14 vs live 105 = 0.13×** (stricter, not looser) | **YES** |
| 5. Severity dist ~18% high+crit | ~18% | **untestable** — all 14 shadow-matched are semantic-recovered w/ no model severity → 100% 'low' | **NO (untestable)** |
| 6. Composite coverage ~100% + tier-2 proj | ~100% | 14/14 composite-scored, 14/14 tier-2-eligible (projection on small n) | **YES (projection)** |
| 7. ★ 611/665 semantic verdict | each accept/reject | **batch pass NOT BUILT** (slice 6) | **NO** |

Also: **fabrication kill 103** (PECL 54, Kilbacks 49); **geo_pending 24, 100% "Home"/Kilbacks → "Home-is-noise" read HOLDS**; **swallowed 0**; write-isolation intact (shadow 870 rows → **0 signals**).

**RECOMMENDATION — PARTIAL cutover, not full (not rounding toward go):**
- **CUTOVER the DETERMINISTIC matcher** (token-boundary + geo-anchor + retire common-noun asset labels like "Home"). This is proven: kills fabrication (103/54h), volume far under ceiling, isolation clean, geo-noise confirmed. The anchor tighten (already live) is the first piece of this.
- **HOLD the SEMANTIC leg from the live gate** — precision too low (recovers sports recaps + a hockey miss); tune before it may ADD to live matching.
- **Severity recalibration: not yet trustable** — no representative sample (all matched were semantic-recovered/low). Needs matched items carrying model severity before criterion 5 can be judged.
- **Build slice 6 (611/665 batch pass) BEFORE the correction lands** — criterion 7 is unmet; the evidence-based verdict requires running the matcher (deterministic + semantic) over those stored sets. Do not correct the 611/665 until then.

## HOLD state (2026-08-07):** deterministic legs burning in; deliver the 48h report (~2026-08-09 15:00 UTC: fabrication kill per client, geo_pending per client, rows/swallowed/ratio, signals==insert parity) + first-real-run spend, THEN continue slices 6–7. No `signals` writes at any step until the operator rules cutover.
