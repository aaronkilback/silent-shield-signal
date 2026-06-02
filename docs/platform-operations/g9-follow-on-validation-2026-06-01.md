# G-9 Follow-On — Posting-Time Axis Replacement: Implementation + Validation

**Date:** 2026-06-01
**Branch:** `feat/er-v1-slice2-comparison` (NOT merged, NOT deployed)
**Scope:** Replace the Slice 2 posting-time axis so it never treats `signals.created_at`
as actor behavior; bundle G-4 telemetry into the same `axes_evidence` schema pass.
**Constraints honored:** no production deploy, no staging deploy, no merge, no push,
no schema migration (all changes are code + the additive jsonb `axes_evidence` shape).

---

## 1 · Decision recorded before implementation — Tier A allowlist DROPPED

The structural grounding primitive + per-signal filtering **eliminates** the need for a
Tier A monitor allowlist, and is more correct than it:

- **Granularity:** the allowlist is per-monitor; the defect is per-signal. NAAD (a Tier A
  monitor) is only 68% meaningful — a per-monitor allowlist would wrongly admit its 32%
  cosmetic/NULL signals. The per-signal structural test keeps the good NAAD signals and
  drops the bad ones.
- **New monitors:** an allowlist silently excludes any monitor onboarded after the audit;
  the structural test evaluates every monitor on its own data automatically.

The only thing an allowlist encodes that structure cannot is a positive *source-honesty*
assertion. That residual risk is covered without a static dependency by (a) the
`grounded_signal_count_{a,b}` telemetry (makes filtering observable), (b) the negative-control
test (regression tripwire for writer drift), and (c) the `temporal_grounding` column becoming
authoritative once T-1 ships. **No monitor-specific dependency enters the codebase.**

No latency upper bound is applied either: the histogram buckets on `event_date`, so collection
latency does not shift buckets; a latency bound would only wrongly drop honest late-collected
events. The defect to reject is *fabricated* `event_date` (cosmetic-midnight / copied-from-created),
not honest-but-late `event_date`.

---

## 2 · Grounded timestamp hierarchy (the contract)

Implemented in `_shared/temporal-grounding.ts::isActorTimeGrounded`, in resolution order:

1. `temporal_grounding ∈ {current_grounded, historical_grounded}` → grounded (authoritative;
   inert today — column is 100% `'unknown'` in prod — live when T-1 ships).
2. `temporal_grounding ∈ {current_inferred, historical_inferred, unknown}` → NOT grounded.
3. Column unpopulated → structural fallback on `event_date`:
   - NULL / unparseable → NOT grounded
   - cosmetic-midnight-of-created → NOT grounded
   - copied-from-created (|event − created| ≤ 5s) → NOT grounded
   - otherwise → grounded
4. `created_at` is **never** an actor-time source.

`groundedActorTime()` returns the trustworthy `event_date` (never `created_at`) or `null`.

---

## 3 · Changes

| File | Change |
|---|---|
| `_shared/temporal-grounding.ts` (NEW) | Canonical grounding primitive + tunable constants (`COSMETIC_MIDNIGHT_MS_TOLERANCE`, `COPIED_FROM_CREATED_MS_TOLERANCE`). Pure functions. |
| `_shared/er-axes/posting-time.ts` | Input contract now takes signal records; filters via `groundedActorTime`; buckets on `event_date`; sample floor applies to the **grounded** count; emits `grounded_signal_count_{a,b}` + grounded-aware summary. |
| `_shared/er-axes/_evidence-schema.ts` | G-9: `grounded_signal_count_{a,b}` on `PostingTimeEvidence`. G-4: top-level optional `telemetry` (`axis_timing_ms`, `signals_truncated_{a,b}`, `df_sample_sha256`). Additive to `v:1` — **no version bump**. `EMPTY_POSTING_TIME` updated. |
| `er-compare-entities/index.ts` | Signal `select` adds `event_date, temporal_grounding`; passes records to the axis; per-axis timing; truncation flag; deterministic `df_sample_sha256`; attaches `telemetry`. |
| `_shared/er-axes/posting-time.test.ts` | Rewritten to new input shape + G-9 cases (incl. negative control). |
| `_shared/temporal-grounding.test.ts` (NEW) | Unit coverage for the primitive + detectors. |

