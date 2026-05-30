# Feedback Loop Restoration (Path A) — Operator Authorization Package

**Created:** 2026-05-30
**Status:** OPERATOR REVIEW. No implementation. No branch opened. No code written. No migration drafted. No deploy initiated.
**Classification:** B — Moderate workstream (§13 below).
**Predecessors:** Detection Health Assessment (2026-05-30), Path A causal map (2026-05-30), Path A remediation assessment (2026-05-30), Sequencing decision memo (2026-05-30).

---

## §1 — Plain-English objective

Restore canonical statistical learning so that operator feedback (false-positive / confirmed / correction) accumulates per-tenant pattern state in `learning_profiles`, and so that the signal-relevance gate and adjacent consumers consult those patterns when scoring new signals.

The break today: every feedback event reaches `feedback_events` (267 rows / 30d) and `universal_learning_log` (225 rows / 30d) and Path B (`apply-feedback-to-agent` → agent `system_prompt`, 83 rows / 30d), but the `upsertLearningProfile` writer in `process-feedback/index.ts:621-625` omits the schema-required `tenant_id` column, so every INSERT silently fails. `learning_profiles` has zero rows lifetime; consumers read empty and fall back to defaults; the gate cannot adapt by statistical evidence.

The repair: thread the already-available `tenant_id` (carried on every `feedback_events` row by the existing `enforce_feedback_events_tenant_id` trigger) through the writer chain and add per-tenant filtering to the consumer reads. Bundle the writer + consumer changes in a single deploy to eliminate any transient cross-tenant read window.

---

## §2 — Exact files, functions, and tables affected

### Tables touched (data state only)

| Table | Operation | Pre-state | Post-state |
|---|---|---|---|
| `learning_profiles` | INSERTs (forward-only) | 0 rows | gains rows per feedback event, ~5–15 rows/tenant in week 1 |

No other table receives new writes from this repair. No table is altered in shape. No DDL executed.

### Files modified

| File | Role | Sites |
|---|---|---|
| `supabase/functions/process-feedback/index.ts` | Primary writer | `.select()` line 28 · helper signature lines 597-630 · ~13 helper call sites · ~8 `update<Object>Learning` function signatures |
| `supabase/functions/_shared/signal-relevance-scorer.ts` | Consumer (ingest critical path) | reads at 261-265 and 421-425 |
| `supabase/functions/ingest-signal/index.ts` | Consumer (ingest critical path) | read at 1436 |
| `supabase/functions/_shared/learning-context-builder.ts` | Consumer (audit) | unknown read count — pre-flight audit |
| `supabase/functions/learn-from-investigations/index.ts` | Consumer (audit) | pre-flight audit |
| `supabase/functions/visibility-gap-scanner/index.ts` | Consumer (audit) | pre-flight audit |
| `supabase/functions/briefing-feedback/index.ts` | Consumer (audit) | pre-flight audit |
| `supabase/functions/generate-learning-context/index.ts` | Consumer (audit) | pre-flight audit |
| `supabase/functions/threat-cluster-detector/index.ts` | Consumer (audit) | pre-flight audit |
| `supabase/functions/dashboard-ai-assistant/index.ts` | Tables-list reference (line 1232); confirm not an active read | quick verify |
| `supabase/functions/system-watchdog/index.ts` | Alarm logic (reads staleness) | confirm tenant-aware after fix |
| Pre-flight writer audit | Inspect for same defect class | `aggregate-implicit-feedback`, `aggregate-global-learnings`, `agent-self-learning`, `learn-from-investigations` |

### Functions and helpers affected

`process-feedback/index.ts`:
- `upsertLearningProfile(supabase, profileType, newFeatures)` → adds `tenantId` parameter
- `updateSignalLearning(supabase, objectId, feedback, context?)` — signature gains `tenantId`
- `updateIncidentLearning(supabase, objectId, feedback)` — same
- `updateBriefingLearning(supabase, objectId, feedback, context?, correction?)` — same
- `updateReportLearning(...)`, `updateTravelAlertLearning(...)`, `updateAudioBriefingLearning(...)`, `updateEntityPhotoLearning(...)`, `updateGenericLearning(...)`, `updateEntitySuggestionLearning(...)` — same threading
- `propagateCrossDomainLearning(supabase, category, feedback)` — **design judgment required** (see §11 R5): thread `tenantId` (tenant-scoped path) OR route to `agent_tradecraft` (tenant-agnostic tradecraft path). Both options consistent with the doctrine; operator picks the routing intent before implementation.

---

## §3 — Writer changes required

