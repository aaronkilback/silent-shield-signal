# Deployment Runbook — Temporal Integrity

**Change:** Per-item temporal classification (Current / Timing-Unknown / Historical-Resurfaced)
across all signal-retrieval paths + Aegis narration + CRT-facing UI.
**Branch:** `feat/er-v1-slice2-comparison` · **Commits:** `cda04b72` → `e346ad19` (8 commits).
**Objective:** Safe deployment only. No new functionality. Upcoming/scheduled classification
refinement is explicitly OUT OF SCOPE here (see Follow-ups).

**Projects:** prod `kpuqukppbmwebiptqmog` · staging `lkvyrvuakzguszbpwnfz`.

---

## 0. Pre-flight facts (verified 2026-06-03, read-only)

- **Prod:** `signals.surface_date` column **ABSENT**, `idx_signals_effective_recency` **ABSENT** → migration required.
- **Staging:** column + index **PRESENT** (migration `20260602140000` already applied); 0 rows populated (expected — forward-only).
- The column is **additive + nullable** → adding it does **not** break the currently-deployed (old) code, which never references it.
- **Hard ordering constraint:** every NEW function both **SELECTs** `surface_date` and (ingest-signal) **INSERTs** it. Without the column, PostgREST returns *"column does not exist"* → the migration MUST land **before** any new function code runs.

### Deploy surface — 11 edge functions + 1 migration + frontend

Supabase inlines `_shared/*` into each function at deploy time, so **every consumer of a changed
shared module must be redeployed**. Transitive closure (incl. side-effect + dynamic `await import`)
of the 6 changed shared modules + `ingest-signal`:

| # | Function | Why it's in scope | `verify_jwt` (config.toml) |
|---|---|---|---|
| 1 | `ingest-signal` | **writer** — persists `surface_date`; selects temporal cols | `false` |
| 2 | `ai-tools-query` | entity/recent/related/IOC/query_fortress_data buckets | `false` |
| 3 | `generate-daily-briefing` | 3-group temporal partition + discipline header | `false` |
| 4 | `dashboard-ai-assistant` | COP + handlers + Aegis prompt discipline | `false` |
| 5 | `agent-chat` | COP injection (temporal-tagged) | `false` |
| 6 | `aegis-chat` | agent-tools-core (entity search buckets) | **default `true`** |
| 7 | `respond-as-agent` | agent-tools-core (side-effect import) | **default `true`** |
| 8 | `review-signal-agent` | agent-tools-core (dynamic import) | `false` |
| 9 | `ai-decision-engine` | agent-tools-core (dynamic import) | `false` |
| 10 | `wildfire-portal-chat` | agent-tools-core | `false` |
| 11 | `aegis-entity-parity-probe` | entity-parity-probe → tenant-entity-graph | **default `true`** |

**NOT in scope (false positives):** `wraith-security-advisor`, `wraith-snapshot-codebase` reference
`handlers-signals-incidents.ts` only as a **string path** in file lists — no import, no bundle, no redeploy.

> **verify_jwt caution (CLAUDE.md):** the Management API / MCP `deploy_edge_function` **resets
> verify_jwt to true**, which breaks inter-function `sb_secret_*` auth on the 8 functions that must
> stay `false`. **Deploy via the Supabase CLI** (`supabase functions deploy`), which reads
> `config.toml` and preserves each function's setting. If MCP deploy is unavoidable, pass
> `metadata.verify_jwt=false` explicitly for the 8 `false` functions above.

---

## 1. Exact deployment sequence

Deploy to **staging first**, validate (§2), then **prod**. Backend and frontend ship together so
Aegis and the UI never disagree (no "Aegis says historical / UI implies current" split-brain).

### Phase A — Staging (rehearsal + validation)

```bash
# A1. Confirm on the deploy commit
git -C /Users/aaronkilback/code/silent-shield-signal checkout feat/er-v1-slice2-comparison
git rev-parse HEAD   # expect e346ad19 (or later if fast-forwarded)

# A2. Migration — already applied on staging; confirm only (no-op if present)
#     (skip db push if §0 shows column present)

# A3. Deploy the 11 functions to staging (CLI preserves verify_jwt from config.toml)
for fn in ingest-signal ai-tools-query generate-daily-briefing dashboard-ai-assistant \
          agent-chat aegis-chat respond-as-agent review-signal-agent ai-decision-engine \
          wildfire-portal-chat aegis-entity-parity-probe; do
  supabase functions deploy "$fn" --project-ref lkvyrvuakzguszbpwnfz
done

# A4. Build the frontend (catches esbuild/TS issues before any prod push)
npm run build
```

