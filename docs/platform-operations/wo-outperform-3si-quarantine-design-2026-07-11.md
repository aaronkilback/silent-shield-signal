# WO-OUTPERFORM-3SI §8.1 — Retrieval Quarantine Flag Design (read-only survey + design proposal)

**Status:** design proposal for operator review, 2026-07-11. **NO build without explicit GO** per master spec §8. This document delivers §8.1 step 1: which 3Si reports are in the platform, whether ingestion derived entities/signals from them, and the retrieval-quarantine flag design mechanism.

---

## 1. Benchmark corpus in the platform (survey answer — CORRECTED)

### 1a. Root cause of prior error (transparency ledger)

An earlier draft of this document reported **15 benchmark documents / 18 derived entity_suggestions / 8 approved / 14-of-15 pending**. Those numbers were **wrong** — they came from a survey query that carried an implicit `LIMIT 40` and I read the 40-row sample as the complete corpus. The operator correctly refused to accept rulings until raw evidence was pasted. Corrected numbers with paste-quality evidence are below. This entry is preserved in the doc so the correction is discoverable, not hidden.

### 1b. Prod evidence (Petronas Canada tenant, 2026-07-11)

**Per-pattern match count (each filter run independently against `archival_documents`):**

| Pattern | Count |
|---|---:|
| `filename ILIKE 'Petronas%Security Awareness Report%'` | 285 |
| `filename ILIKE 'Petronas Weekly Security Awareness%'` | 1 |
| `filename ILIKE 'Petronas Special Security%'` | 3 |
| `filename ILIKE '%SPIN%'` | 2 |
| **Sum (with overlap on A/B)** | **~290** |

**`%SPIN%` full filename list** (only 2, both legitimate benchmark-adjacent):
- `Signal-to-Decision Scorecard — SPIN 2026.pdf` (2026-07-10, pending)
- `Copilot_SPIN_Template_MASTER June w ARC and Pembina 2026-1.xlsx` (2026-07-01, pending)

**10 random Petronas SAR filenames** (sample validates the 285 as legitimate 3Si historical corpus, not filter noise):
- Petronas - Security Awareness Report - May 8 2026.pdf
- Petronas - Weekly Security Awareness Report - Oct 23, 2020 (1).pdf
- Petronas - Weekly Security Awareness Report - Sep 2 2022.pdf
- Petronas - Security Awareness Report - Jan 24 2025.pdf
- Petronas - Weekly Security Awareness Report - Oct 29 2021.pdf
- Petronas - Weekly Security Awareness Report - 03 31 2023.pdf
- Petronas - Security Awareness Report - Dec 20 2024 (1).pdf
- Petronas - Weekly Security Awareness Report - 01 27 2023.pdf
- Petronas - Weekly Security Awareness Report - Sep 10 2021.pdf
- Petronas - Weekly Security Awareness Report - Dec 16 2022.pdf

Weekly cadence × ~5.5 years ≈ 285 fits the operational shape of a real historical 3Si delivery stream.

### 1c. Aggregate corpus metrics (Petronas Canada, 3Si + SPIN filters)

```
total_docs        : 290
total_derived     : 22    ← FLOOR ONLY (see 1d)
total_approved    : 11    ← FLOOR ONLY (see 1d)
pending_count     : 251
completed_count   : 39
```

**Derived-row per-document detail** (only rows with derived > 0):

| filename | processing_status | derived | approved |
|---|---|---:|---:|
| Petronas - Security Awareness Report - Apr 10 2026.pdf | pending | 12 | 3 |
| Petronas - Security Awareness Report - Apr 17 2026.pdf | pending | 5 | 5 |
| Petronas - Security Awareness Report - Sep 29 2023.pdf | pending | 4 | 3 |
| Signal-to-Decision Scorecard — SPIN 2026.pdf | pending | 1 | 0 |

### 1d. **`22 derived` is a FLOOR, not a total** — critical caveat

The `22` counts **entity_suggestions only**. It does NOT count:

1. **`tenant_chunks`** derived from the 39 `processing_status='completed'` documents. Those documents were fully ingested through the chunking pipeline, but `tenant_chunks` has no `source_document_id` column today (see §3a Q5). Their chunk-level derivation is presently **unmeasured**. The number of chunks derived from completed benchmark docs is not zero, and cannot be counted until the Q5 substrate FK ships and backfill lands.
2. **`entity_content`** rows that may have been created from these documents by report generators or investigation pipelines.
3. **`signals`** that may have been derived indirectly (no direct `source_id → archival_document` FK on `signals` today, so this vector needs its own lineage audit).