### W1 — Lift `tenant_id` from the feedback_events INSERT return

Line 28: change `.select('id')` → `.select('id, tenant_id')`. The trigger `trg_feedback_events_tenant_id` (BEFORE INSERT, function `enforce_feedback_events_tenant_id`) already auto-populates `tenant_id` from `(object_type, object_id)` on the row, so `tenant_id` is guaranteed non-null on every row read back.

### W2 — Thread `tenantId` through the type-specific update functions

Each `update<Object>Learning` function gains a `tenantId: string` parameter and passes it to `upsertLearningProfile`. ~8 functions, mechanical signature change.

### W3 — Update the helper

`upsertLearningProfile`:
- New signature: `(supabase, tenantId: string, profileType: string, newFeatures: Record<string, number>)`
- SELECT existing: add `.eq('tenant_id', tenantId)` to the existing `.eq('profile_type', profileType)` filter. This is correct against the live `UNIQUE (tenant_id, profile_type)` constraint.
- INSERT payload: add `tenant_id: tenantId`.
- UPDATE path: no change (id-based).

### W4 — `propagateCrossDomainLearning` routing **[DECIDED: Option α]**

Operator decision 2026-05-30: **Option α (tenant-scoped).** Thread `tenantId` from `updateSignalLearning`'s scope through `propagateCrossDomainLearning` and into `upsertLearningProfile`. Cross-domain category learning is written into the tenant's own `learning_profiles` slice.

Considered and not chosen: **Option β (route to `agent_tradecraft`).** Doctrinally cleaner (cross-domain category-relatedness is structurally L2 approved-anonymized tradecraft, not L1 tenant fact), but requires schema-fit verification — `agent_tradecraft` was built for narrative tradecraft notes / decision rules, not category-frequency feature vectors. A clean β implementation would need a schema extension or translation layer, pushing scope from B toward C.

**Follow-on backlog note (to revisit, not now):** when `agent_tradecraft` schema fit is verified or extended, migrate cross-domain category-relatedness patterns from per-tenant `learning_profiles` slices to the shared tradecraft store. Cost of α today: a Petronas analyst marking "protest → civil_unrest" as related does not teach BC Place's gate the same relationship. Tradecraft fragments per-tenant until the migration. Acceptable for the minimum-safe-repair window.

### W5 — Error-handling shape **[DECIDED: In scope, constrained to W5a]**

Operator decision 2026-05-30: **W5 in scope, constrained to W5a shape.** Replace the silent-swallow try/catch in `upsertLearningProfile` (lines 627-629) with:

- Inspect the supabase-js response `error` field on every write attempt (both SELECT-existing and INSERT/UPDATE paths)
- On error: `console.error` with full context (`tenant_id`, `profile_type`, error code, error message, attempted payload shape)
- **Do NOT throw.** Function continues; caller is unaffected.
- **Do NOT change the HTTP response shape** of process-feedback. Frontend toast behavior unchanged.
- Path B enqueue path is structurally preserved — a Path A write failure does not block `apply-feedback-to-agent` from being queued.

Doctrinal alignment: Aegis action-integrity AR1–AR6 ("no fake success," "honest refusal") + the consistent C.x pattern (ingest-signal hard-reject, recordAgentMemory fail-closed, cop-timeline-writer discriminated union). The W5a shape preserves the doctrine surface (failures are loud) without coupling Path A and Path B success states.

Considered and not chosen: **W5b (surface in return shape) / W5c (throw on PostgrestError).** Both shapes risk coupling Path B success to Path A success — if a writer throws, the downstream `enqueueJob('apply-feedback-to-agent', ...)` call may not execute, and the currently-working Path B regresses. W5a's loud-log-no-throw shape is the minimum hardening that kills the silent-swallow defect class without introducing this coupling.

Defect-class prevention: the original `learning_profiles` defect hid for 30+ days specifically because the swallowing try/catch concealed `23502` errors. W5a guarantees the same drift in the future produces immediate, queryable edge function log noise — discoverable in any standard log search within hours, not 30 days.

---

## §4 — Consumer changes required

### C1 — `_shared/signal-relevance-scorer.ts` (critical path)

Two reads to scope by tenant_id:

