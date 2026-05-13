# CRT Stabilization Plan — 2026-05-13

**Source audit:** `docs/pre-crt-audit-2026-05-13.md` (21 findings, 9 BLOCKERS)
**Demo date:** 2026-05-14 (tomorrow)
**Onboarding window:** Between demo and CRT user provisioning — exact date TBD with Calvin/Vince
**Owner:** Aaron Kilback (operator) + Claude as co-author

## Operating rules during this plan

1. **One finding per branch.** No bundled commits. Each step is independently revertible.
2. **Benchmark before + after each step.** F-012 must land first so this rule has teeth. After F-012, every step in this plan ends with a "benchmark must stay ≥ previous green" check. If a step drops decision accuracy >5%, the deploy gets reverted, not iterated on top of.
3. **No fixes during a Phase's verification window.** When a Phase ships, wait 24h of cron cycles before starting the next Phase. Watch Monitor Health.
4. **Never deploy on a Friday afternoon** when CRT users could be active.
5. **The Phase 3 RLS rewrite happens on a Saturday morning** with at least one test tenant logged in to verify isolation.

---

## Pre-demo (today → 2026-05-14)

**Goal:** Do nothing structural. Demo against the state we have. Prepare a verified-clean demo path.

### Pre-demo checklist

| Task | Why | Estimated time |
|---|---|---|
| Verify all deploys from today's session have landed (commits `3e008938` through `b2719116`) | Don't demo with mid-flight code | 15m — check GH Actions |
| Pre-run the benchmark, confirm decision accuracy ≥ today's 51% | Don't get blindsided by a different number live | 10m |
| Curate a 1-week signal trail you can walk through (Wet'suwet'en activism case is good — F-001 hit hardest by recent relaxation) | Avoid showing a stale or weak example | 30m |
| Manually trigger a Petronas Daily Briefing on real signals from May 12 | Have an executive-quality artifact in hand | 15m |
| Have the support-chat open in a side window | Show the operator-side answers when CRT asks "how do you know what's broken" | 0 — already there |
| Have `docs/pre-crt-audit-2026-05-13.md` open as your operator-only reference | If asked about platform stability, you can quote real numbers + the fix plan | 5m to skim |

### Pre-demo NO-GO list

- **Do not push any function code.** Risk of mid-demo regression.
- **Do not touch RLS policies.** F-007 fix is for Phase 3, not pre-demo.
- **Do not run database migrations.** Same reason.
- **Do not delete the deactivated agents.** Wait for Phase 1.
- **Do not change agent prompts.** F-021 confirmed they're solid; leave them.

---

## Phase 0 — Foundation (Day 1-2, post-demo)

**Goal:** Make every subsequent fix observable and revertible. These four steps are the precondition for the rest of the plan.

### Step 0.1 — F-012: Benchmark in CI

**Why first:** Every later step in this plan should fail the workflow if it regresses the benchmark. None of the safety claims in the rest of the plan are credible without this.

**Files to touch:**
- `.github/workflows/deploy-functions.yml` — add post-deploy benchmark step

**Implementation:**
```yaml
- name: Post-deploy benchmark
  if: success()
  run: |
    # 1. Trigger run-benchmark
    RESPONSE=$(curl -sS -X POST -H "Authorization: Bearer ${SERVICE_KEY}" \
      "${SUPABASE_URL}/functions/v1/run-benchmark" \
      -d '{"triggered_by":"ci_deploy","commit":"${{ github.sha }}"}')

    # 2. Poll for completion (max 5 min — benchmark is ~2 min)
    RUN_ID=$(echo "$RESPONSE" | jq -r '.run_id')
    for i in {1..30}; do
      sleep 10
      STATUS=$(curl -sS "${SUPABASE_URL}/rest/v1/benchmark_runs?id=eq.${RUN_ID}&select=completed_at,signal_creation_accuracy" \
        -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}")
      COMPLETED=$(echo "$STATUS" | jq -r '.[0].completed_at')
      [ "$COMPLETED" != "null" ] && break
    done

    # 3. Compare to previous green run
    NEW_ACC=$(echo "$STATUS" | jq -r '.[0].signal_creation_accuracy')
    PREV_ACC=$(curl -sS "${SUPABASE_URL}/rest/v1/benchmark_runs?triggered_by=eq.ci_deploy&order=triggered_at.desc&offset=1&limit=1&select=signal_creation_accuracy" \
      -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}" | jq -r '.[0].signal_creation_accuracy // 0.5')

    # 4. Fail if drop > 0.05
    python3 -c "import sys; new=float('${NEW_ACC}'); prev=float('${PREV_ACC}'); print(f'NEW={new:.2%} PREV={prev:.2%}'); sys.exit(1 if (prev - new) > 0.05 else 0)"
```

**Acceptance criteria:**
- Push a no-op commit. Workflow completes with a "Post-deploy benchmark" step that runs run-benchmark and reports accuracy.
- Deliberately introduce a known regression in a branch (e.g. add `return reject()` to ingest-signal). Workflow fails the step.
- Revert the regression. Workflow passes.

