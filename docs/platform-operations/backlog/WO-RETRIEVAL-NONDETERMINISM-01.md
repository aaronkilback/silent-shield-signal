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