- Lines 261-265: `.in('profile_type', [...])` → add `.eq('tenant_id', currentTenantId)`. The scorer is called per-signal at ingest; `currentTenantId` must be plumbed in from the caller (ingest-signal already has the signal's tenant_id in scope).
- Lines 421-425: `.eq('profile_type', 'adaptive_thresholds').single()` → add `.eq('tenant_id', currentTenantId)`. `.single()` now reads at most one row per tenant (matches the `UNIQUE (tenant_id, profile_type)` schema invariant).

### C2 — `ingest-signal/index.ts` (critical path)

Read at line 1436 — add `.eq('tenant_id', currentTenantId)` matching the same pattern.

### C3 — Secondary consumers (audit pass)

| File | Role | Action |
|---|---|---|
| `learn-from-investigations` | Consumer | Confirm tenant_id filter on any `learning_profiles` read |
| `visibility-gap-scanner` | Consumer | Same |
| `briefing-feedback` | Consumer | Same |
| `generate-learning-context` | Consumer | Same |
| `threat-cluster-detector` | Consumer | Same |
| `process-intelligence-document` | Consumer | Same |
| `_shared/learning-context-builder.ts` | Consumer helper | Same |
| `apply-feedback-to-agent` | Audit (writes elsewhere; verify no incidental learning_profiles read) | Confirm |
| `investigation-ai-assist` | Audit | Same |
| `system-ops` | Audit | Same |
| `system-watchdog` | Alarm logic | Confirm staleness check is per-tenant or globally relaxed once repair lands |
| Frontend: `SignalHistory.tsx`, `SignalFalsePositiveButton.tsx`, `SignalDetailDialog.tsx`, `signals/SignalDetailSheet.tsx` | UI reads | Confirm tenant_id filter (frontend should be inheriting tenant scope from auth, but verify) |
| `dashboard-ai-assistant` | References learning_profiles in tables-list only (line 1232) | Confirm no active read |

### C4 — `system-watchdog` alarm

Today's check: *"learning_profiles haven't updated in 48h"*. Post-repair, this alarm should clear within hours of the first post-deploy feedback event. The watchdog's check logic may need a tenant-aware variant once data exists (e.g., flag a tenant whose `last_updated` is stale despite recent feedback activity). Minimum-change scope keeps the existing global staleness check, which will become misleading once data exists for some tenants but not others. Flag for follow-on tuning.

---

## §5 — Tenant-isolation implications

The repair **strengthens** tenant isolation versus the current state. Three findings:

| Today (broken) | Post-repair |
|---|---|
| `learning_profiles` is empty → no isolation surface to enforce | `learning_profiles` is non-empty + writes are tenant-scoped + reads are tenant-scoped → CQ1 invariant binding at the read seam |
| Consumer reads use `.in('profile_type', [...])` without tenant_id filter | Same readers add `.eq('tenant_id', currentTenantId)`; any future cross-tenant row would be ignored at the read |
| Cross-tenant leak risk = N/A (empty table) | Cross-tenant leak risk only during writer-deploy window IF writer ships before consumer fix — eliminated by bundled deploy |

**CQ1 alignment:** `learning_profiles.tenant_id NOT NULL` + named CHECK + FK to `tenants` + `UNIQUE (tenant_id, profile_type)` + `learning_profiles_service_role` policy allowing service-role manage + `learning_profiles_tenant_select` RLS policy gating reader by `tenant_users` membership. The schema invariants are already binding; the repair makes the writer and the consumer reads honor them.

**No new policies required.** No new triggers required. No new CHECK constraints required. The hardening is purely application-layer.

**Provenance Doctrine alignment:** the writer fix supplies `tenant_id` from the feedback_events row, which was itself derived from the parent object's (signal / incident / entity) tenant scope via the existing trigger. Provenance is end-to-end: object → feedback_event → learning_profile, with `tenant_id` carried by the same trigger-derived value throughout. No `client_id IS NULL` fallback. No `unknown` tenant. No ownerless write.

---

## §6 — Testing and verification plan

### Pre-flight (before any code change is written or proposed)

| # | Test | Method | Pass criterion |
|---|---|---|---|
| P1 | `learning_profiles` is empty on staging + prod | MCP execute_sql | 0 rows on both |
| P2 | No active `learning_profiles_phase1_snapshot` confusion | Inventory query | Snapshot is read-only archive; not referenced by any writer or consumer |
| P3 | Audit all writers for same defect class | Static grep for `learning_profiles` `.insert(` and `.upsert(` | All writers omit tenant_id consistently OR have a pre-existing tenant_id supply path |
| P4 | Audit all consumers for tenant filtering | Static grep for `learning_profiles` `.select(` `.from('learning_profiles')` | Catalog every site; each gets a verdict (already-scoped / needs-fix / unused) |
| P5 | Confirm trigger `enforce_feedback_events_tenant_id` is ENABLED on prod | `pg_trigger` query | `tgenabled = 'O'` |
| P6 | Confirm `propagateCrossDomainLearning` routing decision | Operator chooses Option α or β before implementation | Recorded in deploy notes |

### Build verification

| # | Test | Method | Pass criterion |
|---|---|---|---|
| B1 | TypeScript build passes | `npm run build` | success, no TS2304 / TS2552 |
| B2 | Unit tests pass | `npm run test` | all suites green |
| B3 | ESLint passes | `npm run lint` | no new violations |

### Functional verification — synthetic two-tenant isolation test

Mirroring the C.0 / C.1 G2 functional test pattern: a synthetic fixture exercising the full feedback → learning_profiles chain twice, once per tenant, then verifying isolation.

| # | Test | Method | Pass criterion |
|---|---|---|---|
| F1 | INSERT feedback for tenant-A signal → learning_profiles row exists for tenant A | Service-role SQL fixture: create signal under tenant A → invoke process-feedback → SELECT learning_profiles WHERE tenant_id = tenant-A | exactly one row, tenant_id = tenant-A, profile_type matches the feedback shape |
| F2 | INSERT feedback for tenant-B signal → learning_profiles row exists for tenant B; tenant A row unchanged | Same shape under tenant B; re-SELECT for tenant A | tenant-A row sample_count unchanged; new tenant-B row present |
| F3 | SELECT scoped to tenant A returns ONLY tenant-A profiles (no tenant-B bleed) | Service-role SELECT with `.eq('tenant_id', tenant-A)` | exactly the tenant-A rows; no tenant-B rows |
| F4 | signal-relevance-scorer read scoped per-tenant | Synthetic call into scorer for tenant A's signal | scorer's internal `.in()` query returns tenant-A profiles only |
| F5 | UPDATE path: second feedback for tenant A increments tenant A's `sample_count` | Re-invoke process-feedback with same profile_type | sample_count == 2 for tenant-A row; tenant-B row unchanged |
| F6 | CLEAR / NULL semantics — clearing `last_updated` not applicable; verify `last_updated` advances on each write | Compare timestamps | last_updated strictly increases per update |
| F7 | Fixture cleanup | DELETE all c4-cap-test-* fixtures (signals, feedback_events, learning_profiles where created by test) | residue = 0 across all involved tables |

### Watchdog verification

| # | Test | Method | Pass criterion |
|---|---|---|---|
| W1 | `system-watchdog` "learning_profiles haven't updated in 48h" alarm clears | Trigger watchdog post-first-feedback after deploy | alarm transitions from RED to GREEN within hours |

### Post-deploy observation (7-day window)

| # | Observation | Method | Pass criterion |
|---|---|---|---|
| O1 | `learning_profiles` row count climbs | Daily SQL count | strictly increasing; reflects feedback volume |
| O2 | Per-tenant signal admission rate stays within base floor/ceiling (0.25–0.55) | Compare per-tenant signal counts pre/post deploy | no excursion to 0 admissions or 100% admissions |
| O3 | No cross-tenant pattern bleed | Random-sample 10 signals across multiple tenants, verify scorer read consulted only the correct tenant's profiles | scorer queries Aegis Flight Recorder for retrieval traces; tenant-scoping verified |
| O4 | No spike in process-feedback HTTP 500s | Edge function logs | error rate consistent with baseline |
| O5 | Watchdog stale-learning alarm remains GREEN | Daily watchdog check | no re-fire |

---

## §7 — Rollback plan

Single PR revert. The repair is contained to application code; no schema modified.

### Code rollback

`git revert <merge-commit-sha>` on main. Cloudflare Pages auto-rebuilds and deploys. Edge functions re-deploy via the existing pipeline (manual `supabase functions deploy` per function, or batch script). Rollback window: ~5–15 minutes from decision to revert.

### Data rollback (optional)

Forward-only data; rollback is **not required**. The rows added to `learning_profiles` during the operational window remain valid tenant-scoped profile state and are read-only useful even if the writer is reverted (consumers fall back to the same patterns).

If the operator prefers a clean slate post-revert:

```sql
TRUNCATE public.learning_profiles;
```

(no cascading effect; no other table depends on these rows.) **NOT recommended** unless a specific corruption surface is identified, because truncation discards real captured learning.

### Per-tenant rollback (granular)

If a single tenant's profiles exhibit excursion (over-tightened gate), a tenant-scoped delete restores that tenant's gate to defaults without touching other tenants:

```sql
DELETE FROM public.learning_profiles WHERE tenant_id = '<tenant-uuid>';
```

This is a tenant-isolated corrective surgery; no global rollback needed.

---

## §8 — Blast radius

| Surface | Impact | Severity |
|---|---|---|
| `learning_profiles` (table) | Gains rows from each feedback event | LOW — schema unchanged, RLS enforced, tenant-scoped |
| signal-relevance-scorer (ingest critical path) | Begins consulting per-tenant patterns; gate adapts | MEDIUM — observable behavior change |
| ingest-signal (critical path) | Same | MEDIUM |
| Other consumers (`learn-from-investigations`, `visibility-gap-scanner`, etc.) | Reads now scoped per-tenant | LOW |
| system-watchdog | Stale-learning alarm clears | LOW — alarm de-fires |
| Path B (`apply-feedback-to-agent`) | Untouched | ZERO |
| Other tables (`feedback_events`, `universal_learning_log`, `self_improvement_log`, etc.) | Untouched | ZERO |
| Schema | No DDL | ZERO |
| RLS policies | No new policies | ZERO |
| Triggers | No new triggers | ZERO |
| Migrations | None drafted | ZERO |

**Net behavior change observable:** per-tenant signal admission/rejection rates may shift over days/weeks as patterns accumulate. The base floor (0.25) and ceiling (0.55) cap excursion magnitude. The shift IS the intended effect of the repair — the gate becomes adaptive.

---

## §9 — Expected behavioral impact

### Hours after deploy

- First feedback event post-deploy → first `learning_profiles` row written.
- `universal_learning_log` continues to log learning attempts (no change in its rate).
- Path B (`apply-feedback-to-agent`) continues to log to `self_improvement_log` (no change in its rate).
- system-watchdog stale-learning alarm clears.

### Days 1–7

- ~5–15 `learning_profiles` rows per tenant (scaling with feedback volume).
- Each tenant's relevance gate begins adjusting from accumulated patterns.
- Per-tenant signal admission rates may shift modestly. Tenants with negative-feedback-heavy patterns see marginal tightening; tenants with positive-feedback-heavy patterns see marginal loosening.

### Weeks 2–4

- False-positive rates expected to decline for tenants engaging with feedback.
- Per-source credibility (`source:<type>_approved` / `source:<type>_rejected`) profiles tighten or loosen per accumulated evidence.
- Per-category rejection rates (`category:<cat>`) accumulate.
- Per-rejection-reason patterns (`rejection_reason:<reason>`) accumulate.
- `adaptive_thresholds` profile gains evidence (if `updateGenericLearning` or any consumer writes to it).

### Outside the scope of this repair

- Path A becoming operational does not change investigation creation rate, synopsis population rate, or `next_review_at` population rate (per the 2026-05-30 sequencing decision memo — the causal chain from gate-adaptation to editor-engagement is speculative).
- Path A does not affect any C.4 §11 measurement (Q1–Q5).
- Path A does not affect Path B in any direction.

---

## §10 — Success criteria

### Capability (provable within hours of deploy)

| # | Criterion | Method | Pass |
|---|---|---|---|
| S1 | `learning_profiles` row count > 0 | SQL count | within 1 hour of first post-deploy feedback event |
| S2 | Inserts are tenant-scoped | SELECT samples | every row has non-null `tenant_id` matching the feedback's parent object |
| S3 | Consumer reads return tenant-scoped results | Aegis Flight Recorder trace inspection on a real ingest | scorer read returns only `currentTenantId` rows |
| S4 | Watchdog stale-learning alarm clears | Watchdog check | GREEN within hours |
| S5 | No HTTP 500 spike on process-feedback | Edge function logs | error rate baseline-flat |

### Behavioral (observable over 7-day window)

| # | Criterion | Method | Pass |
|---|---|---|---|
| B1 | Per-tenant signal admission rate stays within bounds | Daily SQL on `signals.relevance_score` distribution per tenant | no excursion outside floor (0.25) or ceiling (0.55) |
| B2 | No cross-tenant pattern bleed | Aegis Flight Recorder sample audit | retrieval traces show correct tenant scope every time |
| B3 | `learning_profiles` row growth aligns with feedback volume | SQL ratio: new profiles / feedback_events in same window | growth rate consistent across tenants with similar feedback rates |
| B4 | No regression in Path B | `self_improvement_log` rows continue at baseline rate | rate consistent with pre-deploy baseline |

### Long-horizon (weeks 2–4)

| # | Criterion | Method | Pass |
|---|---|---|---|
| L1 | False-positive rate decline for engaged tenants | Compare per-tenant rejection-rate trend pre/post | downward trend for tenants with non-zero feedback volume |
| L2 | Per-source credibility profiles populated | SQL: `SELECT profile_type FROM learning_profiles WHERE profile_type LIKE 'source:%'` | non-empty per tenant with diverse signal sources |
| L3 | Per-category rejection profiles populated | Same with `category:%` | non-empty |

**Failure modes** (any of which warrants rollback or per-tenant surgery):

- F-CAPABILITY: zero rows after 24h with active feedback → writer or consumer fix didn't deploy cleanly.
- F-LEAK: Flight Recorder traces show cross-tenant rows in a scorer read → consumer fix incomplete; immediate rollback.
- F-EXCURSION: per-tenant admission rate hits 0 or 100 → over-tightening or over-loosening; per-tenant DELETE + investigate.
- F-CRASH: process-feedback HTTP 500 rate climbs → write-path bug; immediate rollback.
- F-PATH-B-REGRESSION: `self_improvement_log` rate drops → unexpected coupling; investigate before continuing.

---

## §11 — Risk analysis

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Cross-tenant pattern bleed during a writer-first window | MEDIUM if not bundled / ZERO if bundled | HIGH (CQ1 violation) | **Bundled deploy** (writer + consumer in one PR / one Cloudflare release) |
| R2 | Other writers (`aggregate-implicit-feedback`, `aggregate-global-learnings`, `agent-self-learning`) have same tenant_id-omission defect | LOW–MEDIUM (likely some do) | MEDIUM | **Pre-flight P3 audit**; expand the writer fix to cover all sites in the same PR, OR explicitly carve them out with separate backlog items |
| R3 | Relevance gate over-tightens for negative-feedback-heavy tenant | LOW–MEDIUM | MEDIUM | Schema floor/ceiling (0.25–0.55) caps excursion; B1 7-day observation; per-tenant DELETE surgery available |
| R4 | Operator confusion about signal-volume shift | MEDIUM | LOW | Deploy notes explicitly call out expected per-tenant shift; signal-volume telemetry watched |
| R5 | `propagateCrossDomainLearning` routing ambiguity | **RESOLVED 2026-05-30** | — | Option α chosen (§3 W4). Cross-domain category-relatedness becomes per-tenant; follow-on backlog note records future β migration when `agent_tradecraft` schema fit is verified. |
| R6 | Silent re-introduction of same defect class via the error-swallowing try/catch in `upsertLearningProfile` | **RESOLVED 2026-05-30 (W5a in scope)** | — | W5a hardening in scope: loud `console.error` on every write failure with full context. Defect class becomes discoverable in edge function logs within hours, not 30 days. No throw, no API shape change, no Path B coupling. |
| R7 | Consumer fan-out incomplete; one reader misses tenant filter and reads cross-tenant rows | MEDIUM | HIGH | Pre-flight P4 catalogs every site; verified by Flight Recorder trace audit during functional tests (F3, F4) |
| R8 | Watchdog stale-learning alarm logic still global; once data exists for some tenants but not others, alarm becomes misleading | MEDIUM | LOW | Flag for separate watchdog-tuning follow-on; not gating |
| R9 | Repair shipped during C.4 adoption window confounds adoption measurement | **REFUTED** (sequencing memo 2026-05-30) | — | Confounding argument shown speculative; no §11 metric structurally affected |
| R10 | The 35 archived rows in `learning_profiles_phase1_snapshot` get accidentally promoted to live `learning_profiles` | LOW | MEDIUM | Pre-flight P2 confirms snapshot is read-only archive; no promotion path exists in this repair |

**R1 is load-bearing.** Bundled deploy is non-negotiable. Writer-first sequencing introduces a real CQ1 violation window. The minimum-safe repair is the bundled repair, not the smallest-LOC repair.

---

## §12 — Recommended deployment sequencing

### Phase 0 — Pre-flight (before PR is opened)

1. P1-P6 pre-flight tests (§6) run against staging + prod. P3 + P4 audits catalog every writer and reader with a verdict.
2. ~~Operator picks Option α vs β for `propagateCrossDomainLearning` (§3 W4).~~ **RESOLVED 2026-05-30 = Option α.**
3. Operator picks scope based on P3 audit findings: this repair only, OR this repair plus same-class fixes to `aggregate-implicit-feedback` / `aggregate-global-learnings` / `agent-self-learning` if the pre-flight reveals they have the same defect. **CONDITIONAL on P3 audit outcome.**
4. ~~Operator picks whether to ship §3 W5 (error-handling hardening) inside or after this repair.~~ **RESOLVED 2026-05-30 = W5a in scope.**

### Phase 1 — Implementation

Single PR on a branch `feat/feedback-loop-restoration-path-a` (or similar). Contents:
- Writer changes (process-feedback/index.ts)
- Consumer changes (signal-relevance-scorer + ingest-signal + secondary consumers in same PR)
- Optionally W5 error-handling hardening if scoped in
- Unit tests covering the helper signature + tenant scoping
- Functional test fixture (two-tenant synthetic isolation roundtrip)

### Phase 2 — Build + CI

`npm run build` · unit tests · ESLint · DB Types Drift check · cop-timeline-writer-discipline (unaffected) · Workstream D suites (unaffected). All must pass.

### Phase 3 — Staging deploy + validation

1. Deploy edge functions to staging.
2. Cloudflare Pages staging preview deploys automatically.
3. Run F1–F7 functional tests on staging.
4. 24-hour staging observation:
   - learning_profiles row growth
   - Signal admission rate per tenant
   - No HTTP 500 spike on process-feedback
   - Watchdog clears

### Phase 4 — Prod deploy + observation

1. Deploy edge functions to prod (parity-exact with staging).
2. Verify Cloudflare Pages prod deploy serves new bundle.
3. Run W1 (watchdog clears) within hours.
4. 7-day prod observation (O1–O5).

### Phase 5 — Post-observation acceptance

Validation report (same shape as C.0–C.4):
- Capability section: S1–S5 results
- Behavioral section: B1–B4 results over 7 days
- Long-horizon: L1–L3 will trail by weeks; report at 4-week mark
- Failure modes: any F-* hit, with disposition

### Phase 6 — Long-horizon report

4-week mark: per-tenant false-positive rate trend, per-source credibility population, per-category rejection profile coverage. Inform the operator's prioritization of follow-on hardening (W5, R8, R6).

---

## §13 — Why this is classified as a B-class workstream

A — Small contained repair: writer-only line change, single file, no consumer scoping, no audit pass. Carries R1 (cross-tenant leak). Not safe.

B — Moderate workstream: writer + consumer bundled, pre-flight audit of other writers, two-tenant functional test, 7-day post-deploy observation, optional W5 hardening. Safe minimum.

C — Architectural change: would require schema rework (e.g., splitting learning_profiles by scope, adding a separate tradecraft store, rewriting the writer chain). Not needed; current schema is correct.

This repair is firmly **B** because:

1. Single primary code surface but consumer fan-out is real (~5–8 sites need tenant_id filter audit; 2 critical-path consumers MUST be in scope).
2. Pre-flight cross-writer audit (R2) catches sibling defects in the same class — out of scope for an A-class repair, in scope for B.
3. Bundled deploy is non-negotiable (R1) — forces single-PR / single-release discipline, not a hotfix shape.
4. Behavioral observation window (B1–B4, O1–O5) over 7 days — A-class repairs ship-and-forget.
5. Behavior change is observable in prod (signal admission rate per tenant shifts) — requires explicit operator awareness even though no schema or migration is touched.

---

## §14 — Explicit answers to operator-stated questions

| Q | A |
|---|---|
| Schema changes required? | **None.** `tenant_id NOT NULL`, `UNIQUE (tenant_id, profile_type)`, FK to `tenants`, named RLS policies — all already in place. The repair is purely application-layer. |
| Backfill required? | **None.** Forward-only is acceptable. The 35-row `learning_profiles_phase1_snapshot` archive predates the `tenant_id` column and is not advisable to restore. |
| Path B affected? | **No.** `apply-feedback-to-agent` writes to `agent_configs.system_prompt` and `self_improvement_log`. Independent surfaces. Path A repair does not touch Path B code or data. Both paths coexist after the repair. |
| Tenant-isolation risks remaining after remediation? | **None at steady state, conditional on R1 mitigation.** Schema invariants bind (`tenant_id NOT NULL` + named CHECK + RLS + UNIQUE). Writer supplies `tenant_id` from trigger-derived source. Consumers filter on `tenant_id`. Provenance chain end-to-end. The only residual is R7 (consumer fan-out incomplete) — mitigated by the §6 P4 audit catalog. R1 (writer-first window) is eliminated by bundled deploy, not residual. |

---

## §15 — Held (out of scope)

- Schema modifications. None proposed.
- Migrations. None drafted.
- Path B modification.
- Watchdog logic rewrite (R8 flagged separately).
- Error-handling shape rewrite (W5 flagged separately; can be in-scope by operator choice).
- INC-LEARN-CONTAM containment lift on `expert_knowledge`, `global_learning_insights`, `agent_beliefs`. Those remain frozen per their own incident track.
- Cross-domain tradecraft routing redesign beyond the Option α / β decision.
- Front-end UI changes on signal-feedback surfaces (`SignalFalsePositiveButton`, etc.). Only audit-pass scope.
- C.4 adoption-analysis impact (refuted by sequencing memo).
- R1.1 / Decision Layer detector work. Locked behind §11 inventory re-run.
- Report Generator Standardization.

---

## §16 — Sign-off block (operator GO / NO-GO, item-by-item)

Following the C.0–C.4 pattern. Operator review of each item; GO / NO-GO / NOTES on each.

| Item | Question | Expected sign-off shape |
|---|---|---|
| §16.1 | Approve §1 plain-English objective and the framing that this restores statistical learning without touching Path B | "Approved" or amendment |
| §16.2 | Approve §2 file-and-table inventory as the full scope of touched surfaces | "Approved" or expand/shrink |
| §16.3 | Approve §3 writer changes (W1, W2, W3) **+ acknowledge W4 = Option α and W5 = W5a-shape (in scope)** decisions of 2026-05-30 | "Acknowledged" |
| §16.4 | Approve §4 consumer changes (C1, C2 critical-path; C3 secondary-consumer audit; C4 watchdog flag) | "Approved" or amend |
| §16.5 | Approve §5 tenant-isolation framing (repair strengthens, no new RLS / triggers / CHECK) | "Approved" |
| §16.6 | Approve §6 pre-flight + functional + post-deploy verification plan | "Approved" or amend |
| §16.7 | Approve §7 rollback plan (PR revert; data forward-only; per-tenant DELETE as granular surgery) | "Approved" |
| §16.8 | Approve §8 blast radius assessment | "Approved" |
| §16.9 | Approve §9 expected behavioral impact (per-tenant signal admission may shift; no §11 metric coupling) | "Approved" |
| §16.10 | Approve §10 success criteria (S1–S5 capability; B1–B4 behavioral; L1–L3 long-horizon) | "Approved" or tighten |
| §16.11 | Approve §11 risk analysis and R1 bundled-deploy mitigation as non-negotiable | "Approved" |
| §16.12 | Approve §12 deployment sequencing (staging-first, 24h staging soak, prod parity-exact, 7-day prod observation, 4-week long-horizon report) | "Approved" or amend |
| §16.13 | Acknowledge §13 B-class classification | "Acknowledged" |
| §16.14 | Acknowledge §14 explicit answers (no schema, no backfill, no Path B impact, no residual isolation risk at steady state) | "Acknowledged" |
| §16.15 | Acknowledge §15 held items remain unauthorized | "Acknowledged" |
| §16.16 | **AUTHORIZE EXECUTION** — explicit GO for Phase 1 implementation per §12 sequencing | This is the load-bearing GO. Without it, this package remains an operator-review document. |

---

## §17 — What this package is NOT

- Not an implementation plan ready to execute autonomously. **W4 and W5 are now decided; §16.16 GO authorization is the only remaining operator step before Phase 0 begins.**
- Not a PR or branch. No code committed, no migration drafted.
- Not authorization for any other backlog item (Report Generator Standardization, R1.1, detector work, watchdog rewrite, INC-LEARN-CONTAM lift).
- Not a deferral of C.4 adoption observation. Adoption window continues independently.

## §17a — Revision history

- **2026-05-30 v1** — Initial package draft. W4 and W5 left as operator design decisions.
- **2026-05-30 v2** — Operator decisions recorded: W4 = Option α (tenant-scoped, with follow-on backlog note for eventual β migration to `agent_tradecraft`); W5 = in scope, constrained to W5a shape (loud `console.error` without throw, no API change, Path B preserved). R5 and R6 marked RESOLVED. §16.3 sign-off shape simplified to "Acknowledge." Pre-flight Phase 0 design-decision steps struck through. §16.16 (AUTHORIZE EXECUTION) remains the only load-bearing operator decision.

---

## §18 — Related references

- Detection Health Assessment 2026-05-30 — BLUF identifying Path A as P1
- Path A causal map 2026-05-30 — exact break point + the team's 2026-04-30 audit
- Path A remediation assessment 2026-05-30 — blast radius, complexity, risk, expected outcome, A/B/C classification
- Sequencing decision memo 2026-05-30 — confounding-risk refutation
- Backlog item `docs/platform-operations/backlog/feedback-loop-restoration-path-a.md` — context-preservation entry
- Provenance Doctrine 2026-05-26 — `tenant_id NOT NULL` + CHECK backstop pattern
- Aegis Authority & Memory Doctrine 2026-05-27 — CQ1 strictness; service-role-untrusted-by-default

🤖 Generated with [Claude Code](https://claude.com/claude-code)
