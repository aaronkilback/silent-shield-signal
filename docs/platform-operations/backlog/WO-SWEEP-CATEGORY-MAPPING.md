# WO-SWEEP-CATEGORY-MAPPING — Section 7 reports "returned nothing" for searches that returned material

**Status:** LOGGED (report complete, do NOT build). **Opened:** 2026-08-31 (D3 review).
**Class:** correctness defect in the sweep-category → outcome mapping. The D3 relabel made the *sentences*
honest; the *mapping underneath is still wrong*. Six of seven categories report "returned nothing" while
material from at least three of them appears elsewhere in the same report.

## The four requirements — answered empirically (Kilback subject, scan 890d604b)

### 1 + 2. True "did this search return material" vs what `catOutcome` reports
Captures classified back to their battery category by matching `found_by_query` against each category's
battery-query signature (`buildBattery`, `_shared/subject-retrieval.ts:81-97`):

| Sweep category | Captures its search returned | Classified as (item cat) | `catOutcome` reports | Verdict |
|---|---|---|---|---|
| legal | **60** | media, mention | returned nothing | **MISREPORTED** |
| financial | **13** | mention | returned nothing | **MISREPORTED** |
| professional | **11** | mention | returned nothing | **MISREPORTED** |
| media | 42 | media, mention | returned material | correct |
| social | **56** (19 site: + 37 bare-name) | mention | returned nothing | **MISREPORTED** |
| corporate | **14** | media, mention | returned nothing | **MISREPORTED** |
| property | **7** | media, mention | returned nothing | **MISREPORTED** |

(`other/learned` = 49 — HIBP breach captures + learned-battery queries; not one of the seven.)

### 3. How many of the seven are misreported today
**Six of seven.** Every category's search returned material; only **media** is reported correctly — and only
by accident (see mechanism). The corporate row is exactly the case the operator named: the RocketReach /
ZoomInfo broker profiles came from the corporate battery query (`director OR officer OR founder…`) and render
as `mention`, so nothing carries the corporate key back and the row falsely reads "returned nothing."

### 4. The mechanism — where the sweep category is lost
**The sweep category is never persisted.** `subject_exposure_locations` has NO category column (verified:
columns are `exposure_item_id, url, domain, platform, title, snippet, published_date, date_captured,
found_by_query, phase, found_at_rank, corroborates, gate_failed, m1_pass, m2_pass`). The ONLY trace of which
search found a row is the raw `found_by_query` string.

But `catOutcome` does not even *attempt* query-string inference for the outcome. It computes
`categories_with_findings` = the distinct **item `category`** values (`data_breach / media / mention / legal /
environmental`) and intersects them against the seven **sweep-category names**. That intersection is non-empty
**only when a sweep-category name happens to equal an item-category name AND a finding of that item-category
exists** — i.e. `media` (and `legal`, if a real court case were classified). For the other five sweep
categories (financial, professional, social, corporate, property) **no item category shares the name**, so the
intersection is *structurally always empty* → they can NEVER show "returned material," regardless of how much
their search returned. So this is not "inference that fails" — there is **no inference**; it is a
name-collision accident that works for exactly one category (media) in this report.

> Note: the generator DOES already infer sweep category from `found_by_query` — but only for the
> **searched-vs-not-searched** determination (`QUERY_TERM_CAT` → `capByCat`, index.ts:112-129). It never
> applies that inference to the **material-vs-nothing** outcome. The machinery exists; the outcome path ignores it.

## The fix decision (per operator: requirement 4 decides it)
The sweep category is **not persisted**, so the mapping is being reconstructed by inference — and the outcome
path doesn't even do that. Two options, to be ruled later:
- **(A) Persist it.** Add a `sweep_category` column on `subject_exposure_locations`, written at capture time
  from the battery query that found the row (the producer already knows it — `bq.category`). Then `catOutcome`
  reads a real field, not a name collision. Forward-only; historical rows stay inference-only.
- **(B) Infer it in the outcome path.** Extend the existing `found_by_query` inference to drive material-vs-
  nothing, not just searched-vs-not. No schema change; works on historical rows; but keeps a regex seam.
- Either way, the outcome vocabulary likely needs a THIRD state: **"returned material — mentions only, no
  finding"** distinct from "returned material — assessed in Part I" and "returned nothing." A search that
  returned 60 rows that were all bare mentions is neither "nothing" nor "a finding."

## Do NOT
Report only. Do not build until the (A)/(B) ruling. **WO-SOCIAL-ZERO-FLOOR is blocked on this** — you cannot
detect an anomalous zero while normal non-zeros are being reported as zero.