Then run **§2 staging validation**. Do not proceed to prod until all staging checkpoints pass.

### Phase B — Production

```bash
# B1. APPLY MIGRATION FIRST (additive, reversible). Either:
supabase db push --project-ref kpuqukppbmwebiptqmog
#   …or apply only 20260602140000_temporal_integrity_surface_date_column.sql.
#   >>> CHECKPOINT C1 before continuing <<<

# B2. Deploy the WRITER first, verify it before the readers
supabase functions deploy ingest-signal --project-ref kpuqukppbmwebiptqmog
#   >>> CHECKPOINT C2 <<<

# B3. Deploy the remaining 10 functions
for fn in ai-tools-query generate-daily-briefing dashboard-ai-assistant agent-chat \
          aegis-chat respond-as-agent review-signal-agent ai-decision-engine \
          wildfire-portal-chat aegis-entity-parity-probe; do
  supabase functions deploy "$fn" --project-ref kpuqukppbmwebiptqmog
done
#   >>> CHECKPOINT C3 <<<

# B4. Frontend — promote src/** to main per standard flow (build already passed in A4),
#     push → Cloudflare CI builds & publishes.
#   >>> CHECKPOINT C4 <<<
```

---

## 2. Validation checkpoints

### Staging (after Phase A) — EXECUTED 2026-06-03; see §7 for the full record
- **S1 — schema:** ✅ PASS — staging `surface_date` column + `idx_signals_effective_recency` present.
- **S2 — writer:** ⏸ DEFERRED to prod **C2** — staging had 0 ingestion post-deploy (idle dataset), so
  `surface_date` population could not be exercised without inserting data (declined by directive).
- **S3 — deployment integrity (non-invasive):** ✅ PASS — the *deployed* staging bundles were inspected
  via `get_edge_function`: `ai-tools-query` v25, `dashboard-ai-assistant` v85, `ingest-signal` v44 all
  contain the reviewed temporal code (`temporal-recency.ts`, `temporal-grounding.ts`, entity-graph
  `tagEntitySignals`, COP tagging, `AEGIS_TEMPORAL_DISCIPLINE`, `surface_date` writer); `verify_jwt=false`
  preserved on all. The deployed artifact IS the reviewed code.
- **S3b — runtime health:** ✅ PASS — `search_entities` + `get_active_incidents` return real staging
  data (service-role reads work, functions execute, HTTP 200, no temporal errors).
- **S4 — helper logic:** ✅ PASS — committed helper run over all 78 staging rows → 78/78 `timing_unknown`
  (every row has NULL / cosmetic-midnight / copied event_date; G-9 grounding correctly demotes them);
  synthetic grounded rows → `historical`/`current`. Logic is correct; the all-timing-unknown result is a
  staging-**data** property.
- **S5 — positive bucket observation:** ⏸ **NOT OBSERVABLE on staging → deferred to prod C3** (authoritative
  gate). Staging has no in-window/grounded/BC-Place data, and the schema-safe signal tools either window-out
  (`get_recent_signals`, 24h) or are blocked by a **pre-existing** column defect (`search_signals` selects
  non-existent `source`; `get_related_signals` selects non-existent `correlated_entity_ids` — absent on
  prod too, see §6 F-TEMPORAL-3). Not a Temporal-Integrity issue.
- **S6 — frontend build:** ✅ PASS — `npm run build` exits 0.

### Production checkpoints (gates between phases)
- **C1 (post-migration):** column + index exist; **old (still-live) functions remain healthy** — run
  `node scripts/test-aegis-tools.mjs` and confirm no "column does not exist" errors. Adding a nullable
  column must not perturb current behavior. If C1 fails → §3 rollback (drop column).
- **C2 (post ingest-signal):** ingest a real signal; confirm `surface_date` populates from genuine
  pubDate only; confirm signal-pipeline health (`get_logs` shows no insert failures).
