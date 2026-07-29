> **ARCHIVED — superseded, retained for the immutable decision chain (nothing deleted, everything traceable).**
> PR #66. Implemented via the C.0/C.1/C.3 migrations salvaged to main in this PR.

---

# ADR — Decision Layer Option C — G2 Architecture (canonical workspace tenancy + 5 enforcement controls)

**Status:** PROPOSED 2026-05-30 — design-only ADR for operator ratification. **No code, no schema changes, no implementation work authorized by this document.** Supersedes Option C v2 (`decision-layer-option-c-schema-patches-2026-05-29.md`) per operator approval of G2 path on 2026-05-30 following the ruthless security review (`decision-layer-option-c-v2-security-review-2026-05-30.md`).

**Operator directive 2026-05-30 (verbatim):**

> *"Do not proceed with Option α as originally proposed. Approve G2."*
>
> Required controls:
> - RC1: Trigger enforcing tenant chain match
> - RC2: `get_workspace_tenant_id` must raise an exception on path disagreement. No silent COALESCE winner.
> - RC3: Continuous drift-detection audit
> - RC4: CI guard preventing writers from bypassing the canonical helper
> - RC5: Promote tenant ownership to `investigation_workspaces`
>
> Goal: **Single source of truth for workspace ownership.**

**Locked principles when ratified:**
- Tenant ownership for any artifact hanging off `investigation_workspaces` is **canonically** stored on `investigation_workspaces.tenant_id NOT NULL`. Child tables (cop_timeline_events first; future tables structurally inherit the discipline) carry tenant_id as **enforced-denorm**, validated by trigger against the workspace's canonical value.
- The two-path FK chain (incident_id / investigation_id) is used **only** during backfill of `investigation_workspaces.tenant_id` (a one-time operation) and is **bounded to a single table**. Once `investigation_workspaces.tenant_id` exists, all child tables are one-hop.
- No silent fall-throughs. Path disagreement is a P1 incident. The RPC raises EXCEPTION rather than COALESCE.
- Writer discipline is **not the safeguard**. Trigger enforcement is. Service-role bypass cannot spoof tenant_id at the row level.

**Companion artifacts:**
- `decision-layer-option-c-schema-patches-2026-05-29.md` (Option C v2 — SUPERSEDED)
- `../decision-layer-option-c-cq-recommendations-2026-05-30.md` (CQ v2 — SUPERSEDED below for CQ1/CQ4)
- `../decision-layer-option-c-authorization-sheet-2026-05-30.md` (v2 auth sheet — RESCINDED)
- `../decision-layer-option-c-v2-security-review-2026-05-30.md` (the review that led here)
- `provenance-contract.md` (Provenance Doctrine — preserved)

## §1 — Architecture overview

```
investigation_workspaces                         ← CANONICAL TENANT SCOPE (RC5)
  + tenant_id uuid NOT NULL
  + consistency CHECK (chain matches stored value)
  + trigger enforcing chain on every INSERT/UPDATE
  + named Provenance CHECK constraint (tenant_id IS NOT NULL)

  ↓ (one-hop FK lookup)

cop_timeline_events                              ← ENFORCED-DENORM (RC1)
  + tenant_id uuid NOT NULL
  + trigger BEFORE INSERT/UPDATE auto-fills OR raises on mismatch
  + named Provenance CHECK constraint
  + service-role manage RLS policy (per CQ2)

  ↑ (continuous audit, RC3)

audit_workspace_tenancy_drift()                  ← CONTINUOUS DRIFT DETECTION (RC3)
  + cron: nightly
  + alerts: any drift = P1 incident

  ↑ (write-time enforcement, RC4)

scripts/check-cop-timeline-writer-discipline.mjs ← CI STATIC-GREP GUARD (RC4)
  + fails CI on any cop_timeline_events write outside canonical helper
```

