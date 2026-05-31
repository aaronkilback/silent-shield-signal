# Temporal Integrity — Authorization Package

**Operator-directed 2026-05-31 (Task #151).** Smallest reversible intervention sequence that materially reduces customer-facing temporal inaccuracies. **Authorization package only — no implementation.**

Operator framing:
> *"What is the smallest reversible intervention that materially reduces customer-facing temporal inaccuracies?"*

Baseline established by Task #150: **170 customer-visible alerts in 90d (~13/week)** arrived with ungrounded temporal claims. **56.3%** of real-customer incidents (90d) trace to at-risk signals. The intervention must measurably bend that curve while staying reversible at each step.

---

## §0 — Constraints and doctrines honored in this design

| Doctrine | How honored here |
|---|---|
| **Defensive layers before prompt tuning** | T-0 → T-3 are deterministic substrate/writer/egress layers. AI Decision Engine prompt changes are deferred (T-4+) — never the primary gate. |
| **Input-side before output-side** | T-1 (ingest writer) classifies at write-time; T-2/T-3 (egress) are validators atop. |
| **Measure before and after every intervention** | Each step has a quantitative baseline + a 24h/72h/7d re-measure protocol. |
| **Measurability is part of the feature** | All step effects observable via `function_telemetry` + new columns. No console-only logs. |
| **No persistence without named consumer** | T-0 substrate (`signals.temporal_grounding`) has a named consumer in this same package: T-2 audit shim + T-3 egress gate. |
| **Audit-before-blocking** | T-2 is audit-only ("would-have-blocked" telemetry). T-3 promotes to blocking ONLY after baseline observation. |
| **Capability vs adoption split** | §8 reports capability (does the gate compile + classify correctly?) and adoption (does customer-facing rate trend down?) **separately**. |
| **C-0 substrate pattern** (Task #146/#148) | T-0 mirrors the tier-column substrate: pure DDL, conservative default, CHECK constraint, zero behavioral change. |
| **Provenance-style non-bypassable** | T-3 gate at egress is the non-bypassable backstop. Service-role writers can't avoid it because they all flow through `alert-delivery*`. |
| **Reversibility** | Every step has a one-line rollback. T-0/T-1 reversible by DDL/code revert; T-2 reversible by removing telemetry lines; T-3 reversible by feature-flag toggle. |

---

## §1 — Smallest-reversible-intervention question, answered

The intervention that materially reduces the **170-customer-alert-per-90d** rate is at the egress layer — **`alert-delivery*` refusing to ship alerts whose source signal lacks defensible temporal grounding.**

That single step is the operative customer-facing change. Everything else in the sequence (substrate, writer, audit shim) exists to make that step **safe, measurable, and reversible**.

**Smallest reversible intervention = T-3** (egress block on `temporal_grounding IN ('unknown','current_inferred')`).
**Smallest substrate prerequisite = T-0** (the column itself, default `'unknown'`, zero behavioral change).
**Smallest validation prerequisite = T-2** (audit-only "would-have-blocked" telemetry shim, before T-3 promotes to blocking).

Operative sequence: **T-0 → T-1 → T-2 → (operator GO) → T-3.** T-4+ deferred separately.

---

## §2 — Sequencing

```
T-0  signals.temporal_grounding column + CHECK + default 'unknown'  [substrate, zero behavior]
 │
T-1  ingest-signal classifies temporal_grounding at write time      [input-side writer, audit-only by default]
 │
T-2  alert-delivery* logs would-have-blocked decisions              [output-side audit shim]
 │   ── operator GO required before T-3 ──
 │
T-3  alert-delivery* refuses ungrounded-temporal alerts             [egress gate, operator-flagged ON]
 │
T-4+ deferred (operator separately gated):
     • backfill existing 760 at-risk signals
     • report-generator prose-lint R8
     • AI Decision Engine prompt tuning
     • Aegis context cleansing
     • Workstream D claim-frame extension
```

Each step is independently reversible. Each gate is operator-explicit. No step is bundled.

---

## §3 — T-0: Substrate (the smallest substrate-first step)

### Migration shape

```sql
BEGIN;

ALTER TABLE public.signals
  ADD COLUMN temporal_grounding text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.signals
  ADD CONSTRAINT signals_temporal_grounding_check
  CHECK (temporal_grounding IN (
    'unknown',           -- no defensible temporal claim available
    'current_grounded',  -- event recently occurred AND source corroborates
    'historical_grounded', -- event > 30d ago AND source corroborates
    'current_inferred',  -- AI claimed current but no source grounding
    'historical_inferred' -- AI claimed historical but no source grounding
  ));

COMMENT ON COLUMN public.signals.temporal_grounding IS
  'T-0 (2026-05-31) — temporal-grounding class per default-to-historical-when-unknown doctrine. '
  'Default ''unknown'' = no row gains a temporal claim from this migration alone. '
  'T-1 writer populates at ingest; T-2 audit shim measures; T-3 egress gate blocks unknown/current_inferred.';

COMMIT;
```

### Properties

| Property | Value |
|---|---|
| **Behavioral change** | ZERO — default `'unknown'`; no writer reads or writes the column yet |
| **Forward-applicability** | Every new signal gets `'unknown'` until T-1 ships |
| **Backward-applicability** | Every existing signal gets `'unknown'` — no retroactive classification |
| **Reversibility** | `ALTER TABLE signals DROP COLUMN temporal_grounding;` — fully reversible |
| **Cost** | One column add; CHECK constraint; ~negligible storage |
| **Named consumer** | T-2 audit shim (this package, §5) + T-3 egress gate (this package, §6). NOT speculative substrate. |

### What T-0 deliberately does NOT do

- Does NOT retroactively classify the 760 existing at-risk signals (deferred to T-4+ backfill)
- Does NOT modify the AI Decision Engine
- Does NOT modify report generators
- Does NOT modify alert-delivery
- Does NOT modify Aegis context retrieval

Default `'unknown'` is the most conservative choice — every signal is initially un-classifiable until the writer runs, mirroring C-0's `'log'`-as-default pattern.

---

## §4 — T-1: Ingest-side writer (audit-only by default)

### Shape

Edit `supabase/functions/ingest-signal/index.ts` to compute `temporal_grounding` at write time from deterministic rules **only** (no LLM dependency):

```ts
function classifyTemporalGrounding(signal: IncomingSignal): TemporalGrounding {
  // Rule 1: explicit event_date >30 days old AND source text mentions year → historical_grounded
  // Rule 2: explicit event_date within 30 days AND source text corroborates recency → current_grounded
  // Rule 3: event_date NULL → unknown
  // Rule 4: event_date is midnight-of-ingestion (cosmetic) → unknown
  // Rule 5: AI Decision Engine flag is_historical_content=true → historical_inferred (preserved but flagged)
  // Rule 6: AI Decision Engine flag is_historical_content=false WITH estimated_event_date → current_inferred
  // Rule 7: AI Decision Engine flag is_historical_content=false WITHOUT date → unknown (the 227 class)
  // Default: unknown
}
```

### Properties

| Property | Value |
|---|---|
| **Behavioral change at T-1** | New signals classified; existing signals unchanged |
| **Validator-first** | Pure deterministic rules (no prompt-discipline dependence). Caught: midnight-cosmetic, NULL event_date, 227-class. |
| **Reversibility** | Code revert; column defaults back to `'unknown'` for any new rows |
| **Telemetry** | Each classification emits `function_telemetry` row `{ event: 'temporal_grounding_classified', class: '<value>', signal_id, debug_trace_id }` |
| **Capability test** | Synthetic signals with known event_date patterns classify correctly (SQL-verifiable) |

### What T-1 deliberately does NOT do

- Does NOT call any LLM
- Does NOT modify AI Decision Engine outputs (only reads the existing `ai_decision` block)
- Does NOT backfill existing signals (deferred)
- Does NOT change any downstream behavior — T-1 writes the column; nothing reads it yet

---

## §5 — T-2: Egress audit shim (audit-only)

### Shape

Edit `supabase/functions/alert-delivery/index.ts` and `alert-delivery-secure/index.ts` to compute the "would-have-blocked" decision and log it **without altering delivery**:

```ts
async function wouldEgressGateBlock(alert: Alert, supabase: SupabaseClient) {
  if (!alert.incident_id) return { would_block: false, reason: 'no_incident' };
  // Look up source signal via incidents.signal_id
  // Read signals.temporal_grounding
  // Return { would_block: temporal_grounding IN ('unknown','current_inferred'), reason, signal_id, temporal_grounding }
}

// In delivery loop, BEFORE current delivery code:
const audit = await wouldEgressGateBlock(alert, supabase);
await recordTelemetry(supabase, {
  function_name: 'alert-delivery',
  event: 'temporal_audit_decision',
  context: { alert_id: alert.id, would_block: audit.would_block, reason: audit.reason, signal_id: audit.signal_id, temporal_grounding: audit.temporal_grounding },
});
// Delivery proceeds as before — audit-only.
```

### Properties

| Property | Value |
|---|---|
| **Behavioral change** | ZERO — every alert still delivers; only telemetry added |
| **Measurement** | After 7 days, `SELECT context->>'would_block', COUNT(*) FROM function_telemetry WHERE event='temporal_audit_decision' GROUP BY 1` gives the audit-rate |
| **Reversibility** | Code revert; no schema change |
| **Operator decision input** | The 7-day audit rate is the empirical input to T-3 GO/NO-GO. If audit shows 80% block rate, the writer/backfill needs more work BEFORE promoting. |

### Acceptance criterion before T-3 is proposed

The T-2 baseline must produce a defensible block-rate distribution. Specifically: **if `would_block=true` exceeds 25% of customer alerts, T-3 is NOT proposed** — the upstream writer (T-1) needs improvement or a backfill needs to ship first. This prevents T-3 from becoming a customer-visible outage disguised as a doctrine win.

---

## §6 — T-3: Egress block (operator-gated; separate authorization)

This step is described for completeness but **does not move forward in this package**. It requires a separate authorization based on the T-2 observation window.

### Shape

```ts
const audit = await wouldEgressGateBlock(alert, supabase);
if (TEMPORAL_EGRESS_GATE_ENABLED && audit.would_block) {
  await recordTelemetry(supabase, { ..., event: 'temporal_egress_blocked', ... });
  return { skipped: true, reason: 'temporal_grounding_insufficient' };
}
// Otherwise deliver as before.
```

### Properties

| Property | Value |
|---|---|
| **Behavioral change** | Customer-facing — blocks delivery of `unknown`/`current_inferred` alerts |
| **Feature flag** | `TEMPORAL_EGRESS_GATE_ENABLED` (env-var or DB-config). Toggle ON/OFF without redeploy. |
| **Reversibility** | Flag flip = instant revert to audit-only |
| **Pre-conditions** | T-2 baseline shows block-rate < operator-set threshold; T-1 writer has been running ≥7 days |
| **Adoption measurement** | 7d/30d post-flip: customer-visible temporal-claim rate trend |

### Decision input for T-3

Decision is gated on TWO things — neither pre-decided here:
1. The empirical T-2 block-rate is in a defensible range
2. Operator explicitly authorizes flag-on

---

## §7 — T-4+ deferred work (NOT in this package)

| Item | Defer reason |
|---|---|
| **Backfill existing 760 at-risk signals** | Touches historical rows; needs separate authorization once T-1 writer is proven |
| **Report-generator prose-lint R8** | Workstream D claim-frame extension; per "audit-before-blocking" doctrine, R8 should also be audit-only first |
| **AI Decision Engine prompt tuning** | "Defensive layers before prompt tuning" — defer until T-1/T-3 catch rate is measured |
| **Aegis context cleansing** | Risk 2 from impact assessment §10 — separate workstream; touches grounding-state doctrine territory |
| **Off-DB `reports` storage scan** | Unmeasured 255-report exposure; needs separate authorization (storage egress + read costs) |

Each is a separate authorization package, not a bundled item.

---

## §8 — Measurement plan (capability + adoption, separately)

Per *capability-vs-adoption-split* doctrine, every step reports both.

### T-0 (substrate)

| Type | Measurement | Pass criterion |
|---|---|---|
| **Capability** | `SELECT column_name FROM information_schema.columns WHERE table_name='signals' AND column_name='temporal_grounding'` returns 1 row; CHECK constraint exists | Both yes |
| **Capability** | Inserting an invalid value (e.g., `'bogus'`) raises CHECK violation | Yes |
| **Adoption** | N/A — zero behavioral change | — |

### T-1 (ingest writer)

| Type | Measurement | Pass criterion |
|---|---|---|
| **Capability** | After 24h, `SELECT temporal_grounding, COUNT(*) FROM signals WHERE created_at > T1_ship GROUP BY 1` returns a distribution (not all-`'unknown'`) | At least 3 of 5 classes populated for new signals |
| **Capability** | Synthetic-signal regression: 10 known-event_date patterns classify per rules | 10/10 correct |
| **Adoption** | N/A — no customer-facing effect | — |

### T-2 (egress audit shim)

| Type | Measurement | Pass criterion |
|---|---|---|
| **Capability** | After 24h, `function_telemetry` rows with `event='temporal_audit_decision'` exist for every customer alert | 100% of delivered customer alerts have a paired audit row |
| **Capability** | `would_block` distribution is computable | Yes |
| **Adoption** | N/A — zero behavioral change | — |

### T-3 (egress block — separately authorized)

| Type | Measurement | Pass criterion |
|---|---|---|
| **Capability** | Blocked alerts log `event='temporal_egress_blocked'`; flag toggle reverts behavior in real-time | Yes |
| **Adoption** | 7d / 30d post-flip: count of customer-visible alerts from `unknown` or `current_inferred` signals **trends to zero** | At T+30d, the 170/90d baseline is materially below baseline; ground-truth via the same query from impact assessment §4 |

### Baseline (T-1d, pre-T-0)

| Metric | Today's value (from Task #150) |
|---|---|
| Customer alerts (90d) | 1,525 |
| Customer alerts with source signal | 344 |
| Customer alerts with at-risk source | 170 |
| Customer alerts from ai_claimed_current_no_grounding | 80 |
| Real-customer at-risk incidents (90d) | 54 of 96 (56.3%) |

These are the operator-visible numbers re-measured at 24h / 72h / 7d / 30d post-T-3.

---

## §9 — Rollback plan (per step)

| Step | Rollback shape | Time to revert |
|---|---|---:|
| **T-0** | `ALTER TABLE signals DROP COLUMN temporal_grounding;` (DDL one-liner) | < 5 min |
| **T-1** | `git revert <T-1 commit>` + redeploy `ingest-signal`. Column defaults back to `'unknown'` for new rows; old rows keep prior classification (read-only column at that point) | < 15 min |
| **T-2** | `git revert <T-2 commit>` + redeploy `alert-delivery*`. Telemetry rows persist (no customer impact) | < 15 min |
| **T-3** | Toggle `TEMPORAL_EGRESS_GATE_ENABLED=false` (env-var or DB flag). No redeploy. Behavior reverts to audit-only | < 60 sec |

### Combined rollback (full unwind)

Worst case: revert all steps in reverse order. Total time < 30 min, no data loss (telemetry preserved, column drop is the only schema change).

### What rollback does NOT restore

- Customer alerts that were blocked during T-3 ON period are not retroactively delivered (intentional — operator confirms before T-3)
- Telemetry rows persist in `function_telemetry` (read-only audit trail)

---

## §10 — Scope boundaries

### In scope (this package)

- `signals.temporal_grounding` column + CHECK
- `ingest-signal` writer
- `alert-delivery` + `alert-delivery-secure` audit shim
- Measurement queries
- Per-step rollback procedures
- Operator decision points TI.D1–TI.D4

### Explicitly out of scope (NOT in this package — separate authorization required)

- **No AI Decision Engine prompt changes** (deferred per "defensive layers before prompt tuning")
- **No retroactive backfill** of existing 760 at-risk signals (separate authorization, after T-1 writer is proven)
- **No report-generator changes** (deferred; Workstream D claim-frame extension is separate)
- **No Aegis context retrieval changes** (Risk 2 mitigation is a separate workstream)
- **No off-DB `reports` body scan** (unmeasured 255 reports — separate authorization)
- **No `incidents` or `entity_content` temporal-grounding columns** (mirror tables; not in this scope)
- **No changes to existing W-MISSION Phase 1 watchdog** (separate observation surface)
- **No bundled C-1/C-2 tier-column work** (those proceed on their own track)
- **No frontend changes** (signal cards may render `temporal_grounding` differently but that's a UI follow-on)

### Explicit doctrinal alignment with prior work

- Mirrors C-0 substrate pattern (Task #146/#148) — pure DDL substrate, conservative default, CHECK constraint, named consumer present
- Mirrors EX-1 validator-first pattern — deterministic writer (T-1) before any prompt-discipline change
- Mirrors QR1 measurement pattern (Task #129) — recordTelemetry() in writers; SQL-observable; capability vs adoption split

---

## §11 — Honest limits + known gaps

1. **The 1,049 signals with no AI Decision Engine flag (legacy / pre-engine)** will be classified by T-1 using only structural rules (event_date check). Those that have NULL event_date will be `'unknown'`. T-3 will block their alerts. **This may produce a one-time bump in blocked-alert rate** when T-3 first fires; operator should expect this and may want backfill (T-4) before T-3 flag-on.

2. **AI Decision Engine `is_historical_content=true` with NULL event_date (3 signals)** classifies as `'historical_inferred'` per rule 5. Tiny population; not material.

3. **The "current_grounded" class (rule 2)** requires source-text corroboration of recency. The current `ingest-signal` does **not** parse source text for recency markers. Initially this class will be ~empty; over time the writer can be enhanced. **This is not a regression** — T-3 only blocks `unknown` / `current_inferred`; `current_grounded` being underpopulated does not cause blocks.

4. **Off-DB `reports` body** (255 rows / 90d) unaddressed by this package. Report-generator prose-lint (T-4+) is the eventual fix.

5. **Customer-perceived "ungrounded-but-true"** alerts may be blocked once T-3 fires. The operator-visible effect: a customer might NOT receive an alert about a genuinely-current event whose ingest source happened to lack a parseable event_date. **Mitigation:** the T-2 audit-only window is the calibration period to measure this rate. If it's material, the T-1 writer's rules need tightening before T-3 promotes.

6. **The 56.3% at-risk-incident rate** is reduced by T-3 only for future alerts. Existing 54 at-risk incidents remain in the system; their alerts are already delivered. T-3 is forward-only.

---

## §12 — Operator decision surface

| # | Decision | Default |
|---|---|---|
| **TI.D1** | Ratify the default-to-historical-when-unknown doctrine as the temporal twin of the Provenance Doctrine | Recommend ACCEPT |
| **TI.D2** | Authorize T-0 (substrate-only) — pure DDL, zero behavioral change, fully reversible via `DROP COLUMN` | Recommend GO with staging-first apply (mirrors C-0 path: Task #146 → #148) |
| **TI.D3** | Authorize T-1 (ingest writer) once T-0 is in prod | DO NOT decide here — operator-gated separately after T-0 burn-in |
| **TI.D4** | Authorize T-2 (audit shim) once T-1 is producing classifications | DO NOT decide here — operator-gated separately after T-1 burn-in |
| **TI.D5** | Authorize T-3 (egress block) only after T-2 baseline shows defensible block-rate | DO NOT decide here — explicit separate authorization required |
| **TI.D6** | Optional: ratify the T-2-block-rate-<25% gate as the empirical guard between T-2 and T-3 | Recommend RATIFY — prevents T-3 from being a hidden outage |
| **TI.D7** | Confirm scope boundaries in §10 are complete (no AI prompt, no backfill, no report prose, no Aegis context in this package) | Recommend CONFIRM |
| **TI.D8** | Confirm rollback time-budgets in §9 are acceptable (T-0 DDL < 5min; T-3 flag flip < 60sec) | Recommend CONFIRM |

The operator may authorize TI.D2 alone (T-0 only) and pause to evaluate before TI.D3. The architecture supports incremental authorization at every step.

---

## §13 — Most-important question, answered

> *"What is the smallest reversible intervention that materially reduces customer-facing temporal inaccuracies?"*

**Answer:** A two-line egress gate in `alert-delivery*` that refuses delivery when the source signal's `temporal_grounding` is `'unknown'` or `'current_inferred'`. That single change directly reduces the 170-alert-per-90d rate.

That intervention depends on a three-row prerequisite:

1. **One column** (`signals.temporal_grounding`, default `'unknown'`, CHECK constrained) — pure DDL, fully reversible.
2. **One deterministic classifier** in `ingest-signal` — no LLM dependency, validator-first.
3. **One audit shim** that measures the would-block rate before flipping to blocking — audit-before-blocking compliance.

Total reversible-step count: 4. Total time-to-revert (worst case): <30 minutes. Doctrinal coverage: all eleven prior doctrines listed in §0.

The non-intervention alternative is the status quo: ~13 ungrounded-temporal alerts per week to Petronas, Cascade, and BC Place, continuing indefinitely.

---

## §14 — Constraints honored

- Authorization package only — no implementation, no migrations, no schema changes applied
- No design proposals beyond the smallest viable sequence
- No bundled work (each step independently authorized)
- No prod JWTs in chat
- C-0 prod observation continues undisturbed (Task #148)
- W-MISSION Phase 1 GREEN preserved (Task #137)
- QR1 measurement window (T+24h/T+72h/T+7d) continues separately

🤖 Generated with [Claude Code](https://claude.com/claude-code)
