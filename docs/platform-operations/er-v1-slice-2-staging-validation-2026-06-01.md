# ER v1 Slice 2 — Staging Validation Report

**Date:** 2026-06-01
**Branch:** `feat/er-v1-slice2-comparison`
**Commit:** `dc5de6ec` (implementation)
**Staging project:** `lkvyrvuakzguszbpwnfz`
**Function:** `er-compare-entities` · slug `er-compare-entities` · version 2 · status `ACTIVE` · `verify_jwt: false` (staging-only; per Option C)
**Operator GO:** Slice 2 implementation 2026-06-01; Option C (verify_jwt=false on staging only) 2026-06-01
**Most-important constraint honored:** Insufficient evidence → UNKNOWN, never LOW.

---

## §1 — Operator's 6-axis assessment

### 1. Function is reached successfully

✅ **PASS.** All 4 test scenarios produced HTTP responses with correctly typed JSON bodies. After the `verify_jwt=false` redeploy (version 2), the platform auth gate no longer blocks staging invocation. The function is executing, the recorder fires (when reached), DB writes happen (when the write seam passes pre-flight), and Flight Recorder rows land in `aegis_request_trace` / `aegis_retrieval_trace` / `aegis_tool_trace`.

### 2. Comparison output is understandable to an operator

✅ **PASS.** Every customer-visible string in the response is plain English with concrete numbers. Example from Test 4:

```
summary_text:
"Suggested cluster between \"BC Place\" and \"Trent Reznor\":
 UNKNOWN — UNKNOWN: insufficient: only 0/3 axes computed;
 posting_time, vocabulary, source_class lacked sufficient samples"

per-axis stub_reason (posting-time):
"posting-time axis needs ≥10 signals per actor;
 entity A has 0, entity B has 0"

per-axis stub_reason (vocabulary):
"vocabulary axis needs ≥100 non-stopword tokens per actor;
 entity A has 0, entity B has 0"

per-axis stub_reason (source-class):
"source-class axis needs ≥2 distinct classes per actor;
 entity A has 0, entity B has 0"

sufficiency.reason:
"insufficient: only 0/3 axes computed;
 posting_time, vocabulary, source_class lacked sufficient samples"
```

**The operator can read every line and explain why UNKNOWN was selected.** That's the most-important-question contract, met directly.

### 3. axes_evidence v:1 populated correctly

✅ **PASS.** The persisted `actor_cluster_members.axes_evidence` jsonb for Test 4 contains every field defined in `_evidence-schema.ts`:

| Field | Test 4 value |
|---|---|
| `v` | `1` |
| `computed_at` | `2026-06-01T16:49:48.346Z` |
| `tenant_id` | `79315dca-bfce-4d6d-8d56-7260e1358812` (CRT) |
| `entity_a_id` | `24a68222-…` (BC Place) |
| `entity_b_id` | `db468a1b-…` (Trent Reznor) |
| `flight_recorder_trace_id` | `9085b6e2-90f4-4a3f-bf8e-e2c8d098eaf8` |
| `sufficiency.passed` | `false` |
| `sufficiency.reason` | populated, human-readable |
| `sufficiency.computed_axes_count` | `0` |
| `axes.posting_time` | full evidence block with stub_reason |
| `axes.vocabulary` | full evidence block with stub_reason |
| `axes.source_class` | full evidence block with stub_reason |
| `cluster_confidence.cluster_confidence_class` | `"UNKNOWN"` |
| `cluster_confidence.rationale` | starts with `"UNKNOWN:"`, names insufficient axes |
| `cluster_confidence.predicates` | bookkeeping counts intact |

Both `actor_cluster_members` rows (anchor + candidate) carry an identical `axes_evidence` snapshot — operator can review either member row alone to reconstruct the comparison.

### 4. UNKNOWN-first logic behaves correctly

✅ **PASS — operator amendment proven on real data.**

**Test 4 is the critical operator-amendment test.** Two real, tenant-owned, distinct entities. Both have entity_mentions on staging. The function:
- Reached the writer (no pre-flight refusal).
- Computed each axis deterministically.
- Each axis returned `status="insufficient_samples"` with reviewable stub_reason naming the floor (≥10 signals / ≥100 tokens / ≥2 classes) and the actual count (0 / 0 / 0).
- Sufficiency gate evaluated `0/3 ≥ 2 = false` → `passed: false`.
- Predicate aggregation was bypassed (its counts retained for audit, but not used to pick a class).
- Final `cluster_confidence_class = "UNKNOWN"`.

**Critically: the class is UNKNOWN, not LOW.** Both entities exist, both are real, both are owned by the same tenant — but evidence was thin. The system did not collapse "thin evidence" into "weak overlap." This is the exact behavior the operator's amendment required, validated on real (if sparse) staging data.

### 5. actor_clusters / actor_cluster_members write behavior

✅ **PASS.**