- **C3 (post all functions) — AUTHORITATIVE POSITIVE-OBSERVATION GATE.** Staging could not produce a
  positive bucket observation (idle/synthetic data + pre-existing tool defects), so by operator decision
  (2026-06-03) **C3 on real production data is the gate that proves the runtime emits correct buckets.**
  C3 is **blocking**: frontend promotion (C4) does not proceed until all four checks below pass. Run the
  **§5 production verification checklist**, which MUST explicitly verify:
  1. a **real current** signal classifies **Current**,
  2. the **real BC Place 2022** signal (`8fe0704f`) classifies **Historical / Resurfaced**,
  3. a **real timing-unknown** signal classifies **Timing Unknown**,
  4. **Aegis entity-context retrieval honors those classifications** (does not narrate the 2022 signal as current).
- **C4 (post frontend):** load the live feed; confirm temporal badges render (see §5). **After C3+C4,
  execute the full trust-validation package:** `temporal-integrity-post-deploy-validation-2026-06-03.md`
  (Aegis / CRT / Petronas / regression — proves Fortress tells time correctly; any FAIL → §3 rollback).

---

## 3. Rollback procedure

Rollback is **reverse order**. The column is harmless to old code, so the default rollback is
**code-only** — leave the column in place.

### 3a. Function rollback (primary, fast)
Redeploy the prior-version functions from the last pre-temporal commit:
```bash
git checkout cda04b72~1 -- supabase/functions   # pre-temporal function code
# redeploy the same 11 functions to the affected project (prod or staging)
for fn in ingest-signal ai-tools-query generate-daily-briefing dashboard-ai-assistant \
          agent-chat aegis-chat respond-as-agent review-signal-agent ai-decision-engine \
          wildfire-portal-chat aegis-entity-parity-probe; do
  supabase functions deploy "$fn" --project-ref <ref>
done
git checkout HEAD -- supabase/functions          # restore working tree
```
Old code does not reference `surface_date`; the lingering column/index are inert. **Stop here** in
most cases — the system returns to pre-temporal behavior.

### 3b. Frontend rollback
Revert the `src/**` temporal commits (`SignalAgeBadge`, `LiveEventFeed`, `SignalHistory`,
`SignalDetailSheet`, `src/lib/temporal-recency.ts`), `npm run build`, push → CI republishes.

### 3c. Schema rollback (ONLY for a full clean revert — do 3a first)
The new code SELECTs `surface_date`; dropping the column while new code is live breaks it. So:
**revert functions (3a) BEFORE dropping the column.** Then:
```sql
DROP INDEX IF EXISTS public.idx_signals_effective_recency;
ALTER TABLE public.signals DROP COLUMN IF EXISTS surface_date;
```
Any `surface_date` values written by ingest-signal are lost on drop — acceptable (forward-derivable;
never substituted for event/created time).

---

## 4. Expected before / after behavior

| Surface | BEFORE | AFTER |
|---|---|---|
| **Recency basis** | `created_at` (ingestion) treated as "recent" | `surface_date` → grounded `event_date`; `created_at` never event time |
| **NULL event_date** | rendered/treated as **Current** (the masquerade) | **Timing Unknown** — visible, labeled, never current |
| **BC Place 2022 (`8fe0704f`)** | narrated as current; UI badge "current" | **Historical / Resurfaced — event 2022-10-14** on every path |
| **Re-ingested old signal** | appears in "this week" | labeled Historical/Resurfaced; excluded from "current" |
| **Aegis narration** | could assert recency w/o event grounding | bound by `AEGIS_TEMPORAL_DISCIPLINE`; only `current` may be called recent |
| **Daily briefing** | flat "RAW SIGNALS (24h)" | 3 groups: Current / Timing-Unknown / Historical-Resurfaced |
| **COP (every Aegis prompt)** | "CRITICAL/HIGH (24h)" by ingestion | per-line bucket tag + do-not-narrate-as-current note |
| **UI signal feed / detail** | `SignalAgeBadge` NULL→Current | bucket-driven badge; undated → "Timing Unknown" |
| **Future-dated (FIFA WC 2026)** | shown as **Current** | **Timing-Unknown** bucket w/ honest "Upcoming/scheduled" caption¹ |
| **Genuinely recent signal** | Current | **Current (unchanged)** |
| **Volume / deletion** | — | **0 signals deleted**; re-labeled + re-prioritized only |

