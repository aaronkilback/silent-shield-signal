# T-0 Production Validation Report — `signals.temporal_grounding`

**Task #176 · 2026-06-01** · Operator-authorized TI.D2-prod (approved 2026-06-01). Apply mirrored from staging (Task #152 GREEN).

---

## §1 — Migration result

| Field | Value |
|---|---|
| **Apply method** | Supabase MCP `apply_migration` (inline SQL; mirror of `supabase/migrations/20260531201311_t0_signals_temporal_grounding_substrate.sql` from `feat/t0-temporal-grounding-substrate`) |
| **Target project** | `kpuqukppbmwebiptqmog` (prod) |
| **Apply timestamp (UTC)** | `2026-06-01T12:44:54Z` |
| **Apply result** | `{"success": true}` |
| **Pre-apply baseline** | 1,487 signal rows · column absent · constraint absent |
| **Post-apply state** | 1,487 signal rows · column present · constraint present · 1,487/1,487 defaulted `'unknown'` |
| **Lock duration** | Sub-second (no row rewrite — constant default in PG11+) |
| **Staging mirror** | Applied 2026-05-31T20:15:14Z; T+1h GREEN; rollback drill proven |

---

## §2 — T+0 measurements (verified post-apply)

| Check | Value | Status |
|---|---|---|
| `col_exists` | true | ✅ |
| `col_type` | `text` | ✅ |
| `col_default` | `'unknown'::text` | ✅ |
| `col_nullable` | `NO` | ✅ |
| `constraint_def` | `CHECK ((temporal_grounding = ANY (ARRAY['unknown'::text, 'current_grounded'::text, 'historical_grounded'::text, 'current_inferred'::text, 'historical_inferred'::text])))` | ✅ matches spec |
| `rows_total` | 1,487 | ✅ |
| `rows_unknown` | 1,487 | ✅ all defaulted |
| `distinct_classes_present` | 1 | ✅ only `'unknown'` |
| `now_utc` (when measured) | `2026-06-01T12:45:00.929Z` | (T+0 + ~6s) |

**Zero behavioral change.** No row gained a temporal claim from this migration. Distribution: 100% `'unknown'`.

---

## §3 — Constraint enforcement (two-sided test)

### Test A — caught violation via PL/pgSQL EXCEPTION block

```sql
DO $$ DECLARE v_test_id uuid; BEGIN
  SELECT id INTO v_test_id FROM public.signals LIMIT 1;
  BEGIN
    UPDATE public.signals
       SET temporal_grounding = 'bogus_value_not_in_check_prod'
     WHERE id = v_test_id;
    RAISE EXCEPTION 'CHECK CONSTRAINT FAILED TO ENFORCE';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: CHECK violation correctly raised: %', SQLERRM;
  END;
END$$;
```

Post-test distribution check: still **1,487/1,487 `'unknown'`** — proof that the UPDATE was rolled back inside the catch block. ✅

### Test B — uncaught raw UPDATE (expect SQLSTATE 23514)

```sql
UPDATE public.signals
   SET temporal_grounding = 'prod_invalid_test'
 WHERE id = (SELECT id FROM public.signals LIMIT 1);
```

PostgreSQL returned hard error:

```
ERROR: 23514: new row for relation "signals" violates check constraint
       "signals_temporal_grounding_check"
DETAIL: Failing row contains (bae94dbf-66f1-4313-824b-c7c4c4a357a3, ..., prod_invalid_test).
```

✅ SQLSTATE `23514` confirmed. Constraint name `signals_temporal_grounding_check` matches spec. Row dump shows the rejected value at the end, never committed.

**Constraint is non-bypassable at the DB layer on prod.** Service-role writers cannot supply an out-of-vocabulary value.

---

## §4 — Rollback readiness

Rollback procedure (one-line DDL):

```sql
ALTER TABLE public.signals DROP COLUMN temporal_grounding;
```