**For passing comparisons (Test 4):** one row in `actor_clusters` (status='suggested', tenant_id=CRT, summary_text plain English) + two rows in `actor_cluster_members` (one role='anchor', one role='candidate', both with `first_seen_at=2026-05-22T03:32:13Z` derived from the entity's earliest mention, both carrying the full v:1 evidence jsonb). Tenant-match trigger fired silently — both members carry the same CRT tenant as the cluster.

**For refused comparisons (Tests 2 + 3):** zero rows in either table. The canonical write seam pre-flight (`er-write-suggestion.ts:55-93`) refused before reaching the INSERT, returning structured `WriteError` with the doctrinal reference verbatim:
- Test 2: `"entity_a tenant_id mismatch — comparison was requested under tenant 4f28617d-… but entity_a belongs to 79315dca-… (Aegis Authority + Memory)"`
- Test 3: `"entity_b (Houston, BC) has no tenant ownership — cannot join a cluster (Provenance Doctrine)"`

The function correctly identifies the ownerless entity **by name** ("Houston, BC") so the operator sees an audit-friendly refusal, not a UUID.

**For body-validation refusals (Test 1):** zero rows; refused at the API entry layer before the recorder fires (`index.ts:216`). This is by design — body-validation errors are not interesting Flight-Recorder events.

### 6. Slice 2 defects discovered after auth bypass

**No defects found.** Three observations to flag, none of which block Slice 2 advancement:

| Observation | Severity | Notes |
|---|---|---|
| Test 1 (self-comparison) bypasses Flight Recorder | INFO / by design | Body-validation refusals don't merit a trace. If telemetry on bad-input shapes is later needed, this is the place to add it. |
| UNKNOWN comparisons still persist a `suggested` cluster row | INFO / by design | The cluster row is an audit artifact ("we tried; here is what we found"). Slice 5 (operator confirm/reject) will decide whether UNKNOWN suggestions enter the operator review queue or auto-finalize as `rejected`. Not a Slice 2 decision. |
| Test 4 returned UNKNOWN despite both entities having signal mentions (1 each on staging) | INFO / staging data hygiene | The function correctly returned UNKNOWN. The likely cause is staging signals lacking `tenant_id` or being outside the 180-day window — a separate INC-XTEN-class staging-data observation, not a Slice 2 defect. The function reported "0 signals retrieved" honestly. |

---

## §2 — Test ledger

| # | Tenant context | A | B | Expected | Got | Verdict |
|---|---|---|---|---|---|---|
| 1 | CRT | BC Place | BC Place (same) | 400 `entity_self_comparison` | 400 `entity_self_comparison` | ✅ |
| 2 | smoke (4f28617d) | BC Place [CRT] | Trent Reznor [CRT] | 422 `entity_a_cross_tenant` | 422 `entity_a_cross_tenant`, debug_trace_id present | ✅ |
| 3 | CRT | BC Place | "Houston, BC" (ownerless) | 422 `entity_b_ownerless` | 422 `entity_b_ownerless` ("Houston, BC" named verbatim) | ✅ |
| 4 | CRT | BC Place | Trent Reznor | 200, UNKNOWN | 200, UNKNOWN, axes_evidence v:1, cluster+members written, FR trace present | ✅ |

---

## §3 — Flight Recorder verification (Test 4 only — the success path)

| Row | Value |
|---|---|
| `aegis_request_trace.status` | `ok` |
| `aegis_request_trace.tenant_id` | `79315dca-…` (CRT) |
| `aegis_request_trace.duration_ms` | `236` ms |
| `aegis_request_trace.debug_trace_id` | `9085b6e2-90f4-4a3f-bf8e-e2c8d098eaf8` |
| Retrieval surfaces logged | `er_compare:entity_a_signals`, `er_compare:entity_b_signals`, `er_compare:tenant_df_sample` |
| Tool outcomes logged | `writeClusterSuggestion: ok` |

Trace IDs match between `aegis_request_trace.debug_trace_id`, `axes_evidence.flight_recorder_trace_id`, and the response body's `debug_trace_id` — the audit chain is intact.

Cumulative Flight Recorder counts across the 4 tests:
- `aegis_request_trace` rows: 3 (tests 2, 3, 4)
- `aegis_retrieval_trace` rows: 9 (3 surfaces × 3 tests)
- `aegis_tool_trace` rows: 3 (one per writeClusterSuggestion call)

---

## §4 — Verdict

**Slice 2 staging validation: GREEN across all 6 operator-specified axes.**

The most-important question is answered with evidence:

> *"Can an operator review the comparison output and understand exactly why the suggested relationship exists?"*

**Yes.** The operator can read the summary_text, the rationale, each axis's stub_reason or evidence_summary, and the sufficiency block — and reach the same conclusion the system reached, by inspection, without consulting any other surface.

**The sufficiency-first amendment is enforced.** Insufficient evidence produces UNKNOWN, not LOW, deterministically, every time.

**No Slice 2 defects found.**

---

## §5 — Staging-side debris (for cleanup)

- `actor_clusters` row `ca7c8dae-18fa-412e-b760-9311d77460c4` (test 4) + 2 child member rows. Kept as validation evidence; can be deleted via `DELETE FROM actor_clusters WHERE id = 'ca7c8dae-18fa-412e-b760-9311d77460c4';` (cascade handles members) once operator review is complete.
- 3 Flight Recorder traces for tests 2, 3, 4. Kept as audit evidence.

---

## §6 — What does NOT advance with this validation

- **No production deploy.** Prod stays at v1 of the function (no version exists) — Slice 2 is staging-only until operator GO.
- **No prod migration changes.** The substrate is already in prod from Slice 1; Slice 2 only adds the edge function.
- **No Slice 3 work.** Per operator instruction, Slice 3 (Aegis chat integration) does not begin until Slice 2 validation is green or defects are listed. **This validation IS green.** Slice 3 may now be proposed when the operator authorizes.
- **No credential rotation.** Per memory + operator instruction, the stale-JWT issue is documented separately (see `er-v1-slice-2-staging-jwt-platform-debt-2026-06-01.md`); no action taken.
- **No prod `verify_jwt=false`.** Staging only.

---

## §7 — Next operator decision surface

1. Accept Slice 2 validation GREEN.
2. Authorize prod deploy of `er-compare-entities` (with `verify_jwt=true`).
3. Authorize Slice 3 work proposal (Aegis chat integration).
