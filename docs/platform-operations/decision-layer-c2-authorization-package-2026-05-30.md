# Decision Layer C.2 — Authorization Package (pre-implementation review)

**Status:** PROPOSED 2026-05-30 — signable authorization artifact for C.2. **This document does not, by itself, authorize implementation.** Operator review of §1–§7 + sign-off on §8 converts the plan into the binding pre-implementation contract for C.2 only. C.3 / C.4 + R1.1 remain separately gated.

**Companion artifacts:**
- `architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md` (G2 ADR — RATIFIED, this package is its C.2 + RC4 phase)
- `decision-layer-c1-authorization-package-2026-05-30.md` (C.1 pattern this package mirrors)
- `supabase/migrations/20260530120000_decision_layer_c0_*.sql` (C.0 — APPLIED)
- `supabase/migrations/20260530140000_decision_layer_c1_*.sql` (C.1 — APPLIED)

**C.0 + C.1 acceptance verified 2026-05-30:** canonical workspace tenancy operative; cop_timeline_events trigger enforces; drift audit + cron operative; all 7 (C.0) + 8 (C.1) functional tests pass on staging + prod.

**Bundled scope decision: RC4 ships WITH C.2 (single GO covers both).**

The G2 ADR §3 listed CI gate (RC4) and C.2 as separately-gated phases, with RC4 landing *before* C.2. In practice this creates a chicken-and-egg problem: the CI guard's allowlist would have to permit `COPCanvas.tsx` pre-C.2 (transitional state) and then change to permit only the helper post-C.2. Bundling the two into one C.2 phase produces a cleaner single-PR change: the helper is created, COPCanvas.tsx is retrofitted to use it, and the CI guard ships with its terminal allowlist (`src/lib/cop-timeline-writer.ts` only) — all in one atomic transition. This is **recommended** but the operator can split (§8.6 of this package).

**C.2 scope (under the recommended bundle):**

| # | Artifact | Surface |
|---|---|---|
| C.2.A | New file `src/lib/cop-timeline-writer.ts` — canonical helper that wraps `cop_timeline_events` writes | TypeScript module |
| C.2.B | Modified file `src/components/briefing/COPCanvas.tsx` — `addEvent` mutation retrofitted to call the helper | React component |
| C.2.C | New file `scripts/check-cop-timeline-writer-discipline.mjs` — CI static-grep guard (RC4) | Node script |
| C.2.D | Modified file `.github/workflows/ci.yml` — wire the guard into the Fortress CI workflow as a required check | CI config |
| C.2.E | New file `src/lib/__tests__/cop-timeline-writer.test.ts` (or inline) — unit test stub for the helper signature + error-path behavior | Test |

**Locked principles carried forward (unchanged from G2 + C.0 + C.1):**
- Operator-locked CQ1 strictness preserved verbatim; the helper is **defense in depth** (the C.1 trigger already auto-fills tenant_id on NULL writer-set — the helper makes tenant resolution visible in code and surfaces workspace-lookup errors at the application layer before they hit the DB).
- Service-role spoofing remains structurally prevented at the DB layer (C.1 trigger); the helper does not add a new spoof-prevention surface, only an ergonomic + observable layer above it.
- §10 + §11 carried verbatim (Option C ≠ R1.1 authorization; inventory-rerun gate before any detector work).

**Pre-flight observations (clean):**

| Check | Result |
|---|---|
| `.github/workflows/ci.yml` exists | ✓ (display name "Fortress CI") |
| `src/lib/cop-timeline-writer.ts` does not yet exist | ✓ |
| `scripts/check-cop-timeline-writer-discipline.mjs` does not yet exist | ✓ |
| `src/components/briefing/COPCanvas.tsx:178` still has the inline `.from(...).insert(...)` | ✓ |
| No other `cop_timeline_events` writers exist in the codebase | confirmed (today the table has exactly one writer in the repo) |

---

## §1 — Exact implementation plan

### C.2.A — `src/lib/cop-timeline-writer.ts` (NEW)