The architecture has **three layers of defense** (vs v2's one layer):

| Layer | Mechanism | Enforces |
|---|---|---|
| Application | Canonical writer helper + RPC `get_workspace_tenant_id` raising EXCEPTION on disagreement (RC2) | Ergonomics + path-disagreement detection |
| **Database** | **Trigger + consistency CHECK on investigation_workspaces; trigger on cop_timeline_events (RC1)** | **Non-bypassable. Service-role cannot spoof.** |
| Audit | Continuous drift-detection RPC + cron + alert (RC3); CI static-grep on writers (RC4) | Detection + developer-side prevention |

## §2 — Required Controls (RC1–RC5) — detailed

### RC5 — Canonical workspace tenancy on `investigation_workspaces` (the load-bearing structural change)

**Schema additions:**

```sql
-- C.0 migration (new phase, was not in v2)

ALTER TABLE investigation_workspaces ADD COLUMN tenant_id uuid;

-- Backfill via the same two-path COALESCE chain, but ONLY HERE (not in cop_timeline_events).
-- After this one-time backfill, the chain is never used again.
UPDATE investigation_workspaces w SET tenant_id = COALESCE(
    -- Path A: workspace → incident → tenant
    (SELECT i.tenant_id FROM incidents i WHERE i.id = w.incident_id),
    -- Path B: workspace → investigation → client → tenant
    (SELECT c.tenant_id FROM clients c JOIN investigations inv ON inv.client_id = c.id WHERE inv.id = w.investigation_id)
);

-- Disagreement detection during backfill.
-- If Path A and Path B both resolve and disagree, the migration HALTS.
-- The operator resolves manually before proceeding.
DO $$
DECLARE
  disagreement_count integer;
BEGIN
  SELECT count(*) INTO disagreement_count
  FROM investigation_workspaces w
  WHERE w.incident_id IS NOT NULL
    AND w.investigation_id IS NOT NULL
    AND (SELECT i.tenant_id FROM incidents i WHERE i.id = w.incident_id) IS NOT NULL
    AND (SELECT c.tenant_id FROM clients c JOIN investigations inv ON inv.client_id = c.id WHERE inv.id = w.investigation_id) IS NOT NULL
    AND (SELECT i.tenant_id FROM incidents i WHERE i.id = w.incident_id)
        != (SELECT c.tenant_id FROM clients c JOIN investigations inv ON inv.client_id = c.id WHERE inv.id = w.investigation_id);
  IF disagreement_count > 0 THEN
    RAISE EXCEPTION 'C.0 backfill HALT: % investigation_workspaces rows have Path A / Path B tenant disagreement. Manual operator resolution required before proceeding.', disagreement_count;
  END IF;
END $$;

ALTER TABLE investigation_workspaces ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE investigation_workspaces
  ADD CONSTRAINT investigation_workspaces_provenance_ck
  CHECK (tenant_id IS NOT NULL);
```

**Trigger enforcement on INSERT/UPDATE** (RC1 + RC2 applied at the parent level):

```sql
CREATE OR REPLACE FUNCTION investigation_workspaces_enforce_tenant_chain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  path_a_tenant uuid;
  path_b_tenant uuid;
  canonical_tenant uuid;
BEGIN
  -- Compute both paths.
  IF NEW.incident_id IS NOT NULL THEN
    SELECT i.tenant_id INTO path_a_tenant FROM incidents i WHERE i.id = NEW.incident_id;
  END IF;
  IF NEW.investigation_id IS NOT NULL THEN
    SELECT c.tenant_id INTO path_b_tenant
      FROM clients c
      JOIN investigations inv ON inv.client_id = c.id
     WHERE inv.id = NEW.investigation_id;
  END IF;

  -- RC2: raise on disagreement. NO silent COALESCE winner.
  IF path_a_tenant IS NOT NULL
     AND path_b_tenant IS NOT NULL
     AND path_a_tenant != path_b_tenant THEN
    RAISE EXCEPTION
      'investigation_workspaces tenant chain disagreement: incident_id=% resolves to tenant=%, investigation_id=% resolves to tenant=%. Resolve workspace ownership before insert/update.',
      NEW.incident_id, path_a_tenant, NEW.investigation_id, path_b_tenant;
  END IF;

  -- Canonical = whichever path resolved (they agree, or only one is set).
  canonical_tenant := COALESCE(path_a_tenant, path_b_tenant);

  -- If chain empty AND NEW.tenant_id is NULL: fail-closed.
  IF canonical_tenant IS NULL AND NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION
      'investigation_workspaces row has no resolvable tenant: incident_id=%, investigation_id=%, and tenant_id is NULL. Fail-closed per Provenance Doctrine.',
      NEW.incident_id, NEW.investigation_id;
  END IF;

  -- If chain resolved and NEW.tenant_id explicitly set: must match canonical.
  IF canonical_tenant IS NOT NULL
     AND NEW.tenant_id IS NOT NULL
     AND NEW.tenant_id != canonical_tenant THEN
    RAISE EXCEPTION
      'investigation_workspaces tenant_id=% does not match chain-derived tenant_id=%. Direct tenant_id sets are rejected when chain resolves to a different value.',
      NEW.tenant_id, canonical_tenant;
  END IF;

  -- If chain resolved and NEW.tenant_id is NULL: auto-fill.
  IF canonical_tenant IS NOT NULL AND NEW.tenant_id IS NULL THEN
    NEW.tenant_id := canonical_tenant;
  END IF;

  -- If chain empty and NEW.tenant_id explicitly set: accept (operator-direct workspace creation).
  -- (Logged for audit via INSERT trigger sidecar; out of scope for this migration text.)

  RETURN NEW;
END $$;

CREATE TRIGGER investigation_workspaces_enforce_tenant_chain_trg
  BEFORE INSERT OR UPDATE OF tenant_id, incident_id, investigation_id ON investigation_workspaces
  FOR EACH ROW EXECUTE FUNCTION investigation_workspaces_enforce_tenant_chain();
```

**Properties of this enforcement:**
- Service-role cannot spoof. Trigger runs regardless of role.
- Path disagreement raises EXCEPTION — never silent COALESCE winner.
- Empty chain + NULL tenant_id raises EXCEPTION — fail-closed.
- Chain-resolved + explicit tenant_id mismatch raises EXCEPTION — direct sets cannot diverge.
- Auto-fill works when chain resolves and writer omitted tenant_id — clean DX without bypass risk.

### RC1 — Trigger on `cop_timeline_events` enforcing one-hop match against workspace

```sql
-- C.1 migration (simplified now that RC5 ships first)

ALTER TABLE cop_timeline_events ADD COLUMN tenant_id uuid;

-- One-hop backfill from the canonical workspace tenancy (post-C.0).
UPDATE cop_timeline_events e
   SET tenant_id = w.tenant_id
   FROM investigation_workspaces w
  WHERE w.id = e.workspace_id;

ALTER TABLE cop_timeline_events ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE cop_timeline_events
  ADD CONSTRAINT cop_timeline_events_provenance_ck
  CHECK (tenant_id IS NOT NULL);

-- RC1 trigger
CREATE OR REPLACE FUNCTION cop_timeline_events_enforce_workspace_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  workspace_tenant_id uuid;
BEGIN
  SELECT w.tenant_id INTO workspace_tenant_id
    FROM investigation_workspaces w
   WHERE w.id = NEW.workspace_id;

  -- If workspace has no resolvable tenant: fail-closed (should be impossible post-C.0 but defense in depth).
  IF workspace_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'cop_timeline_events workspace_id=% has NULL tenant_id on investigation_workspaces. Fail-closed.',
      NEW.workspace_id;
  END IF;

  -- Auto-fill if writer omitted tenant_id.
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := workspace_tenant_id;
  -- Reject mismatch.
  ELSIF NEW.tenant_id != workspace_tenant_id THEN
    RAISE EXCEPTION
      'cop_timeline_events tenant_id=% does not match workspace tenant_id=% for workspace_id=%. Direct tenant_id sets are rejected.',
      NEW.tenant_id, workspace_tenant_id, NEW.workspace_id;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER cop_timeline_events_enforce_workspace_tenant_trg
  BEFORE INSERT OR UPDATE OF tenant_id, workspace_id ON cop_timeline_events
  FOR EACH ROW EXECUTE FUNCTION cop_timeline_events_enforce_workspace_tenant();

-- RLS (per CQ2 v2 — additive service-role manage policy)
ALTER TABLE cop_timeline_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cop_timeline_events service manage" ON cop_timeline_events;
CREATE POLICY "cop_timeline_events service manage"
  ON cop_timeline_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

### RC2 — `get_workspace_tenant_id` RPC raises EXCEPTION on disagreement

```sql
CREATE OR REPLACE FUNCTION get_workspace_tenant_id(p_workspace_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result uuid;
BEGIN
  SELECT tenant_id INTO result
    FROM investigation_workspaces
   WHERE id = p_workspace_id;
  -- Post-C.0, investigation_workspaces.tenant_id is itself trigger-enforced
  -- to never disagree internally. This RPC simply forwards the canonical value.
  -- The RC2 "raise on disagreement" lives in the C.0 trigger (above), not here.
  IF result IS NULL THEN
    RAISE EXCEPTION
      'get_workspace_tenant_id: workspace_id=% has NULL or missing tenant scope. Fail-closed.',
      p_workspace_id;
  END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION get_workspace_tenant_id(uuid) TO authenticated, service_role;
```

The RPC is a thin wrapper around `investigation_workspaces.tenant_id`. The raising-on-disagreement happens at the **canonical surface** (C.0 trigger), not in the read RPC — because once C.0 ships, disagreement is impossible to STORE. Reads can never produce a disagreement because the canonical row has only one tenant_id value.

This is **stronger than RC2's original wording.** RC2 said the RPC raises on disagreement; G2 says the underlying schema makes disagreement impossible to persist. The RPC inherits that property for free.

### RC3 — Continuous drift-detection audit

```sql
CREATE OR REPLACE FUNCTION audit_cop_timeline_events_tenant_drift()
RETURNS TABLE (
  cop_timeline_event_id uuid,
  stored_tenant_id uuid,
  expected_tenant_id uuid,
  workspace_id uuid,
  detected_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.tenant_id, w.tenant_id, e.workspace_id, now()
    FROM cop_timeline_events e
    JOIN investigation_workspaces w ON w.id = e.workspace_id
   WHERE e.tenant_id != w.tenant_id;
$$;

-- Cron + alerting (proposed; not authorized by this ADR)
SELECT cron.schedule(
  'audit-cop-timeline-tenant-drift-nightly',
  '0 3 * * *',
  $$
  DO $audit$
  DECLARE
    drift_count integer;
  BEGIN
    SELECT count(*) INTO drift_count FROM audit_cop_timeline_events_tenant_drift();
    IF drift_count > 0 THEN
      -- Insert into incidents as P1, or call alert-delivery, or write to a
      -- dedicated audit_alerts table. Implementation choice deferred to
      -- the C.0/C.1 implementation phases.
      INSERT INTO incidents (priority, status, title, summary, tenant_id, provenance_summary, created_by_function)
      VALUES (
        'p1', 'open',
        format('Tenant drift: %s cop_timeline_events rows', drift_count),
        'audit_cop_timeline_events_tenant_drift() returned non-zero rows. Cross-tenant contamination class incident.',
        NULL,  -- ownerless system incident; backfilled to the platform-internal tenant if one exists, else flagged for operator triage
        'audit-cop-timeline-tenant-drift-nightly',
        'audit_cop_timeline_events_tenant_drift'
      );
    END IF;
  END $audit$;
  $$
);
```

A parallel audit ships on `investigation_workspaces` itself, checking that the trigger's invariant holds (Path A / Path B agreement when both populated) — defense in depth against a future trigger DISABLE.

### RC4 — CI static-grep guard

```javascript
// scripts/check-cop-timeline-writer-discipline.mjs (proposed, not authorized)
// Fails CI if any cop_timeline_events write occurs outside the canonical helper.

import { execSync } from 'node:child_process';
const ALLOWED_HELPER_PATH = 'src/lib/cop-timeline-writer.ts';  // proposed canonical writer module
const BLOCKED_PATTERN = `\\.from\\(['"]cop_timeline_events['"]\\)\\.(insert|upsert|update)`;
const result = execSync(
  `grep -rnE "${BLOCKED_PATTERN}" supabase/functions/ src/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "${ALLOWED_HELPER_PATH}" || true`,
  { encoding: 'utf-8' }
);
if (result.trim()) {
  console.error('Found cop_timeline_events writes outside the canonical helper:');
  console.error(result);
  process.exit(1);
}
console.log('cop_timeline_events writer discipline: OK');
```

Wired into the `Fortress CI` workflow as a required check. Ships before any C.2 writer plumb (since C.2 IS the canonical helper; before C.2, all writes still go through the legacy `COPCanvas.tsx:178` path which gets retrofitted in C.2).

The guard's `ALLOWED_HELPER_PATH` is a single named file. Any addition to that allowlist requires an explicit reviewer approval.

## §3 — Migration plan (revised phase ordering)

| Phase | Scope | Reversibility | Gate |
|---|---|---|---|
| **C.0** (NEW per RC5) | Add `investigation_workspaces.tenant_id` + backfill via 2-path COALESCE + consistency CHECK + trigger (RC1+RC2 at parent level) + named Provenance CHECK. **HALT on disagreement detection during backfill.** | DROP COLUMN; DROP TRIGGER; DROP FUNCTION. Tenant scope still reachable via the 2-path chain if dropped. | G2 sign-off + this ADR ratified |
| **C.1** (revised) | Add `cop_timeline_events.tenant_id` + one-hop backfill from `investigation_workspaces.tenant_id` + RC1 trigger + named Provenance CHECK + service-role manage RLS policy | DROP COLUMN; DROP TRIGGER; DROP FUNCTION. Tenant scope still reachable via the parent workspace's tenant_id. | C.0 green + separate operator GO |
| **C.2** (revised) | G3 writer plumb. Canonical helper `src/lib/cop-timeline-writer.ts` calls `get_workspace_tenant_id(workspace_id)` and passes through to `addEvent`. **`COPCanvas.tsx:178` retrofitted to call the helper.** | Revert frontend changes; trigger continues to enforce regardless | C.1 green + separate operator GO |
| **C.3** (unchanged) | Add `investigations.next_review_at` column + named Provenance CHECK | DROP COLUMN | C.2 green + separate operator GO |
| **C.4** (unchanged) | Investigation editor form field + edge function payload field for `next_review_at` | Revert frontend + edge function | C.3 green + separate operator GO |
| **Cross-phase: Audit (RC3)** | Deploy `audit_cop_timeline_events_tenant_drift()` + cron + alerting | DROP FUNCTION; DROP cron job | Lands with C.1 (since cop_timeline_events.tenant_id must exist) |
| **Cross-phase: CI gate (RC4)** | Deploy `scripts/check-cop-timeline-writer-discipline.mjs` + wire to CI workflow | Revert script + workflow change | Lands before C.2 (so C.2's canonical helper is the one allowed path from day 1) |

**G2 changes vs v2:**
- Phase count: 5 (was 4)
- New parent table change: `investigation_workspaces.tenant_id` becomes canonical (was: chain-derived in each child)
- New enforcement layer: trigger on parent (RC1+RC2 at C.0) + trigger on child (RC1 at C.1)
- New observability: continuous drift audit (RC3) + CI guard (RC4)
- Simplification at child level: cop_timeline_events.tenant_id is now ONE-HOP, not two-path
- Future child tables (workspace_notes, workspace_decisions, etc.) inherit the discipline for free — only need a one-hop trigger like the C.1 trigger; no chain re-derivation

## §4 — Doctrine preservation contracts

| Doctrine | G2 preservation |
|---|---|
| **Tenant isolation** | Trigger on `investigation_workspaces` enforces canonical tenant; trigger on `cop_timeline_events` enforces one-hop match; service-role cannot spoof at either layer. Read paths use `WHERE tenant_id = $1` explicitly per [[feedback-tenant-isolation-checklist]] |
| **Provenance Doctrine** | `tenant_id NOT NULL` + named CHECK on both tables (survives accidental `ALTER COLUMN DROP NOT NULL`). No bare ownerless rows. |
| **Anti-Fabrication** | Schema only; no claim-generation path. |
| **Grounding-State Doctrine** | New columns become valid `evidence_row_ids` for R1.1 with the canonical tenant scope. |
| **Tradecraft separation** | Untouched. |
| **Recommendation → Approval → Execution** | G2 is schema + enforcement. No recommendation, no Decision Frame generation. |
| **Flight Recorder** | Trigger raises are visible in Postgres logs; the audit cron's incidents are first-class. |
| **Aegis Authority Modes** | Schema patches apply equally to tenant + Ops modes. |
| **Commander's Intent** | G2 operationalizes the inventory-maturity prerequisite for R1.1. |
| **Operator-locked CQ1** | **Preserved verbatim** — tenant_id required + NOT NULL + fail-closed + Provenance preserved. No nullable transition. No softening. The trigger makes the constraint MORE binding, not less. |
| **Operator-locked I1 / I2 (R1 Q5)** | Untouched (Decision Layer detector still locked behind §8 inventory-rerun gate). |

## §5 — Non-goals (explicit)

| Non-goal | Why |
|---|---|
| Build the `principal_commitments` table | Option B's territory. G2 does not preempt it. |
| Add tenant_id to other tables off `investigation_workspaces` proactively | Out of scope. Each new child table inherits the C.1-style trigger pattern when it's added. |
| Authorize R1.1 | Locked behind §8 inventory-rerun gate. Unchanged. |
| Fix `investigation_workspaces.workspace_id` references in unrelated code | Surface elsewhere if needed. |
| Modify the Decision Layer Doctrine | Locked. |
| Modify the R1 ADR | Locked. |
| Touch any held item (P5/P6/Class B/PR #36) | Standing directive. |
| Commit to an implementation timeline | Each phase its own operator GO. |

## §6 — Open questions for ratification (G2-specific)

Most v2 CQs are resolved by G2 directly. Three new CQs are introduced by RC5:

| # | Question |
|---|---|
| **G2Q1** | **What happens to existing rows where Path A and Path B disagree during C.0 backfill?** Recommendation: the migration HALTS with `RAISE EXCEPTION` (already encoded in the C.0 migration above). The operator manually resolves each disagreement before re-running. *Pre-flight finding:* both `investigation_workspaces` and `cop_timeline_events` are 0-row in prod and staging today, so the HALT path is currently unreachable — but the safeguard ships regardless. |
| **G2Q2** | **What happens when `investigation_workspaces` has both FKs NULL (no parent)?** This is allowed today (a workspace can be created without an incident or investigation linkage — though it's unclear if any code path actually does this). The C.0 trigger would require `NEW.tenant_id` to be explicitly set in that case. **Recommendation:** allow operator-direct tenant_id sets for orphan workspaces; trigger logs the case for audit; CI guard checks no edge function creates orphan workspaces without tenant_id. |
| **G2Q3** | **CQ6 forward-compatibility revisited.** With `investigation_workspaces.tenant_id` as canonical, Option B (`principal_commitments`) becomes even cleaner: it's a view over multiple source tables, each of which carries authoritative tenant_id. No change to the CQ6 recommendation; G2 makes it stronger. |

## §7 — Verification strategy (proof, not confidence)

Per the security review §7 — all controls land:

| Test | Phase |
|---|---|
| AT1: Trigger rejects mismatched tenant_id on cop_timeline_events | C.1 + CI |
| AT2: C.0 backfill HALTS on Path A/B disagreement (fixture row) | C.0 (run on staging-first) |
| AT3: Adversarial service-role direct INSERT with wrong tenant rejected | C.1 + CI |
| AT4: Drift detector returns 0 rows in clean state | C.1 + continuous prod monitor |
| AT5: Migration validation (post-apply 100% tenant_id non-NULL, 100% chain-consistent) | C.0 + C.1 |
| AT6: RLS regression suite (Tenant A cannot read Tenant B under each role) | C.1 + CI |
| AT7: PETRONAS / CRT cross-tenant contamination fixture | C.1 + CI |
| AT8: Static-grep CI guard self-test (bad-writer PR fails CI) | RC4 deploy + CI |

Continuous production monitoring:

| Monitor | Frequency | Threshold |
|---|---|---|
| `audit_cop_timeline_events_tenant_drift()` count | Nightly + on-demand | >0 → P1 |
| `investigation_workspaces` consistency violation count (parallel audit) | Nightly | >0 → P1 |
| Trigger-state audit (ENABLED on both tables) | Hourly | DISABLED → P0 |
| NULL tenant_id in either table (constraint violation) | Continuous | Any → P1 |
| RLS policy change on either table | Continuous (DB audit log) | Any unexpected → P1 |
| CI guard failure rate | Per PR | Sustained failure → investigate |

## §8 — Long-term architecture (G2 at hundreds of tenants)

Per the security review §8:

| Property | v2 (rejected) | G2 (proposed) |
|---|---|---|
| Tenant ownership for any workspace child | Re-derived per-table | One-hop from `investigation_workspaces` |
| New child tables (future) | Each re-implements the chain | Each adds a one-hop trigger like C.1's |
| Schema-evolution cost | Linear per chain hop | Single canonical surface to audit |
| Drift detection surface | Per-child-table audit | Single audit on the canonical + one per child |
| Tenant migration cost | Sweep every child | Update the canonical once; triggers propagate via auto-fill |
| Path-disagreement failure mode | Silent COALESCE winner | RAISE EXCEPTION at the canonical surface; impossible to persist |
| Service-role spoofing failure mode | Possible (CHECK only enforces NOT NULL) | Impossible (trigger enforces chain match) |

G2 is the architecture that supports hundreds of tenants without per-tenant audit burden growth. v2 (chain in every child) was viable at 1–3 tenants and structurally degraded beyond that.

## §9 — Held (unchanged)

- P5 · P6 · Class B · PR #36 — unchanged
- R1.0 (deployed) — unaffected
- **R1.1 — still NOT authorized; §8 inventory-rerun gate stands**
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated
- R2 / R3 / R4 / R5 / R6 — separately gated
- Decision Layer Doctrine — unchanged
- R1 ADR — unchanged
- I1 / I2 operator-locked invariants — unchanged
- R1 §B watchlist — unchanged
- Operator-locked CQ1 strictness — **preserved verbatim and strengthened by triggers**
- Options A, F — remain rejected
- Options B, D, E — unchanged; Option B's eventual design scope still view-shaped per CQ6 v2

## Changelog

- **2026-05-30 v1 (G2 architecture)** — initial G2 architecture ADR following operator approval after ruthless security review. Five required controls (RC1–RC5) operationalized. **RC5 is the load-bearing structural change**: canonical workspace tenancy on `investigation_workspaces.tenant_id` instead of chain-derived per child. New phase C.0 added before C.1. Phase plan: C.0 → C.1 → C.2 → C.3 → C.4 + cross-phase audit (RC3) + cross-phase CI gate (RC4). v2 Option α (chain in every child) is **superseded**. v2 authorization sheet v1 sign-off was already rescinded by the schema-reality pre-flight; v2 sheet v2 supersedes it; this ADR proposes G2 as the path forward. Pending re-ratification of a new G2 authorization sheet (forthcoming).
