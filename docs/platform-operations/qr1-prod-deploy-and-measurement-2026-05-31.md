# QR1 — Prod Deploy Report + Measurement Schedule

**Operator-directed 2026-05-31 (Task #128).** Atomic prod sequence: migration applied; edge function deploys pending operator CLI execution.

---

## §1 — Migration: APPLIED ✓

Applied to prod project `kpuqukppbmwebiptqmog` via `apply_migration`. Returned `success: true`.

### Prod verification (immediate post-apply)

| Check | Result |
|---|---|
| Status CHECK constraint includes `'superseded'` | ✓ |
| Index `monitoring_proposals_dedup_idx` exists | ✓ |
| 11 rows marked `superseded` | ✓ (exactly matches pre-flight §2.A estimate) |
| Audit marker `[QR1 dedup 2026-05-31...]` in `reasoning` | ✓ |

### Status distribution snapshot (T+0)

| Status | Count | Delta from pre-deploy |
|---|---:|---:|
| pending | 312 | –4 (4 dups were marked superseded) |
| applied | 93 | –7 (7 dups were marked superseded) |
| rejected | 37 | 0 |
| superseded | **11** | +11 (the new value) |

11 total = 4 pending + 7 applied superseded. Math reconciles with pre-flight forecast.

### Sample of superseded rows (audit trail visible)

- `BC Wildfire Service` (add_entity) — 4 dupes for one client; deterministic winner kept
- `Cisco Catalyst SD-WAN vulnerabilities` (add_keyword)
- `Wet'suwet'en land defenders` (add_entity) — 3 dupes for one client
- `Palo Alto Networks` (add_entity)

All have `reviewed_at = 2026-05-31 17:08:04 UTC` and the QR1 audit marker in `reasoning`.

---

## §2 — Edge Function Deploys: PENDING

The supabase CLI is not available in this AI session. Per the canonical Fortress deploy pattern (CLAUDE.md), the deploys need to be executed from the operator's local environment:

**Run these two commands now (they execute in this session via the `!` prefix):**

```
! supabase functions deploy generate-monitoring-proposals
! supabase functions deploy process-stored-document
```

Order matters: deploy these in close succession to minimize the unhandled-23505 window. Code is on `main` as of commit `ab0d0aa1`.

### Why this can't wait

- The DB constraint is now LIVE in prod
- Without the writer updates, CRUCIBLE's next batch will hit `23505 duplicate key violation`
- The unhandled error is logged-noise (not data-loss; agents continue inserting non-dup rows), but it generates avoidable error volume in `edge_function_errors`

### How to confirm deploys succeeded

After running the two deploy commands, the operator can call back here with confirmation OR I can verify via:
- Function version timestamps on the Supabase dashboard
- A test invocation of `generate-monitoring-proposals` showing no 23505 in the response

---

## §3 — Extended Measurement Plan (per operator direction)

> *Track: duplicate insert attempts prevented · duplicates by proposal_type · duplicates by client · top duplicate-generating workflows. Objective: quantify operator attention recovered.*

### Where the data lives

Duplicate-prevention events surface in three places:

1. **`edge_function_errors`** — service-role-captured `23505` errors that the writer code logs (when the dedup gate fires)
2. **Edge function `console.info` logs** — the new QR1 logging lines: `[generate-monitoring-proposals] QR1 dedup blocked duplicate {...}`
3. **`monitoring_proposals.status='superseded'` rows** — the historical cleanup (this stays static after migration)

### Metric definitions (reproducible SQL)

```sql
-- M1: Total duplicate insert attempts prevented (since deploy)
-- Counts 23505 errors mentioning the QR1 index.
SELECT COUNT(*) AS dup_attempts_prevented
FROM public.edge_function_errors
WHERE created_at > '2026-05-31 17:08:00 UTC'   -- post-migration
  AND (error_message ILIKE '%monitoring_proposals_dedup_idx%'
       OR error_message ILIKE '%duplicate key value violates unique constraint%');

-- M2: Duplicate attempts BY proposal_type (parsed from error_message)
-- The error message contains: Key (..., proposal_type, ...) = (..., <type>, ...)
SELECT
  substring(error_message FROM 'add_keyword|add_entity|remove_keyword|add_source|update_source') AS proposal_type,
  COUNT(*) AS dup_count
FROM public.edge_function_errors
WHERE created_at > '2026-05-31 17:08:00 UTC'
  AND error_message ILIKE '%monitoring_proposals_dedup_idx%'
GROUP BY 1
ORDER BY dup_count DESC;

-- M3: Duplicate attempts BY client_id (parsed from error_message)
-- Error format: Key (client_id, proposal_type, ...)=(<uuid>, ...)
SELECT
  substring(error_message FROM '\(([0-9a-f-]{36})') AS client_uuid_in_error,
  COUNT(*) AS dup_count
FROM public.edge_function_errors
WHERE created_at > '2026-05-31 17:08:00 UTC'
  AND error_message ILIKE '%monitoring_proposals_dedup_idx%'
GROUP BY 1
ORDER BY dup_count DESC
LIMIT 20;

-- M4: Top duplicate-generating workflows (which edge function generated the most dups)
SELECT
  function_name,
  COUNT(*) AS dup_attempts
FROM public.edge_function_errors
WHERE created_at > '2026-05-31 17:08:00 UTC'
  AND error_message ILIKE '%monitoring_proposals_dedup_idx%'
GROUP BY function_name
ORDER BY dup_attempts DESC;

-- M5: Weekly inflow trend comparison (baseline vs post-deploy)
SELECT
  date_trunc('week', created_at)::date AS week,
  COUNT(*) AS inflow,
  COUNT(*) FILTER (WHERE status = 'superseded') AS superseded_count
FROM public.monitoring_proposals
WHERE created_at > NOW() - INTERVAL '12 weeks'
GROUP BY week
ORDER BY week DESC;

-- M6: Pending queue depth (operator-attention proxy)
SELECT COUNT(*) AS pending_depth
FROM public.monitoring_proposals
WHERE status = 'pending';

-- M7: Estimated operator attention recovered (per the success criterion)
-- Assumes 30 seconds per dup that would have reached the operator at avg approval cost.
SELECT
  (SELECT COUNT(*) FROM public.edge_function_errors
   WHERE created_at > '2026-05-31 17:08:00 UTC'
     AND error_message ILIKE '%monitoring_proposals_dedup_idx%') * 30 / 60.0
  AS estimated_minutes_recovered_since_deploy;
```

### Important caveat for metric reliability

These metrics depend on `edge_function_errors` capturing the 23505 events. The new writer code uses `console.info` and `continue` — it does NOT throw. So whether `edge_function_errors` captures these depends on:
- The `_shared/error-logger.ts` mechanism (whether it captures all console output or only errors)
- The `_shared/observability.ts` telemetry pattern

I should verify this assumption AT T+24h with a test query. If `edge_function_errors` is silent (because the writer swallows + logs only via `console.info`), I'll need to either:
- Switch the writer to also call `recordTelemetry()` with a `dedup_blocked` event
- Add a dedicated audit table for the dedup-blocked events

This is a known instrumentation gap. Document it explicitly so we don't claim success without measurement evidence.

---

## §4 — Measurement Schedule (per ratified doctrine)

### T+24h check (next sequence call-back)

Run M1, M2, M3, M4, M6. Confirm:
- M1 > 0 (the gate has fired at least once) OR explain why not (deploy delay, low traffic, etc.)
- No legitimate inserts failing (check function_jobs for non-23505 errors)
- M6 has not increased relative to T+0 baseline of 312

### T+72h check

Re-run M1–M7. Add:
- Operator self-report: "Has CRUCIBLE behavior changed visibly?"
- Visual scan of `monitoring_proposals` table: is the queue cleaner?

### T+7d check

Re-run all metrics. Compute weekly delta. Pre-defined success criteria from pre-flight §6:

**GREEN:**
1. M1 > 0 (gate has fired)
2. M5 weekly inflow declines ≥10% from baseline week (186/wk)
3. M6 pending depth is non-increasing
4. Zero false-positive 23505 errors blocking legitimate inserts

**YELLOW:** index not firing AND inflow not declining → CRUCIBLE upstream changed; investigate

**RED:** false-positive 23505 blocking legitimate insertions OR edge-function failure rate spike → trigger rollback per pre-flight §7

### Success criterion (operator-recorded)

> Success is NOT "Index created."
> Success IS "Fewer redundant decisions entering the system."

The T+7d metric M5 (weekly inflow) IS the success measurement. M1 (gate firings) is the *mechanism evidence*. Both must be positive for GREEN.

---

## §5 — Rollback Readiness (still pre-staged)

All 3 layers from pre-flight §7 stand:

| Layer | Trigger | Action |
|---|---|---|
| 1 | False-positive 23505 blocking legitimate inserts | `DROP INDEX monitoring_proposals_dedup_idx` (instant) |
| 2 | Operator wants 11 superseded rows back | UPDATE … SET status='pending', reviewed_at=NULL (where reasoning ILIKE '%[QR1 dedup%') |
| 3 | Full revert | Layer 2 → DROP CONSTRAINT … ADD CONSTRAINT (without 'superseded') |

Writer rollback: `git revert ab0d0aa1` (merge commit) + redeploy.

---

## §6 — Next Operator Action Required

1. **Run the two deploy commands** (above in §2)
2. **Confirm back** so I can run T+24h verification
3. After T+24h confirmation: I report measurement results
4. After T+7d: full GREEN/YELLOW/RED verdict

Held. Migration is live; writer code is on `main` but not deployed. Awaiting operator-side deploy execution.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
