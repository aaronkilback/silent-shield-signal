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

### Staging (after Phase A)
- **S1 — schema:** `surface_date` column + `idx_signals_effective_recency` present (already true).
- **S2 — writer:** trigger one monitor run (or `ingest-signal` test call); confirm a freshly-ingested
  signal with a real upstream pubDate has `surface_date` populated, and one without leaves it `NULL`
  (never defaulted to `now()`).
- **S3 — Aegis tool smoke:** `node scripts/test-aegis-tools.mjs` → green. Spot-check that
  `get_recent_signals` / entity-context results include a `temporal_bucket` field.
- **S4 — entity-context (canonical):** query Aegis about an entity with a known old signal; confirm
  the response carries the bucket and does not narrate an old event as current.
- **S5 — frontend build:** `npm run build` exits 0.

### Production checkpoints (gates between phases)
- **C1 (post-migration):** column + index exist; **old (still-live) functions remain healthy** — run
  `node scripts/test-aegis-tools.mjs` and confirm no "column does not exist" errors. Adding a nullable
  column must not perturb current behavior. If C1 fails → §3 rollback (drop column).
- **C2 (post ingest-signal):** ingest a real signal; confirm `surface_date` populates from genuine
  pubDate only; confirm signal-pipeline health (`get_logs` shows no insert failures).
- **C3 (post all functions):** run the **§5 production verification checklist**.
- **C4 (post frontend):** load the live feed; confirm temporal badges render (see §5).

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

Backend (run after the 11 functions are live):
- [ ] `node scripts/test-aegis-tools.mjs` → all green (no "column does not exist", no 401 inter-function auth regressions).
- [ ] **Canonical:** ask Aegis (CRT tenant `0aaaaaaa`) about **BC Place** → response frames the
      2022-10-14 signal as **historical / resurfaced**, NOT current. (This is the campaign's acceptance oracle.)
- [ ] Entity-context tool output includes `temporal_bucket` / `temporal_caption` on returned signals.
- [ ] Daily briefing for a real client renders the 3 temporal groups; no resurfaced item under "current."
- [ ] A genuinely-recent signal still reads as **Current** (no over-correction).
- [ ] `get_logs` (prod) clean for ingest-signal + ai-tools-query + dashboard-ai-assistant (no insert/select errors).
- [ ] `verify_jwt` unchanged: the 8 `false` functions still authenticate inter-function calls
      (a passing `test-aegis-tools.mjs` confirms the dashboard→ai-tools-query path).

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