**Effort:** S — half day (3-4 hours)

**Dependencies:** None

**Risk:** Low. Adds a step; if it has a bug, it can be disabled with a single PR.

---

### Step 0.2 — F-016: LLM cost alert + budget cap

**Why early:** Every later step adds AI calls. Without a cost ceiling, a buggy retry loop could 10x the bill in an hour.

**Files to touch:**
- New SQL migration: `supabase/migrations/<ts>_llm_cost_alerts.sql` (RPC + cron + alert table)
- New edge function: `supabase/functions/compute-llm-daily-cost/index.ts`
- `supabase/functions/_shared/ai-gateway.ts` — check daily budget before call

**Implementation outline:**
```sql
-- llm_daily_cost: daily aggregate table
CREATE TABLE llm_daily_cost (
  day date PRIMARY KEY,
  function_name text,
  ai_model text,
  calls int,
  tokens_in bigint,
  tokens_out bigint,
  est_usd numeric,
  computed_at timestamptz DEFAULT now()
);

-- llm_budget_caps: budget config (operator-editable)
CREATE TABLE llm_budget_caps (
  scope text PRIMARY KEY,        -- 'global', 'function:<name>', 'tenant:<id>'
  daily_usd_alert numeric,        -- threshold for platform_finding
  daily_usd_hard_cap numeric      -- threshold for hard fail
);
INSERT INTO llm_budget_caps VALUES
  ('global', 25, 100);            -- alert at $25/day, hard cap at $100/day
```

```ts
// in ai-gateway.ts, before issuing the LLM call:
const today = new Date().toISOString().slice(0,10);
const { data: spend } = await supabase
  .from('llm_daily_cost')
  .select('est_usd')
  .eq('day', today)
  .eq('scope','global');
if (spend?.[0]?.est_usd > HARD_CAP_USD) {
  return { content: null, error: 'LLM_BUDGET_EXCEEDED', circuitOpen: true };
}
```

Cron: `compute-llm-daily-cost-30min` (every 30 min). Reads `function_telemetry`, upserts `llm_daily_cost`. If alert threshold breached, writes `platform_findings` row severity=`high`.

**Acceptance criteria:**
- After 30 min cron run, `llm_daily_cost` has today's row with cost matching the audit query.
- Drop the alert threshold to $1 via SQL UPDATE. Within 30 min, a `platform_findings` row appears.
- Drop the hard cap to $1. Next ai-gateway call returns `LLM_BUDGET_EXCEEDED`. Reset cap. Verify normal flow resumes.

**Effort:** M — ~1 day

**Dependencies:** None (parallel with 0.1)

**Risk:** Medium — the hard cap could starve real ingest. Default `daily_usd_hard_cap=100` is well above the $17/day current burn. Ship with cap=200 initially, lower after verification.

---

### Step 0.3 — F-017: Secret rotation alerts

**Files:**
- SQL migration: cron job + alert
- `docs/runbook-secret-rotation.md` — new

**Implementation:**
```sql
CREATE OR REPLACE FUNCTION public.alert_stale_secrets() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT name, EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 AS days_old
    FROM vault.secrets
    WHERE updated_at < NOW() - INTERVAL '60 days'
      AND name NOT IN ('SUPABASE_URL') -- URL, not a secret
  LOOP
    INSERT INTO platform_findings (fingerprint, category, severity, title, plain_english, action, affected_job, metadata)
    VALUES (
      'stale_secret:' || r.name,
      'security',
      CASE WHEN r.days_old > 90 THEN 'critical' ELSE 'high' END,
      'Secret ' || r.name || ' is ' || floor(r.days_old) || ' days old',
      'Production API keys should rotate at most every 90 days. ' || r.name || ' is ' || floor(r.days_old) || ' days old.',
      'Rotate via Supabase dashboard → Project Settings → Vault. Document in runbook.',
      NULL,
      jsonb_build_object('days_old', r.days_old, 'name', r.name)
    )
    ON CONFLICT (fingerprint) DO UPDATE SET last_seen_at = NOW(), occurrence_count = platform_findings.occurrence_count + 1;
  END LOOP;
END;
$$;

SELECT cron.schedule('alert-stale-secrets-daily', '15 5 * * *', 'SELECT public.alert_stale_secrets()');
```

**Acceptance criteria:**
- Set ANTHROPIC_API_KEY.updated_at to NOW() - 91 days (testing only). Run function. `platform_findings` shows critical alert.
- Reset. Verify alert disappears next run.
- Run the actual rotation for the 4 stale keys: OpenAI, Gemini, Anthropic, Perplexity. Confirm they show up green.

**Effort:** S — ~2 hours

**Dependencies:** None

**Risk:** Low

---

### Step 0.4 — F-014: Audit remaining monitors for heartbeat drift

**Files:**
- Read `supabase/functions/monitor-*/index.ts` for recordHeartbeat call patterns
- Fix any that use the two-recordHeartbeat-call pattern that timed out for monitor-news-google

