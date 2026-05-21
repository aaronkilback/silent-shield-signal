# Production Baseline — Authoritative Snapshot
**As of:** 2026-05-21 (UTC)
**Prod project ref:** `kpuqukppbmwebiptqmog`
**Staging project ref:** `lkvyrvuakzguszbpwnfz`

This document answers: *"What exact version is prod running right now?"*

---

## 1. Git state

| Item | Value |
|---|---|
| Current branch | `main` |
| Last committed prod-representative HEAD | **`c05fc0a5`** — `fix(#120 Phase 1): source attribution — curator-seed + CISA-KEV + PATTERN (#9)` |
| HEAD position vs `origin/main` | 0 ahead / 0 behind (origin is current) |
| Uncommitted changes | **17 files modified + 3 new migrations + 1 audit doc** — listed in §6 below |

⚠️ **Drift exists**: prod database and prod edge functions have been advanced beyond `c05fc0a5`. The code that produced those changes is in the working tree but **not committed**. See §6 for full drift inventory.

---

## 2. Migrations applied to prod (today, 2026-05-21)

| Version | Name | Ticket | Notes |
|---|---|---|---|
| `20260521024734` | `get_user_accessible_client_ids_by_uid` | #112 | F-026 helper RPC overload |
| `20260521160410` | `backfill_entity_tags_from_phase4d` | #121 Phase 1 | entity_tags coverage backfill |
| `20260521162736` | `source_attribution_phase1` | #120 Phase 1 | source_id backfill (PATTERN / CISA-KEV / curator-seed) |
| `20260521183053` | `entity_suggestions_tenant_backfill` | #134 | tenant_id NULL → resolved via 5 heuristics |
| `20260521184632` | `entities_visibility_class` | #139 | 3-class visibility column + backfill |

