# QR1 — Pre-Flight: Baseline, Migration Design, Measurement Plan

**Operator-directed 2026-05-31 (Task #126).** Pre-flight document for QR1 (partial unique index on `monitoring_proposals` to prevent duplicate inserts at the database layer). No implementation. Awaits explicit "execute now" GO.

Doctrine applied: *Measure before and after every intervention.*

---

## §1 — Baseline Measurement (Prod, captured 2026-05-31)

### A — Current proposal counts

| `proposal_type` | `status` | Last 90 days | All time |
|---|---|---:|---:|
| `add_entity` | applied | 25 | 25 |
| `add_entity` | pending | 34 | 34 |
| `add_entity` | rejected | 12 | 12 |
| `add_keyword` | applied | 69 | 69 |
| `add_keyword` | pending | 265 | 265 |
| `add_keyword` | rejected | 25 | 25 |
| `remove_keyword` | applied | 6 | 6 |
| `remove_keyword` | pending | 17 | 17 |

**Total rows in `monitoring_proposals`:** 453.
**Total constrained rows (status ∈ {pending, applied}):** 416.
**Total inflow last 90d:** 453 (the table is effectively 90 days old).

### B — Duplicate measurement (what the unique index would catch)

Normalization expression: `LOWER(TRIM(regexp_replace(proposed_value, '\s+', ' ', 'g')))`
Constraint key: `(client_id, proposal_type, normalized_value)` where `status IN ('pending', 'applied')`

| Metric | Value |
|---|---:|
| Duplicate groups (≥2 rows in same key) | **6** |
| Total rows in those duplicate groups | **17** |
| Excess rows (rows beyond the first per group) | **11** |
| Excess as % of constrained rows | **2.6%** |

The 6 specific duplicate groups:

| Normalized value | Type | Rows | Clients involved | Excess |
|---|---|---:|---:|---:|
| `bc wildfire service` | add_entity | 6 | 4 (one client has 4 dups) | 3 |
| `wet'suwet'en land defenders` | add_entity | 6 | 3 (one client has 4 dups) | 3 |
| `keyera corp` | add_entity | 3 | 1 (3 dups for one client) | 2 |
| `cisco catalyst sd-wan vulnerabilities` | add_keyword | 2 | 1 | 1 |
| `palo alto networks` | add_entity | 3 | 2 (one client has 2 dups) | 1 |
| (one more group identified via `dup_group_count = 6` aggregate, 1 excess row) | — | — | — | 1 |

Note: Different clients with the same proposal value are **not** duplicates from the constraint's perspective. The constraint is `(client_id, proposal_type, norm_value)` — per-client.

### C — Weekly proposal volume (last 8 weeks)

| Week starting | add_entity | add_keyword | remove_keyword | Total | Distinct clients |
|---|---:|---:|---:|---:|---:|
| 2026-05-25 | 21 | **156** | 9 | 186 | 12 |
| 2026-05-18 | 18 | 127 | 9 | 154 | 11 |
| 2026-05-11 | 13 | 42 | 4 | 59 | 5 |
| 2026-05-04 | 13 | 25 | 1 | 39 | 3 |
| 2026-04-27 | 6 | 9 | 0 | 15 | 1 |

**Inflow trend:** sharply accelerating. Most recent two weeks each exceed 150 proposals/week. CRUCIBLE batch behavior (Task #123) likely drives the spike.

### D — Hypothesis: expected reduction

The unique index catches **exact-duplicate inserts at write time**. The historical data shows:
- 21.4% of all add_keyword proposals (90d) were exact duplicates (Task #123)
- 2.6% of currently-constrained rows are duplicates that would be blocked TODAY

The discrepancy: most historical duplicates have already aged into `rejected` (which is outside the partial predicate). Going forward, **the index prevents NEW duplicate inserts** — exact figure depends on inflow pattern.

**Hypothesis to test:** post-deploy weekly inflow drops by ≥15% AND the duplicate-rate metric within the partial predicate goes to 0% sustained.

Stretch hypothesis: if CRUCIBLE's batch behavior generates many same-keyword-many-clients proposals, the per-client constraint catches re-runs. Expected reduction: 15-25% of inflow.

Cautious hypothesis: agents may RETRY when the constraint violates, increasing edge-function error rate. Need to observe.

---

## §2 — Pre-Deploy State Assessment

### A — Existing duplicates that would BLOCK index creation

11 specific rows (the "WOULD_QUARANTINE" rows from the row_number analysis). Each is a row in a duplicate group where `rn > 1` after partitioning by `(client_id, proposal_type, normalized_value)` and ordering by `status='applied' first → confidence DESC → created_at ASC`.

Specific row UUIDs (truncated; full list in commit log):
```
76190318...  bc wildfire service   add_entity  applied
03c84164...  bc wildfire service   add_entity  pending
96c7c50b...  bc wildfire service   add_entity  applied
ed26746d...  bc wildfire service   add_entity  pending
95ba0662...  cisco catalyst sd-wan vulnerabilities  add_keyword  pending
23193190...  keyera corp           add_entity  applied
d5f592a0...  keyera corp           add_entity  applied
5de48a29...  palo alto networks    add_entity  applied
6c99bb8f...  wet'suwet'en land defenders  add_entity  applied
09414daa...  wet'suwet'en land defenders  add_entity  applied
083b7558...  wet'suwet'en land defenders  add_entity  pending
```

These must be resolved BEFORE the unique index is created. The migration includes the resolution step.

### B — Status enum constraint

`monitoring_proposals_status_check`:
```sql
CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'applied', 'expired']))
```

To mark the 11 excess rows without misusing existing semantics:
- `'rejected'` — implies operator action; semantically wrong
- `'expired'` — implies time-based aging; semantically wrong
- **`'superseded'` — semantically correct; requires CHECK constraint update**

**Recommendation: add `'superseded'` to the allowed values.** This is a 1-line `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT` pair — small migration overhead, correct semantics, no UI surprise (UI already filters by `status='pending'` for the queue).

### C — Existing indexes

Current indexes on `monitoring_proposals`:
- `monitoring_proposals_pkey` (id)
- `idx_monitoring_proposals_client` (client_id)
- `idx_monitoring_proposals_status` (status)

No existing index conflicts with the new partial unique index.

### D — Function volatility (required for index expression)

Confirmed all three functions in the normalization expression are IMMUTABLE:
- `LOWER` — IMMUTABLE
- `TRIM` (`BTRIM`) — IMMUTABLE
- `regexp_replace` — IMMUTABLE

The expression is safe for use in a unique index.

### E — Staging readiness

| Check | Result |
|---|---|
| Staging has `monitoring_proposals` table | YES |
| Staging row count | **0** |
| Staging proposal types | none (zero data) |
| Staging fixture (`scripts/check-staging-load-fixture.mjs`) | not affected by this migration |

**Important:** staging cannot exercise the duplicate-resolution logic (no data). The migration will apply cleanly on staging by virtue of having nothing to constrain. The validation gap: we cannot observe the cleanup behavior empirically on staging before prod apply.

Mitigation:
1. Apply migration on staging anyway — confirms DDL syntax + extension compatibility
2. Apply on prod inside an explicit transaction with a final post-cleanup verification step inside the transaction
3. Have the rollback SQL pre-staged

---

## §3 — Migration Design

### A — Migration file

```sql
-- Migration: 20260531000001_qr1_monitoring_proposals_dedup.sql
-- Doctrine: Address Generation Before Approval
-- Reference: docs/platform-operations/queue-generation-reduction-assessment-2026-05-31.md (Task #123)
-- Reference: docs/platform-operations/qr1-pre-flight-2026-05-31.md (Task #126)

BEGIN;

-- §A — Add 'superseded' to allowed status values
ALTER TABLE public.monitoring_proposals
  DROP CONSTRAINT monitoring_proposals_status_check;

ALTER TABLE public.monitoring_proposals
  ADD CONSTRAINT monitoring_proposals_status_check
  CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'applied', 'expired', 'superseded']));

-- §B — Mark excess duplicates as 'superseded' (deterministic winner per group)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, proposal_type,
        LOWER(TRIM(regexp_replace(proposed_value, '\s+', ' ', 'g')))
      ORDER BY
        CASE status WHEN 'applied' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        confidence DESC NULLS LAST,
        created_at ASC
    ) AS rn
  FROM public.monitoring_proposals
  WHERE status IN ('pending', 'applied')
)
UPDATE public.monitoring_proposals
SET
  status = 'superseded',
  reviewed_at = NOW(),
  reasoning = COALESCE(reasoning || ' | ', '') ||
              '[QR1 dedup 2026-05-31: superseded by duplicate kept by deterministic ranking]'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- §C — Verify the cleanup BEFORE creating the constraint
DO $$
DECLARE
  remaining_dups int;
BEGIN
  SELECT COUNT(*) - COUNT(DISTINCT (
    client_id, proposal_type,
    LOWER(TRIM(regexp_replace(proposed_value, '\s+', ' ', 'g')))
  )) INTO remaining_dups
  FROM public.monitoring_proposals
  WHERE status IN ('pending', 'applied');

  IF remaining_dups > 0 THEN
    RAISE EXCEPTION 'QR1 cleanup incomplete: % duplicate rows still violate constraint. Aborting migration.', remaining_dups;
  END IF;
END $$;

-- §D — Create the partial unique index
CREATE UNIQUE INDEX monitoring_proposals_dedup_idx
ON public.monitoring_proposals (
  client_id,
  proposal_type,
  LOWER(TRIM(regexp_replace(proposed_value, '\s+', ' ', 'g')))
)
WHERE status IN ('pending', 'applied');

COMMENT ON INDEX public.monitoring_proposals_dedup_idx IS
  'QR1 dedup gate (2026-05-31). Prevents duplicate (client_id, proposal_type, normalized_value) inserts while status is pending or applied. Doctrine: Address Generation Before Approval.';

COMMIT;
```

### B — What this migration does

1. Adds `'superseded'` to allowed status values — semantically correct for system-deduplicated rows
2. Marks the 11 excess duplicate rows as `superseded` with audit note in `reasoning`
3. Verifies cleanup completed (raises exception + rolls back if any duplicates remain)
4. Creates the partial unique index

### C — What this migration does NOT do

- Does not delete any rows (`superseded` preserves history; rows are queryable)
- Does not touch rows with `status IN ('rejected', 'expired', 'approved')` — those are outside the constraint scope
- Does not change writer code (agents continue inserting; the DB rejects the duplicate INSERT, agents see error)
- Does not modify CRUCIBLE prompts or behavior

### D — Behavior change after migration

- **Future duplicate INSERT attempts will fail** with PostgreSQL error `23505 unique_violation`
- Writers (CRUCIBLE via service-role insert; UI inserts via authenticated user) need to handle this error gracefully
- The system-watchdog should not interpret a `23505` from this index as a failure — it's the intended behavior

**Important caveat:** if any writer treats INSERT failure as a fatal error, the unique violation could cascade. **This needs explicit code-side check.** The QR1 migration alone is not sufficient — there must be a paired code-side update (or at least a code-side review) confirming that the writer paths handle the error correctly. Suggested approach: writers should catch `23505` and log "deduplicated by QR1" rather than fail.

This means QR1 may actually need a one-line writer change in `agent-actions.ts` `proposeAction()` to log+swallow the conflict. Treat as a sub-task of QR1.

---

## §4 — Staging Validation Plan

Per the operator's measurement doctrine and the staging-load-fixture policy:

| Step | Action |
|---|---|
| S1 | Apply migration to staging via `apply_migration` |
| S2 | Verify migration applied: `SELECT * FROM pg_indexes WHERE indexname='monitoring_proposals_dedup_idx'` returns 1 row |
| S3 | Verify status enum updated: `pg_get_constraintdef` returns the new array |
| S4 | Insert a test row on staging: `(client_id, 'add_keyword', 'qr1-test-keyword', 'pending', 0.75)` — should succeed |
| S5 | Insert exact duplicate on staging: same row — should FAIL with 23505 |
| S6 | Verify no cleanup happened (staging had no dupes to clean — but the cleanup DDL ran cleanly) |
| S7 | Clean up the test rows: DELETE the qr1-test-keyword rows |

Staging cannot exercise the prod-data cleanup behavior. The prod apply must complete in a single transaction so cleanup + constraint creation are atomic.

---

## §5 — Prod Apply Plan

Per operator approval pattern:

| Step | Action | Operator gate |
|---|---|---|
| P1 | Confirm staging green (§4) | inform |
| P2 | Apply migration to prod via `apply_migration` (within single transaction per the SQL above) | EXPLICIT GO REQUIRED |
| P3 | Verify migration applied: same probes as §4 against prod | inform |
| P4 | Verify 11 rows became `superseded` (audit trail in `reasoning`) | inform |
| P5 | Verify partial unique index exists | inform |
| P6 | Confirm no pending function_jobs failed in the 5 minutes following the apply (no constraint-violation cascade) | inform |
| P7 | Capture post-deploy snapshot for 24h measurement | automated |

---

## §6 — Post-Deploy Measurement Plan

Per the new doctrine. Three measurement windows.

### Metric definitions (SQL — reproducible)

```sql
-- Metric 1: Weekly inflow (count of proposals created)
SELECT date_trunc('week', created_at)::date AS week,
       COUNT(*) AS inflow
FROM monitoring_proposals
WHERE created_at > NOW() - INTERVAL '8 weeks'
GROUP BY week ORDER BY week DESC;

-- Metric 2: Duplicate-attempt rejection count (would-have-been-dupes the index caught)
-- We don't store these directly — they appear as 23505 errors in edge_function_errors / function_jobs
SELECT date_trunc('day', occurred_at)::date AS day,
       COUNT(*) AS dup_rejections
FROM edge_function_errors
WHERE error_message ILIKE '%monitoring_proposals_dedup_idx%'
   OR error_message ILIKE '%duplicate key value violates unique constraint%'
GROUP BY day ORDER BY day DESC;

-- Metric 3: Current pending queue depth (the "fewer items operator sees" measurement)
SELECT COUNT(*) AS pending_depth
FROM monitoring_proposals
WHERE status = 'pending';

-- Metric 4: Successful-insert rate (no regression in legitimate inflow)
SELECT date_trunc('day', created_at)::date AS day,
       COUNT(*) AS proposals_created
FROM monitoring_proposals
WHERE created_at > NOW() - INTERVAL '14 days'
GROUP BY day ORDER BY day DESC;
```

### Measurement schedule

| Window | Action |
|---|---|
| **T+24h** | Run all 4 metrics. Compare Metric 1 to baseline week. Compare Metric 2 to zero (any rejections at all proves the gate fires). Compare Metric 3 to pre-deploy 316. |
| **T+72h** | Re-run all 4 metrics. Add: any reports of CRUCIBLE behavior change (operator self-report). |
| **T+7d** | Re-run all 4 metrics. Compute weekly delta. Capture in a measurement-log doc. |

### Pre-defined success criteria

**Capability GREEN if all four hold:**
1. Migration applied without errors
2. No false-positive `23505` errors disrupting legitimate inserts (Metric 2 should show ONLY actual dupes; legitimate inserts should NOT fail)
3. Pending depth (Metric 3) is non-increasing relative to pre-deploy at T+72h (allowing for normal week-on-week variation)
4. Weekly inflow (Metric 1) declines by ≥10% from baseline week, OR Metric 2 shows the index catching ≥3 duplicates per week

**Capability YELLOW if:**
- Metric 1 inflow shows no decline AND Metric 2 shows zero rejections — index isn't firing. Investigate CRUCIBLE upstream behavior.

**Capability RED if:**
- Metric 2 shows the constraint blocking unique-but-legitimate inserts (false-positive class)
- Edge-function failure rate spikes due to writers not handling 23505 gracefully
- Trigger rollback per §7

---

## §7 — Rollback Plan

### Layer 1 — Drop the index (instant, preserves all data)

```sql
BEGIN;
DROP INDEX IF EXISTS public.monitoring_proposals_dedup_idx;
COMMIT;
```

Takes effect immediately. All duplicate-creation paths re-open. The 11 `superseded` rows remain `superseded` (this is a safe rollback — the operator can manually re-status them if needed). The `'superseded'` enum value remains in the CHECK constraint (harmless; can stay).

### Layer 2 — Revert the superseded rows (only if operator wants the dupes back)

```sql
BEGIN;
UPDATE public.monitoring_proposals
SET status = (CASE
  WHEN reasoning ILIKE '%[QR1 dedup%' THEN 'pending'
  ELSE status
END),
reviewed_at = NULL,
reasoning = regexp_replace(reasoning, ' \| \[QR1 dedup.*\]', '', 'g')
WHERE status = 'superseded'
  AND reasoning ILIKE '%[QR1 dedup%';
COMMIT;
```

### Layer 3 — Drop the `'superseded'` enum value (full revert)

Only after Layer 2 confirms zero `superseded` rows remain:

```sql
BEGIN;
ALTER TABLE public.monitoring_proposals
  DROP CONSTRAINT monitoring_proposals_status_check;
ALTER TABLE public.monitoring_proposals
  ADD CONSTRAINT monitoring_proposals_status_check
  CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'applied', 'expired']));
COMMIT;
```

### Rollback decision tree

```
Observed: false-positive 23505 blocking legitimate inserts?
  ↓ YES → Layer 1 (drop index) — instant. Investigate.
  ↓ NO → don't roll back
Observed: operator wants the 11 superseded rows back?
  ↓ YES → Layer 2
Operator wants the 'superseded' value gone entirely?
  ↓ YES → Layer 3 (after Layer 2)
```

---

## §8 — Coupled Writer Update (Required Before Index Goes Live)

Per §3.D, the writer at `agent-actions.ts` `proposeAction()` should handle 23505 gracefully:

```typescript
// Before INSERT
try {
  const { data, error } = await supabase
    .from('monitoring_proposals')
    .insert({ /* ... */ });

  if (error) {
    // QR1 dedup: 23505 is the intended behavior; log and swallow
    if (error.code === '23505' && error.message.includes('monitoring_proposals_dedup_idx')) {
      console.info('[proposeAction] QR1 dedup blocked duplicate insert', {
        client_id: input.client_id,
        proposal_type: input.proposal_type,
        normalized_value: input.value.toLowerCase().trim(),
      });
      return { ok: true, deduped: true };
    }
    throw error;
  }

  return { ok: true, deduped: false };
} catch (err) { /* ... */ }
```

This writer change is part of QR1's deploy package. **Migration + writer change ship in the same PR.**

---

## §9 — Pre-Flight Acceptance Checklist

| # | Item | Status |
|---|---|---|
| ✓ | Baseline measurements captured | §1 |
| ✓ | Existing duplicates identified (11 rows) | §2.A |
| ✓ | Status enum updatable (add 'superseded') | §2.B |
| ✓ | No conflicting indexes | §2.C |
| ✓ | Function volatility verified (IMMUTABLE) | §2.D |
| ✓ | Staging environment verified | §2.E |
| ✓ | Migration designed (atomic transaction with cleanup + constraint) | §3 |
| ✓ | Staging validation steps defined | §4 |
| ✓ | Prod apply steps defined | §5 |
| ✓ | Post-deploy measurement schedule defined (24h/72h/7d) | §6 |
| ✓ | Pre-defined success criteria (GREEN/YELLOW/RED) | §6 |
| ✓ | Rollback plan (3 layers) | §7 |
| ✓ | Coupled writer update identified | §8 |

---

## §10 — What I Need From Operator Before Proceeding

| # | Decision | Recommendation |
|---|---|---|
| QR1.D1 | Approve adding `'superseded'` as new status value | YES — cleanest semantic |
| QR1.D2 | Approve marking the 11 specific rows as `superseded` (operator may review the row IDs in §2.A) | YES — deterministic ranking; audit preserved in `reasoning` |
| QR1.D3 | Approve the coupled writer update in `agent-actions.ts proposeAction()` to handle 23505 gracefully | YES — required for clean fail mode |
| QR1.D4 | Explicit "execute now" GO for: (1) apply to staging, (2) verify, (3) apply to prod | recommend stepwise: GO staging → confirm → GO prod |

Held. No DDL, no DML, no deploy until explicit GO per QR1.D4.

The pre-flight is complete. After GO:
1. Apply migration to staging (Layer 1 — DDL only, no data)
2. Run §4 validation steps
3. Report back to operator
4. Await explicit GO for prod apply

---

## §11 — Tie to Doctrine

| Doctrine | How QR1 honors it |
|---|---|
| Operator attention is critical infrastructure | Stops 21.4% of historical add_keyword inflow at the DB layer |
| In peace time, improve your fighting position | Smallest possible peacetime investment; one migration |
| Address generation before approval | Pure generation-side fix; no approval workflow change |
| Measure before and after every intervention | Baseline captured §1; T+24h/72h/7d schedule defined §6 |
| No persistence without named consumer | The index has a named consumer (the operator's queue) |
| Defensive layers before prompt tuning | DB constraint is the most defensive possible layer |
| Confidence is not correctness | The index uses exact normalized-string match — no confidence involved |
| Input-side before output-side | This IS the input-side gate |

This is the campaign's first concrete deploy. It applies every ratified doctrine.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
