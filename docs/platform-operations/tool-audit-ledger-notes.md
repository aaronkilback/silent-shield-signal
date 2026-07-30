# Tool-audit ledger notes

Resolutions of AEGIS tool-audit findings.

## Item 2 — `get_active_incidents` counter "mystery" — RESOLVED 2026-07-30

**Finding:** the `get_active_incidents` tool reported a **monotonically growing active-incident
set** that no longer reflected reality — an audit discrepancy with no obvious single cause.

**Root cause (two layers):**
1. Incidents were never aged out → the open set only grew. Closed by
   `incident-lifecycle-sweep` (WO-INCIDENT-QA Step 4: soft-close via `status='closed'` +
   `outcome_type`; hazard event-ended at 7d quiet, stale→expired at 14d+14d).
2. **The missing/inconsistent status filter across consumers** — every consumer implemented its
   own allowlist/denylist over the `incidents` status enum, so a soft-closed incident was
   invisible to some queries and visible to others (the exec brief had **no status filter at
   all**, rendering 10 closed incidents as open P2s for Petronas/7d).

**Resolution:** the **canonical `public.active_incidents` view** + `is_incident_active(text)` fn
+ TS mirrors (`_shared/incident-status.ts`, `src/lib/incident-status.ts`) — one definition of
"active" (not deleted, not superseded, not test, `status NOT IN (resolved, closed)`), every
consumer converged (PR #186). The counter can no longer diverge: terminal set lives in one place;
growing the enum cannot re-break consumers. Verified: Petronas/7d exec brief incident table went
from **10 closed-as-open → 0**. See [[project_canonical_active_incident]].
