# Production Release Ledger

Append-only operational log of every prod-touching change. One entry per release.

**Why this exists:** prevent staging/prod drift; preserve operational truth when migrations, function deploys, manual SQL, and frontend changes are interleaved.

**How to use:**
1. Before touching prod, draft the entry's metadata fields.
2. Execute the change.
3. Fill in the validation result + rollback notes immediately after.
4. Commit this file in the same PR as the change.

**Format constraint:** one entry per release, kept terse. If a release fans out across multiple commits or PRs, list all of them in the same entry. Do not split.

---

## Entry template

Copy this template for each new release:

```markdown
### YYYY-MM-DDTHH:MMZ — <short title>

- **Ticket:** #NNN
- **Operator:** <name or @handle>
- **Commits / PRs:** <list>
- **Migrations applied (prod):** <filename(s) or "none">
- **Functions deployed (prod):** <list with version, or "none">
- **Frontend deploy:** <committed-only | live on Vercel | deferred>
- **Manual SQL / data changes:** <one-line per op, or "none">
- **Validation performed:** <staging tests, prod sanity check, etc.>
- **Rollback:** <revert PR / SQL to undo / function rollback command>
```

---

## Entries

### 2026-05-21T20:05Z — P0 hotfix: super_admin bootstrap infinite spinner