**Implementation:**
```bash
# Audit step:
grep -rln "recordHeartbeat" supabase/functions/monitor-*/index.ts | while read f; do
  echo "=== $f ==="
  grep -c "recordHeartbeat" "$f"
done

# Any function with 2+ recordHeartbeat calls is suspect — convert to start/complete pattern.
```

For each suspect: apply the same fix as `monitor-news-google` (commit `b9ce0e31`) — convert to `startHeartbeat` + per-iteration progress update + `completeHeartbeat`.

**Acceptance criteria:**
- All monitor-* functions either use start/complete pattern OR have only one recordHeartbeat call at end.
- 24h after deploy: every `monitor-*-...` cron name in `cron_heartbeat` shows a `succeeded` status with a meaningful `signals_created` count (not 0 if there were signals).

**Effort:** S — ~2-3 hours

**Dependencies:** None

**Risk:** Low — each fix is a contained per-function change.

---

## Phase 1 — Data integrity quick wins (Day 2-3)

**Goal:** Stop the leaks. Make the database trustworthy before changing the AI behavior on top of it.

### Step 1.1 — F-006: Production-signal-to-inactive-client guard

**Files:**
- `supabase/functions/ingest-signal/index.ts` — add symmetric guard near existing `is_test=true → active client` rejection.

**Implementation:**
```ts
// Right after the client lookup, before signal creation:
const { data: client } = await supabase
  .from('clients').select('status').eq('id', resolvedClientId).single();

if (client?.status !== 'active' && !signal.is_test && !signal.benchmark_run_id) {
  console.warn(`[ingest-signal] Rejecting production signal targeting inactive client ${resolvedClientId}`);
  return successResponse({
    status: 'rejected',
    reason: 'production_signal_inactive_client',
    detail: `Client ${client?.status} — only test/benchmark signals allowed on non-active clients`,
  });
}
```

**Backfill step:** Reassign the 4 known leaked signals from F-006 either to their correct active client (Petronas Canada) or archive them:
```sql
-- Verify list first
SELECT id, signal_number, title FROM signals
WHERE client_id IN (SELECT id FROM clients WHERE status != 'active')
  AND is_test = false AND deleted_at IS NULL
  AND (raw_json->>'benchmark_run_id') IS NULL;

-- Decide per row: reassign to Petronas Canada (CCCS cyber → real PECL) or soft-delete.
-- Suggested: reassign, since these are real CCCS advisories.
UPDATE signals
SET client_id = (SELECT id FROM clients WHERE name='Petronas Canada' AND status='active')
WHERE id IN (...);
```

**Acceptance criteria:**
- Test: call ingest-signal with a payload targeting `_benchmark_petronas` and `is_test=false`. Response is `rejected` with reason `production_signal_inactive_client`.
- Test: call with `is_test=true`. Accepted.
- Test: call with `benchmark_run_id=<uuid>`. Accepted.
- Production query: `SELECT COUNT(*) FROM signals WHERE client_id IN (SELECT id FROM clients WHERE status != 'active') AND is_test=false AND created_at >= NOW() - INTERVAL '7 days'` returns 0 after 7d.

**Effort:** S — ~1-2 hours

**Dependencies:** None

**Risk:** Low. The guard's check is symmetric to existing logic.

---

### Step 1.2 — F-004: Fix remaining 19% null source_name in filtered_signals

**Investigation step first** — identify the offending insert path:
```sql
SELECT COALESCE(filter_reason, 'null_reason') AS reason, COUNT(*)
FROM filtered_signals
WHERE source_name IS NULL AND filtered_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1;
```

Likely culprits (per filter_reason):
- `ai_relevance_gate` from ingest-signal — the source attribution wasn't passed through
- Some monitor function still calling insert without source_name

**Files:**
- `supabase/functions/ingest-signal/index.ts` — track every `filtered_signals.insert` call site, ensure `source_name` is set. Fallback to `payload.source_key`, `payload.raw_json.source`, or `'unknown:<monitor-name>'` (the call_origin) before allowing null.

**Acceptance criteria:**
- 7 days after fix: `SELECT COUNT(*) FROM filtered_signals WHERE source_name IS NULL AND filtered_at >= NOW() - INTERVAL '7 days'` returns 0.
- All historical null rows (from before fix) can be backfilled from `raw_json` where possible (best-effort UPDATE).

**Effort:** S — ~2-3 hours

**Dependencies:** None

**Risk:** Low

---

### Step 1.3 — F-019: Clean up deactivated agents

**Files:**
- SQL — delete or document each deactivated row
- `docs/agent-changelog.md` — new, records the audit decisions

**Implementation:**
```sql
-- 1. Hard-delete the test agent
DELETE FROM ai_agents WHERE call_sign = 'WATCH-ALPHA-2';
-- Verify nothing references it:
SELECT * FROM signal_agent_analyses WHERE agent_call_sign = 'WATCH-ALPHA-2';
SELECT * FROM agent_specialty_embeddings WHERE call_sign = 'WATCH-ALPHA-2';
SELECT * FROM agent_debate_records WHERE 'WATCH-ALPHA-2' = ANY(participating_agents); -- adjust col name
-- If any FK errors, cascade or migrate first.

-- 2. Decision matrix for the other 16 — make per-agent decision:
--    a. Permanently delete (test/duplicate) — DELETE
--    b. Archived for historical reference — keep is_active=false, add note column
--    c. Reactivation candidate (e.g. SENT-CON for CRT onboarding) — flip is_active=true after Phase 1
```