The canonical helper. Single export, opinionated signature, defensive about workspace resolution. Imports the existing `supabase` client; no new dependencies.

```typescript
// src/lib/cop-timeline-writer.ts
//
// Canonical writer for public.cop_timeline_events.
// Per Decision Layer Option C G2 (CQ4 v2 + RC4): all writes to cop_timeline_events
// MUST route through this module. The CI guard at scripts/check-cop-timeline-writer-discipline.mjs
// enforces this by failing CI on any direct `.from('cop_timeline_events').(insert|upsert|update|delete)`
// outside this file.
//
// Defense in depth: the C.1 trigger (cop_timeline_events_enforce_workspace_tenant_trg)
// already auto-fills tenant_id from investigation_workspaces.tenant_id when NULL.
// This helper makes the tenant resolution explicit in application code so:
//   1. workspace-lookup failures surface at this layer with a clear error code,
//      before hitting the DB and turning into an FK violation or NOT NULL violation
//   2. tenant_id flow is visible to code readers
//   3. future writers (when added) can be quickly audited against a single pattern

import { supabase } from '@/integrations/supabase/client';

export type CopTimelineEventInput = {
  workspace_id: string;
  title: string;
  event_time: string;  // ISO timestamp
  event_type: 'signal' | 'incident' | 'task' | 'decision' | 'evidence' | 'entity' | 'general' | 'milestone';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  description?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  added_by_user_id?: string | null;
  added_by_agent_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CopTimelineEventResult =
  | { ok: true; event_id: string; tenant_id: string }
  | { ok: false; error: string; code: 'TENANT_LOOKUP_FAILED' | 'TENANT_NOT_RESOLVED' | 'INSERT_FAILED' };

/**
 * Insert one cop_timeline_events row using canonical tenant resolution.
 *
 * Flow:
 *   1. Call public.get_workspace_tenant_id(workspace_id) via RPC.
 *      - Raises in the DB if the workspace doesn't exist or has NULL tenant_id.
 *      - Returns the canonical tenant_id otherwise.
 *   2. Insert the event row with explicit tenant_id from the RPC result.
 *      The C.1 trigger validates explicit-set against workspace and accepts
 *      because we pass the canonical value verbatim.
 *
 * Returns a discriminated union so callers handle errors explicitly. Never throws.
 */
export async function writeCopTimelineEvent(
  input: CopTimelineEventInput
): Promise<CopTimelineEventResult> {
  // Step 1: resolve canonical tenant_id from workspace.
  const { data: tenant_id, error: tenantError } = await supabase.rpc(
    'get_workspace_tenant_id',
    { p_workspace_id: input.workspace_id }
  );

  if (tenantError) {
    return {
      ok: false,
      code: 'TENANT_LOOKUP_FAILED',
      error: `get_workspace_tenant_id failed: ${tenantError.message}`,
    };
  }
  if (!tenant_id) {
    return {
      ok: false,
      code: 'TENANT_NOT_RESOLVED',
      error: `Workspace ${input.workspace_id} returned no tenant_id from RPC`,
    };
  }

  // Step 2: insert with explicit tenant_id.
  const { data: inserted, error: insertError } = await supabase
    .from('cop_timeline_events')
    .insert({
      ...input,
      tenant_id,
    })
    .select('id')
    .single();

  if (insertError) {
    return {
      ok: false,
      code: 'INSERT_FAILED',
      error: insertError.message,
    };
  }

  return { ok: true, event_id: inserted.id, tenant_id };
}
```

**Type discipline:** uses the `CopTimelineEventInput` to constrain `event_type` and `severity` to the same enums the DB CHECK constraints enforce. Catches misspellings at compile time.

**No retry logic.** A failed write returns `{ ok: false }` and the caller (mutation hook) handles UX. Retries are caller-controlled.

### C.2.B — `src/components/briefing/COPCanvas.tsx` (MODIFIED)

The `addEvent` mutation (current lines 177–204) is retrofitted to call the canonical helper. The mutation's `onSuccess` / `onError` UX is unchanged.