- **Ticket:** P0 prod hang triage (no ticket # — incident response)
- **Operator:** ak@silentshieldsecurity.com (Claude-assisted)
- **Commits / PRs:** commit `69419afe` (pushed direct to main, no PR — emergency hotfix)
- **Migrations applied (prod):** none
- **Functions deployed (prod):** none
- **Frontend deploy:** live on Cloudflare Worker (deploy succeeded 1m44s; Aaron confirmed page loads after hard refresh)
- **Manual SQL / data changes:**
  1. `FEEDBACK_LEARNING_PER_TENANT_ENABLED=true` set as prod secret (option A speculative fix; later determined unrelated to the actual root cause but left set; safe — it would only re-enable already-deployed Phase 1 logic when those functions next run)
- **Validation performed:**
  - DevTools network triage ruled out backend hang (signals/incidents/user 200, no pending XHR)
  - Debug overlay confirmed: tenant=null, profile=operator, isAllTenantsView=false, selectedClient populated
  - Code trace → `ProtectedRoute.tsx:195` unconditional `if (!currentTenant) return <Loader>` inside `OnboardingChecks`
  - Aaron's super_admin session had no `fortress_current_tenant_id` in localStorage and no `fortress_all_tenants_view`, so `useTenant` hydration intentionally left `currentTenant=null` ("explicit no-selection" — useTenant.tsx:201-207 from Bug 2 2026-05-19 sweep). Hit loader, spun forever.
  - Ticket #81 ("Super_admin lockout hotfix — admit isSuperAdmin+!currentTenant into platformAdminMode") was supposed to prevent this case; the fix had been lost from `OnboardingChecks.platformAdminMode`.
  - Hotfix: added `(isSuperAdmin && !currentTenant)` to `platformAdminMode` condition. Super_admin with no scope now hits early-return at line 173.
  - Post-deploy: Aaron confirmed prod page loaded after hard refresh.
- **Rollback:** `git revert 69419afe`. No DB / migration / function impact.
- **Followups filed:**
  - #147 — Playwright regression test for super_admin no-scope bootstrap
  - #148 — No-forever-spinner global guard (8-10s timeout → recoverable reset)

### 2026-05-21T19:50Z — #130 Phase 0: feedback_events tenant containment + ML kill switches + telemetry

- **Ticket:** #130 (Phase 0A + 0B), #143, #144
- **Operator:** ak@silentshieldsecurity.com (Claude-assisted)
- **Commits / PRs:** commit `f7675f5d` (Phase 0A migration + 3 feature-flag patches + Phase 0B tenant-scope patches)
- **Migrations applied (prod):** `20260521190000_feedback_events_phase0a_rls_clamp` — dropped broad "Analysts and admins full access" policy; replaced with polymorphic tenant-scoped SELECT via signals/entities chain; super_admin bypass.
- **Functions deployed (prod):** `optimize-rule-thresholds`, `predictive-alert-tuning`, `generate-learning-context` (feature-flag-disabled via FEEDBACK_LEARNING_PER_TENANT_ENABLED, default OFF), `ingest-signal` (tenant-scoped few-shot via signals!inner join), `process-intelligence-document` (tenant-scoped feedback via clients chain)
- **Frontend deploy:** none (backend-only)
- **Manual SQL / data changes:** prod marker proof seed/cleanup (deleted)
- **Validation performed:**
  - Staging deterministic marker proof (5 cases all PASS — A_ONLY_MARKER visible to CRT only, B_ONLY_MARKER visible to Petronas only, pre-fix shape would have seen both)
  - Prod marker proof re-run (5 cases all PASS, same shape)
  - Customer API read leak closed: Vince's feedback_events visibility dropped 264 → 5 rows
  - super_admin omniscience preserved: Aaron sees 264 rows
  - 211 prod ingest-signal calls post-Phase 0: 0 errors, latency comparable (p50 2470ms vs pre 2850ms)
- **Rollback:** `git revert f7675f5d`; re-apply old RLS policy; unset env var.

### 2026-05-21T18:46Z — #139 entities visibility_class model

- **Ticket:** #139 (Issue 2 Phase B — provenance-aware suppression)
- **Operator:** ak@silentshieldsecurity.com (Claude-assisted)
- **Commits / PRs:** PENDING COMMIT (working tree)
- **Migrations applied (prod):** `20260521184632 entities_visibility_class` — adds `visibility_class text NOT NULL DEFAULT 'extracted' CHECK IN ('curated','reviewed','extracted')` + backfill heuristic
- **Functions deployed (prod):** `create-entity` v56 (only writer that stamps `visibility_class='curated'`)
- **Frontend deploy:** **deferred** — 4 files modified (`Entities.tsx`, `CreateEntityDialog.tsx`, `EntitySuggestionsPanel.tsx`, `InvestigationDetail.tsx`); not yet committed/pushed
- **Manual SQL / data changes:** `UPDATE entities SET visibility_class='curated' WHERE id='e78330da-6793-44d9-8e0f-113cabdb2e42'` — CRT Investigation root entity didn't match heuristic, explicit fix (1 row)
- **Validation performed:** Staging: 5-test suite (T-POS, T-NEG, T-CROSS, default fail-closed, writer coverage). Prod: V1-V6 (Vince BC Place toggle ON visible=17/17 curated, AEGIS retrieval unaffected at 2,018 active entities).
- **Rollback:** `ALTER TABLE entities DROP COLUMN visibility_class` (reversible, additive change). Frontend revert: any old build still works.

### 2026-05-21T18:30Z — #138 Phase A: BC Place quality_score backfill

- **Ticket:** #138 (Issue 2 Phase A — emergency operator visibility fix)
- **Operator:** ak@silentshieldsecurity.com (Claude-assisted)
- **Commits / PRs:** none — direct prod SQL, no migration file
- **Migrations applied (prod):** none
- **Functions deployed (prod):** none
- **Frontend deploy:** n/a
- **Manual SQL / data changes:**
  1. `UPDATE entities SET quality_score=GREATEST(quality_score, 50) WHERE id LIKE '10000001-bbbb-4000-aaaa-%' OR id LIKE 'bcb1ead1-aaaa-4000-8000-%'` — 13 BC Place seeded entities
  2. `UPDATE entities SET quality_score=GREATEST(quality_score, 50) WHERE id IN ('e78330da-6793-44d9-8e0f-113cabdb2e42', '222692f4-f521-4aea-b83e-fe89ef04e25e')` — Kelly Pietras + CRT Investigation root (operator-curated; didn't match the UUID pattern)
- **Validation performed:** Pre/post counts: BC Place will_render 8/17 → 17/17 active entities.
- **Rollback:** structurally superseded by #139; the `visibility_class` column now classifies these same rows as `curated`. If #139 is reverted, this Phase A backfill remains effective on its own.

### 2026-05-21T17:50Z — #134 entity_suggestions tenant isolation

- **Ticket:** #134 (Issue 1 — entity_suggestions tenant_id NULL leak)
- **Operator:** ak@silentshieldsecurity.com (Claude-assisted)
- **Commits / PRs:** PENDING COMMIT (working tree)
- **Migrations applied (prod):** `20260521183053 entity_suggestions_tenant_backfill` — 5 backfill heuristics for NULL tenant_id rows
- **Functions deployed (prod):** 9 functions: `dashboard-ai-assistant` v157, `process-stored-document` v93, `process-security-report` v69, `extract-signal-insights` v58, `correlate-entities` v75, `parse-entities-document` v60, `auto-enrich-entities` v59, `agent-chat` v101, `create-entity` (deployed twice — #134 then #139)
- **Frontend deploy:** **deferred** — 2 files modified (`EntitySuggestionsPanel.tsx`, `Header.tsx`); not yet committed/pushed
- **Manual SQL / data changes:** `UPDATE entity_suggestions SET tenant_id='0aaaaaaa-cccc-4444-bbbb-000000000001' WHERE id='d38c8ef7-c6ff-4682-975e-02e0e0629777'` — ISIS-K row → CRT tenant (1 row). 46 pending NULL-tenant rows remain; triage exported to `docs/audit-evidence/2026-05-21-134-orphan-suggestions-triage.md`.
- **Validation performed:** Staging: 6 RLS impersonation tests (CRT analyst, Petronas analyst, cross-tenant insert blocked, identity spoof blocked, ISIS-K visible to CRT only). Prod: backfill resolved 17/78 NULL rows; ISIS-K confirmed visible to Vince.
- **Rollback:** Migration is data-only (backfill UPDATEs); reverse with `UPDATE entity_suggestions SET tenant_id=NULL WHERE id IN (...)` for the 17 resolved rows. Function rollback: redeploy prior versions via Supabase dashboard.

### 2026-05-21T16:27Z — #120 Phase 1: source attribution backfill

- **Ticket:** #120 / #114.1 — source_id NULL for 29% of signals
- **Operator:** ak@silentshieldsecurity.com (committed by Claude, PR'd by user)
- **Commits / PRs:** commit `c05fc0a5`, PR #9
- **Migrations applied (prod):** `20260521162736 source_attribution_phase1` — registers Fortress Pattern Detector + per-publisher curator-seed sources, backfills source_id for PATTERN / CISA-KEV / curator-seed signals
- **Functions deployed (prod):** `detect-threat-patterns` (sets `source_id: patternSourceId` going forward)
- **Frontend deploy:** n/a
- **Manual SQL / data changes:** none beyond the migration
- **Validation performed:** Pre/post count of `source_id IS NULL` signals on prod, +223 signals attributed.
- **Rollback:** migration is forward-only data backfill; reverse via `UPDATE signals SET source_id=NULL` filtered by the same conditions.

### 2026-05-21T16:04Z — #121 Phase 1: entity_tags backfill from phase4d

- **Ticket:** #121 / #114.3 — entity-tag coverage gap
- **Operator:** ak@silentshieldsecurity.com (committed by Claude, PR'd by user)
- **Commits / PRs:** commit `8b771873`, PR #8
- **Migrations applied (prod):** `20260521160410 backfill_entity_tags_from_phase4d` — tenant-scoped UUID→name resolution for matched_entities
- **Functions deployed (prod):** `correlate-entities` (write entity_tags from Phase 4D going forward)
- **Frontend deploy:** n/a
- **Manual SQL / data changes:** none
- **Validation performed:** +79 signals tagged, coverage 35% → improved on operator workflow surfaces.
- **Rollback:** migration data-only.

### 2026-05-21T02:47Z — #112 F-026 helper restore + #114.2 community outreach disable

- **Ticket:** #112 (F-026 helper restore), #119 / #114.2 (community outreach cron disable)
- **Operator:** ak@silentshieldsecurity.com (committed by Claude, PR'd by user)
- **Commits / PRs:** commits `817b4b96`, `6aa40e97`, PRs #4 + #7
- **Migrations applied (prod):** `20260521024734 get_user_accessible_client_ids_by_uid` — RPC overload accepting explicit `_user_id`
- **Functions deployed (prod):** `ingest-signal` (restored hostile-attribution + F-026 helpers)
- **Frontend deploy:** n/a
- **Manual SQL / data changes:** `SELECT cron.alter_job(job_id := 201, active := false)` — disabled `monitor-community-outreach-hourly` cron job
- **Validation performed:** Mode 4-6 staging validation (F-026 access checks before test-signals guard); production smoke test (ingest-signal still 200s on valid input).
- **Rollback:** revert PR #4 + PR #7; re-enable cron via `cron.alter_job(job_id := 201, active := true)`.

---

## Pending entries (not yet pushed to prod)

### STAGING-ONLY — #133 Reports tenant isolation

- **Ticket:** #133
- **Status:** staging-validated, prod rollout NOT executed
- **Why deferred:** awaiting Aaron go for prod sequence (per session conversation)
- **What's ready:** migration file `20260521030000_reports_tenant_isolation.sql`, 2 function patches (`persist-report`, `scheduled-report-delivery`), 1 hook patch (`useReportArchive.ts`)
- **What was validated on staging:** 8 RLS access tests (positive, negative, cross-tenant insert blocked, identity spoof blocked, etc.)