**Correct framing:** the 22 entity_suggestions is the confirmed lower bound of direct derived-row footprint. The true footprint is at least 22 and may be substantially larger once `tenant_chunks` are countable post-Q5-backfill. **Any design or operational decision that treats 22 as complete is unsafe.**

### 1e. Reframed opportunity

251 pending documents are the born-quarantined opportunity — applying `is_benchmark=true` before ingestion processes them keeps 251 documents' worth of future derived rows out of tenant retrieval by construction. The 39 already-completed documents are the retroactive-cleanup risk — their derived chunks cannot be quarantined until they can be attributed to their source document (Q5 FK + backfill). Sequencing implication: **substrate PR must include the Q5 FK addition** so the completed-doc chunks can be flagged in the same wave rather than left unmeasured.

## 2. Answer to §8.1 questions

**§8.1.a — Which 3Si reports are in the platform?** 285 Petronas Security Awareness Reports + 1 legacy weekly + 3 Special Security Reports + 2 SPIN-adjacent = **~290 documents** in the Petronas Canada tenant. Filter validated by sample (10 random SAR filenames + full 2-item SPIN list, no false positives).

**§8.1.b — Whether ingestion derived entities/signals from them?**
- **Confirmed lower bound:** 22 entity_suggestions derived (11 approved into live tenant graph) across 3 SARs and 1 SPIN Scorecard. Enumerated in §1c.
- **Unmeasured (must be treated as non-zero):** `tenant_chunks` derived from the 39 `processing_status='completed'` documents. Countable only after Q5 FK backfill.
- **Signals:** no direct `source_id → archival_document` FK on `signals` today; any indirect derivation needs a separate lineage audit.

**§8.1.c — Design the retrieval-quarantine flag mechanism.** See §3.

## 3. Retrieval quarantine flag — proposed design

### 3a. Substrate additions (schema changes)

**On `archival_documents`:**
```
is_benchmark             boolean NOT NULL DEFAULT false
benchmark_vendor         text NULL              -- CHECK ('3si','control_risks','isos','other')  [Q3 RULED]
benchmark_kind           text NULL              -- 'periodic' or 'oneoff'
benchmark_period_start   timestamptz NULL       -- kind='periodic': coverage window start
benchmark_period_end     timestamptz NULL       -- kind='periodic': coverage window end
benchmark_subject        text NULL              -- kind='oneoff': subject key
benchmark_registered_at  timestamptz NULL
benchmark_registered_by  uuid REFERENCES auth.users(id)
```

Constraint: `(is_benchmark = false) OR (benchmark_vendor IN ('3si','control_risks','isos','other') AND benchmark_kind IN ('periodic','oneoff') AND ((benchmark_kind='periodic' AND benchmark_period_start IS NOT NULL AND benchmark_period_end IS NOT NULL) OR (benchmark_kind='oneoff' AND benchmark_subject IS NOT NULL)))`.

**On derived-row tables:**
```
-- entity_suggestions:
  benchmark_source_document_id uuid REFERENCES archival_documents(id) NULL
-- tenant_chunks:                                           [Q5 RULED — ships in substrate PR]
  source_document_id           uuid REFERENCES archival_documents(id) NULL
  benchmark_source_document_id uuid REFERENCES archival_documents(id) NULL
-- entity_content:
  benchmark_source_document_id uuid REFERENCES archival_documents(id) NULL
-- signals (if benchmark→signal lineage confirmed by lineage audit):
  benchmark_source_document_id uuid REFERENCES archival_documents(id) NULL
```

FK propagation is the mechanism — writers that create derived rows FROM a benchmark document set the FK; retrieval predicate reads it. No boolean copy that can drift.

**Q5 backfill (per ruling):** existing `tenant_chunks` are backfilled with `source_document_id` where the linkage can be resolved from `metadata` JSONB or the ingestion audit trail. Chunks that cannot be resolved stay `NULL` and are **excluded from the quarantine mechanism by construction** (safe default — a NULL source cannot be a benchmark source, and unresolvable chunks predate the FK and are treated as tenant-native until proven otherwise). Backfill is a follow-up PR after the substrate lands.

### 3b. Harness-mode session context

Session flag / RPC parameter, cleared at end of run:
```
current_setting('fortress.harness_mode', true) = 'true'
current_setting('fortress.harness_generation_period_start', true)  -- ISO timestamp
current_setting('fortress.harness_generation_period_end', true)
current_setting('fortress.harness_generation_subject', true)       -- for oneoff comparisons
```