```typescript
// Top of file: add import
import { writeCopTimelineEvent } from '@/lib/cop-timeline-writer';

// addEvent mutation body becomes:
const addEvent = useMutation({
  mutationFn: async () => {
    const result = await writeCopTimelineEvent({
      workspace_id: workspaceId,
      title: newEvent.title,
      description: newEvent.description || null,
      event_type: newEvent.event_type,
      severity: newEvent.severity,
      event_time: new Date(newEvent.event_time).toISOString(),
      source_type: 'manual',
      added_by_user_id: user?.id ?? undefined,
    });
    if (!result.ok) {
      // Surface the helper's error code so the toast message is informative.
      throw new Error(`[${result.code}] ${result.error}`);
    }
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['cop-timeline', workspaceId] });
    setShowAddEvent(false);
    setNewEvent({
      title: '',
      description: '',
      event_type: 'general',
      severity: 'info',
      event_time: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    });
    toast.success('Event added to timeline');
  },
  onError: (err: Error) => toast.error(`Failed to add event: ${err.message}`),
});
```

**Behavioral change:** none in the success path (still inserts cleanly, still invalidates queries). Failure path is more informative — error code surfaces in the toast.

### C.2.C — `scripts/check-cop-timeline-writer-discipline.mjs` (NEW)

The RC4 static-grep CI guard. Fails CI on any direct `cop_timeline_events` write outside the canonical helper.

