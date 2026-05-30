# Decision Layer C.1 — Authorization Package (pre-implementation review)

**Status:** PROPOSED 2026-05-30 — signable authorization artifact for C.1. **This document does not, by itself, authorize implementation.** Operator review of §1–§7 below + sign-off on §8 converts the plan into the binding pre-implementation contract for C.1 only. C.2 / CI gate / C.3 / C.4 + R1.1 remain separately gated.

**Companion artifacts:**
- `architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md` (G2 ADR — RATIFIED, this package is its C.1 phase)
- `decision-layer-option-c-G2-authorization-sheet-2026-05-30.md` (G2 sheet — SIGNED for C.0 only)
- `decision-layer-option-c-v2-security-review-2026-05-30.md` (the review that defined the 5 required controls)
- `supabase/migrations/20260530120000_decision_layer_c0_investigation_workspaces_tenant_id.sql` (C.0 — APPLIED to staging + prod)

**C.0 acceptance verified 2026-05-30:** all 7 functional tests pass on staging + prod with parity; raise-on-disagreement verified; trigger-enforced chain consistency verified; canonical workspace tenancy operative; `get_workspace_tenant_id(uuid)` operative.

**C.1 scope (per the G2 ADR §3):**

1. Add `cop_timeline_events.tenant_id uuid NOT NULL` (one-hop from canonical workspace tenancy)
2. Named Provenance CHECK constraint
3. BEFORE INSERT/UPDATE trigger (RC1 child-side enforcement)
4. Service-role manage RLS policy (per CQ2 v2)
5. `audit_cop_timeline_events_tenant_drift()` RPC (RC3)
6. `decision_layer_audit_alerts` table (system-internal alert store; operator-forensic read)
7. `run_audit_cop_timeline_events_tenant_drift()` cron-callable wrapper
8. Nightly cron schedule (RC3)

**Locked principles carried forward (unchanged from G2 ratification):**
- Tenant ownership is canonically stored on `investigation_workspaces.tenant_id` (C.0 invariant). `cop_timeline_events.tenant_id` is **enforced-denorm**, validated by trigger against the workspace's canonical value on every INSERT/UPDATE.
- Service-role cannot spoof. Trigger runs regardless of role.
- Auto-fill on NULL writer-set; RAISE on explicit mismatch.
- Drift between stored `tenant_id` and canonical workspace tenant is a **P1 system alert** (RC3).
- Operator-locked CQ1 strictness preserved verbatim: tenant_id required + NOT NULL + fail-closed + Provenance preserved.
- Operator-locked §10 (Option C is not R1.1 authorization) + §11 (inventory-rerun gate before any detector work) — unchanged.

---

## §1 — Exact migration plan

The C.1 migration is **one transactional unit** with eight ordered statements + documentation comments. Each statement is annotated with its safety property.

### Pre-flight state confirmed (2026-05-30)

| Property | Staging | Prod |
|---|---|---|
| `pg_cron` extension available | ✓ | (same expected) |
| `cop_timeline_events` row count | 0 | 0 |
| `cop_timeline_events.tenant_id` column absent | ✓ | ✓ |
| `cop_timeline_events.workspace_id NOT NULL` | ✓ (existing) | ✓ |
| `decision_layer_audit_alerts` absent | ✓ | ✓ |
| `audit_cop_timeline_events_tenant_drift()` absent | ✓ | ✓ |
| `investigation_workspaces.tenant_id` NOT NULL (post-C.0) | ✓ | ✓ |

### Pre-existing constraints (will not be modified)

- PRIMARY KEY `(id)`
- FK `workspace_id → investigation_workspaces(id) ON DELETE CASCADE`
- FK `added_by_user_id → auth.users(id)`
- FK `added_by_agent_id → ai_agents(id)`
- CHECK `event_type ∈ ('signal','incident','task','decision','evidence','entity','general','milestone')`
- CHECK `severity ∈ ('info','low','medium','high','critical')`
- `workspace_id NOT NULL`, `event_time NOT NULL`, `title NOT NULL`, `created_at NOT NULL DEFAULT now()`

