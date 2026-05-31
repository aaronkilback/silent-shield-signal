# QR2 — Pre-Implementation Demonstration

**Operator-directed 2026-05-31 (Task #124).** Demonstrate-before-implement gate for the entity_suggestions write-side check. Diagnostic only.

Operator's conditions before QR2 proceeds:
1. Demonstrate existing `matched_entity_id` usage
2. Demonstrate the current write path
3. Identify exact interception point
4. Document rollback plan

---

## §1 — Existing `matched_entity_id` Usage

### Reads (current consumers of the column)

| # | Consumer | File:line | What it does |
|---|---|---|---|
| 1 | EntitySuggestionsPanel UI | `src/components/EntitySuggestionsPanel.tsx:287` | Operator clicks "Merge with existing entity" → writes `matched_entity_id = targetEntityId` + status='merged' |
| 2 | silentFailureDetector | `src/lib/silentFailureDetector.ts:268` | Consistency assertion: `status='approved' ⇒ matched_entity_id IS NOT NULL` |
| 3 | e2eTests | `src/lib/e2eTests.ts:319` | Same assertion under test |
| 4 | merge-duplicate-entities | `supabase/functions/merge-duplicate-entities/index.ts:187` | On entity merge: redirects suggestions pointing to deleted duplicates → keeper entity |
| 5 | tenant backfill migration | `supabase/migrations/entity_suggestions_tenant_backfill.sql:34-40` | First resolution priority for `tenant_id` is `matched_entity_id` ownership |

### Writes (current setters of the column)

| # | Writer | File:line | When |
|---|---|---|---|
| 1 | EntitySuggestionsPanel — Approve new | `src/components/EntitySuggestionsPanel.tsx:201` | Operator approves NEW entity creation; matched_entity_id = newEntity.id |
| 2 | EntitySuggestionsPanel — Merge | `src/components/EntitySuggestionsPanel.tsx:287` | Operator merges → existing entity id |
| 3 | auto-enrich-entities | `supabase/functions/auto-enrich-entities/index.ts:230` | **Special case** — sets matched_entity_id = entity.id (the entity BEING enriched; proposing a modification, not a new entity) |
| 4 | process-stored-document | `supabase/functions/process-stored-document/index.ts:1320` | If pre-match by name/alias finds a hit; otherwise null |
| 5 | process-security-report | `supabase/functions/process-security-report/index.ts:722` | If pre-match by UUID or ilike-name finds a hit; otherwise null |

### Behavior matrix (current state of the column)

| `status` | `matched_entity_id` | Meaning |
|---|---|---|
| `pending` | NULL | Default insert; operator hasn't decided |
| `pending` | non-NULL | Some writers pre-match (process-stored-document, process-security-report) — operator can see "candidate existing entity" |
| `approved` | non-NULL (required by silentFailureDetector) | Operator approved → a new `entities` row was created with this id |
| `merged` | non-NULL | Operator clicked "Merge with existing" → links to existing entity |
| `rejected` | NULL or non-NULL | Operator rejected; matched_entity_id is informational |

### Critical finding — the schema's design intent already supports auto-merge

The `matched_entity_id` column + `status='merged'` semantic was **designed** to express "this suggestion has been linked to an existing entity instead of becoming a new one." Two writers (process-stored-document, process-security-report) already pre-compute this. The remaining writers do not. QR2 is the consistency fix — not new behavior.

**A pre-existing `status='auto_merged'` is not in the enum today.** Adding it requires either:
- Option A: reuse `status='merged'` (operator-applied semantic) — risky, conflates operator action with system action
- Option B: add `status='auto_merged'` as a new enum value — cleaner; requires migration + UI handling

**Recommendation: Option B.** Keeps operator action ('merged') distinct from system action ('auto_merged') and preserves the silentFailureDetector consistency assertion (auto_merged would also require matched_entity_id IS NOT NULL).

---

## §2 — Current Write Path (All Production Writers)

### Seven writers identified (auto-enrich is the special-case exception)

| # | Writer | File:line | Pre-checks today | Normalizes name? | Sets matched_entity_id? |
|---|---|---|---|---|---|
| 1 | **process-stored-document** | `supabase/functions/process-stored-document/index.ts:1360` | name/alias pre-match (lines 1292-1310) + within-suggestions dedupe (lines 1275-1289) | partial — `.toLowerCase()` for match comparison | yes, if pre-match found |
| 2 | **process-security-report** | `supabase/functions/process-security-report/index.ts:729-730` | UUID or ilike-name pre-match (lines 680-690) | UUID validation only | yes, if pre-match found |
| 3 | **correlate-entities** | `supabase/functions/correlate-entities/index.ts:325` | NONE | NO | NO (always null) |
| 4 | **agent-chat** | `supabase/functions/agent-chat/index.ts:1791` | tenant_id guard only | NO | NO (always null) |
| 5 | **parse-entities-document** | `supabase/functions/parse-entities-document/index.ts:227-249` | NONE | normalizeEntityType only | NO (always null) |
| 6 | **extract-signal-insights** | `supabase/functions/extract-signal-insights/index.ts:294-305` | tenant_id guard only; try/catch on duplicate insert | NO | NO (always null) |
| 7 | **auto-enrich-entities** | `supabase/functions/auto-enrich-entities/index.ts:223-224` | **DIFFERENT INTENT** — proposes enrichment for an existing entity; matched_entity_id = entity.id by design | n/a | yes, but as enrichment target |

### Inconsistency this exposes

- Five writers (3, 4, 5, 6 + auto-enrich for non-enrichment cases) insert with `matched_entity_id=NULL` even when the suggested name already exists in `entities` for the same tenant
- Two writers (1, 2) attempt pre-match but with inconsistent normalization (one uses `.toLowerCase()`, one uses `ilike`)
- The data shows the consequence: **136 of 334 (40.7%)** pending entity_suggestions exist with `matched_entity_id=NULL` but their normalized name matches an existing entity for the same tenant

---

## §3 — Exact Interception Point

### Approach: shared helper at `supabase/functions/_shared/entity-suggestions.ts`

Five reasons to favor the shared helper over per-writer retrofit:
1. **One normalization rule.** Today there are two competing normalizations across writers; a helper makes the rule single-sourced.
2. **One match-against-entities query.** Avoid bug-class where one writer matches `entities.name` but another matches `entities.aliases`.
3. **Single rollback surface.** Feature flag + revert apply once, not seven times.
4. **One place to add cross-cutting concerns later** (audit logging, tenant assertion, metrics).
5. **Tests stay focused.** One unit test per helper rule, not seven test files.

### Helper API surface (proposed)

```typescript
// supabase/functions/_shared/entity-suggestions.ts

export interface ResolvedSuggestion {
  matched_entity_id: string | null;
  status: 'pending' | 'auto_merged';
}

export async function resolveExistingEntity(
  supabase: SupabaseClient,
  tenantId: string,
  suggestedName: string,
): Promise<ResolvedSuggestion> {
  if (!tenantId) {
    // Provenance Doctrine: refuse to operate without tenant context
    throw new Error('resolveExistingEntity: tenantId is required');
  }
  const normalized = suggestedName.trim().toLowerCase();
  if (!normalized) return { matched_entity_id: null, status: 'pending' };

  // Single canonical match query (name first; alias optional)
  const { data, error } = await supabase
    .from('entities')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', normalized)        // case-insensitive exact match
    .limit(1)
    .maybeSingle();

  if (error || !data) return { matched_entity_id: null, status: 'pending' };
  return { matched_entity_id: data.id, status: 'auto_merged' };
}
```

### Per-writer interception lines

For each writer, the helper call is added IMMEDIATELY BEFORE the existing INSERT:

| Writer | Insert at | Helper call insertion | Variables available |
|---|---|---|---|
| `process-stored-document` | line 1360 | line 1312 (before building suggestion record) | `docTenantId`, `entity.name` |
| `process-security-report` | line 729 | line 708 (before payload construction) | `tenantIdForSuggestion`, `entity.name` |
| `correlate-entities` | line 325 | line 322 (before conditional insert) | `sourceTenantId`, `name` |
| `agent-chat` | line 1791 | line 1789 (after tenant guard) | `agent.tenant_id`, `args.suggested_name` |
| `parse-entities-document` | line 227 | line 221 (in per-entity loop) | `tenant_id`, `entity.name` |
| `extract-signal-insights` | line 294 | line 292 (in per-entity loop) | `signal.tenant_id`, `entity.name` |
| `auto-enrich-entities` | line 223 | **SKIP** — this writer's matched_entity_id is the target of enrichment, not a duplicate match |

### Behavior change per writer

```typescript
// BEFORE (per writer; varies slightly)
await supabase.from('entity_suggestions').insert({
  tenant_id: tenantId,
  suggested_name: name,
  // ...
  matched_entity_id: maybeExistingMatch, // or null
  status: 'pending',
});

// AFTER (uniform across writers)
const resolved = await resolveExistingEntity(supabase, tenantId, name);
await supabase.from('entity_suggestions').insert({
  tenant_id: tenantId,
  suggested_name: name,
  // ...
  matched_entity_id: resolved.matched_entity_id,
  status: resolved.status,  // 'pending' or 'auto_merged'
});
```

### Writers that already pre-match (1, 2)

Their existing pre-match logic gets REPLACED by the helper call. This is a net simplification — the helper's normalization rule is stricter than the current `.toLowerCase()` / `ilike` mismatch.

### Pre-flight requirement before any commit

**Add `auto_merged` to the `entity_suggestions.status` value set.** Schema audit needed:
- If `status` is `text` (unconstrained): no migration required; the helper can write the new value safely
- If `status` has a CHECK constraint or enum: needs migration before the helper can write `auto_merged`

The current Explore data did not surface a CHECK constraint on `entity_suggestions.status`. **Verify before shipping** (single SQL: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'entity_suggestions'::regclass AND contype = 'c';`)

Additionally:
- `silentFailureDetector.ts:268` consistency check must accept `auto_merged` as well as `approved` (both should require non-null `matched_entity_id`)
- UI handling: `EntitySuggestionsPanel.tsx` should either hide `auto_merged` rows from the pending list (they're already resolved) or display them in a separate "auto-merged" section for operator audit

---

## §4 — Rollback Design

### Three rollback layers (use the smallest one needed)

**Layer 1 — Feature flag (cheapest, no revert)**

Environment variable: `ENTITY_SUGGESTION_AUTOMERGE_ENABLED` (default `false` on initial deploy).

```typescript
const resolved = Deno.env.get('ENTITY_SUGGESTION_AUTOMERGE_ENABLED') === 'true'
  ? await resolveExistingEntity(supabase, tenantId, name)
  : { matched_entity_id: null, status: 'pending' as const };
```

Disable by setting env var to `false` on all functions. Takes effect immediately on next invocation. Zero code change to roll back.

**Layer 2 — Git revert (single commit)**

The helper + all writer retrofits land in ONE commit. `git revert <sha>` restores prior behavior. Edge functions redeploy automatically.

**Layer 3 — Database state reversal (only if rows were misrouted)**

If `auto_merged` rows were created that shouldn't have been:

```sql
-- Backfill: convert mis-applied auto_merged back to pending
UPDATE public.entity_suggestions
SET status = 'pending', matched_entity_id = NULL
WHERE status = 'auto_merged'
  AND created_at >= '<deploy_timestamp>'
  -- optional: scope to specific tenant if issue is isolated
;
```

Append-only audit: the original `matched_entity_id` would be lost on this UPDATE unless captured. Recommend a one-line audit insert into `audit_events` before the bulk update if Layer 3 is needed.

### Rollback decision tree

```
Observation: false auto-merges appearing
  ↓
Is it ALL writers or one specific writer?
  ├─ ALL → Layer 1 (env var off) — instant
  └─ ONE → narrow Layer 2 (revert that writer's change only); keep helper intact
  ↓
Are wrong auto_merged rows in DB?
  ├─ YES → Layer 3 SQL backfill
  └─ NO → done
```

### Pre-deploy validation (gate before any operator GO)

1. Helper unit tests: name normalization, tenant scoping, empty-name handling, missing-tenant refusal
2. Synthetic test on staging: insert entity "ACME Corp" → call each retrofitted writer with name "acme corp" → confirm `status='auto_merged'`, `matched_entity_id` = that ACME entity's id
3. Negative test: same writer, name "ACME Corporation" → confirm `status='pending'`, `matched_entity_id` IS NULL (exact match, not fuzzy)
4. Run silentFailureDetector after a synthetic auto_merged row exists → confirm it does NOT flag (after the consistency-check update accepts `auto_merged`)
5. Re-confirm staging fixture (`scripts/check-staging-load-fixture.mjs`) passes — no monitor-function regressions

### Smallest possible deploy

Recommended PR shape:
- Single migration to add `auto_merged` value (if needed after CHECK-constraint audit)
- Single TypeScript commit with: `_shared/entity-suggestions.ts` (helper) + six writer retrofits + `silentFailureDetector` update + UI display rule
- Feature flag default OFF on first deploy; operator flips it ON after observation

This way the deploy is observable in three stages: code deployed (no behavior change) → flag ON (auto-merge begins) → metrics confirm.

---

## §5 — Pre-Implementation Checklist (operator-reviewable)

| # | Item | Status |
|---|---|---|
| ✓ | All entity_suggestions write paths inventoried | 7 production writers identified; 1 (auto-enrich) excluded by design |
| ✓ | Existing `matched_entity_id` usage mapped | 5 readers, 5 writers documented |
| ✓ | Schema's design intent for matched_entity_id confirmed | Yes — supports auto-merge semantics natively |
| ✓ | Interception point identified per writer | 6 specific lines; shared helper recommended |
| ✓ | Helper API surface drafted | `resolveExistingEntity()` returns discriminated result |
| ✓ | Rollback plan documented | 3 layers: feature flag → git revert → DB backfill |
| ⚠ | CHECK constraint on `entity_suggestions.status` | **Needs verification before commit** (single SQL probe) |
| ⚠ | `silentFailureDetector` accepts `auto_merged` | Requires update; included in single commit |
| ⚠ | UI displays auto_merged rows | Requires update; included in single commit |
| ⚠ | Feature flag default OFF | First deploy must ship with flag false |

The three ⚠ items are pre-conditions; ship them all in the same PR before flipping the feature flag.

---

## §6 — Held / Operator Decision Surface

### Decisions required (each separate)

| # | Decision | Recommendation |
|---|---|---|
| QR2.D1 | Approve the shared-helper approach (over per-writer retrofit) | recommended — shared helper |
| QR2.D2 | Approve adding `auto_merged` as new status value (Option B over reusing `merged`) | recommended — keeps operator vs system action distinct |
| QR2.D3 | Approve feature-flag rollout (default OFF, flip after observation) | recommended |
| QR2.D4 | Authorize the schema-constraint audit query before commit | recommended — quick (single SQL) |
| QR2.D5 | Authorize PR construction (helper + 6 writers + silentFailureDetector + UI in one commit) | recommended |
| QR2.D6 | Re-check feedback rule: *"address generation before approval"* — this is the input-side gate that prevents 40.7% of entity_suggestion inflow | doctrine-aligned |

### What this demonstration does NOT do

- Does not write any code
- Does not modify any function
- Does not run the schema-constraint audit (operator-gated; mentioned as a pre-flight requirement)
- Does not produce the test harness (covered by QR2.D5)

This is the demonstration. Implementation is gated on operator GO per QR2.D1-D6.

Held. No code. No branch. Awaiting operator GO per §6.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