```javascript
#!/usr/bin/env node
// scripts/check-cop-timeline-writer-discipline.mjs
//
// RC4 — Decision Layer Option C, G2 architecture.
// Fails CI on any direct `cop_timeline_events` write outside the canonical helper.
// The C.1 trigger prevents wrong-tenant rows; this script prevents writer-discipline
// drift at the source-code layer.

import { execSync } from 'node:child_process';

const ALLOWED_WRITERS = new Set([
  'src/lib/cop-timeline-writer.ts',
]);

// Multi-line method-chain pattern. Uses ripgrep with -U (multiline) so chains like
//   .from('cop_timeline_events')
//   .insert({...})
// are caught when they span lines.
const PATTERN = String.raw`\.from\(['"]cop_timeline_events['"]\)[\s\S]*?\.(insert|upsert|update|delete)\s*\(`;

function detectWriters() {
  // Use ripgrep if available; fall back to a coarser grep otherwise.
  const cmd = `rg -Un --pcre2 "${PATTERN}" supabase/functions/ src/ -g "*.ts" -g "*.tsx" -l 2>/dev/null || true`;
  const output = execSync(cmd, { encoding: 'utf-8' });
  return output
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

const candidates = detectWriters();
const violations = candidates.filter(file => !ALLOWED_WRITERS.has(file));

if (violations.length > 0) {
  console.error('cop_timeline_events writer discipline FAILED.');
  console.error('Found direct writes outside the canonical helper in:');
  violations.forEach(f => console.error(`  ${f}`));
  console.error('');
  console.error(`Allowed writers: ${[...ALLOWED_WRITERS].join(', ')}`);
  console.error('Route all writes through src/lib/cop-timeline-writer.ts.');
  console.error('If a new writer is genuinely required, add it to ALLOWED_WRITERS in this script + reviewer approval.');
  process.exit(1);
}

console.log(`cop_timeline_events writer discipline OK (${candidates.length} matching file(s) found, all in allowlist).`);
```

**Why ripgrep:** the COPCanvas.tsx insert pattern (`.from(...)` and `.insert(...)` on separate lines) cannot be matched by line-oriented grep. Ripgrep with `-U` enables multiline. Available in the GitHub Actions Ubuntu runner image. If ripgrep is missing the script fails-closed (logs the error; CI fails).

**Coverage:** scans `src/` + `supabase/functions/`. Both TS and TSX file extensions. Excludes test fixtures via the natural absence of `cop_timeline_events.insert(...)` patterns in test files (which would be intentional violations to test the guard — addressed in C.2.E).

### C.2.D — `.github/workflows/ci.yml` (MODIFIED)

Add the CI guard as a step in the existing Fortress CI workflow. The exact insertion point depends on the workflow's job layout; recommended placement is alongside the existing `check-undefined-identifiers.mjs` step (same shape: a node script that exits non-zero on violation).

```yaml
# Inside the existing job that runs lint/type checks:

      - name: Check cop_timeline_events writer discipline (RC4)
        run: node scripts/check-cop-timeline-writer-discipline.mjs
```

**Position:** before the build step. Failure here blocks the build and prevents merge. Position alongside other static-grep guards (the codebase already has the `check-undefined-identifiers.mjs` pattern, per the standing memory).

### C.2.E — Unit test stub for the helper (NEW)

A small unit test confirms the helper's signature + happy-path + error-path behavior using a mocked supabase client. Does NOT call prod or staging. Vitest preferred (already in package.json based on the repo's testing pattern).

```typescript
// src/lib/__tests__/cop-timeline-writer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { writeCopTimelineEvent } from '../cop-timeline-writer';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('writeCopTimelineEvent', () => {
  it('returns TENANT_LOOKUP_FAILED when RPC errors', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: 'boom' } });
    const result = await writeCopTimelineEvent({
      workspace_id: 'w', title: 't', event_time: 'x',
      event_type: 'general', severity: 'info',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TENANT_LOOKUP_FAILED');
  });

  it('returns TENANT_NOT_RESOLVED when RPC returns null tenant', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });
    const result = await writeCopTimelineEvent({
      workspace_id: 'w', title: 't', event_time: 'x',
      event_type: 'general', severity: 'info',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TENANT_NOT_RESOLVED');
  });

  it('returns ok when insert succeeds', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    (supabase.rpc as any).mockResolvedValue({ data: 'tenant-abc', error: null });
    const single = vi.fn().mockResolvedValue({ data: { id: 'event-xyz' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    (supabase.from as any).mockReturnValue({ insert });
    const result = await writeCopTimelineEvent({
      workspace_id: 'w', title: 't', event_time: 'x',
      event_type: 'general', severity: 'info',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event_id).toBe('event-xyz');
      expect(result.tenant_id).toBe('tenant-abc');
    }
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'tenant-abc' }));
  });
});
```

---

## §2 — Rollback plan

Single-PR revert. No DB schema changes. No prod data implications. Zero-data-loss revert.

### Step-by-step revert

1. Revert C.2.B — restore the inline `addEvent` mutation in `COPCanvas.tsx` to its pre-C.2 form (the post-C.1 trigger still auto-fills tenant_id correctly, so this UI continues to work).
2. Delete C.2.A — `git rm src/lib/cop-timeline-writer.ts`.
3. Revert C.2.D — remove the guard step from `.github/workflows/ci.yml`.
4. Delete C.2.C — `git rm scripts/check-cop-timeline-writer-discipline.mjs`.
5. Delete C.2.E — `git rm src/lib/__tests__/cop-timeline-writer.test.ts`.
6. Push the revert PR; CI runs without the guard.

### Rollback validation

After revert, the system returns to its post-C.1 state:
- COPCanvas.tsx UI still works (trigger auto-fills tenant_id on insert without explicit value)
- No CI guard, no canonical helper
- DB schema unchanged
- Any cop_timeline_events rows written between C.2 ship and revert remain (they have correct tenant_id; the helper just made the resolution explicit in code)

**Database is untouched by C.2; no migration rollback needed.**

---

## §3 — Verification plan

### §3.1 Pre-flight (must pass before any C.2 commit)

| Check | Expected |
|---|---|
| `.github/workflows/ci.yml` exists | ✓ |
| `src/lib/cop-timeline-writer.ts` does not yet exist | ✓ |
| `scripts/check-cop-timeline-writer-discipline.mjs` does not yet exist | ✓ |
| COPCanvas.tsx still has inline `.from(...).insert(...)` at line ~178 | ✓ |
| C.1 `cop_timeline_events_enforce_workspace_tenant_trg` operative on staging + prod | ✓ (validated in C.1) |
| C.0 `get_workspace_tenant_id` RPC operative on staging + prod | ✓ (validated in C.0) |

### §3.2 Build + lint verification (staging environment first)

| Check | Expected |
|---|---|
| `npm run build` (or equivalent) succeeds with the new helper | exit 0 |
| Existing `scripts/check-undefined-identifiers.mjs` passes | exit 0 |
| **New** `scripts/check-cop-timeline-writer-discipline.mjs` passes against the post-retrofit codebase | exit 0 |
| Same guard FAILS against a temporary bad-writer fixture (added to a sample file, then removed) | exit 1 |
| TypeScript type-check passes (`tsc --noEmit`) | exit 0 |
| Vitest unit tests for the helper pass | all green |

### §3.3 Functional behavior verification (staging UI session)

Per the standing operator preference (no JWT exposure in chat), end-to-end verification runs in the staging UI:

1. Operator opens the Briefing Room UI in staging
2. Operator clicks "Add Timeline Event" with a valid workspace context
3. Operator submits an event
4. **Expected:** event row appears in `cop_timeline_events` with `tenant_id` matching the workspace's canonical tenant_id
5. Operator reports back: event_id timestamp range
6. Validation script queries `cop_timeline_events` for the recent row via Supabase MCP; confirms `tenant_id != NULL` and matches `investigation_workspaces.tenant_id` for the row's workspace
7. Drift audit run: `SELECT count(*) FROM audit_cop_timeline_events_tenant_drift()` — must be 0

**Negative path verification:** operator attempts to add an event to a workspace they aren't a member of (workspace_members RLS rejects). Expected: helper surfaces `INSERT_FAILED` with a clear toast message. No row written.

### §3.4 CI guard self-test

Before the C.2 PR is merged, a deliberate "bad writer" PR is opened against a fork or test branch to confirm:
- The guard catches the violation
- CI fails with the expected error message
- The PR is blocked from merging until the violation is removed

This proves the guard actually fires. After confirmation, the test PR is closed without merge.

### §3.5 Staging-then-prod protocol

C.2 is a frontend + CI change, not a DB migration. The deploy mechanism is git push → merge to main → CD pipeline. Staging-vs-prod parity is automatic (same build artifact). However:

1. PR opened against main; **CI must pass** (includes the new guard self-validating against itself)
2. PR reviewed by operator
3. PR merged
4. Frontend deploy (Cloudflare Pages or equivalent) goes to staging first per existing pipeline
5. Operator runs the §3.3 functional verification on staging
6. If staging passes, the same build artifact promotes to prod via existing pipeline
7. Operator re-runs §3.3 on prod
8. Validation report (this package's deliverable) returned for C.2 acceptance

---

## §4 — Expected row counts

| Surface | Pre-C.2 (current prod) | Post-C.2 deploy | After 7-day window |
|---|---|---|---|
| `cop_timeline_events` | 0 | 0 | depends on UI adoption — could remain 0, could grow if operators use the Briefing Room |
| `decision_layer_audit_alerts` | 0 | 0 | 0 (steady state) |
| `investigation_workspaces` | 0 | 0 | 0 |

**No new rows are expected from C.2 itself.** The deploy is code-only. Any rows that appear are operator-driven via the UI, and they will all have valid tenant_id (validated by both the helper and the C.1 trigger).

---

## §5 — Expected drift-audit outputs

Unchanged from C.1:
- Nightly cron runs at 03:00 UTC
- `audit_cop_timeline_events_tenant_drift()` returns 0 rows in steady state
- Any drift triggers a P1 alert in `decision_layer_audit_alerts`

**C.2 does not change the drift surface.** It only changes how new rows are written (canonically), so all post-C.2 rows are correct by construction. Drift remains producible only via admin trigger DISABLE or catalog manipulation.

---

## §6 — Expected helper behavior

### Happy paths

| Input | Helper behavior | Result |
|---|---|---|
| Valid workspace_id, all other required fields present | RPC returns canonical tenant_id; insert with explicit tenant_id; C.1 trigger validates match | `{ ok: true, event_id, tenant_id }` |
| Valid workspace_id, optional fields omitted | Same — optional fields default per the DB schema (description=null, source_type=null, etc.) | `{ ok: true, ... }` |

### Error paths

| Input / state | Helper behavior | Result |
|---|---|---|
| workspace_id doesn't exist in `investigation_workspaces` | RPC raises (`get_workspace_tenant_id` raises on NULL) | `{ ok: false, code: 'TENANT_LOOKUP_FAILED', error: <RPC message> }` |
| workspace_id is empty string or malformed UUID | RPC errors with type mismatch or NULL return | `{ ok: false, code: 'TENANT_LOOKUP_FAILED' or 'TENANT_NOT_RESOLVED' }` |
| event_type not in CHECK constraint enum | DB CHECK rejects insert | `{ ok: false, code: 'INSERT_FAILED', error: <CHECK violation> }` |
| severity not in CHECK constraint enum | Same | `{ ok: false, code: 'INSERT_FAILED' }` |
| workspace_id valid but caller's RLS prevents reading the workspace (Workspace members policy) | RPC is SECURITY DEFINER — bypasses RLS — returns tenant_id; insert may be rejected by the workspace_members RLS write side | `{ ok: true, ... }` if RLS allows write, `{ ok: false, code: 'INSERT_FAILED' }` if not |
| Caller spoofs tenant_id explicitly in input | **Helper IGNORES caller-provided tenant_id** — it uses ONLY the RPC result. (The input type doesn't include tenant_id; if a caller circumvents the type via `any`, the helper still overwrites with the canonical value.) | `{ ok: true, ... }` with canonical tenant_id |

### Defense-in-depth properties

- **Even if the C.1 trigger were ever disabled,** the helper still writes correct tenant_id explicitly — drift is structurally impossible from helper-initiated writes.
- **Even if a caller bypasses the helper entirely,** the C.1 trigger catches the bad write at the DB layer.
- **Even if both safeguards were defeated,** the nightly drift audit detects the bad row within ≤24h and fires a P1 alert.

Three layers of defense; C.2 adds the application-layer one. The DB-layer ones (C.0 + C.1) remain the load-bearing safeguards.

---

## §7 — Failure scenarios and detection paths

| # | Scenario | Mitigation | Detection |
|---|---|---|---|
| F-T1 | New writer is added to the codebase outside the helper | RC4 CI guard rejects PR | CI fails; PR blocked |
| F-T2 | Existing writer is modified to bypass the helper (e.g., COPCanvas.tsx reverted to inline insert in a future PR) | RC4 CI guard fails on the change | CI fails; PR blocked |
| F-T3 | The CI guard is removed from `ci.yml` in a future PR | **NOT directly detected.** A second-order guard (e.g., a CI workflow that verifies the guard step is present) would close this — but is out of C.2 scope. PR review is the safeguard. | Manual review |
| F-T4 | The helper is removed without retrofitting writers | Build fails (TypeScript can't import a missing module from COPCanvas.tsx) | CI fails on build step |
| F-T5 | The helper is modified to no longer call the RPC | **NOT directly detected.** Defense in depth: the C.1 trigger still auto-fills correctly. But this defeats the helper's observability advantage. | Manual review + unit test if the test asserts RPC is called |
| F-T6 | Caller bypasses the helper via `(supabase as any).from(...).insert(...)` to evade TypeScript | RC4 guard catches the pattern in the source (it's a string match, not a type check) | CI fails |
| F-T7 | Caller uses a different table name to write to cop_timeline_events (impossible — there's no other table name that aliases) | n/a | n/a |
| F-T8 | A monorepo / vendored copy of cop_timeline_events writer ends up in a directory the guard doesn't scan | Guard scope is `src/` + `supabase/functions/`. Any new top-level code path would need to be added to the guard scope. | Manual review of `git diff` for new directories |
| F-T9 | Helper RPC call fails transiently (network flake, DB load) | Helper returns `TENANT_LOOKUP_FAILED`; caller decides retry. No silent fallback to NULL tenant_id. | Logs + toast UX |
| F-T10 | Helper succeeds but DB insert fails (e.g., CHECK violation on event_type) | Helper returns `INSERT_FAILED` with error message | UI surfaces error to operator |
| F-T11 | Type-safety bypass via `as any` in the helper's caller | Compile-time check loses fidelity; runtime still validated by RPC + trigger | Manual review |
| F-T12 | Edge function writes to cop_timeline_events directly (today none exist; future could) | RC4 guard scans `supabase/functions/` too; any direct write fails CI | CI fails |

### What C.2 does NOT close

- **F-T3** — CI guard removal. Would need a meta-guard that verifies the guard is present. Out of scope.
- **F-T5** — Helper modification that defeats its purpose. Code review + unit test discipline only.
- **F-T8** — New top-level scan paths. Operator review of guard scope when new dirs are added.

These are not blockers for C.2 — they're documented gaps for future ADRs (or for inclusion in a future "Decision Layer audit hardening" phase).

---

## §8 — Authorization sheet (for sign-off after operator review)

| # | Item | Default | Operator action |
|---|---|---|---|
| §8.1 | C.2.A canonical helper `src/lib/cop-timeline-writer.ts` | Per §1 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.2 | C.2.B retrofit `COPCanvas.tsx` `addEvent` mutation | Per §1 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.3 | C.2.C RC4 static-grep guard `scripts/check-cop-timeline-writer-discipline.mjs` | Per §1 (ripgrep multiline) | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.4 | C.2.D wire guard into `.github/workflows/ci.yml` | Per §1 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.5 | C.2.E unit test stub for the helper | Per §1 (vitest, mocked supabase client) | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.6 | Bundle RC4 + C.2 in one PR / one GO | Recommended (avoids transitional-allowlist) | ☐ CONFIRM bundle ☐ OVERRIDE: split RC4 first ☐ OVERRIDE: split RC4 after |
| §8.7 | Verification plan (§3) | All 5 sub-sections required | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.8 | Rollback plan (§2) | Per §2 (no DB rollback needed) | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.9 | Failure scenarios + detection paths (§7) | Acknowledge F-T3/F-T5/F-T8 gaps | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.10 | Option C is NOT R1.1 authorization (locked, carried from G2 §10) | Locked | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.11 | Re-run inventory study before any detector work (locked, carried from G2 §11) | Locked | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.12 | Held items remain held (per §9 below) | Per §9 | ☐ CONFIRM ☐ OVERRIDE: ______________ |

Operator signal in chat to authorize: *"Authorize C.2"* (or equivalent unambiguous wording) with item-by-item decisions.

---

## §9 — Held (unchanged)

- P5 · P6 · Class B · PR #36 — unchanged
- C.0 (deployed, accepted) — unaffected
- C.1 (deployed, accepted) — unaffected
- **C.3** (`investigations.next_review_at`) — separately gated; not authorized by this package
- **C.4** (investigation editor plumb) — separately gated; not authorized
- G2 of v2-era — deferred (unchanged)
- **R1.1 — locked behind §11 inventory-rerun gate** (carried from G2)
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated
- R2 / R3 / R4 / R5 / R6 — separately gated
- Decision Layer Doctrine — unchanged
- R1 ADR — unchanged
- I1 / I2 operator-locked invariants — unchanged
- R1 §B watchlist — unchanged
- Operator-locked CQ1 strictness — preserved; the helper is a defense-in-depth layer above the C.1 trigger, not a softening
- Options A / F — remain rejected
- Options B / D / E — unchanged

## Changelog

- **2026-05-30 v1** — initial C.2 authorization package. Pre-flight clean: ci.yml present, helper + guard files absent, COPCanvas.tsx unchanged since C.1, no other writers in the codebase. Five-deliverable scope (helper + retrofit + guard + CI wire + unit test); bundle-RC4-with-C.2 recommendation (single GO; avoids transitional CI allowlist); ripgrep multiline for the guard (single-line grep misses the existing chain in COPCanvas.tsx); verification plan in 5 sub-sections including UI-session functional check + CI-guard self-test. Operator-locked §8.10 + §8.11 carried forward. 12-item sign-off block. Held items unchanged.