### Migration SQL (annotated)

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.A — cop_timeline_events.tenant_id schema additions
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) Add column (nullable initially so backfill can run)
ALTER TABLE public.cop_timeline_events ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- (2) One-hop backfill from canonical workspace tenancy.
-- 0 rows in prod → UPDATE is empty. Logic ships regardless for forward correctness.
UPDATE public.cop_timeline_events e
   SET tenant_id = w.tenant_id
   FROM public.investigation_workspaces w
  WHERE w.id = e.workspace_id;

-- (3) SET NOT NULL — fail-closed at the schema layer.
ALTER TABLE public.cop_timeline_events ALTER COLUMN tenant_id SET NOT NULL;

-- (4) Provenance Doctrine named CHECK backstop.
DO $ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema='public' AND table_name='cop_timeline_events'
       AND constraint_name='cop_timeline_events_provenance_ck'
  ) THEN
    ALTER TABLE public.cop_timeline_events
      ADD CONSTRAINT cop_timeline_events_provenance_ck
      CHECK (tenant_id IS NOT NULL);
  END IF;
END $ck$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.B — RC1 child-side trigger
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cop_timeline_events_enforce_workspace_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  workspace_tenant_id uuid;
BEGIN
  SELECT w.tenant_id INTO workspace_tenant_id
    FROM public.investigation_workspaces w
   WHERE w.id = NEW.workspace_id;

  -- Defense in depth: workspace tenant should be non-NULL post-C.0. If somehow NULL, fail-closed.
  IF workspace_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'cop_timeline_events workspace_id=% has NULL tenant_id on investigation_workspaces. Fail-closed.',
      NEW.workspace_id
      USING errcode = 'not_null_violation';
  END IF;

  -- Auto-fill when writer omitted tenant_id.
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := workspace_tenant_id;
  -- Reject mismatch (service-role spoof prevention).
  ELSIF NEW.tenant_id != workspace_tenant_id THEN
    RAISE EXCEPTION
      'cop_timeline_events tenant_id=% does not match workspace tenant_id=% for workspace_id=%. Direct tenant_id sets are rejected.',
      NEW.tenant_id, workspace_tenant_id, NEW.workspace_id
      USING errcode = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS cop_timeline_events_enforce_workspace_tenant_trg ON public.cop_timeline_events;
CREATE TRIGGER cop_timeline_events_enforce_workspace_tenant_trg
  BEFORE INSERT OR UPDATE OF tenant_id, workspace_id ON public.cop_timeline_events
  FOR EACH ROW EXECUTE FUNCTION public.cop_timeline_events_enforce_workspace_tenant();

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.C — RLS: service-role manage policy (per CQ2 v2)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.cop_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cop_timeline_events service manage" ON public.cop_timeline_events;
CREATE POLICY "cop_timeline_events service manage"
  ON public.cop_timeline_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.D — RC3 audit infrastructure: alert table, drift RPC, cron wrapper, schedule
-- ─────────────────────────────────────────────────────────────────────────────

-- Audit alerts table (system-internal; super_admin read; service-role manage)
CREATE TABLE IF NOT EXISTS public.decision_layer_audit_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_name      text NOT NULL,
  severity        text NOT NULL DEFAULT 'p1',
  drift_count     integer NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  CONSTRAINT decision_layer_audit_alerts_severity_ck CHECK (severity IN ('p0','p1','p2','p3'))
);

