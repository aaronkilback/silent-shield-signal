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
**GO ruled 2026-08-07** (operator: "GO on WO-GATE-PHASE3-SHADOW-PLAN with three changes" → the three changes are folded in above as operator change 1/2/3 → "start the Phase 3 shadow build"). Build order:
1. **`ingest_shadow` substrate table** — RLS-at-creation, forward-only, 30-day retention. *(this slice)*
2. Shadow matcher module (`_shared/shadow-matcher.ts`) — token-boundary + semantic + asset-geo(fail-closed) — pure, no writes.
3. Shadow scorer (`computeComposite` replica + tier-2 eligibility) + severity recalibration (corroboration-gated critical).
4. Wire the shadow into `process-intelligence-document` (path='rss') **and** `ingest-signal` (path='ingest_signal'), each after its live gate, swallow-on-failure, no `signals` write, no live `ai-decision-engine` call.
5. 30-day purge cron (`purge-ingest-shadow-nightly`, mirrors `purge-ingest-decisions-nightly`).
6. 611-fabrication batch pass (separate from the live stream).
7. 7-day compare query → operator cutover ruling.

No `signals` writes at any step until the operator rules cutover.