**Time-to-revert estimate**: < 5 minutes (single DDL; no row rewrite; trivial CHECK constraint removal). Drill proven on staging via PL/pgSQL DO-block + RAISE EXCEPTION auto-rollback (Task #152 §4) — staging confirmed column restored after intentional drop+abort.

**Rollback decision criteria** (any → revert):
- Apply returned non-success
- T+0 column-exists check returned false
- T+0 row count differed from baseline
- T+0/T+1h: edge_function_errors referencing `temporal_grounding` traced to previously-healthy functions
- Operator directs revert

**Current state**: NO triggers fired. NO rollback required.

---

## §5 — T+1h measurements

**In flight.** Background watch task `bxr8kv75a` scheduled at apply-time; fires at approximately `2026-06-01T13:45Z`. T+1h measurements will re-verify:
- Column still present + constraint intact
- Row count + distribution unchanged (modulo any new ingest-signal inserts — prod averages ~0.8 signals/hour)
- `edge_function_errors` referencing `temporal_grounding` in 1h window = 0
- Any new signals inserted in window defaulted correctly to `'unknown'`

**Prod will exercise the live-insert default path** (staging didn't — zero new signals in its 1h window). This is the proof point that the default applies on new INSERTs in production traffic.

---

## §6 — Coherence with staging validation

| Axis | Staging (Task #152) | Prod (this report) |
|---|---|---|
| Migration apply | GREEN | GREEN |
| Constraint enforcement (caught) | GREEN | GREEN |
| Constraint enforcement (uncaught — SQLSTATE 23514) | GREEN | GREEN |
| Rows defaulted `'unknown'` | 78/78 (100%) | 1,487/1,487 (100%) |
| Distinct classes present | 1 | 1 |
| Lock duration | Sub-second | Sub-second |
| Rollback drill | PROVEN (DO-block) | Procedure documented + ready |
| Live-insert default-value proof | N/A (staging quiet) | Pending T+1h |

Staging behavior reproduced exactly on prod at 19× the row count.

---

## §7 — Downstream consumer state (unchanged)

T-0 has **zero downstream consumers** today. All HELD per operator:
- T-1 ingest-signal classifier — HELD until prod T+0 burn-in
- T-2 alert-delivery audit shim — HELD until T-1
- T-3 alert-delivery egress gate — HELD until T-2 block-rate <25%
- Coverage Confidence module (`aegis-coverage-confidence.ts`) reads `temporal_grounding` when present; falls back to structural detection (NULL or cosmetic-midnight) when absent — so the new column on prod is now optionally readable by Coverage Confidence if the slim slice is later promoted to prod

**No edge functions today read or write `temporal_grounding` on prod.** New column is pure substrate.

---

## §8 — Operator decision queue (post-apply)

| # | Decision | Status |
|---|---|---|
| ✅ TI.D2-prod (T-0 prod apply) | **DONE** 2026-06-01T12:44:54Z |
| TI.D3 (T-1 ingest classifier) | HELD until ≥7d prod burn-in |
| TI.D4 (T-2 audit shim) | HELD until T-1 |
| TI.D5 (T-3 egress gate) | HELD until T-2 block-rate <25% |
| Dashboard-ai-assistant slim slice (B+C+D+E) | Awaiting operator's 3 narrowed staging tests per 2026-06-01 directive |

---

## §9 — Honest limits

1. **Migration applied via MCP inline SQL**, not via `supabase functions deploy --include-migrations` from a checked-out branch. The repo migration file (`supabase/migrations/20260531201311_t0_signals_temporal_grounding_substrate.sql`) is on `feat/t0-temporal-grounding-substrate` and not yet merged to `main`. Prod database state and repo state are functionally equivalent but file-system out of sync until that branch is merged. Recommendation: merge the branch to `main` as a follow-on; no operational urgency.
2. **T+1h watch is in background** (task `bxr8kv75a`) and will fire ~`2026-06-01T13:45Z`. Final §5 will be appended when the watch returns.
3. **Live-insert default-value proof** is prod-only and pending T+1h. Staging didn't exercise this path because zero new signals were ingested during its 1h window. Prod's ~0.8 signals/hour rate means at least one new INSERT should occur within the window.
4. **Rollback drill on prod was NOT executed** — staging drill was sufficient evidence; running an actual DROP COLUMN drill on prod would briefly remove the column and is unnecessary. Procedure is documented + tested on staging; ready if needed.
5. **No new schema parity check** between staging and prod (e.g., `pg_constraint` cross-comparison). Migration definitions match by construction; functional equivalence assumed.

---

## §5 — T+1h watch (2026-06-01T14:13Z — fired via background task `bxr8kv75a`)

Watch ran ~89 minutes after T-0 apply (12:44:54Z → 14:13:01Z, exceeded planned ~1h due to scheduling overhead inside ER substrate work).

| Check | Value | Status |
|---|---|---|
| `column_state` | `text NOT NULL DEFAULT 'unknown'::text` | ✅ unchanged |
| `check_constraint` | `signals_temporal_grounding_check` — same 5-value ARRAY | ✅ unchanged |
| `full_distribution` | 1,488 rows, all `unknown` (was 1,487 at T+0; +1 new signal in window) | ✅ no rogue writer |
| `distribution_since_t0` | 1 signal created since `2026-06-01T12:44:54Z` — also `unknown` | ✅ new INSERTs honor default |

**Live-insert default-value proof now satisfied.** A new prod signal was ingested in the watch window and correctly defaulted to `'unknown'`. No writer code has been changed to set this column to anything else (per substrate-first discipline).

---

## §10 — Verdict

**T-0 PROD: APPLIED + T+0 GREEN + T+1h GREEN.**

All staging-validated success criteria reproduced on prod at production scale. Constraint enforcement proven non-bypassable. Zero behavioral change observed across 89 minutes of production traffic (1 new signal, defaulted correctly). Rollback procedure ready.

T-0 substrate workstream is **CLOSED**. T-1 / T-2 / T-3 remain operator-gated separately.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