---

## 4 · Validation results (local, deterministic; Deno 2.8.1)

| Suite | Result |
|---|---|
| `temporal-grounding.test.ts` | **11 passed / 0 failed** |
| `er-axes/posting-time.test.ts` | **16 passed / 0 failed** |
| `aegis-coverage-confidence.test.ts` (untouched; regression check) | **35 passed / 0 failed** |
| `deno check` on all 4 changed/new shared modules | **clean** |

### Negative control (the G-9 acceptance test)

`G-9 NEGATIVE CONTROL: two actors with only collection-cadence signals → no evidence`:
two entities, 20 cosmetic-midnight signals each (the dominant Tier-C pattern). The OLD axis
would have read `created_at` and produced a near-1.0 false-positive correlation. The NEW axis
returns `status="insufficient_samples"`, `grounded_signal_count_{a,b}=0`, `pearson_r=null`,
while still surfacing `n_signals_{a,b}=20`. **The structural false positive is closed.**

Supporting G-9 cases (all pass): copied-from-created excluded; NULL `event_date` excluded;
mixed feed counts only grounded toward the floor; explicit `temporal_grounding` column overrides
the structural check; determinism preserved.

---

## 5 · Two PRE-EXISTING failures found on the branch (NOT caused by G-9, NOT in scope)

Confirmed by re-running with the G-9 changes stashed — identical results on baseline `444e3bb2`:

1. **`er-cluster-confidence.test.ts`: 5 failures.** Tests assert `MEDIUM` where the code now
   returns `LOW`. The direction matches the **G-1** tightening (handoff §3: *"Pure topical
   overlap downgrades to LOW"*) — the fixtures lack the behavioral-axis corroboration G-1 now
   requires. **Code behaves per G-1 design; the test expectations are stale and were never
   updated when `444e3bb2` landed.** This must be resolved before G-5, because rich-path
   validation depends on a trustworthy aggregation suite. Belongs to the G-1 workstream, not G-9.
2. **`er-compare-entities/index.ts`: `deno check` TS2345.** A `SupabaseClient` type-identity
   clash between the esm.sh import and a stray local `node_modules/@supabase/supabase-js`. At
   line ~247 (`startTrace(sb, …)`), untouched code. Environmental.

Neither is introduced by this change.

---

## 6 · Deferred / out of scope (unchanged)

- **Coverage-confidence alignment:** `aegis-coverage-confidence.ts::isTemporallyGrounded` uses a
  looser test (no copied-from-created rejection). Left untouched to avoid silently shifting a
  shipped Workstream D gate. Aligning it to the shared primitive is a tracked follow-up.
- **Writer-defect stream** (social monitors emitting cosmetic/copied `event_date`): INC-XTEN-class
  hygiene; caps usable data at ~25% until fixed; separate workstream.
- **Slice C:** stays deferred; when authorized, ships C1 + C2 only (C3 posting-window is Slice C+1
  after T-1).

---

## 7 · Updated Slice 2 PRA

**YELLOW → YELLOW-minus-one-gap.** G-9 (the largest single structural unknown) is now closed in
code and unit-validated: the posting-time axis is **production-honest** — it cannot manufacture a
false positive from collection cadence, and it makes its own filtering observable.

Remaining before GREEN / prod:
- **G-5 rich-path validation on real/representative data** — still the open item. Now *runnable*:
  seed Tier A `event_date` signals on staging and confirm MEDIUM/HIGH appears for the right
  reasons. **Blocked behind fixing the 5 stale G-1 cluster-confidence tests** (§5.1) — otherwise
  G-5 can't trust the aggregation it validates. Requires an operator GO for a staging deploy.
- **G-6 / G-7 / G-8** — independent doc/ops items, none merged.
- **Prod migration `20260601170000`** + branch merge + redeploy with `verify_jwt=true` — all
  still gated, none performed.

Recommended next operator decisions: (1) authorize fixing the stale G-1 tests (G-1 workstream),
(2) authorize a staging deploy to run G-5 against Tier A data.
