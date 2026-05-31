# C-0 — Tier Column Migration Substrate (Pre-Flight)

**Operator-directed 2026-05-31 (Task #144).** Pre-flight for C-0: add `tier text` column with CHECK constraint to `alerts`, `platform_findings`, `agent_pending_messages`. Zero behavioral change. Per operator sequential discipline: **C-0 → validate → C-1 → validate → C-2 → validate.** No bundling.

Doctrine applied:
- *Measure before and after every intervention*
- *No persistence without named consumer* (the `tier` column has documented consumers: egress gate, watchdog, daily briefing)
- *Address generation before approval* (classification at write time, not delivery time)
- *Protect Attention Like Critical Infrastructure* (this is the substrate that makes tiering enforceable)

---

## §1 — Baseline Measurement (Prod, 2026-05-31)

| Table | Current row count | Existing `tier` column? |
|---|---:|---|
| `alerts` | 13,868 | NO (no collision) |
| `platform_findings` | 82 | NO |
| `agent_pending_messages` | 167 | NO |

**Total rows to backfill `tier='log'` on:** 14,117.

**No existing `tier` column on any target table.** The migration adds three new columns; no name collisions.

### Pre-existing severity-like columns (for reference; NOT touched by C-0)

- `alerts.status` — pending/sent/failed/etc.
- `alerts.response_json.threat_level` — LOW/MEDIUM/HIGH/CRITICAL (JSON-nested)
- `platform_findings.severity` — critical/high/medium/warning/info
- `platform_findings.category` — mission_health/behavioral_health/etc.
- `agent_pending_messages.priority` — normal/high/urgent (per generator code)

The `tier` column is **orthogonal** to these. It captures the **routing decision** (LOG / FINDING / NOTIFICATION / INTERRUPTION), not the severity label. C-1 (next step) will populate `tier` based on category × severity logic; C-0 just creates the substrate.

---

## §2 — Migration Design

### A — Atomic transaction structure

```sql
-- Migration: 20260531HHMMSS_c0_tier_column_substrate.sql
-- Doctrine: Protect Attention Like Critical Infrastructure
-- Reference: docs/platform-operations/four-tier-classification-design-2026-05-31.md (Task #143)
-- Pre-flight: docs/platform-operations/c0-tier-column-pre-flight-2026-05-31.md (Task #144)
--
-- Effect: adds `tier text` column with CHECK constraint to three operator-surface
-- tables. Default 'log' (most conservative — no row gains push-tier semantics
-- by virtue of this migration). ZERO BEHAVIORAL CHANGE.
--
-- C-1 (separate, future) will update writers to set the correct tier going forward.
-- C-2 (separate, future) will update egress (alert-delivery-secure) to gate on tier.

BEGIN;

-- §A — alerts.tier
ALTER TABLE public.alerts
  ADD COLUMN tier text NOT NULL DEFAULT 'log';

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_tier_check
  CHECK (tier IN ('log', 'finding', 'notification', 'interruption'));

COMMENT ON COLUMN public.alerts.tier IS
  'C-0 (2026-05-31) — alert tier per Protect-Attention doctrine. log=no push, finding=operator-pull, notification=Slack/Teams, interruption=Teams+Slack+SMS+oncall. Default ''log'' = no row gains push semantics from this migration alone.';

-- §B — platform_findings.tier
ALTER TABLE public.platform_findings
  ADD COLUMN tier text NOT NULL DEFAULT 'finding';

ALTER TABLE public.platform_findings
  ADD CONSTRAINT platform_findings_tier_check
  CHECK (tier IN ('log', 'finding', 'notification', 'interruption'));

COMMENT ON COLUMN public.platform_findings.tier IS
  'C-0 (2026-05-31) — finding tier per Protect-Attention doctrine. Default ''finding'' because platform_findings is by design an operator-pull queue (Neural Constellation UI); rows that should not surface to operator can be downgraded to ''log''.';

-- §C — agent_pending_messages.tier
ALTER TABLE public.agent_pending_messages
  ADD COLUMN tier text NOT NULL DEFAULT 'finding';

ALTER TABLE public.agent_pending_messages
  ADD CONSTRAINT agent_pending_messages_tier_check
  CHECK (tier IN ('log', 'finding', 'notification', 'interruption'));

COMMENT ON COLUMN public.agent_pending_messages.tier IS
  'C-0 (2026-05-31) — chat-push tier per Protect-Attention doctrine. Default ''finding'' (chat surface is operator-pull). C-1+ will set ''notification'' for items that should ping the chat panel actively.';

COMMIT;
```

### B — Default-value rationale per table

- **`alerts` default `'log'`**: the 13,868 historical rows are overwhelmingly LOW-priority strategic intelligence (Task #142). The most conservative default is to treat all of them as LOG — no row gains push semantics by virtue of this migration. C-1 backfill (separate step) will reclassify the small subset that warrants higher tier.
- **`platform_findings` default `'finding'`**: by design, this table IS the operator-pull queue. Existing rows already match the FINDING tier semantic.
- **`agent_pending_messages` default `'finding'`**: chat surface is operator-pull; existing 167 stale rows already match this tier.

### C — What this migration does NOT do

- Does not change writer code (alert-delivery-secure, ai-decision-engine, etc. continue to write as before; they just get a default tier value)
- Does not change egress behavior (alert-delivery-secure still attempts Teams/Slack/SMS for every applicable alert)
- Does not change UI surfaces
- Does not modify existing data (default applies to existing rows AND new rows; same outcome)
- Does not enable any new push channel
- Does not affect the 14,117 existing row content

**Behavioral change scope: ZERO.** This is pure substrate.

---

## §3 — Staging Validation Plan

| Step | Action | Pass condition |
|---|---|---|
| S1 | Apply migration to staging via `apply_migration` MCP | `success: true` |
| S2 | Verify column exists on each table | `information_schema.columns` returns 3 rows with `column_name='tier'` |
| S3 | Verify CHECK constraint definition | `pg_get_constraintdef` returns the four-value enum on each table |
| S4 | Verify default applied to existing rows | Sample 5 rows per table; all show `tier='log'` for alerts, `tier='finding'` for others |
| S5 | Reject invalid tier value | Attempt INSERT with `tier='invalid'`; expect 23514 CHECK violation |
| S6 | Accept all four valid tier values | One test row per tier; verify success |
| S7 | Cleanup test rows | DELETE WHERE tier='interruption' AND <test marker> |

### Staging context
- Staging project: `lkvyrvuakzguszbpwnfz`
- `alerts` row count on staging: previously verified at 0
- `platform_findings` row count on staging: unknown — will note
- DDL changes will apply cleanly regardless of row count

---

## §4 — Prod Apply Plan (Operator-Gated)

After staging green:

| Step | Action | Operator gate |
|---|---|---|
| P1 | Confirm staging validation passed (§3) | inform |
| P2 | Apply migration to prod via `apply_migration` | **EXPLICIT GO REQUIRED** |
| P3 | Run §3 verification queries against prod | inform |
| P4 | Capture post-deploy snapshot for measurement | automated |
| P5 | Watch for any unexpected error patterns in next 1h | inform |

---

## §5 — Post-Deploy Measurement Plan

Per ratified *"Measure before and after every intervention"* doctrine:

```sql
-- Metric M-C0-1: Column existence
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND column_name='tier' AND table_name IN
  ('alerts','platform_findings','agent_pending_messages');
-- Expected: 3 rows, all 'tier text', default per §2.B

-- Metric M-C0-2: Tier distribution per table (should be 100% default-tier post-deploy)
SELECT 'alerts' AS t, tier, COUNT(*) FROM alerts GROUP BY tier
UNION ALL
SELECT 'platform_findings', tier, COUNT(*) FROM platform_findings GROUP BY tier
UNION ALL
SELECT 'agent_pending_messages', tier, COUNT(*) FROM agent_pending_messages GROUP BY tier
ORDER BY t, tier;
-- Expected: 13,868 alerts/log, 82 platform_findings/finding, 167 agent_pending_messages/finding

-- Metric M-C0-3: New-row check after 24h (any writers writing default or explicit?)
-- Re-run M-C0-2 after T+24h. Compare row counts. New writes will share the default
-- because C-1 (writer updates) has not shipped yet.

-- Metric M-C0-4: Error rate in edge functions touching the three tables
-- Spot-check edge_function_errors for the 1h post-deploy window
SELECT function_name, COUNT(*)
FROM edge_function_errors
WHERE occurred_at > '<deploy timestamp>'
  AND function_name IN
    ('alert-delivery','alert-delivery-secure','system-watchdog','ai-decision-engine',
     'incident-manager','ingest-signal','proactive-intelligence-push')
GROUP BY function_name;
-- Expected: zero new errors. The migration is additive; no writer should fail.
```

### Measurement schedule

- **T+0** (immediately post-deploy): M-C0-1, M-C0-2, M-C0-4
- **T+1h**: M-C0-4 (compare to baseline error rate)
- **T+24h**: M-C0-2 + M-C0-3 (confirm new writes don't unexpectedly violate the CHECK)
- **T+7d** (optional): M-C0-2 long-term snapshot before C-1 ships

### Success criteria for C-0

- **GREEN**: all 3 metrics show expected results AND zero edge-function-error spike in next 1h
- **YELLOW**: column added but some writer silently fails to provide tier (unlikely since column has DEFAULT)
- **RED**: any writer throws an error related to the column or constraint → trigger rollback

---

## §6 — Rollback Plan (3 layers; lightest first)

### Layer 1 — Drop the columns (preserves all other data)

```sql
BEGIN;
ALTER TABLE public.alerts DROP COLUMN tier;
ALTER TABLE public.platform_findings DROP COLUMN tier;
ALTER TABLE public.agent_pending_messages DROP COLUMN tier;
COMMIT;
```

Takes effect immediately. All other data preserved. The CHECK constraints drop automatically with the column.

### Layer 2 — Drop only the CHECK constraints (keeps columns)

Only if specific need to retain the column for backfill experiments but remove enforcement:

```sql
ALTER TABLE public.alerts DROP CONSTRAINT alerts_tier_check;
ALTER TABLE public.platform_findings DROP CONSTRAINT platform_findings_tier_check;
ALTER TABLE public.agent_pending_messages DROP CONSTRAINT agent_pending_messages_tier_check;
```

### Layer 3 — Full git revert + DROP

Drop columns + revert any committed migration files. Mirrors QR1 rollback pattern.

### Rollback decision tree

```
Did any writer break post-deploy?
  ├─ YES (P5 surfaces error spike) → Layer 1 (drop columns)
  └─ NO → no rollback needed

Is any writer hitting the CHECK constraint unexpectedly?
  ├─ YES → Layer 2 (drop constraints) or rollback writer commit
  └─ NO → continue to C-1
```

---

## §7 — What Comes After C-0 (Out of Scope for This Pre-Flight)

The operator-mandated sequential order is **C-0 → validate → C-1 → validate → C-2 → validate.** This pre-flight covers C-0 only.

After C-0 success, separately:
- **C-1**: writer updates in `ai-decision-engine` (and `alert-delivery-secure`, etc.) to set tier based on subject/category/severity logic at write time
- **C-2**: egress gate in `alert-delivery-secure` to only attempt push for `tier IN ('notification', 'interruption')`

Each gets its own pre-flight + GO. **No bundling per operator direction.**

---

## §8 — Pre-Flight Acceptance Checklist

| # | Item | Status |
|---|---|---|
| ✓ | Baseline row counts captured (§1) | 13,868 + 82 + 167 |
| ✓ | No `tier` column collisions confirmed | All 3 tables clean |
| ✓ | Migration designed as atomic transaction (§2) | ADD COLUMN + CHECK + COMMENT |
| ✓ | Default values per-table justified (§2.B) | alerts='log', platform_findings='finding', agent_pending_messages='finding' |
| ✓ | Staging validation plan defined (§3) | 7 steps, pass conditions explicit |
| ✓ | Prod apply gated on explicit operator GO (§4) | P2 |
| ✓ | Post-deploy measurement queries defined (§5) | 4 metrics with reproducible SQL |
| ✓ | Success criteria GREEN/YELLOW/RED defined (§5) | Pre-defined |
| ✓ | Rollback plan documented (§6) | 3 layers |
| ✓ | C-0 scope strictly bounded (§2.C, §7) | Zero behavioral change; substrate only |

---

## §9 — Operator Decision Surface

| # | Decision |
|---|---|
| C0.D1 | Approve the migration design as drafted (§2) — atomic transaction, three tables, CHECK constraint, defaults per §2.B |
| C0.D2 | Authorize staging apply (`apply_migration` against `lkvyrvuakzguszbpwnfz`) |
| C0.D3 | After staging green: authorize prod apply (`apply_migration` against `kpuqukppbmwebiptqmog`) |
| C0.D4 | Confirm sequential discipline — do NOT proceed to C-1 until prod C-0 validation is complete |

Held. No DDL, no DML, no deploy until C0.D2 explicit GO.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