**Acceptance criteria:**
- WATCH-ALPHA-2 row removed. Spot-check no error in any agent-dispatch function.
- `docs/agent-changelog.md` documents the decision for each of the 16 remaining deactivated rows.
- SENT-CON specifically: either reactivated with a confirmed CRT-onboarding role, OR an active replacement is documented.

**Effort:** S — ~2 hours

**Dependencies:** None

**Risk:** Low if FK check is done first. If WATCH-ALPHA-2 has FK references, just rename to `_archived_watch_alpha_2` instead of deleting.

---

### Step 1.4 — F-018: Fix is_active=false bypass in dispatch paths

**Investigation first:**
```bash
# Find every place that fetches agents and dispatches without filtering is_active
grep -rn "from.*ai_agents\|ai_agents.*select" supabase/functions/ | grep -v "is_active"
```

Likely culprits:
- `auto-trigger-debates`
- `multi-agent-debate`
- `agent-router`
- `respond-as-agent`

For each: ensure the agent lookup filters `WHERE is_active = true`. The `Scout` analysis came from somewhere — find that call site.

**Acceptance criteria:**
- After 7 days: zero new `signal_agent_analyses` rows for any agent where `ai_agents.is_active = false`. Run weekly:
  ```sql
  SELECT s.agent_call_sign, a.is_active, COUNT(*)
  FROM signal_agent_analyses s
  JOIN ai_agents a ON a.call_sign = s.agent_call_sign
  WHERE s.created_at > a.updated_at AND a.is_active = false
  GROUP BY 1, 2;
  ```
  Returns empty.

**Effort:** S — ~3-4 hours

**Dependencies:** None

**Risk:** Low

---

### Step 1.5 — F-009: Fix confidence score parsing

**Files:**
- Wherever the `CONFIDENCE: 0.X` line is parsed from agent output — likely `supabase/functions/agent-chat/index.ts` or `respond-as-agent`
- The prompt template in `supabase/functions/activate-dormant-specialists/index.ts:171-183`

**Implementation:**
1. **Parser fix:** Treat `CONFIDENCE: 0` as ambiguous (one-shot retry asking for explicit non-zero) OR store as NULL and exclude from calibration.
2. **Prompt strengthening:** Add a concrete example to the template:
   ```
   END YOUR RESPONSE WITH A LINE EXACTLY IN THIS FORMAT:
   CONFIDENCE: 0.X
   where 0.X is your probability estimate (0.0–1.0).
   0.5 means "genuinely uncertain — could go either way".
   0.1 means "probably not actionable but not impossible".
   0.9 means "very likely real, would act on this".
   DO NOT output 0 — if your assessment is "no nexus", say so in the body and use 0.1 for the line.
   ```
3. **Backfill / quarantine:** Mark the 351 existing `confidence_score=0` rows as `excluded_from_calibration=true` (new column) so `score-agent-calibration` ignores them.

**Acceptance criteria:**
- After deploy: 14-day window of new analyses shows <10% with `confidence_score=0` (currently 56%).
- `agent_calibration_scores` for top-5 specialists shows brier_score in (0, 0.5) range — not the artificial 0.000.
- AgentListPanel calibration pill stops showing 100% for everyone.

**Effort:** M — ~1 day

**Dependencies:** None

**Risk:** Medium — agents may still default to 0 even with prompt updates. The parser-side retry is the real safety net.

---

## Phase 2 — AI gate stabilization (Day 3-5)

### Step 2.1 — F-001: AI gate consolidation + tuning

**This is the biggest single quality improvement.**

**Goal:** One AI gate, one prompt, one per-source threshold map. Today there are 4+ independent gates that each silently regress.

**Files:**
- New: `supabase/functions/_shared/ai-relevance-gate.ts` — single shared gate
- Refactor: `monitor-social-unified`, `process-intelligence-document`, `monitor-news-google`, `ingest-signal` to call the shared gate

**Architecture:**
```ts
// _shared/ai-relevance-gate.ts
export interface GateInput {
  title: string;
  text: string;
  url: string;
  client: { name: string; keywords: string[]; locations: string[]; industry: string };
  source: { name: string; credibility_score: number };  // from sources table
  isEntityScan?: boolean;
}
export interface GateVerdict {
  admit: boolean;
  score: number;        // 0.0 — 1.0
  reason: string;       // human-readable
  filter_reason: string; // for filtered_signals.filter_reason
  category: string;
}
export async function aiRelevanceGate(input: GateInput): Promise<GateVerdict>;
```

Threshold model (from `sources.credibility_score`):
- Highly credible source (>0.8): floor 0.25
- Standard (0.4-0.8): floor 0.30
- Low credibility (<0.4): floor 0.45

