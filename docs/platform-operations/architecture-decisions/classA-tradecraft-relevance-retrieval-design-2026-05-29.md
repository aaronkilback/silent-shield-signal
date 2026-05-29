# Class A — relevance-based tradecraft retrieval design

**Date:** 2026-05-29. **Status:** design proposal. No code, no schema work, no deploy. Continues from P4 post-cutover validation (PR #55).

Per operator directive: replace the current random-3 retrieval with a relevance-based strategy. The objective is **decision acceleration, not tradecraft utilization** — tradecraft should appear in a prompt **only when it materially improves reasoning, recommendation quality, or decision support**. Empty-result acceptance is required.

---

## 0. The principle this design must honor

> *"I do not want tradecraft injected merely because a retrieval budget exists. The objective is decision acceleration, not tradecraft utilization."*

This single sentence is the design's load-bearing constraint. Every retrieval approach below MUST:

1. Apply a **relevance threshold** below which no item is returned.
2. Accept **0 items** as a valid result when nothing meets the bar.
3. Never pad the budget to a fixed count.
4. Preserve **all safety properties** from P4 (labeling, prose-lint R7, Flight Recorder, asset_class=global_shared, no tenant-scoped items).

The budget of **3 items** is the *upper bound*, not the *target*. The threshold determines the actual count returned per request, anywhere from 0 to 3.

---

## 1. Three approaches compared

### Approach A — Keyword retrieval (Postgres full-text search)

Extract topical keywords from the user's question via `to_tsvector` and rank tradecraft items via `ts_rank` against a pre-computed `tsvector` index on `hypothesis + domain + related_domains + authored_by_agent`. Apply a minimum `ts_rank` threshold gate.

| Axis | Detail |
|---|---|
| **Expected relevance improvement** | **Moderate.** Catches direct topical overlap. Misses paraphrases ("travel security" ≠ "principal movement"; "fixation" ≠ "obsessive stalking" in the corpus). Best for queries that share vocabulary with the tradecraft library. |
| **Complexity** | **Low.** Postgres has built-in FTS. Single SQL query change in `dashboard-ai-assistant`. Migration to add `tsvector` column + GIN index on `agent_tradecraft`. ~50 lines of code change. |
| **Latency impact** | **Negligible** — Postgres FTS on 15K rows with GIN index is <10ms. |
| **Explainability** | **High.** Each match has a `ts_rank` numeric score. Can show "matched on keywords: protection, principal." Operator can drill into exactly why a row was chosen. |
| **Flight Recorder observability** | **High.** Record query tsquery + per-item `ts_rank` + threshold in `provenance.keyword_ranks`. Already-existing trace shape extends naturally. |
| **Empty-result behavior** | Native. `ts_rank` is bounded [0..1]; threshold gate is a single number. |
| **Cost** | Zero per request. No external API. |
| **Failure modes** | Vocabulary mismatch (paraphrasing); stopword sensitivity (short queries noisy); over-matching on common security terms ("threat", "risk") creating false positives. |

### Approach B — Embedding retrieval (pgvector cosine similarity)

Compute embedding of the user's question via OpenAI `text-embedding-3-small` (or compatible). Backfill embeddings for all 15,418 `agent_tradecraft` rows once. Query: cosine similarity against `agent_tradecraft.embedding`; threshold gate on similarity. The `embedding vector` column already exists on the table (P0 schema) but is NULL — populating it is part of this iteration.

| Axis | Detail |
|---|---|
| **Expected relevance improvement** | **High.** Semantic similarity catches paraphrases, conceptual overlap, doctrine-level relevance. Catches "fixated subject" against tradecraft about "obsessive behavior" or "stalking pathway." Best-in-class for topical retrieval. |
| **Complexity** | **Medium-high.** Requires: (1) one-time backfill of 15,418 embeddings; (2) per-request query embedding; (3) pgvector IVFFlat or HNSW index on `agent_tradecraft.embedding`; (4) threshold tuning (what cosine value means "actually relevant"). |
| **Latency impact** | **Moderate.** Per-request: OpenAI embedding API call ~30–50ms + pgvector search ~5–10ms. Adds ~30–80ms to the chat startup; acceptable for a non-streaming retrieval step. |
| **Explainability** | **Moderate.** Can show similarity score per item ("0.82 cosine"). Less interpretable than keyword matching because "why" is hidden in embedding space, but the score + drilldown gives a proxy. |
| **Flight Recorder observability** | **High.** Capture: query embedding model name, similarity scores per item, threshold, items_returned. Provenance also records the embedding API call (latency, model version). |
| **Empty-result behavior** | Native. Cosine is bounded; threshold gate is a single number. |
| **Cost** | One-time backfill: ~15,418 × $0.02 per 1M tokens ≈ **~$1.50 total**. Per-request: ~$0.0001 (negligible). |
| **Failure modes** | Single global threshold may not optimize equally for all query types (e.g., "what is X" queries vs "how do I" queries have different similarity distributions). Off-topic queries ("what's the weather") still get *some* similarity — strict threshold required. Requires embedding-pipeline correctness (model version drift could invalidate the backfill). |

### Approach C — Hybrid retrieval (cascade: keyword filter → embedding rerank)

Two-stage:
1. **Keyword pre-filter** — eliminate obvious off-topic items quickly. Postgres FTS finds top-N (e.g., 30) tradecraft items by keyword overlap with the query.
2. **Embedding rerank** — score the pre-filtered set by cosine similarity against the query embedding. Return top-budget items that meet the threshold; return 0 if none meet it.

| Axis | Detail |
|---|---|
| **Expected relevance improvement** | **Highest.** Combines complementary strengths: keyword catches direct vocabulary overlap; embedding catches paraphrases. Cascade is industry-standard (BM25 + dense rerank). |
| **Complexity** | **Medium-high.** Combines the complexity of both approaches. Two thresholds to tune (pre-filter rank cutoff + final embedding-similarity gate). |
| **Latency impact** | **Same as embedding.** The keyword pre-filter is so fast (<10ms) it doesn't add measurable latency. The embedding API call + pgvector remain the dominant cost. |
| **Explainability** | **Highest.** Per-item: "matched keyword X → embedding rerank scored Y → above threshold Z." Operator sees both signals + final rank. |
| **Flight Recorder observability** | **Highest.** Capture both per-item signals (keyword rank + embedding similarity) + cascade thresholds + cutoff sizes. |
| **Empty-result behavior** | Native. Either gate can result in 0 final items. |
| **Cost** | Same as embedding (~$1.50 backfill + ~$0.0001/request). The keyword pre-filter is free. |
| **Failure modes** | Cascade-specific: if the keyword pre-filter cutoff is too aggressive, semantically-best items get filtered out before rerank. Mitigation: set pre-filter cutoff at top-30 (large enough that semantic rerank usually captures the best). Tuning two thresholds is more work than tuning one. |

---

## 2. Comparison at a glance

| | A — Keyword | B — Embedding | C — Hybrid |
|---|---|---|---|
| Relevance lift over current random-3 | moderate | high | highest |
| Code complexity | low | medium-high | medium-high |
| Schema changes | tsvector column + GIN index | embedding backfill + pgvector index | both |
| Per-request latency added | <10ms | ~30–80ms | ~30–80ms |
| Per-request $ | $0 | ~$0.0001 | ~$0.0001 |
| One-time setup $ | $0 | ~$1.50 | ~$1.50 |
| Explainability to operator | high | moderate | highest |
| Flight Recorder shape | extends naturally | extends naturally | extends naturally |
| Empty-result discipline | native | native | native |
| Survives model-version drift | yes | requires backfill on model change | requires backfill on model change |
| Failure mode | vocabulary mismatch | strict threshold needed | tuning complexity |

---

## 3. The decision-acceleration constraint, made structural

Regardless of which approach is chosen, the design must encode the operator's principle in the code itself:

```ts
const TRADECRAFT_BUDGET = 3;
const RELEVANCE_THRESHOLD = X;  // approach-specific
// 0 ≤ items_returned ≤ TRADECRAFT_BUDGET
// items_returned == 0 is valid AND expected when no item meets the threshold

const candidates = await retrieve(query);
const aboveThreshold = candidates.filter(c => c.relevance >= RELEVANCE_THRESHOLD);
const finalItems = aboveThreshold.slice(0, TRADECRAFT_BUDGET);
// finalItems.length can be anywhere from 0 to TRADECRAFT_BUDGET
```

**No floor, no padding.** If the relevance scores look like `[0.91, 0.42, 0.31, 0.30, 0.28]` with threshold 0.65, the result is exactly **1 item**, not 3. If they look like `[0.31, 0.30, 0.28, 0.27]`, the result is **0 items** — the tradecraft section of the prompt is simply absent.

The Flight Recorder S6 trace records the empty case too: `items_returned: 0`, `candidates_evaluated: 60`, `max_relevance: 0.31`, `threshold: 0.65`. Operator can replay any quiet response and see exactly why no tradecraft was offered.

---

## 4. Threshold-tuning methodology

For approach B or C (the embedding-based variants), threshold tuning is the make-or-break operational question. Three steps:

1. **Cold-start threshold:** set conservatively at a value that returns ~3 items for clearly on-topic queries from the validation package's 5 scenarios. From offline tests on those scenarios, expect cosine ~ 0.60–0.70 to be the right floor (precise value determined by an embedding-shape pass before deploy).

2. **Live threshold validation:** run a 7-day Flight Recorder accumulation period after deploy. Operator reviews 20 random retrievals. If false-positive rate > 20% (irrelevant items injected), raise the threshold. If false-negative rate > 20% (relevant items missed), lower it.

3. **Per-domain thresholds (future iteration if needed):** tradecraft domains have different prevalence and term distributions. `methodology` items may need a tighter threshold than `threat_assessment_frameworks`. Defer until first 7-day data argues for it.

The 7-day review is structurally analogous to the post-cutover validation we just completed. Same discipline — Flight Recorder traces + spot-check.

---

## 5. Recommendation

**Approach C (Hybrid) — but in two iterations:**

**Iteration N+1 (this proposal scope):** Implement **Approach A (keyword)** first.
- Lowest complexity, zero per-request cost, immediate operator-visible value.
- Validates the empty-result discipline and threshold-tuning methodology under low risk.
- Ships in ~50 lines of code change + a small migration (`tsvector` column + GIN index).
- Even if Approach B is the eventual target, Approach A's keyword pre-filter is preserved into the cascade — no code thrown away.

**Iteration N+2 (separate future PR):** Add **embedding rerank** on top, making the full Approach C cascade.
- One-time embedding backfill of 15,418 rows (~$1.50).
- Per-request embedding API call + pgvector cosine query.
- Keyword pre-filter from N+1 stays in place as the cascade's first stage.

**Why split:** the operator's "decision acceleration not tradecraft utilization" principle is more important than maximal relevance. Approach A immediately demonstrates the empty-result discipline working in real prod conversations. If A's relevance is sufficient (operator's call), the embedding cost is unnecessary. If A's relevance is insufficient (operator's call after Flight Recorder review), N+2 adds embedding rerank surgically.

---

## 6. Implementation shape for Approach A (the recommended N+1)

Three changes:

1. **Migration** — add `tsvector` column + GIN index:
   ```sql
   alter table public.agent_tradecraft
     add column hypothesis_search tsvector
     generated always as (to_tsvector('english',
       coalesce(hypothesis,'') || ' ' || coalesce(domain,'') || ' ' ||
       coalesce(array_to_string(related_domains, ' '),'') || ' ' ||
       coalesce(authored_by_agent,'')
     )) stored;
   create index idx_at_search on public.agent_tradecraft using gin (hypothesis_search);
   ```

2. **Retrieval block in `dashboard-ai-assistant`:**
   ```ts
   // Extract topical keywords from the user's last message
   const queryText = userMessages[userMessages.length - 1]?.content ?? "";
   const tsquery = sanitizeForTsquery(queryText);  // simple noun-extraction + & joining

   const { data: ranked } = await supabaseClient
     .from('agent_tradecraft')
     .select('id, authored_by_agent, domain, hypothesis, confidence, provenance_resolved')
     // PostgREST exposes tsquery matching via .textSearch
     .textSearch('hypothesis_search', tsquery, { type: 'plain' })
     // Order by ts_rank — exposed via rpc or computed in SQL
     .gte('confidence', 0.80)
     .limit(30);

   // Apply relevance threshold (TS_RANK_THRESHOLD), accept empty
   const above = ranked.filter(r => r.ts_rank >= TS_RANK_THRESHOLD);
   const finalItems = above.slice(0, TRADECRAFT_BUDGET);  // 0..3
   ```

3. **Flight Recorder provenance** — extend the existing trace to include the query keywords + threshold + per-item rank.

The R7 prose-lint and the labeling block require **no change** — they already accept variable-length `tradecraftItems` lists, including empty.

---

## 7. What this design does NOT do

- Does not implement Approach A in this PR. Design only. Code awaits explicit operator authorization.
- Does not pick the exact `TS_RANK_THRESHOLD` value. That requires an offline tuning pass on the 5 validation scenarios + 7-day Flight Recorder review.
- Does not change the 3-item upper bound. The operator-locked budget stays.
- Does not propose Approach B or C now. Future iteration if Approach A's relevance is insufficient after operator review.
- Does not touch P5, P6, Class B, or PR #36. All four remain held.
- Does not extend the labeling, prose-lint R7, or Flight Recorder shapes — they all already accept 0-to-budget results.

## 8. Operator decisions requested

Three calls before implementation begins:

1. **Approve Approach A as iteration N+1**, with Approach C (full cascade) as the explicit N+2 path if A's relevance proves insufficient after 7-day Flight Recorder review?
2. **Confirm 0-items-is-valid discipline** is the design's load-bearing constraint?
3. **Confirm threshold-tuning methodology** (cold-start at ~3-items-for-on-topic + 7-day review + raise/lower based on false-positive vs false-negative rates)?

P5 / P6 / Class B / PR #36 — all explicitly remain held.