CREATE INDEX IF NOT EXISTS idx_decision_layer_audit_alerts_detected
  ON public.decision_layer_audit_alerts (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_layer_audit_alerts_unacked
  ON public.decision_layer_audit_alerts (severity, detected_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE public.decision_layer_audit_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decision_layer_audit_alerts operator read"
  ON public.decision_layer_audit_alerts;
CREATE POLICY "decision_layer_audit_alerts operator read"
  ON public.decision_layer_audit_alerts FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "decision_layer_audit_alerts service manage"
  ON public.decision_layer_audit_alerts;
CREATE POLICY "decision_layer_audit_alerts service manage"
  ON public.decision_layer_audit_alerts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Drift detection RPC — returns rows where stored tenant_id != canonical workspace tenant.
CREATE OR REPLACE FUNCTION public.audit_cop_timeline_events_tenant_drift()
RETURNS TABLE (
  cop_timeline_event_id uuid,
  stored_tenant_id      uuid,
  expected_tenant_id    uuid,
  workspace_id          uuid,
  detected_at           timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $rpc$
  SELECT e.id, e.tenant_id, w.tenant_id, e.workspace_id, now()
    FROM public.cop_timeline_events e
    JOIN public.investigation_workspaces w ON w.id = e.workspace_id
   WHERE e.tenant_id != w.tenant_id;
$rpc$;

GRANT EXECUTE ON FUNCTION public.audit_cop_timeline_events_tenant_drift()
  TO authenticated, service_role;

-- Cron-callable wrapper: runs the audit and inserts a P1 alert if drift > 0.
CREATE OR REPLACE FUNCTION public.run_audit_cop_timeline_events_tenant_drift()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $wrap$
DECLARE
  drift_count integer;
  drift_rows  jsonb;
BEGIN
  SELECT count(*), coalesce(jsonb_agg(to_jsonb(d.*)), '[]'::jsonb)
    INTO drift_count, drift_rows
    FROM public.audit_cop_timeline_events_tenant_drift() d;

  IF drift_count > 0 THEN
    INSERT INTO public.decision_layer_audit_alerts (audit_name, severity, drift_count, details)
    VALUES (
      'audit_cop_timeline_events_tenant_drift',
      'p1',
      drift_count,
      jsonb_build_object('rows', drift_rows)
    );
  END IF;
END
$wrap$;

GRANT EXECUTE ON FUNCTION public.run_audit_cop_timeline_events_tenant_drift()
  TO service_role;

-- Schedule the nightly cron (idempotent via unschedule-first).
DO $sched$
BEGIN
  PERFORM cron.unschedule('audit-cop-timeline-tenant-drift-nightly');
EXCEPTION WHEN OTHERS THEN
  -- ignore "job not found"
  NULL;
END $sched$;

SELECT cron.schedule(
  'audit-cop-timeline-tenant-drift-nightly',
  '0 3 * * *',  -- 03:00 UTC daily
  $cron$SELECT public.run_audit_cop_timeline_events_tenant_drift()$cron$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- C.1.E — Documentation comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.cop_timeline_events.tenant_id IS
  'Enforced-denorm tenant scope from canonical investigation_workspaces.tenant_id. '
  'NOT NULL. Trigger cop_timeline_events_enforce_workspace_tenant_trg auto-fills '
  'on NULL writer-set, raises on explicit mismatch. Service-role cannot spoof. '
  'See decision-layer-option-c-G2-architecture-2026-05-30.md.';

COMMENT ON FUNCTION public.audit_cop_timeline_events_tenant_drift() IS
  'RC3 drift-detection RPC. Returns rows where stored tenant_id differs from '
  'canonical workspace tenant. Should return 0 in steady state. Non-zero is a '
  'P1 system alert (cross-tenant contamination class).';

COMMENT ON TABLE public.decision_layer_audit_alerts IS
  'System-internal audit alert store for Decision Layer drift detection. '
  'Not tenant-scoped (audits are platform-internal, not principal-bound). '
  'Operator-forensic read only.';
```

### Safety properties of the migration

| Statement | Locks taken | Idempotent? | Reversible? |
|---|---|---|---|
| ADD COLUMN IF NOT EXISTS | ACCESS EXCLUSIVE briefly | Yes | DROP COLUMN |
| UPDATE backfill | row locks (none, 0 rows) | Yes (WHERE tenant_id IS NULL) | n/a (no data written) |
| SET NOT NULL | ACCESS EXCLUSIVE briefly | Yes (no-op if already set) | ALTER COLUMN DROP NOT NULL |
| ADD CONSTRAINT | ACCESS EXCLUSIVE briefly | Yes (wrapped in IF NOT EXISTS) | DROP CONSTRAINT |
| CREATE OR REPLACE FUNCTION | None | Yes (OR REPLACE) | DROP FUNCTION |
| DROP + CREATE TRIGGER | ACCESS EXCLUSIVE briefly | Yes (DROP IF EXISTS first) | DROP TRIGGER |
| ENABLE RLS | ACCESS EXCLUSIVE briefly | Yes (no-op if already enabled) | DISABLE RLS |
| CREATE POLICY (with DROP first) | ACCESS EXCLUSIVE briefly | Yes (DROP IF EXISTS first) | DROP POLICY |
| CREATE TABLE IF NOT EXISTS | None | Yes | DROP TABLE |
| cron.schedule | None | Yes (unschedule-first wrapper) | cron.unschedule |

---

## §2 — Rollback plan

Single-statement set, executable as one transaction. Restores prod to its pre-C.1 state. Zero data loss because both `cop_timeline_events` and `decision_layer_audit_alerts` are 0-row at C.1 deploy time (decision_layer_audit_alerts may have post-C.1 rows; rollback discards them).

```sql
BEGIN;

-- Cron + audit infrastructure
DO $$ BEGIN
  PERFORM cron.unschedule('audit-cop-timeline-tenant-drift-nightly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.run_audit_cop_timeline_events_tenant_drift();
DROP FUNCTION IF EXISTS public.audit_cop_timeline_events_tenant_drift();
DROP TABLE IF EXISTS public.decision_layer_audit_alerts;

-- RLS policy
DROP POLICY IF EXISTS "cop_timeline_events service manage"
  ON public.cop_timeline_events;
-- Note: do NOT ALTER TABLE DISABLE ROW LEVEL SECURITY — RLS was already enabled
-- pre-C.1 (table had RLS on with 0 policies in prod).

-- Trigger
DROP TRIGGER IF EXISTS cop_timeline_events_enforce_workspace_tenant_trg
  ON public.cop_timeline_events;
DROP FUNCTION IF EXISTS public.cop_timeline_events_enforce_workspace_tenant();

-- Provenance CHECK
ALTER TABLE public.cop_timeline_events
  DROP CONSTRAINT IF EXISTS cop_timeline_events_provenance_ck;

-- tenant_id column
ALTER TABLE public.cop_timeline_events DROP COLUMN IF EXISTS tenant_id;

COMMIT;
```

**Rollback validation:** after rollback, the table should match its post-C.0 state exactly. Pre-C.1 state was:
- `cop_timeline_events`: 13 columns, no tenant_id, RLS enabled with 0 policies, no triggers from C.1
- `decision_layer_audit_alerts`: did not exist
- Functions: did not exist
- Cron job: did not exist

Rollback restores all of the above.

---

## §3 — Verification plan

### §3.1 Pre-flight (must pass before staging apply)

| Check | Expected |
|---|---|
| `pg_cron` extension available | 1 (present) |
| `cop_timeline_events` row count | 0 |
| `cop_timeline_events.tenant_id` column absent | 0 |
| `decision_layer_audit_alerts` table absent | 0 |
| `audit_cop_timeline_events_tenant_drift()` absent | 0 |
| `run_audit_cop_timeline_events_tenant_drift()` absent | 0 |
| `investigation_workspaces.tenant_id` NOT NULL (post-C.0) | NO (NOT NULL) |
| `investigation_workspaces_enforce_tenant_chain_trg` present (C.0) | 1 |

### §3.2 Post-apply schema verification (staging + prod parity)

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='cop_timeline_events') AS col_count,                 -- expect 14 (was 13, +tenant_id)
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='cop_timeline_events' AND column_name='tenant_id') AS tenant_id_nullability,  -- expect NO
  (SELECT count(*) FROM information_schema.table_constraints
     WHERE table_schema='public' AND table_name='cop_timeline_events'
       AND constraint_name='cop_timeline_events_provenance_ck') AS provenance_ck_present,           -- expect 1
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='cop_timeline_events_enforce_workspace_tenant') AS trigger_fn_present,  -- expect 1
  (SELECT count(*) FROM pg_trigger
     WHERE tgname='cop_timeline_events_enforce_workspace_tenant_trg') AS trigger_present,           -- expect 1
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND tablename='cop_timeline_events') AS rls_policy_count,            -- expect 1 (service manage)
  (SELECT relrowsecurity FROM pg_class
     WHERE relname='cop_timeline_events' AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')) AS rls_enabled,  -- expect true
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name='decision_layer_audit_alerts') AS audit_alerts_table_present,  -- expect 1
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='audit_cop_timeline_events_tenant_drift') AS audit_rpc_present,    -- expect 1
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='run_audit_cop_timeline_events_tenant_drift') AS audit_wrapper_present,  -- expect 1
  (SELECT count(*) FROM cron.job WHERE jobname='audit-cop-timeline-tenant-drift-nightly') AS cron_scheduled,  -- expect 1
  (SELECT count(*) FROM public.cop_timeline_events) AS row_count,                                   -- expect 0
  (SELECT count(*) FROM public.decision_layer_audit_alerts) AS audit_alerts_row_count;              -- expect 0
```

### §3.3 Functional tests (8 cases — mirror C.0 rigor, scoped to C.1)

| # | Test | Setup | Action | Expected |
|---|---|---|---|---|
| 1 | NULL tenant_id auto-fill | Workspace W (tenant_a) created via C.0 chain | INSERT cop_timeline_events with workspace_id=W, tenant_id=NULL | tenant_id auto-filled to tenant_a |
| 2 | Explicit matching tenant_id | Same W | INSERT with workspace_id=W, tenant_id=tenant_a | Row inserts; tenant_id = tenant_a |
| 3 | Explicit mismatch → RAISE | Same W; tenant_b exists separately | INSERT with workspace_id=W, tenant_id=tenant_b | RAISE caught |
| 4 | UPDATE tenant_id to mismatch → RAISE | Inserted row R from test 1 | UPDATE R SET tenant_id = tenant_b | RAISE caught (trigger fires on UPDATE OF tenant_id) |
| 5 | UPDATE workspace_id to a workspace with different tenant → RAISE | Inserted row R; second workspace W2 (tenant_b) | UPDATE R SET workspace_id = W2 (tenant_id stays at tenant_a, now mismatches W2's tenant_b) | RAISE caught |
| 6 | Drift RPC returns 0 in clean state | After tests 1, 2 cleanup | `SELECT count(*) FROM audit_cop_timeline_events_tenant_drift()` | 0 |
| 7 | Drift RPC returns drifted row after admin bypass | Insert row R via auto-fill. Disable trigger. UPDATE R SET tenant_id = wrong tenant. Re-enable. | Run audit RPC | Returns 1 row matching R |
| 8 | Cron wrapper inserts P1 alert on drift | Drift state from test 7 | `SELECT public.run_audit_cop_timeline_events_tenant_drift();` then `SELECT count(*) FROM decision_layer_audit_alerts` | 1 alert row with severity='p1', drift_count=1, details.rows non-empty |

All test rows + alert rows cleaned up at end. Residue check confirms zero leftover across cop_timeline_events, investigation_workspaces, decision_layer_audit_alerts, plus all fixture tables.

### §3.4 Staging-first protocol (same as C.0)

1. Apply migration to staging via `apply_migration`
2. §3.2 schema verification on staging
3. §3.3 functional tests on staging (all 8 pass)
4. Residue check (0 rows in all surfaces)
5. Apply same migration to prod
6. §3.2 schema verification on prod (parity-exact match with staging)
7. §3.3 functional tests on prod (all 8 pass)
8. Residue check on prod
9. Commit migration file to repo, push, open PR

---

## §4 — Expected row counts

| Surface | Before C.1 (current prod) | After C.1 apply | After 7-day window (with §8 deferred — no Phase 2 yet) |
|---|---|---|---|
| `cop_timeline_events` | 0 | 0 | 0 (no writers active until C.2) |
| `decision_layer_audit_alerts` | n/a (table doesn't exist) | 0 | 0 (no drift in steady state; cron runs nightly returning 0) |
| `investigation_workspaces` | 0 (post-C.0, unchanged by C.1) | 0 | 0 |

C.1 alone produces **zero new rows** in any surface in steady state. Writers don't activate until C.2 (canonical helper + `COPCanvas.tsx` retrofit). The Briefing Room UI remains dormant (no end-user RLS policies).

---

## §5 — Expected drift-audit outputs

### Steady state (clean prod)

```sql
SELECT count(*) FROM public.audit_cop_timeline_events_tenant_drift();
-- Expected: 0
```

```sql
SELECT * FROM public.audit_cop_timeline_events_tenant_drift();
-- Expected: empty result set
```

### Cron-driven nightly behavior

The cron fires at 03:00 UTC daily. Inside `run_audit_cop_timeline_events_tenant_drift()`:

- `count(*) = 0` → no alert inserted into `decision_layer_audit_alerts`
- `count(*) > 0` → P1 alert row inserted with:
  - `audit_name = 'audit_cop_timeline_events_tenant_drift'`
  - `severity = 'p1'`
  - `drift_count` = number of drifted rows
  - `details = {"rows": [<jsonb array of drifted rows>]}`
  - `detected_at = now()`
  - `acknowledged_at = NULL`

### What "drift" means

Drift = a `cop_timeline_events` row whose stored `tenant_id` no longer matches its workspace's canonical `tenant_id`.

In the trigger-protected steady state, drift is **impossible to produce via normal writes** because:
- INSERT trigger auto-fills or rejects
- UPDATE OF tenant_id trigger rejects mismatch
- UPDATE OF workspace_id trigger re-validates

Drift becomes possible only via:
1. **Admin trigger DISABLE** (privileged ALTER TABLE) — direct workspace UPDATE
2. **Workspace re-pointed to different tenant** — but the C.0 trigger on `investigation_workspaces` rejects this if it disagrees with stored `tenant_id`. Cannot happen via normal path.
3. **Direct catalog manipulation** — pg_class-level edits; effectively a database compromise.

All three are observable in the audit log. The audit RPC catches all three.

### Expected alert volume

- Under normal operation: **0 alerts per night.**
- Under any of the three drift-producing scenarios: **1 alert per night** until the underlying drift is resolved.
- Cron runs once per night — alerts don't multiply. If drift persists, a single new alert row is inserted each night (allowing tracking of when drift began vs. persisted).

---

## §6 — Expected trigger behavior

### `cop_timeline_events_enforce_workspace_tenant_trg`

Fires `BEFORE INSERT OR UPDATE OF tenant_id, workspace_id` on `cop_timeline_events`. For every fired event:

| Input state | Trigger behavior | Outcome |
|---|---|---|
| INSERT, NEW.tenant_id IS NULL, NEW.workspace_id exists & has tenant_id=W | Look up workspace tenant; set NEW.tenant_id := W | Row inserts with W |
| INSERT, NEW.tenant_id = W (matches workspace) | Look up; verify NEW.tenant_id = W | Row inserts with W |
| INSERT, NEW.tenant_id = X (mismatches workspace tenant W) | Look up; raise EXCEPTION | INSERT rejected |
| INSERT, NEW.workspace_id points to non-existent workspace | FK enforcement (pre-existing) — fails before trigger fires | INSERT rejected |
| INSERT, NEW.workspace_id IS NULL | Pre-existing NOT NULL on workspace_id rejects | INSERT rejected |
| INSERT, workspace exists but workspace.tenant_id IS NULL | Should be impossible post-C.0 (canonical column is NOT NULL); raise EXCEPTION as defense in depth | INSERT rejected |
| UPDATE SET tenant_id = X where current tenant_id = W and workspace tenant = W | Fires on UPDATE OF tenant_id; X ≠ W → raise | UPDATE rejected |
| UPDATE SET tenant_id = W (no actual change) | Fires; W = workspace tenant; pass | UPDATE accepted (no-op) |
| UPDATE SET workspace_id = W2 where W2 has tenant_b and current tenant_id = tenant_a | Fires on UPDATE OF workspace_id; re-validates against new workspace; tenant_a ≠ tenant_b → raise | UPDATE rejected |
| UPDATE SET title = '...' (no change to tenant_id or workspace_id) | Trigger does NOT fire (scoped to UPDATE OF tenant_id, workspace_id) | UPDATE accepted |
| UPDATE SET event_type = '...' (no change to tenant_id or workspace_id) | Trigger does NOT fire | UPDATE accepted |

### What the trigger does NOT do

- Does not check drift between stored tenant_id and current canonical workspace tenant on every read or write. (That's what the audit RPC does, asynchronously.)
- Does not fire on cascading DELETE (the FK cascades from `investigation_workspaces`; trigger has no DELETE branch).
- Does not fire on UPDATEs that don't touch tenant_id or workspace_id.

### Security property

**Service-role cannot spoof.** The trigger runs `BEFORE` the row commits, regardless of role. Direct INSERTs from service-role with mismatched tenant_id are rejected with `integrity_constraint_violation`.

---

## §7 — Failure scenarios and detection paths

| Failure scenario | Mechanism | Detection path |
|---|---|---|
| **F-S1: Service-role writer inserts row with wrong tenant_id** | Edge function bug or compromised service-role | **Prevented at write time** by C.1 trigger → INSERT rejected with `integrity_constraint_violation` |
| **F-S2: Service-role writer inserts row with NULL tenant_id and bug supplies wrong workspace_id** | Workspace mismatch in writer logic | Trigger auto-fills from the supplied workspace_id (so the row goes to whichever tenant the workspace is in — which is the workspace_id's tenant, not the writer's intended tenant). **Not caught by C.1 alone.** This is a C.2 concern (canonical helper validates workspace context). Mitigation: CI guard (RC4) ensures all writers go through canonical helper. |
| **F-S3: Admin disables trigger and inserts arbitrary row** | Privileged ALTER TABLE | Trigger-state audit (proposed §B watchlist; out of C.1 scope, but the drift RPC catches the resulting state). Detected within ≤24h via nightly cron. |
| **F-S4: Workspace's tenant changes (post-creation)** | Workspace's `incident_id` or `investigation_id` re-pointed; C.0 trigger raises on mismatch | **Prevented at write time** by C.0 trigger on `investigation_workspaces`. Cannot happen via normal path. If admin bypasses both triggers, drift surfaces in C.1 audit. |
| **F-S5: Aegis retrieval reads workspace-scoped, not tenant-scoped** | Reader filters by workspace_id instead of tenant_id | **NOT caught by C.1.** This is the F7 failure mode from the security review (INC-CTX-CONTAM Class A reincarnated). Mitigation requires reader-side discipline (per [[feedback-tenant-isolation-checklist]]) and is enforced at the read path, not at C.1's write path. R1.1 reads MUST use `WHERE tenant_id = $1` explicitly. |
| **F-S6: cron fails to run** | pg_cron extension misconfiguration; database restart loses scheduled jobs | Detection: query `cron.job_run_details` for the last run timestamp; alert if >36h since last execution. Out of C.1 scope; should be part of broader cron health monitoring. |
| **F-S7: Audit RPC returns wrong drift count** | Bug in `audit_cop_timeline_events_tenant_drift()` SQL | Detection: §3.3 test 7 + test 8 prove the RPC catches admin-bypass drift. If they pass, the RPC is correct for the defined drift model. |
| **F-S8: Alert table writes silently fail** | RLS misconfiguration; service-role doesn't have write access | Detection: §3.3 test 8 proves the service-role write path works. If test 8 fails, deploy blocked. |
| **F-S9: tenant_id ends up NULL despite NOT NULL constraint** | Schema corruption | Detection: continuous monitoring `SELECT count(*) FROM cop_timeline_events WHERE tenant_id IS NULL` should always return 0. Any non-zero is a P0 incident. |
| **F-S10: Migration partial-apply (failure mid-flight)** | Transaction abort during ADD COLUMN, SET NOT NULL, or trigger creation | Postgres atomicity: each `apply_migration` call is one transactional unit. If any statement fails, all roll back. Detection: post-apply schema verification (§3.2) — any mismatch with expected counts indicates partial apply. |
| **F-S11: Cron schedule duplicated (cron.schedule called twice)** | Re-run of migration; missing idempotency | Handled by the `cron.unschedule(...)` wrapper before `cron.schedule(...)`. Post-deploy verification asserts exactly 1 cron job named `audit-cop-timeline-tenant-drift-nightly`. |
| **F-S12: Backup restore reverts cop_timeline_events but not investigation_workspaces** | Operator restoring a single table | Post-restore drift detected by nightly audit. Detection within ≤24h. Mitigation: operator should restore both tables in lockstep; runbook should explicitly call this out. (Out of C.1 scope but flagged.) |

### Detection-path summary

| Failure class | Detection latency |
|---|---|
| Writer bug (F-S1, F-S2) | Immediate (trigger rejects at write time) |
| Workspace re-pointing (F-S4) | Immediate (C.0 trigger rejects) |
| Admin bypass / catalog edit (F-S3) | ≤24h (nightly cron) |
| Schema corruption (F-S9) | Continuous (operator-side monitoring) |
| Cron health (F-S6) | Requires broader infrastructure monitoring (out of C.1 scope) |
| Reader-side discipline (F-S5) | Requires reader-side audit (out of C.1 scope; per the Tenant Isolation checklist) |

**C.1 alone does not close every failure mode in the security review.** It closes F1 (silent COALESCE — already closed by C.0), F3 (service-role spoofing) at the cop_timeline_events surface, F5 (stale denorm) via the audit RPC, and partially F4 (RLS bypass writers — partially because the trigger catches mismatched writes, but the audit catches the rest). F7 (Aegis retrieval reads workspace-scoped) is **NOT** closed by C.1 — that's a reader-side discipline requirement enforced at the future R1.1 retrieval seam, well downstream of C.1.

---

## §8 — Authorization sheet (for sign-off after operator review)

| # | Item | Default | Operator action |
|---|---|---|---|
| §8.1 | C.1.A schema additions (column + NOT NULL + Provenance CHECK) | Per §1 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.2 | C.1.B child trigger (RC1) | Per §1 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.3 | C.1.C service-role manage RLS policy | Per CQ2 v2 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.4 | C.1.D audit infrastructure (alert table + drift RPC + cron) | Per §1 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.5 | Verification plan (§3.1 + §3.2 + §3.3 + §3.4) | All 8 tests required on both envs | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.6 | Rollback plan (§2) | Per §2 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.7 | Failure detection paths (§7) | Acknowledge what C.1 does and does NOT cover | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.8 | Option C is NOT R1.1 authorization (locked, carried from G2 §10) | Locked | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.9 | Re-run commitment inventory study before any detector work (locked, carried from G2 §11) | Locked | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.10 | Held items remain held | Per §9 below | ☐ CONFIRM ☐ OVERRIDE: ______________ |

Operator signal in chat to authorize: *"Authorize C.1"* (or equivalent unambiguous wording) with item-by-item decisions.

---

## §9 — Held (unchanged)

- P5 · P6 · Class B · PR #36 — unchanged
- C.0 (deployed, accepted) — unaffected
- **C.2** (writer plumb + canonical helper) — separately gated; depends on C.1
- **CI gate (RC4)** — lands before C.2; separately gated
- **C.3** (`investigations.next_review_at`) — separately gated
- **C.4** (investigation editor plumb) — separately gated
- G2 of v2-era (deferred) — unchanged
- **R1.1 — locked behind §11 inventory-rerun gate** (Option C completion is a precondition, not authorization)
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated
- R2 / R3 / R4 / R5 / R6 — separately gated
- Decision Layer Doctrine — unchanged
- R1 ADR — unchanged
- I1 / I2 operator-locked invariants — unchanged
- R1 §B watchlist — unchanged
- Options A and F — remain rejected
- Options B / D / E — unchanged; Option B's eventual design scope still view-shaped per CQ6 v2

## Changelog

- **2026-05-30 v1** — initial C.1 authorization package. Pre-flight clean on staging (pg_cron present, 0 rows, no existing objects, investigation_workspaces.tenant_id NOT NULL per C.0). All seven required sections delivered: exact migration plan with statement-level safety annotations, single-statement rollback set, three-tier verification plan (pre-flight + schema + functional + parity), expected zero-row state, drift-audit semantics, trigger behavior table covering 11 input cases, twelve named failure scenarios with detection paths. Sign-off block has 10 items mirroring the G2 authorization sheet pattern. Held items unchanged.