¹ Upcoming caption shipped with the campaign; its promotion to a first-class bucket is a **separate follow-up** (§6), not part of this deployment.

---

## 5. Production verification checklist (run at C3 / C4)

> **C3 is the authoritative positive-observation gate** (staging could not produce it — §7). It is
> **blocking**: do not promote the frontend (C4) until all four positive-observation checks pass.
>
> **Tool caveat (false-negative trap):** do **NOT** use `search_signals` or `get_related_signals` to
> observe buckets — they select columns absent on prod (`source`, `correlated_entity_ids`) and return
> empty regardless (§6 F-TEMPORAL-3). Use `get_recent_signals` (24h, schema-safe) and the real Aegis
> entity-context path (`dashboard-ai-assistant` → `tenant-entity-graph`, which uses the correct
> `auto_correlated_entities`).

**C3 — the four mandatory positive observations (BLOCKING):**
- [ ] **(1) Real current → Current.** Pick a prod signal with a grounded `event_date` within 7 days
      (e.g. a current FIFA/operational item). Via the live runtime (`get_recent_signals` or Aegis),
      confirm it carries `temporal_bucket:"current"`.
- [ ] **(2) Real BC Place 2022 → Historical / Resurfaced.** Signal `8fe0704f` (event 2022-10-14,
      tenant `0aaaaaaa`). Via the entity-context path, confirm `temporal_bucket:"historical"` /
      caption "Historical / Resurfaced — event 2022-10-14". *(Campaign acceptance oracle.)*
- [ ] **(3) Real timing-unknown → Timing Unknown.** A prod signal with NULL/ungrounded `event_date`
      confirms `temporal_bucket:"timing_unknown"` ("event date not established").
- [ ] **(4) Aegis entity-context honors the classifications.** Ask Aegis (CRT tenant `0aaaaaaa`) about
      **BC Place**; the response must frame the 2022-10-14 signal as historical/resurfaced and must
      **not** narrate it as current — while genuinely-recent items remain current.

**C3 — supporting checks:**
- [ ] `node scripts/test-aegis-tools.mjs` (harness targets prod by design) — pass rate ≥ the pre-deploy
      baseline; **no new** failures, and specifically no "column does not exist" for `surface_date`/
      `event_date`/`temporal_grounding`. *(Pre-existing harness failures are out of scope — compare to baseline.)*
- [ ] Daily briefing for a real client renders the 3 temporal groups; no resurfaced item under "current."
- [ ] `get_logs` (prod) clean for ingest-signal + ai-tools-query + dashboard-ai-assistant (no insert/select errors).
- [ ] `verify_jwt` unchanged: the 8 `false` functions still authenticate inter-function calls.

Frontend (after C4):
- [ ] Live Event Feed: the BC Place 2022 signal shows a **Historical / Resurfaced** banner/badge.
- [ ] A NULL-event signal shows **Timing Unknown** (not a bare ingestion "X ago").
- [ ] A future-dated FIFA WC 2026 signal shows **Upcoming / Scheduled** (blue), not "Current."
- [ ] A current signal shows the **Current** badge.
- [ ] Signal Detail sheet "Event Timeline" renders for an undated signal (Timing Unknown), not a bare "Discovered" line.

---

## 6. Follow-ups (recorded, NOT in this deployment)

- **F-TEMPORAL-1 — "Upcoming / Scheduled" first-class bucket.** Future-dated grounded events
  currently live inside `timing_unknown` with an honest "Upcoming/scheduled" caption. Decision
  pending on whether to promote Upcoming to a distinct bucket (4-bucket taxonomy) with its own
  filter/sort/UI treatment. **Out of scope for this deployment by directive.**
- **F-TEMPORAL-2 — surface_date backfill.** Forward-only today (monitors populate going forward).
  Historical backfill is net-~0 from existing `raw_json` and is a separate monitor-capture workstream.