**Acceptance criteria:**
- Benchmark `signal_creation_accuracy` ≥ 0.55 (current 0.51) AND no class drops below the F-001 audit baseline.
- 7-day admit ratio in 25-30% target band.
- `filtered_signals.filter_reason` is always populated (not just "ai_relevance_gate" — specific values).
- Search "aiRelevanceGate" or equivalent inline gate code in the 4 monitors — all forwarded to the shared gate.

**Effort:** L — ~2-3 days

**Dependencies:** Phase 0 complete (benchmark CI catches regressions in real-time during refactor)

**Risk:** High. This touches every signal path. Ship behind a feature flag (`USE_CONSOLIDATED_GATE=true`) and run shadow-mode for 48h before flipping.

---

### Step 2.2 — F-002 + F-005: Agent dispatch to dormant specialists

**Files:**
- `supabase/functions/agent-router/index.ts` — reserve 1 slot in top-K for least-recently-fired agent matching the signal category
- `supabase/functions/activate-dormant-specialists/index.ts` — bump MAX_DISPATCHES_PER_RUN if needed

**Implementation:**
```ts
// In agent-router top-K computation:
const baseAgents = await pgvectorTopK(question, k); // existing similarity ranking
const dormantSlot = await supabase
  .from('ai_agents')
  .select('call_sign, specialty')
  .eq('is_active', true)
  .not('call_sign', 'in', `(${baseAgents.map(a => `'${a.call_sign}'`).join(',')})`)
  .order(sql`(SELECT MAX(created_at) FROM signal_agent_analyses WHERE agent_call_sign = ai_agents.call_sign) NULLS FIRST`)
  .limit(1);
return [...baseAgents.slice(0, k-1), dormantSlot]; // sacrifice 1 slot
```

**Acceptance criteria:**
- After 7 days: count of `signal_agent_analyses` rows for any of the 12 currently-never-fired agents is > 0 (target: 5+).
- `activate-dormant-specialists-daily` cron `result_summary` shows `dispatched > 0` on most days, not 0.

**Effort:** M — ~1 day

