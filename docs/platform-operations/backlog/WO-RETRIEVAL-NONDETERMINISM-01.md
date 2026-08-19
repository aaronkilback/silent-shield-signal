# WO-RETRIEVAL-NONDETERMINISM-01 — the scan returns different findings each run

**Status:** OPEN — logged, higher priority than the clustering question. 2026-08-19.

## The finding
Two runs of the *identical* query minutes apart returned wildly different result sets:
- Run A: 27 phase1 verified, 39 phase2, 1 exposure item.
- Run B: 14 phase1 verified, 1 phase2, 3 third-party + 4 self-published items.
- **wiselaw.blogspot.com was reachable both times (Serper rank 1 for `"Olynyk v. Kilback"`) but appeared in neither run's output** — because whether the pivot even *generates* the case-name query varies run to run.

**A $10,000 deliverable cannot return different findings each time it runs.** This is the same non-determinism class we recorded for the relevance scorer earlier this week (LLM self-certainty ≠ correctness; measure-before-after) — here it is worse because it compounds across four sequential LLM stages.

## Root cause — four sequential non-deterministic LLM stages
Every post-retrieval stage is an `callAiGateway`/LLM call (`_shared/subject-retrieval.ts`):
1. **Verifier** (`verifyFindings`) — LLM. Keeps a different subset each run → 27 vs 14 verified.
2. **Source-class classifier** (`classifySourceClass`) — LLM. self_published flipped 3→0→4 across runs.
3. **Pivot** (`pivotTerms`) — LLM. Extracts a different quote/case_name each run → different propagation queries → 39 vs 1 phase2, and the `"Olynyk v. Kilback"` query (which returns wiselaw) ran in one run, not the other.
4. **Clusterer** (`clusterFindings`) — LLM. Buckets/drops differently each run, and is lossy (dropped 7 of 15 in run B).
Only the battery (fixed templates) and the search provider are deterministic. Four compounding non-deterministic stages multiply the variance.

## Mitigations to weigh (NOT built — record first)
- **temperature=0** on all four calls (reduces, does not eliminate — gpt-4o-mini at temp 0 is not fully deterministic).
- **Replace LLM with deterministic logic where the task is deterministic** (platform doctrine — deterministic-matcher, "prefer defensive layers before prompt tuning"):
  - source-class → deterministic (own-handle/personal-domain rules) instead of an LLM.
  - pivot → deterministic extraction of case names (`X v. Y`) + citations (regex) so the propagation query SET is fixed given a finding; LLM only as a fallback.
  - clusterer → deterministic fingerprint (domain + case-name + quote-hash), LLM only for the merge decision, and MUST be lossless (every finding → an item, singleton if it clusters with nothing).
  - verifier → deterministic exact-name-token gate first; LLM only for genuinely ambiguous homonyms, temp 0.
- **Determinism as an acceptance criterion:** the same subject must yield the same exposure items across N runs (± provider ranking drift). Add a repeatability check to the acceptance harness.

Cross-ref: `feedback_confidence_is_not_correctness`, `feedback_measure_before_and_after`, `feedback_prefer_defensive_layers_before_prompt_tuning`; spec `vip-reputational-retrieval-design.md`; clustering-loss is the sibling WO (fold in). This one gates a shippable product.

## UPDATE 2026-08-19 — #2/#3/A/#4 built; determinism narrowed to ONE upstream dependency
Deterministic replacements shipped: #2 source-class (rules), #3 pivot (regex litigant/case/citation), A clustering key = case-QUERY provenance (not snippet), #4 verifier name-gate (reject different-first-name homonyms; reject beats provenance-keep).残 LLM: verifier residual (bare-surname only, temp 0) + third-party-quote extractor (temp 0). Clusterer stays lossless.

**These work.** Run `16783f6f` (2026-08-19): wiselaw + pressreader clustered into ONE item `case-kilback-olynyk` "Legal case: Kilback v. Olynyk" (4 locations); all 5 homonyms (Ash/Ellen/Amparo/Kyle/Barry Kilback) rejected. phase2 noise fell 103→5 once `litigants()` replaced the "any capitalized word" extractor (the garbage `"Technology"/"Most"/"Arms" v. Kilback` queries were also POISONING provenance-keep → whitelisting homonyms; both bugs fixed by the same change).

**But the acceptance test is STILL non-deterministic** — 3 consecutive runs: `a9045363` found wiselaw in phase-1 (rank 4); `16783f6f` found it via the phase-2 case query (PASS, clustered); `d78b9c43` retrieved **zero** Olynyk/pressreader coverage in phase-1 at all (14 phase-1 findings, phase2=0, no case query → no wiselaw). **Root cause is now isolated and singular:** the `"Olynyk v. Kilback"` case query is DETERMINISTIC and reliably returns wiselaw (Serper rank 1) — but it only FIRES if phase-1 happens to retrieve the seed finding ("Ken Olynyk sued … Aaron Kilback") so `litigants()` can extract "Olynyk". Phase-1 retrieval (Serper organic ranking + possible free-tier throttling from 4 rapid test scans + LLM verifier residual) drifts run-to-run; when it drops the seed, the whole case chain collapses. The non-determinism is no longer in verify/classify/pivot/cluster LOGIC — it is in whether the SEED is rediscovered.

**The determinism fix (operator ruling):** make the case query STANDING, not conditional on rediscovery. Persist discovered litigants / case-names per `subject_entity` and seed them into every future scan's battery (the "learned/historical battery", Phase-3 of the module design). Then `"Olynyk v. Kilback"` fires every run regardless of phase-1 luck. Pairs with the #5 repeatability harness (assert the same case item across N runs). Until then, a single scan can miss the headline finding.
