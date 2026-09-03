# WO-ENTITY-PROVENANCE-GAP — logged, NOT started (2026-09-03)

**Status:** LOGGED. Do not start. Split out from WO-ENTITY-MENTION-CONTAMINATION because it is a **different class** of defect.

## The gap

Two of the three count inputs to `entities.quality_score` have no test-provenance lineage at all — so the contamination there is not just unfiltered, it is **unrecordable and unmeasurable**.

`quality_score = mentions×3 + relationships×4 + content×2 + (description/photo/assessment/risk bonuses)` (`refresh_entity_quality_score`).

- **`entity_relationships` (36 rows)** — columns: `entity_a_id, entity_b_id, relationship_type, strength, occurrence_count, feedback_*`. **No `is_test`, no `signal_id`, no `source`.** A test signal that asserted a relationship between two *real* entities is **invisible and always will be**. 0 of 36 even touch a test entity — but that proves nothing, because the provenance (which signal asserted the edge) was never recorded. No backfill can derive a fact that was never captured.
- **`entity_content` (2,231 rows)** — has no usable test flag: `benchmark_source_document_id` is **0/2,231 populated** (dead column), `source` is free-text *external* origin (cbc.ca, SEC EDGAR, LinkedIn, OFAC…), only 1 row matches any test/benchmark token and that's a false positive (`www.synthhistory.com`). No `is_test`, no `signal_id`.

## Consequence (state plainly)

After WO-ENTITY-MENTION-CONTAMINATION, the **mentions×3** term of `quality_score` is clean. The **relationships×4 and content×2 terms carry permanent, unmeasurable test-contamination for all historical rows.** Part of the platform's entity-significance score cannot be cleaned by any is_test filter, because the tables never recorded the provenance the filter would read.

## Why this is a different class

The mention contamination was **a flag nobody filtered** — the fact existed (`signals.is_test`), the readers just ignored it; fixable by stamping + a seam. This is **a fact nobody recorded** — `Absence-Is-Not-A-Value at the schema layer`: the tables cannot answer "is this test-derived?" because they never captured it. There is no read-time or migration-time fix; only a writer change, forward-only.

## Scope later (NOT NOW)

1. **Add provenance at the writers** so *future* rows are answerable — capture the asserting `signal_id` (and/or a stamped `is_test`) on `entity_relationships` and `entity_content` at every insert site, same chokepoint discipline as the entity_mentions trigger.
2. **Historical rows stay UNKNOWN — this is the important rule.** When this is built, historical `entity_relationships` / `entity_content` rows **MUST NOT be defaulted to `is_test = false`.** They are not known-real; they are **unknown**, and **unknown is a third state**, distinct from both test and real. Defaulting them to false would re-commit the exact Absence-Is-Not-A-Value error one layer down — asserting "clean" over rows whose provenance was never captured. Model it as a three-state provenance (`test` / `real` / `unknown`), NOT NULL, with historical rows = `unknown`.
3. Only then can `quality_score` optionally exclude `unknown`/`test` provenance from the relationships/content terms — a conservative scorer that counts only *proven-real* evidence.

## Companion doctrines
Absence-Is-Not-A-Value (schema layer), Provenance Doctrine (no artifact without ownership — here, no derived fact without asserting-source), Measured-vs-assessment tier. Sibling of WO-ENTITY-MENTION-CONTAMINATION.