**Dependencies:** Step 1.4 (is_active enforcement must already be correct, otherwise we're dispatching to deactivated agents).

**Risk:** Low-medium — could increase noise if dormant agents produce low-quality output. Mitigated by F-011 specialty-fit verifier (Step 2.3).

---

### Step 2.3 — F-011: Specialty-fit verifier for drift

**Files:**
- New: `supabase/functions/_shared/specialty-fit.ts`
- Call site: wherever `signal_agent_analyses` is inserted (likely `respond-as-agent` or `agent-chat`)

**Implementation:**
After the specialist produces analysis, before storing, run a quick verifier (cheap gpt-4o-mini call):
```ts
const verifier = await callAi({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: `You are a quality gate. Decide if an analysis applies the stated specialty. Answer "yes" or "no" + 1 sentence reason.` },
    { role: 'user', content: `SPECIALTY: ${agent.specialty}\nANALYSIS: ${analysis}\n\nDid the analysis apply the specialty?` },
  ],
});
if (verifier.includes('no')) {
  return { stored: false, reason: 'specialty_drift' };
}
```

**Acceptance criteria:**
- Spot-check 20 random recent analyses post-deploy: ≤2 are drift (vs. 5/8 in the audit sample).
- Drift-rejected count visible in cron heartbeats or a new table.

**Effort:** M — ~1 day (cheap verifier; the work is wiring it everywhere)

**Dependencies:** Phase 0 (LLM budget cap must be in place — this adds calls)

**Risk:** Low — failures fall back to "store anyway with warning" if verifier itself fails.

---

## Phase 3 — Tenancy & RLS (Day 5-10) — THE BIG ONE

**Goal:** A CRT analyst with `role=analyst` sees ONLY their tenant's clients. Cross-tenant queries return empty. Frontend routes for `super_admin` / `tenant_admin` deny access.

**Saturday window recommended.** Have a test tenant ready to log in and verify.

### Step 3.1 — F-013: Add tenant_id to bug_reports

**Required prerequisite for the tenant-scoped RLS rewrite.**

```sql
ALTER TABLE bug_reports ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE bug_reports ADD COLUMN client_id uuid REFERENCES clients(id);

-- Backfill: derive from user's tenant
UPDATE bug_reports br
SET tenant_id = (SELECT tu.tenant_id FROM tenant_users tu WHERE tu.user_id = br.user_id LIMIT 1)
WHERE br.user_id IS NOT NULL AND br.tenant_id IS NULL;

-- support-chat function: pass tenant_id from resolved auth context
```

**Acceptance criteria:**
- After deploy: new bug reports filed from chat have `tenant_id` populated.
- Historical rows backfilled where possible.

**Effort:** S — ~3 hours

---

### Step 3.2 — F-008: Schema migration for tenant-sensitive tables

```sql
-- Add tenant_id + client_id columns where missing
ALTER TABLE signal_agent_analyses ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE signal_correlation_groups ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE agent_debate_records ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE reports ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE agent_actions ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;
ALTER TABLE poi_investigations ADD COLUMN tenant_id uuid, ADD COLUMN client_id uuid;

-- Backfill from joined signal
UPDATE signal_agent_analyses a
SET tenant_id = s.tenant_id, client_id = s.client_id
FROM signals s WHERE s.id = a.signal_id;

UPDATE signal_correlation_groups g
SET tenant_id = s.tenant_id, client_id = s.client_id
FROM signals s WHERE s.id = g.primary_signal_id;

UPDATE agent_debate_records d
SET tenant_id = s.tenant_id, client_id = s.client_id
FROM signals s WHERE s.id = d.signal_id;

UPDATE reports r SET tenant_id = (SELECT tenant_id FROM clients WHERE id = r.client_id);

UPDATE agent_actions a
SET tenant_id = s.tenant_id, client_id = s.client_id
FROM signals s WHERE s.id::text = a.context_signal_id;

UPDATE poi_investigations p
SET tenant_id = e.tenant_id, client_id = e.client_id
FROM entities e WHERE e.id = p.entity_id;

-- Indexes
CREATE INDEX idx_saa_tenant ON signal_agent_analyses(tenant_id);
CREATE INDEX idx_scg_tenant ON signal_correlation_groups(tenant_id);
CREATE INDEX idx_adr_tenant ON agent_debate_records(tenant_id);
CREATE INDEX idx_reports_tenant ON reports(tenant_id);
CREATE INDEX idx_aa_tenant ON agent_actions(tenant_id);
CREATE INDEX idx_poi_tenant ON poi_investigations(tenant_id);
```

**Acceptance criteria:**
- All 6 tables have `tenant_id` and `client_id` columns.
- No nulls on rows where the join would succeed (verify with `SELECT COUNT(*) WHERE tenant_id IS NULL` per table).
- Indexes exist.

**Effort:** L — ~1-2 days. The backfill might be slow on large tables; do it in batches.

**Dependencies:** None — purely additive.

**Risk:** Medium. The backfill statements are large and could lock the tables. Run during off-hours.

---

### Step 3.3 — F-007: RLS rewrite

**The headline fix.** Drop every role-only and wildcard SELECT policy. Add tenant-scoped policies. Keep super_admin bypass.

```sql
-- ============================================================
-- DROP role-only / wildcard policies that leak cross-tenant data
-- ============================================================

-- signals
DROP POLICY "Admins and analysts can view signals" ON signals;
DROP POLICY "Users can view signals for their client" ON signals;
DROP POLICY "Users can manage signals for their client" ON signals;
-- Keep: tenant_scoped_signals_select, super_admin_bypass_signals,
--       Admins and analysts can {insert,update,delete} signals

-- incidents
DROP POLICY "Admins and analysts can view incidents" ON incidents;
DROP POLICY "Users can view incidents for their client" ON incidents;
DROP POLICY "Users can manage incidents for their client" ON incidents;
-- Keep tenant_scoped_incidents_select + super_admin_bypass + insert/update/delete role checks

-- clients
DROP POLICY "auth_users_can_view_clients" ON clients;
-- Replace with tenant-scoped:
CREATE POLICY "tenant_scoped_clients_select" ON clients FOR SELECT
  USING (is_super_admin(auth.uid()) OR
         id IN (SELECT client_id FROM get_user_accessible_client_ids()));

-- entities
DROP POLICY "auth_users_can_view_entities" ON entities;
DROP POLICY "Users can manage entities for their client" ON entities; -- legacy single-client
DROP POLICY "Users can view entities" ON entities; -- legacy
CREATE POLICY "tenant_scoped_entities_select" ON entities FOR SELECT
  USING (is_super_admin(auth.uid()) OR
         client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

-- signal_agent_analyses (now has client_id from Step 3.2)
DROP POLICY "authenticated_read_signal_agent_analyses" ON signal_agent_analyses;
CREATE POLICY "tenant_scoped_saa_select" ON signal_agent_analyses FOR SELECT
  USING (is_super_admin(auth.uid()) OR
         client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

-- signal_correlation_groups
DROP POLICY "Authenticated users can view signal correlations" ON signal_correlation_groups;
DROP POLICY "auth_users_can_view_correlation_groups" ON signal_correlation_groups;
DROP POLICY "Analysts and admins can view correlation groups" ON signal_correlation_groups;
CREATE POLICY "tenant_scoped_scg_select" ON signal_correlation_groups FOR SELECT
  USING (is_super_admin(auth.uid()) OR
         client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

-- agent_debate_records
DROP POLICY "Authorized roles can read debate records" ON agent_debate_records;
CREATE POLICY "tenant_scoped_adr_select" ON agent_debate_records FOR SELECT
  USING (is_super_admin(auth.uid()) OR
         client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

-- reports
DROP POLICY "Analysts and admins can view reports" ON reports;
DROP POLICY "Analysts and admins can manage reports" ON reports;
CREATE POLICY "tenant_scoped_reports_select" ON reports FOR SELECT
  USING (is_super_admin(auth.uid()) OR
         client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));
CREATE POLICY "tenant_scoped_reports_modify" ON reports FOR ALL
  USING (is_super_admin(auth.uid()) OR
         (has_role(auth.uid(),'analyst') AND
          client_id IN (SELECT client_id FROM get_user_accessible_client_ids())));

-- poi_investigations
DROP POLICY "auth_read_poi_investigations" ON poi_investigations;
CREATE POLICY "tenant_scoped_poi_select" ON poi_investigations FOR SELECT
  USING (is_super_admin(auth.uid()) OR
         client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

-- bug_reports (Step 3.1 added tenant_id)
CREATE POLICY "tenant_scoped_bug_reports" ON bug_reports FOR SELECT
  USING (is_super_admin(auth.uid()) OR user_id = auth.uid() OR
         tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));
```

**Acceptance criteria — VERIFY UNDER TWO AUTH CONTEXTS:**
1. Provision a test user in Tenant A (Silent Shield), role=analyst.
2. Provision a test user in Tenant B (CRT), role=analyst.
3. Each user runs `SELECT COUNT(*) FROM signals`. Tenant A user sees only Silent Shield client signals. Tenant B user sees only CRT client signals. Confirm via direct PostgREST API call (not the UI — UI may have its own filters).
4. Repeat for: incidents, entities, reports, signal_agent_analyses, signal_correlation_groups, agent_debate_records, poi_investigations, bug_reports.
5. Tenant A super_admin still sees all.

**Effort:** L — ~2 days for the migration. Another ~1 day for verification with multiple users.

**Dependencies:** Step 3.1, Step 3.2

**Risk:** **VERY HIGH.** This is the change with the most blast radius. Plan:
- Run on Saturday morning when no users are active.
- Provision the two test users in advance.
- Have a rollback migration ready (drop new policies, recreate old role-only policies).
- Monitor `pg_stat_activity` for query errors after the swap.

---

### Step 3.4 — F-015: Frontend ProtectedRoute with role enforcement

**Files:**
- `src/components/ProtectedRoute.tsx` — extend with role check
- `src/App.tsx` — annotate sensitive routes with required roles

**Implementation:**
```tsx
export const ProtectedRoute = ({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  requireRole?: AppRole | AppRole[];
}) => {
  const { user, loading } = useAuth();
  const { roles } = useUserRoles();
  const location = useLocation();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/auth" replace state={{ from: location.pathname }} />;

  if (requireRole) {
    const required = Array.isArray(requireRole) ? requireRole : [requireRole];
    const hasRequired = required.some(r => roles.includes(r));
    if (!hasRequired) return <Navigate to="/forbidden" replace />;
  }
  return <>{children}</>;
};
```

```tsx
// App.tsx — annotate
<Route path="/super-admin" element={
  <ProtectedRoute requireRole="super_admin"><SuperAdminDashboard /></ProtectedRoute>
} />
<Route path="/tenant-admin" element={
  <ProtectedRoute requireRole={["tenant_admin", "super_admin"]}><TenantAdmin /></ProtectedRoute>
} />
<Route path="/user-management" element={
  <ProtectedRoute requireRole={["admin", "super_admin"]}><UserManagement /></ProtectedRoute>
} />
<Route path="/integrations" element={
  <ProtectedRoute requireRole={["admin", "super_admin"]}><Integrations /></ProtectedRoute>
} />
<Route path="/rule-approvals" element={
  <ProtectedRoute requireRole={["admin", "super_admin"]}><RuleApprovals /></ProtectedRoute>
} />
// ... continue for /agents, /agent-actions, /benchmark, /command-center
```

Also create a new `/forbidden` page with a simple message + "go home" link.

**Acceptance criteria:**
- As a `viewer` or `analyst`, navigate to `/super-admin` → redirected to `/forbidden`.
- As `super_admin`, same route renders normally.
- E2E test in `tests/role-access.spec.ts` confirms each protected route.

**Effort:** S — ~half day

**Dependencies:** None (parallel with Step 3.3)

**Risk:** Low. Frontend-only.

---

## Phase 4 — AI quality + DR (Day 10-14)

### Step 4.1 — F-010: Fact-verification layer

**The hardest fix.** Goes between admit-gate and specialist dispatch.

**Architecture:**
- New table `signal_verification_status` (status, confidence, sources_cited, verifier_notes).
- New function `verify-signal-claim` invoked by `review-signal-agent` before any specialist work.
- For high-claim signals ("X has been shut down", "X has signed", "X has been killed"), require ≥2 distinct corroborating source domains.
- Tag UI display: `unverified` / `corroborated` / `disputed`.

**Acceptance criteria:**
- Hallucinated benchmark cases now get `verification_status = unverified` (or `disputed`).
- Specialist analyses on unverified signals prefix with "Pending verification:" or are deferred until corroboration arrives.
- Benchmark `llm_hallucination` class score improves from 20% to ≥60%.

**Effort:** L — 3 days

---

### Step 4.2 — F-020: DR runbook + tested restore

**Steps:**
1. Operator opens Supabase Dashboard → Project Settings → Database → Backups. Records:
   - Tier (Pro / Team / Enterprise)
   - Retention days
   - PITR status
2. Write `docs/runbook-dr.md` covering:
   - Daily backup schedule
   - Restore procedure (specific dashboard clicks)
   - RTO/RPO targets
3. **Test restore**:
   - `mcp__plugin_supabase_supabase__create_branch` to spin up dev branch
   - Apply a tracer migration (e.g. `INSERT INTO clients (name, status) VALUES ('_dr_test_canary', 'inactive')`)
   - Restore to a point 5 minutes before the tracer
   - Verify the canary row is gone
   - `mcp__plugin_supabase_supabase__delete_branch` to clean up

**Acceptance criteria:**
- `docs/runbook-dr.md` exists and another team member can execute it cold.
- One successful test-restore documented in the runbook with timestamp.

**Effort:** S (verification) — ~3 hours. If tier upgrade needed for PITR: M.

---

### Step 4.3 — F-003: Verify agent silent-24h is intentional or routing gap

```sql
-- Check the 5 silent-24h agents' last firing context
SELECT s.agent_call_sign, s.signal_id, s.created_at, sig.title, sig.composite_confidence
FROM signal_agent_analyses s
JOIN signals sig ON sig.id = s.signal_id
WHERE s.agent_call_sign IN ('GUARDIAN','INSIDE-EYE','ORACLE','ECHO-WATCH','SIM-ARCH')
ORDER BY s.created_at DESC LIMIT 30;

-- Check whether they were triggered by a debate (event-coupled)
SELECT * FROM agent_debate_records
WHERE created_at BETWEEN '2026-05-10 14:00' AND '2026-05-10 15:00'
  AND 'GUARDIAN' = ANY(participating_agents);
```

If event-coupled (Vashouk debate) — intentional, document, close as NICE.
If not — routing gap, treat like F-005.

**Effort:** S — ~1 hour investigation + decision

---

## Verification gates between phases

| Gate | Check before proceeding to next phase |
|---|---|
| End of Phase 0 | Benchmark CI green on 3 consecutive deploys. Cost alert fires when manually triggered. |
| End of Phase 1 | 7-day query for null source_name returns 0. Deactivated agents produce 0 new analyses. Confidence-zero rate <10%. |
| End of Phase 2 | Benchmark `signal_creation_accuracy` ≥ 0.65. Admit ratio in 25-30% band. 5+ previously-dormant agents now firing. |
| End of Phase 3 | Two test users in different tenants verified to see only their own data across 8 tables. Frontend role guards verified. |
| End of Phase 4 | Hallucinated benchmark class ≥ 60%. DR runbook executed once successfully. |

**Only after all four gates pass: CRT user provisioning.**

---

## Total effort estimate

| Phase | Effort | Calendar (if 1 person, 6 focused hrs/day) |
|---|---|---|
| Pre-demo prep | ~1 hour | Today |
| Phase 0 — Foundation | 2 days | Day 1-2 |
| Phase 1 — Data integrity | 2-3 days | Day 2-4 |
| Phase 2 — AI gate consolidation | 4-5 days | Day 4-8 |
| Phase 3 — Tenancy + RLS + frontend | 4-5 days (Saturday for the swap) | Day 8-12 |
| Phase 4 — AI quality + DR | 4-5 days | Day 13-17 |
| **Total** | **17-20 working days** | **~3 calendar weeks** |

**Critical path:** F-012 → F-001 → F-008 → F-007 → CRT onboarding.

Phases 0+1+2 can be parallelized somewhat. Phase 3 is sequential (RLS rewrite blocks itself).

---

## What's already shipped today (no action needed)

These commits address parts of audit findings before the audit completed. They are deployed and live (or about to land):

| Commit | Addresses |
|---|---|
| `3e008938` | Partial F-001 (monitor-social-unified prompt relaxation) |
| `b9ce0e31` | Partial F-014 (monitor-news-google heartbeat fix) |
| `0d75447a` | Partial F-005 (ingest-signal → ai-decision-engine fire-and-forget) |
| `8d3d68cc` | Partial F-014 (monitor-instagram + auto-approve heartbeats) |
| `60f7f45d` | KB enrichment — 12 core articles. Not in audit; quality improvement. |
| `1bd2c954` | support-chat platform pulse. Quality improvement. |
| `6f517faa` | support-chat [BUG_READY] marker. Fixes bug-report flow. |
| `60ad0560` | support-chat KB referral instructions. |

These work is foundational; the plan above builds on it.

---

## What this plan does NOT cover

- **Customer-acquisition / pricing / contracts.** Operational only.
- **Capacity planning beyond CRT.** This stabilizes for one paying tenant. Scaling to 5+ tenants needs a re-audit.
- **`aegis.silentshieldsecurity.com` frontend.** Deferred per scope agreement.
- **External API resilience.** Twitter, Google CSE, NAAD can still go dark on their end. Mitigations belong in a separate "external dependency" plan.
- **Performance at scale.** RLS join-heavy queries (Phase 3) may be slow. Add to a follow-up plan if observed.
