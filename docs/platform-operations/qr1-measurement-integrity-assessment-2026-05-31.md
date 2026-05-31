# QR1 Measurement Integrity Assessment

**Operator-directed 2026-05-31 (Task #129).** Observability assessment only. No QR1 logic changes. No implementation.

## §0 — The Question

> If QR1 blocks 100 duplicate proposals this week, can Fortress prove that happened?

**Short answer: NO, not via persistent SQL-queryable storage. The events will appear in Supabase function logs (rolling retention) but will not land in any table that supports M1–M4.**

The dedup mechanism itself is sound; the measurement assumption in the deploy doc was wrong.

---

## §1 — Current Telemetry Path

### A — What the writer code emits today

`supabase/functions/generate-monitoring-proposals/index.ts:277-onwards` (deployed on `main`, commit `ab0d0aa1`):

```typescript
if (error) {
  if (error.code === '23505' && (error.message ?? '').includes('monitoring_proposals_dedup_idx')) {
    qr1Deduped++;
    console.info('[generate-monitoring-proposals] QR1 dedup blocked duplicate', {
      client_id: client.id,
      proposal_type: proposalType,
      normalized_value: proposal.value.toLowerCase().trim(),
    });
    continue;
  }
  ...
}
```

`supabase/functions/process-stored-document/index.ts:1543-onwards`:

```typescript
if (propErr.code === '23505' && (propErr.message ?? '').includes('monitoring_proposals_dedup_idx')) {
  qr1DedupedCount++;
  continue;
}
```

Note that `process-stored-document` does NOT even emit a per-event `console.info` — only an aggregate "blocked N duplicates" line at the end of the batch.

### B — Where `console.info` lands

In the Supabase Edge Functions runtime (Deno):
- `console.info`/`console.log`/`console.warn`/`console.error` → captured by the Supabase platform's function-log stream
- Available via the operator dashboard OR the `mcp__plugin_supabase_supabase__get_logs` MCP tool
- **Time-bounded retention** (typically rolling ~24h; documented as "recent")
- **Not persisted to any DB table**
- **Not SQL-queryable** — no joins, no aggregations across clients/types
- **Not historical** — once outside the retention window, the event is gone

### C — How `edge_function_errors` is populated

Read of `_shared/error-logger.ts`:

```typescript
// Line 99-101: withErrorLogging wraps a handler and catches THROWN errors
try {
  return await handler(req);
} catch (error) {
  // ...
  await logError(error, { functionName, severity, ... });
  // Writes to edge_function_errors
}
```

`edge_function_errors` is populated by exactly two paths:
1. **`withErrorLogging` wrapper** — only when an error escapes the handler (i.e., is thrown all the way up)
2. **Explicit `logError()` call** in code

The QR1 writer code does NEITHER. It catches the 23505 itself, logs to console, and `continue`s. The error is fully handled before it can reach `withErrorLogging`'s catch block.

### D — How `function_telemetry` is populated

Read of `_shared/observability.ts`:

```typescript
// Line 56-78: recordTelemetry inserts directly into function_telemetry
export async function recordTelemetry(supabase, record): Promise<void> {
  await supabase.from('function_telemetry').insert({
    function_name: record.functionName,
    duration_ms: ...,
    status: record.status,
    context: record.context ?? {},
    // ...
  });
}
```

`function_telemetry` is populated only by **explicit `recordTelemetry()` calls**. The QR1 writers do not call it. So no rows will appear.

### Empirical confirmation

```sql
SELECT COUNT(*) FROM edge_function_errors
WHERE error_message ILIKE '%23505%'
   OR error_message ILIKE '%monitoring_proposals_dedup_idx%'
   OR error_message ILIKE '%duplicate key value violates%';
-- Result: 0 rows (pre-QR1; no such events recorded historically either,
--                 confirming the table does not catch swallowed 23505s)
```

Even the legacy code paths that hit duplicate-key violations on OTHER tables don't show up here. The table captures thrown-and-caught-by-wrapper errors only.

---

## §2 — Telemetry Gaps

Mapped against the operator's requested metrics:

| Metric | Storage today | Queryable today? |
|---|---|---|
| M1 — Total duplicate insert attempts prevented | Supabase function logs only | ✗ Not via SQL; only via `get_logs` within retention window |
| M2 — Duplicates by `proposal_type` | Supabase function logs only (parseable from console.info JSON) | ✗ Same |
| M3 — Duplicates by `client_id` | Supabase function logs only | ✗ Same |
| M4 — Top duplicate-generating workflows | Supabase function logs only (parseable from log source) | ✗ Same |
| M5 — Weekly inflow trend | `monitoring_proposals.created_at` — already persistent | ✓ |
| M6 — Pending queue depth | `monitoring_proposals.status` — already persistent | ✓ |
| M7 — Estimated operator attention recovered | Derived from M1 | ✗ Depends on M1 |

**Four of seven metrics are NOT measurable via SQL today.** M5 and M6 work because they query existing persistent state. M1–M4 cannot answer the operator's quantitative success question.

### Why this matters

The success criterion is *"Fewer redundant decisions entering the system."* The persistent indicator of this is M5 (weekly inflow decline) — and that **is** measurable. But the *mechanism evidence* (M1 — that the gate is doing the work) is the load-bearing metric for distinguishing:
- "Inflow declined because QR1 caught duplicates" (good — what we want to prove)
- "Inflow declined because CRUCIBLE ran less" (different reason; QR1 not actually firing)
- "Inflow declined because of an unrelated bug" (worse interpretation)

Without M1, we cannot attribute success to QR1. The deploy doc claimed measurement against `edge_function_errors`; that claim is wrong.

### `get_logs` as a partial workaround

The `mcp__plugin_supabase_supabase__get_logs` tool exists and could surface recent `console.info` lines. Limitations:
- Designed for diagnostic, not analytical use
- Time-bounded; not for T+7d historical comparison
- Not joinable to other tables (no SQL aggregation)
- Returns text; needs parsing
- Cannot be wired into the campaign's reporting cadence reliably

`get_logs` is acceptable for the T+24h sanity check ("did the gate fire AT ALL?") but not for T+72h / T+7d quantitative measurement.

---

## §3 — Recommended Measurement Path

### Option A (RECOMMENDED) — Add `recordTelemetry()` call alongside existing `console.info`

Modify each writer (5–10 lines per writer) to ALSO record telemetry:

```typescript
// In generate-monitoring-proposals (after the console.info, before continue):
await recordTelemetry(supabase, {
  functionName: 'generate-monitoring-proposals',
  durationMs: 0,  // n/a for per-event
  status: 'success',  // qr1 dedup is intended behavior
  context: {
    event: 'qr1_dedup_blocked',
    client_id: client.id,
    proposal_type: proposalType,
    normalized_value: proposal.value.toLowerCase().trim(),
  },
});

// Same pattern in process-stored-document
```

Then M1–M4 become trivial SQL:

```sql
-- M1 — total dedup-blocked events since deploy
SELECT COUNT(*) AS dup_attempts_prevented
FROM public.function_telemetry
WHERE context->>'event' = 'qr1_dedup_blocked'
  AND started_at > '2026-05-31 17:08:00 UTC';

-- M2 — by proposal_type
SELECT context->>'proposal_type' AS proposal_type, COUNT(*)
FROM public.function_telemetry
WHERE context->>'event' = 'qr1_dedup_blocked'
GROUP BY 1 ORDER BY 2 DESC;

-- M3 — by client_id
SELECT context->>'client_id' AS client_id, COUNT(*)
FROM public.function_telemetry
WHERE context->>'event' = 'qr1_dedup_blocked'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- M4 — by function_name (workflow)
SELECT function_name, COUNT(*)
FROM public.function_telemetry
WHERE context->>'event' = 'qr1_dedup_blocked'
GROUP BY 1 ORDER BY 2 DESC;
```

**Advantages:**
- Zero new schema (uses existing `function_telemetry`)
- Existing `recordTelemetry()` helper already imported via `ai-gateway.ts` transitive deps
- `context jsonb` field designed for exactly this use case
- Joinable to `monitoring_proposals`, `clients`, etc. for richer aggregates
- Append-only; consistent with audit-log doctrine
- Doctrine-aligned: this is a named consumer (M1–M4 metrics) for new persistence — passes the no-persistence-without-named-consumer test

**Disadvantages:**
- Small writer code change required (NOT a QR1 logic change; telemetry-only)
- Adds N rows/week to `function_telemetry` (currently 184k rows; tiny impact)

### Option B — Add `logError()` call with `severity='warning'`

```typescript
await logError(
  new Error('QR1 dedup blocked'),
  {
    functionName: 'generate-monitoring-proposals',
    severity: 'warning',
    clientId: client.id,
    requestContext: { proposal_type: proposalType, normalized_value },
  }
);
```

**Advantages:**
- Matches the original (incorrect) M1 query assumption (`edge_function_errors`)
- Existing `logError()` helper

**Disadvantages:**
- Pollutes the error table with non-error events
- Severity='warning' is semantically tolerable but mixes operational signals
- Existing operator workflow may already filter `edge_function_errors` by severity — needs review

### Option C — Dedicated audit table

New table `monitoring_proposals_dedup_log` with columns `(id, client_id, proposal_type, normalized_value, blocked_at, source_function)`.

**Advantages:**
- Clean semantics
- M1 is a named consumer (passes doctrine gate)

**Disadvantages:**
- Heaviest option
- New schema + migration + RLS + retention policy
- Function_telemetry already provides everything Option A needs

### Verdict

**Option A is the minimum change. Recommend Option A.**

Both Option B and Option C are reasonable alternatives, but Option A satisfies every metric with the smallest code surface and zero new schema.

---

## §4 — Minimal Change Required

### Scope

Two files. Two edit points. ~10 lines added across both.

| File | Edit | Lines |
|---|---|---|
| `supabase/functions/generate-monitoring-proposals/index.ts` | Add `recordTelemetry({...})` call in the `error.code === '23505'` branch | ~5 |
| `supabase/functions/process-stored-document/index.ts` | Add `recordTelemetry({...})` call in the equivalent branch | ~5 |

### Imports

Both files would need to import the helper:

```typescript
import { recordTelemetry } from "../_shared/observability.ts";
```

`process-stored-document` already imports from `_shared` (e.g., `ai-gateway.ts`) so this is consistent.

`generate-monitoring-proposals` already imports from `_shared/supabase-client.ts` and `_shared/ai-gateway.ts`.

### Deploy

Same path as QR1: feature branch → operator-side CLI deploy via `! supabase functions deploy <name>`.

### Risk

Negligible. `recordTelemetry()` is documented as "Never throws. Safe to call from anywhere." Even if telemetry insertion fails, it logs to console and continues — same observable behavior as today, plus an extra row in `function_telemetry` per blocked event when it succeeds.

### Rollback

`git revert` the telemetry-add commit + redeploy. Migration unaffected. QR1 logic unaffected.

---

## §5 — Doctrine Alignment

| Doctrine | This assessment |
|---|---|
| Measure before and after every intervention | Identified gap: today we cannot measure after; recommends minimum fix |
| No persistence without named consumer | Option A uses existing table; Options B and C add persistence with M1–M4 named |
| Operator attention is critical infrastructure | Without M1 we cannot prove operator attention was recovered; this gap blocks the success measurement |
| Address generation before approval | Out of scope; QR1 mechanism unchanged |
| Confidence is not correctness | n/a (no AI in this change) |
| Prefer defensive layers before prompt tuning | n/a |
| Input-side before output-side | n/a (telemetry is observation, not gating) |

This is a measurement integrity gap. Closing it is a prerequisite for proving QR1's value — which is a prerequisite for the operator's success criterion.

---

## §6 — What I Verified (Honest Audit Trail)

1. ✓ Read `_shared/error-logger.ts` end-to-end. Confirmed `edge_function_errors` is populated only by thrown-then-caught path.
2. ✓ Read `_shared/observability.ts` end-to-end. Confirmed `function_telemetry` has a `context jsonb` column ideal for storing dedup event metadata.
3. ✓ Queried prod `edge_function_errors` for any historical 23505 / dedup / duplicate-key reference. Zero rows. Confirms swallowed errors never reach this table.
4. ✓ Read writer code as deployed on `main` (commit `ab0d0aa1`). Confirmed `console.info` + `continue` pattern.
5. ✓ Confirmed `function_telemetry` schema includes `function_name`, `status`, `context jsonb`.

---

## §7 — Held / Operator Decision Surface

| # | Decision | Recommendation |
|---|---|---|
| MI.D1 | Authorize the minimum telemetry change (Option A) | YES — required to measure success |
| MI.D2 | Confirm Option A over Option B (logError) or Option C (new table) | Option A — minimum disturbance, zero new schema |
| MI.D3 | Approve PR shape: 2 file edits + import addition + feature branch + operator-side CLI deploy | YES — same pattern as QR1 |
| MI.D4 | Explicit "execute now" GO for telemetry-add deploy | gated on MI.D1+D3 |

Per operator framing: this is observability-only. The dedup logic stays untouched. The measurement layer becomes truthful.

### Interim measurement (if MI.D1 delayed)

For the T+24h check that's already on the schedule:
- Use `mcp__plugin_supabase_supabase__get_logs` to grep recent function logs for `'QR1 dedup blocked duplicate'`
- This gives a yes/no answer ("did the gate fire?") but no aggregation by client/type
- Acceptable for first verification; insufficient for T+7d quantitative success claim

### Pending docs update

Once MI.D1 lands, the QR1 deploy + measurement doc (`qr1-prod-deploy-and-measurement-2026-05-31.md`) should be amended: M1–M4 SQL replaced with the `function_telemetry`-based queries shown above. The original SQL is wrong; honesty doctrine says correct the doc.

---

## §8 — Bottom Line

**Today:** if QR1 blocks 100 duplicate proposals this week, Fortress can confirm "yes, some" via function logs (rolling window) but cannot quantitatively prove "100" via SQL.

**With Option A (~10 lines):** Fortress can show the exact count by client, by proposal_type, by source function, joined to weekly inflow data — for every blocked event from the deploy onward.

This gap was missed in the QR1 deploy planning. Catching it now (before T+24h check) means the success measurement can still be honest.

Held. No code, no deploy. Awaiting operator GO per §7.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