- **F-TEMPORAL-3 — pre-existing broken-column Aegis tools (discovered 2026-06-03, NOT introduced here).**
  `ai-tools-query.search_signals` selects a non-existent `source` column; `get_related_signals` and
  `get_entity_summary_for_signal` select a non-existent `correlated_entity_ids` column. Confirmed absent
  on **both** staging and prod `signals` (`information_schema`), and present in the selects **before** the
  Temporal-Integrity change. PostgREST 400s, the error is swallowed, the tools return `{"result":[]}`.
  Consequence: these tools have returned empty in production all along, and their temporal tagging is inert
  until the column names are corrected (likely `source_url`/`auto_correlated_entities`). **Do not fix as part
  of this deployment.** The certified entity-context seam (`tenant-entity-graph.ts`) is unaffected (uses
  `auto_correlated_entities`).

---

## 7. Staging Validation Record & Decision Package (2026-06-03)

### 7.1 Smoke run on 2026-06-03T12:23Z was INVALID as a staging gate
`scripts/test-aegis-tools.mjs` hardcodes the **production** URL/key (no env override), so the `26 passed /
60 failed` result was produced against **prod running the OLD code** — Temporal-Integrity was not in the
execution path. Attribution: **0 of 60 failures are Temporal-Integrity regressions** (would-still-occur-if-
reverted = all 60); 59 are an opaque harness `"error"` (prod tool_test executor, no tenant context), 1 is an
expected `TENANT_CONTEXT_MISSING`. No `surface_date`/`verify_jwt`/import/`column does not exist` signatures.

### 7.2 What staging validation PASSED (read-only, no test data inserted)
| Evidence | Result |
|---|---|
| Schema (column + index) | ✅ present on staging |
| Helper logic over all 78 staging rows | ✅ 78/78 `timing_unknown`; G-9 correctly demotes 60 cosmetic/copied + 18 NULL |
| Helper on synthetic grounded rows | ✅ → `historical` (BC-2022 analog) / `current` |
| Runtime health | ✅ `search_entities` + `get_active_incidents` return real data; HTTP 200 |
| **Deployment integrity** (deployed bundle inspection) | ✅ `ai-tools-query` v25, `dashboard-ai-assistant` v85, `ingest-signal` v44 contain the reviewed temporal code (helper, grounding, entity-graph tagging, COP, `AEGIS_TEMPORAL_DISCIPLINE`, `surface_date` writer); `verify_jwt=false` preserved |
| No temporal-attributable errors | ✅ none observed |

### 7.3 What staging could NOT validate (and why — none are code faults)
- **Positive bucket value on a live signal payload** — staging has no in-window/grounded/BC-Place data;
  schema-safe `get_recent_signals` windows out (24h); `search_signals`/`get_related_signals` blocked by the
  F-TEMPORAL-3 column defect; the only data-bearing alternative (`query_fortress_data`) writes an audit row
  (excluded by the no-state-change directive). **Deferred to prod C3.**
- **Writer (`surface_date` population)** — staging idle (0 ingestion post-deploy). **Deferred to prod C2.**

### 7.4 Residual risk going into production (bounded)
| # | Residual | Severity | Covered by |
|---|---|---|---|
| R1 | Runtime join (query → `annotateTemporal` → payload) never positively observed pre-prod | **Low** — code verified present in deployed bundle; helper deterministic incl. real BC Place row; functions proven live | **C3** (blocking, real data) |
| R2 | `surface_date` writer never exercised post-deploy | **Low** — code present; logic reviewed; column nullable | **C2** |
| R3 | search_signals / get_related_signals emit no buckets (F-TEMPORAL-3) | **Low** — pre-existing, not a regression; certified entity seam unaffected | follow-up, not this deploy |
| R4 | Prod data composition differs from validated set | **Low** — prod has in-window + grounded + the real BC Place row, enabling full C3 | **C3** |

### 7.5 Decision package — recommendation
- Temporal-Integrity is **exonerated of regressions** and **proven deployed-as-reviewed** on staging.
- Everything verifiable without inserting synthetic data has been verified and **passes**.
- The single un-observed item (positive bucket value) is **bounded Low** and is, by operator decision,
  owned by the **blocking C3 positive-observation gate on real prod data**.
- **Recommendation:** proceed to production execution **when authorized**, treating C3 (§5, four mandatory
  checks) as the hard gate before frontend promotion (C4). Production gate remains **CLOSED** until that
  authorization is given.