**NOT applied to prod (staging-only):**
- `20260521030000_reports_tenant_isolation.sql` (#133) — schema change to `generated_reports` + `report_schedules`. Untracked locally, applied to staging only.

---

## 3. Edge functions deployed to prod today

| Function | Prod version | Last deployed (UTC ts) | Ticket |
|---|---|---|---|
| `create-entity` | v56 | 1779389195574 | #139 (visibility_class='curated' on direct_create) |
| `agent-chat` | v101 | 1779388276860 | #134 (tenant_id on suggest_entity) |
| `auto-enrich-entities` | v59 | 1779388274659 | #134 |
| `parse-entities-document` | v60 | 1779388272744 | #134 (require tenant_id + member check) |
| `correlate-entities` | v75 | 1779388269389 | #134 (resolve sourceTenantId upfront) |
| `extract-signal-insights` | v58 | 1779388267766 | #134 |
| `process-security-report` | v69 | 1779388266470 | #134 (derive tenant via clients) |
| `process-stored-document` | v93 | 1779388264364 | #134 |
| `dashboard-ai-assistant` | v157 | 1779388261487 | #134 (tenant_id on suggest_entity tool) |

**NOT deployed to prod (staging-only):**
- `persist-report` — patched in local tree for #133 (validates tenant_id + caller membership). Prod still runs older version v55 (timestamp 1779332018367, pre-session).
- `scheduled-report-delivery` — patched in local tree for #133 (propagates schedule.tenant_id). Prod still runs older version v54 (timestamp 1779332091477, pre-session).

---

## 4. Frontend changes — committed vs deployed

**All frontend modifications from this session are UNCOMMITTED in the working tree.** Nothing is on `origin/main` yet, which means:
- Vercel/Lovable production build does NOT yet contain these changes
- Vince's browser is still running the previous frontend until you push + the CI rebuilds

Uncommitted files affecting prod-facing UI:

| File | Ticket | What it does |
|---|---|---|
| `src/components/EntitySuggestionsPanel.tsx` | #134, #139 | tenant scope queryKey + filter; sets `visibility_class='reviewed'` on approval |
| `src/components/Header.tsx` | #134 | tenant scope on pending-suggestions count badge |
| `src/components/CreateEntityDialog.tsx` | #139 | sets `visibility_class='curated'` on operator-authored entity |
| `src/pages/Entities.tsx` | #139 | filter changed from quality_score-based to `visibility_class != 'extracted'`; toggle label changed |
| `src/pages/InvestigationDetail.tsx` | #139 | 3 writers stamped `visibility_class='curated'` |
| `src/hooks/useReportArchive.ts` | #133 | useReportArchive + useReportSchedules tenant-scoped queries + tenant_id on writes |

---

## 5. Manual prod SQL / data interventions performed today

Recording one-off database operations that are NOT captured in any migration file:

| Time (approx) | Operation | Scope | Reversibility |
|---|---|---|---|
| #134 Phase | `UPDATE entity_suggestions SET tenant_id='0aaaaaaa-cccc-4444-bbbb-000000000001' WHERE id='d38c8ef7-c6ff-4682-975e-02e0e0629777'` | 1 row — ISIS-K → CRT | Yes (set to NULL) |
| #138 Phase A (1) | `UPDATE entities SET quality_score=GREATEST(quality_score, 50) WHERE id LIKE '10000001-bbbb-4000-aaaa-%' OR id LIKE 'bcb1ead1-aaaa-4000-8000-%'` | 13 rows — BC Place seeded | Yes (`quality_score=0`) |
| #138 Phase A (2) | `UPDATE entities SET quality_score=GREATEST(quality_score, 50) WHERE id IN (Kelly Pietras, CRT Investigation root)` | 2 rows | Yes |
| #139 cleanup | `UPDATE entities SET visibility_class='curated' WHERE id='e78330da-6793-44d9-8e0f-113cabdb2e42'` | 1 row — CRT Investigation root | Yes (`visibility_class='extracted'`) |

**Not yet acted on:** 46 pending entity_suggestions remain `tenant_id IS NULL` on prod. Exported to `docs/audit-evidence/2026-05-21-134-orphan-suggestions-triage.md` for analyst triage.

---

## 6. Drift inventory — uncommitted local state that prod depends on

The biggest operational risk: **prod is running migrations + functions whose source code is uncommitted**. If this working tree is lost or a different machine pulls main, prod's behavior is unrecoverable from git.

**Untracked migrations** (applied to prod but file not yet in git):
- `supabase/migrations/20260521040000_entity_suggestions_tenant_backfill.sql` (#134)
- `supabase/migrations/20260521050000_entities_visibility_class.sql` (#139)
- `supabase/migrations/20260521030000_reports_tenant_isolation.sql` (#133, staging-only — not in prod)

**Untracked audit evidence:**
- `docs/audit-evidence/2026-05-21-134-orphan-suggestions-triage.md`

**Modified function source** (deployed to prod with these changes, but local file uncommitted — git history would show old version):
- `supabase/functions/dashboard-ai-assistant/index.ts`
- `supabase/functions/process-stored-document/index.ts`
- `supabase/functions/process-security-report/index.ts`
- `supabase/functions/extract-signal-insights/index.ts`
- `supabase/functions/correlate-entities/index.ts`
- `supabase/functions/create-entity/index.ts`
- `supabase/functions/parse-entities-document/index.ts`
- `supabase/functions/auto-enrich-entities/index.ts`
- `supabase/functions/agent-chat/index.ts`

**Modified function source** (NOT deployed to prod, but in local tree — for #133):
- `supabase/functions/persist-report/index.ts`
- `supabase/functions/scheduled-report-delivery/index.ts`

---

## 7. Tickets represented in prod

| Ticket | Status in prod | Verification |
|---|---|---|
| #112 | ✓ landed (commit `817b4b96`) | F-026 helpers present + CI guard active |
| #113 | ✓ landed (commit `69434a7a`) | ai-gateway fallback telemetry instrumented |
| #114.2 (#119) | ✓ landed (commit `6aa40e97`) | monitor-community-outreach-hourly cron disabled |
| #114.3 (#121) Phase 1 | ✓ landed (commit `8b771873`) + prod migration applied | entity_tags backfilled, correlate-entities deployed |
| #114.1 (#120) Phase 1 | ✓ landed (commit `c05fc0a5`) + prod migration applied | source_id backfilled |
| **#134** (entity_suggestions tenant) | ⚠ **applied to prod, uncommitted** | migration applied, 9 functions deployed, ISIS-K manually fixed |
| **#138** Phase A | ⚠ **applied to prod via direct SQL, NO migration file** | BC Place quality_score=50 backfill |
| **#139** (visibility_class) | ⚠ **applied to prod, uncommitted** | migration applied, create-entity deployed |
| #133 (Reports tenant) | ⚠ **STAGING ONLY** | not applied to prod database or functions |
| #135 (Sources super_admin scoping) | pending | not started |

---

## 8. Required actions to reconcile

To bring prod and `main` git back into alignment:

1. **Commit the three migration files** to lock the prod schema in version control:
   - `20260521030000_reports_tenant_isolation.sql` (staging-only marker)
   - `20260521040000_entity_suggestions_tenant_backfill.sql` (prod-applied)
   - `20260521050000_entities_visibility_class.sql` (prod-applied)
2. **Commit the 9 prod-deployed function modifications** + 2 staging-only function modifications (clearly labeled).
3. **Commit the 6 frontend modifications** so Vercel/Lovable picks them up on next build.
4. **Capture the 4 manual SQL operations** from §5 in a follow-up migration so re-running the database from scratch reproduces prod state. Or accept them as one-time data fixes documented here.
5. **Push to `origin/main`.**

---

*This baseline reconstruction is point-in-time. Future changes should be tracked in `RELEASE_LEDGER.md` going forward.*