Non-harness Aegis queries operate exactly as today — no benchmark exclusion.

### 3c. Retrieval quarantine predicate

Canonical SQL function `is_benchmark_quarantined(row_source_document_id uuid) RETURNS boolean` (Q4 RULED — SQL function is authoritative). Every retrieval-scoped query includes `AND NOT is_benchmark_quarantined(t.benchmark_source_document_id)`.

The function encodes:
- TIME separation (`periodic` reports): benchmark_period OVERLAPS harness generation window
- SUBJECT separation (`oneoff` reports): benchmark_subject MATCHES harness generation subject
- Q2 RULED: period is auto-derived from filename metadata (e.g., "Apr 17 2026" → week ending 2026-04-17). Operator override added only when a real document breaks derivation.

Companion TS helper `_shared/retrieval-quarantine.ts` for edge functions that construct queries programmatically. **The TS helper emits the exact SQL predicate the DB function encodes — no independent logic.** Q4 RULED.

### 3d. Per-run verification (rule 6, Q6 RULED)

**New persisted table** `harness_retrieval_verifications` (not telemetry — persisted so runs are re-verifiable after the fact). Every harness query logs:
- run_id (FK to a harness_runs table)
- query_signature (canonical hash of the query template + parameters)
- would_return_count (COUNT with quarantine off)
- actual_return_count (COUNT with quarantine on)
- harness_generation_period_start/end OR harness_generation_subject in effect
- ran_at

If `would_return_count > actual_return_count` in a way that indicates quarantine held → PASS. If a benchmark row appears in `actual_return_count` (identifiable by joining back to the derived row's `benchmark_source_document_id`) → FAIL, run is discarded, ledgered as a doctrine breach.

Analogous to the existing `is_canary` exclusion pattern per master spec §4.

### 3e. Sequencing (Q7 RULED — two-phase)

**Phase 1 — substrate-only PR** (zero behavioral change):
- Schema migration: 8 new columns on `archival_documents` + FK columns on 4 derived-row tables + CHECK constraints
- `is_benchmark_quarantined()` SQL function defined but not called anywhere
- `_shared/retrieval-quarantine.ts` helper defined but not called anywhere
- `harness_retrieval_verifications` table created
- No retrieval query rewritten

**Phase 2 — wire retrieval callers** (behavior activates):
- Retrieval sites converted to include the quarantine predicate
- Harness driver sets/clears session context
- First harness run enabled

### 3f. What this design does NOT do

- **Does NOT delete or archive benchmark documents** — per master spec §7 they are reference material.
- **Does NOT modify normal Aegis behavior** for tenant users — only harness-mode retrieval is affected.
- **Does NOT change retrieval for BC Place / CRT tenant queries** — they never enter harness mode.
- **Does NOT hide benchmark documents from operator-facing UIs** — visibility is untouched; only harness-mode retrieval is scoped.

## 4. Open questions — ruling status

| # | Question | Ruling | Detail |
|---|---|---|---|
| Q1 | Backfill scope (which docs get `is_benchmark=true`) | **PENDING** | Operator holding until per-pattern evidence (paste in §1b) is accepted. |
| Q2 | Period auto-derivation | **RULED** | Auto-derive from filename/metadata. Operator override added only when a real document breaks derivation. |
| Q3 | Vendor field controlled vocabulary | **RULED** | CHECK constraint `('3si','control_risks','isos','other')`. |
| Q4 | Retrieval helper location | **RULED** | SQL function `is_benchmark_quarantined()` is canonical authority. TS helper emits the DB predicate only, no independent logic. |
| Q5 | tenant_chunks linkage gap | **RULED** | `source_document_id` FK ships INSIDE the substrate PR. Backfill of existing chunks is a follow-up. NULL excluded from quarantine safe default. |
| Q6 | Verification log persistence | **RULED** | Persisted table `harness_retrieval_verifications`, not telemetry. Runs must be re-verifiable after the fact. |
| Q7 | Sequencing | **RULED** | Two-phase substrate-first. |

## 5. Related work

- Task #221 (corroboration-consumption survey) — companion doc: `docs/platform-operations/wo-signal-to-noise-corroboration-consumption-survey-2026-07-11.md`. Ruled scope: **P1 only** (agent-chat create paths); P2-P5 parked.
- INC-XTEN Track B (task #17) — the provenance contract this quarantine layer rides on.
- `is_canary` exclusion pattern already ratified — the model this quarantine mirrors.
- Master spec: `docs/platform-operations/wo-outperform-3si-master-spec.md` (§4 held-out rule + §4b comparative instruments).
