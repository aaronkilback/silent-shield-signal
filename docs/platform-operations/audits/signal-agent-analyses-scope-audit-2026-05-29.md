# `signal_agent_analyses` scope / RLS / contamination audit

**Date:** 2026-05-29. **Scope:** the `signal_agent_analyses` table and the `generate-daily-briefing` retrieval that consumes it. **Status:** documentation + recommendation; no fix work started, per operator directive.

## TL;DR

Cross-tenant contamination through `signal_agent_analyses` in `generate-daily-briefing` is **structurally possible and historically realized**. On at least 3 dates in May 2026 the daily briefing's 24h window contained rows from **2 distinct tenants** simultaneously. Each of those days, every tenant's daily briefing prompt would have received the *other* tenant's LLM-derived analysis prose. Service-role read bypass is the mechanism; the table's RLS policies are correct for authenticated users but RLS is **not forced**.

---

## 1. Exact retrieval path

### Caller (`supabase/functions/generate-daily-briefing/index.ts:95–100`)

```ts
supabase
  .from("signal_agent_analyses")
  .select("agent_call_sign, trigger_reason, analysis, created_at")
  .ilike("trigger_reason", "entity_mention:%")
  .gte("created_at", cutoff24h)
  .order("created_at", { ascending: false })
  .limit(8),
```

What this returns:

- **No `signal_id` selected** → caller cannot derive ownership transitively.
- **No `client_id` selected** → caller cannot filter by ownership in code.
- **No `tenant_id` selected** → same.
- **No `.eq("client_id", clientId)` filter** → no SQL-level scope guard.
- **No JOIN to `signals`** → no signal-derived scope.
- **`.ilike("trigger_reason", "entity_mention:%")`** is the only non-time filter.

The result rows then feed directly into the daily-briefing AI prompt later in the function. The caller is invoked **once per client** by the daily 07:00 UTC cron — but the query returns rows across **all clients** that match the time + trigger_reason filter.

## 2. Client / tenant scope on the table

### Columns

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `signal_id` | uuid | YES | FK → `signals(id) ON DELETE CASCADE` |
| `agent_call_sign` | text | NO | |
| `analysis` | text | NO | LLM-derived prose |
| `confidence_score` | double precision | YES | |
| `trigger_reason` | text | YES | |
| `created_at` | timestamptz | YES | default now() |
| `analysis_tier` | text | YES | default 'tier1' |
| `confidence_breakdown` | jsonb | YES | |
| `pattern_matches` | jsonb | YES | |
| `reasoning_log` | jsonb | YES | |
| `embedding` | vector | YES | |
| **`tenant_id`** | uuid | **YES** | no FK, no default, no trigger |
| **`client_id`** | uuid | **YES** | no FK, no default, no trigger |

### Population

3,058 rows on prod. **1,190 of them (38.9%) have `client_id IS NULL` AND `tenant_id IS NULL`** simultaneously. `signal_id` is always set (FK enforcement). No row is fully ownerless — every row can transitively derive ownership via `signal_id → signals.client_id/tenant_id`.

Distribution by `trigger_reason` bucket:

| Trigger bucket | Total | With client_id | Without client_id |
|---|---:|---:|---:|
| `other:composite_confidence_gate` | 969 | 573 | 396 |
| `sub_threshold_review` | 617 | 400 | 217 |
| `high_value_enrichment` | 387 | 171 | 216 |
| `other:auto_ingest` | 331 | 256 | 75 |
| `other:high_severity` | 318 | 247 | 71 |
| **`entity_mention:%`** (the daily-briefing filter) | **196** | **107** | **89** |
| `other:anomaly_z_score` | 177 | 81 | 96 |
| `dormant_activation` | 27 | 11 | 16 |
| `red_team_review` | 15 | 4 | 11 |
| `other:task_225_prod_verify` | 9 | 9 | 0 |
| `other:critical_severity` | 9 | 6 | 3 |
| `other:manual_test` | 3 | 3 | 0 |

**Every bucket is mixed** — some rows have `client_id` set, others don't. There is no clean "always-owned" trigger_reason class.

## 3. Tenant scope (transitive via `signal_id`)

Because `signal_id` is FK-enforced and `signals` carries `(client_id, tenant_id)`, every analysis row CAN be tenant-derived through the parent signal — *if* the query joins. Today's daily-briefing query does not join.

## 4. RLS behavior under service role

### Policy inventory

| Policy | cmd | Role | Predicate |
|---|---|---|---|
| `service_role_full_access_signal_agent_analyses` | ALL | public | `auth.jwt() ->> 'role' = 'service_role'` |
| `signal_agent_analyses_select_tenant_scoped` | SELECT | authenticated | `is_super_admin(uid) OR EXISTS(SELECT 1 FROM signals s WHERE s.id = saa.signal_id AND s.client_id IN get_user_accessible_client_ids())` |
| `signal_agent_analyses_tenant_select` | SELECT | public | `client_id IN get_user_accessible_client_ids()` |
| `signal_agent_analyses_tenant_insert` | INSERT | public | WITH CHECK: `client_id IN get_user_accessible_client_ids()` |
| `signal_agent_analyses_tenant_update` | UPDATE | public | `client_id IN get_user_accessible_client_ids()` |
| `signal_agent_analyses_tenant_delete` | DELETE | public | `client_id IN get_user_accessible_client_ids()` |

### RLS state

| Property | Value |
|---|---|
| RLS enabled | **true** |
| RLS **forced** | **false** |
| Triggers | **0** |

**Service-role bypass:** since RLS is not forced, the service-role client (which `generate-daily-briefing` instantiates) bypasses every policy above. The "tenant_select" policy that would otherwise filter to `client_id IN get_user_accessible_client_ids()` does **not** apply.

**Authenticated users are safe** — both SELECT policies are correct: one joins through signals.client_id (handles rows with NULL direct client_id), the other filters direct client_id. But the daily-briefing path runs as service-role, not as an authenticated user.

### Authenticated-user behavior is correct; service-role behavior is the gap

If `generate-daily-briefing` had been written with the user's JWT (per the user-facing path), RLS would have filtered the query results to the caller's accessible clients. But the function uses `createServiceClient()` so it can read across all signals and incidents for the cron-driven daily run — and `signal_agent_analyses` falls into the same uniform service-role read radius.

## 5. Whether cross-client / cross-tenant contamination is possible

**Yes — and it has happened.**

### Structural possibility (proven)

- The retrieval has no scope filter, no JOIN, and no ownership columns selected.
- Service-role bypasses the tenant-scoped RLS policies.
- The function is invoked once per client per day, but the query returns all matching rows regardless of which client it was invoked for.

### Historical realization (measured)

For each of the last 30 daily-briefing 07:00 UTC runs, I reconstructed what the unfiltered query would have returned by reading the 24h window the function uses. Effective tenant/client counts per day where the query returned ≥1 row:

| Day | Eligible rows | Distinct effective tenants | Distinct effective clients |
|---|---:|---:|---:|
| **2026-05-27** | 5 | **2** | **3** |
| **2026-05-24** | 60 | **2** | 2 |
| 2026-05-23 | 9 | 1 | 1 |
| 2026-05-22 | 1 | 1 | 1 |
| 2026-05-20 | 5 | 1 | 1 |
| **2026-05-19** | 6 | **2** | 2 |
| 2026-05-17 | 2 | 1 | 1 |
| 2026-05-16 | 8 | 1 | 2 |
| 2026-05-15 | 9 | 1 | 2 |
| 2026-05-14 | 12 | 1 | 2 |
| 2026-05-13 | 26 | 1 | 2 |
| 2026-05-12 | 18 | 1 | 2 |
| 2026-05-11 | 11 | 1 | 2 |
| 2026-05-09 | 7 | 1 | 2 |
| earlier days | ≥1 | 1 | 1–2 |

**On 2026-05-27, 2026-05-24, and 2026-05-19**, the query returned rows from **two distinct tenants**. On every one of those days, every tenant's daily-briefing prompt received the other tenant's `analysis` prose. That is the same failure class as INC-LEARN-CONTAM but on a different table.

**On at least 8 more days** the query returned rows spanning multiple clients **within one tenant**. That's the BC Place ↔ Trent Reznor concern you raised earlier — confirmed prod-realized on a daily briefing path.

### Visible to which users

The `analysis` prose is woven into the briefing's AI-generated narrative. The briefing is delivered to each client's intelligence consumers (the cron hits `generate-daily-briefing` per client). So the cross-tenant LLM prose entered downstream executive surfaces, not just the function memory.

## 6. Writer inventory — no writer sets `client_id` or `tenant_id`

Every writer found:

| Writer | Sets `client_id`? | Sets `tenant_id`? | Trigger_reason class |
|---|---|---|---|
| `correlate-entities/index.ts:637` | ❌ | ❌ | `entity_mention:*` (the daily-briefing filter target) |
| `review-signal-agent/index.ts:308` | ❌ | ❌ | `sub_threshold_review` / `high_value_enrichment` |
| `red-team-review/index.ts:111` | ❌ | ❌ | `red_team_review` |
| `activate-dormant-specialists/index.ts:211` | ❌ | ❌ | `dormant_activation` |
| `speculative-dispatch/index.ts:104` | ❌ | ❌ | (variable) |
| `_shared/agent-tools-core.ts:317` | ❌ | ❌ | `cross_agent_consult` |

The 1,868 rows that DO have `client_id` set on prod were almost certainly populated by a one-time backfill migration (not located in this audit — backfill date appears to align with `tenant_id` rollout). **All ongoing writes still produce NULL-client_id rows.**

This is a write-time Provenance Doctrine violation that mirrors what INC-OMCR fixed for `agent_investigation_memory`: writers omit ownership and rely on transitive ownership through a parent FK, while service-role readers ignore the transitive path.

## 7. Recommended next code change

Two layers, in this order:

### Layer 1 — read-side fix (immediate; what you asked for first)

In `generate-daily-briefing/index.ts:95–100`, replace the unfiltered query with a client-scoped join through `signals`. Two options:

**Option A (minimal change — join in SQL via PostgREST):**

```ts
supabase
  .from("signal_agent_analyses")
  .select(`
    agent_call_sign, trigger_reason, analysis, created_at,
    signals!inner(client_id, tenant_id)
  `)
  .eq("signals.client_id", clientId)
  .ilike("trigger_reason", "entity_mention:%")
  .gte("created_at", cutoff24h)
  .order("created_at", { ascending: false })
  .limit(8)
```

The `!inner` forces an INNER JOIN. Rows whose parent signal does not belong to `clientId` are excluded. Rows with NULL `signal_id` (none on prod today) would be excluded. Rows where direct `client_id` differs from parent-signal `client_id` (none expected on prod) would also be excluded by the join.

**Option B (belt-and-braces — direct + transitive):**

```ts
const { data: directRows } = await supabase
  .from("signal_agent_analyses")
  .select("agent_call_sign, trigger_reason, analysis, created_at, signal_id")
  .eq("client_id", clientId)
  .ilike("trigger_reason", "entity_mention:%")
  .gte("created_at", cutoff24h)
  .limit(8);
// Plus rows where direct client_id IS NULL but parent signal belongs to clientId.
// (Implemented as a separate query JOIN'd to signals.) Merge in-code.
```

Option A is preferred. Single query, structurally correct, no merge logic.

**Risk:** if any prod analysis row has `signal_id` pointing to a signal that has since been hard-deleted (unlikely given FK ON DELETE CASCADE, but theoretically possible if FK was disabled at some point), the inner join would silently drop those rows. Worth confirming the FK has been continuously enforced; current schema shows it is.

### Layer 2 — write-side fix (Provenance Doctrine; defense in depth, after Layer 1)

Replicate the INC-OMCR pattern that was used for `agent_investigation_memory`:

1. **Backfill** the 1,190 NULL-owner rows from their parent signals: `UPDATE signal_agent_analyses SET (client_id, tenant_id) = (s.client_id, s.tenant_id) FROM signals s WHERE saa.signal_id = s.id AND saa.client_id IS NULL`.
2. **Trigger** `trg_saa_require_tenant` BEFORE INSERT: derive `tenant_id`/`client_id` from `signals` row keyed by `signal_id` if NULL; raise exception if still null. Mirrors `trg_aim_require_tenant`.
3. **Make `client_id` and `tenant_id` NOT NULL** after backfill.
4. **Update writers** in the 6 functions identified to set `client_id`/`tenant_id` explicitly — defensive even with the trigger.

Layer 2 is schema work, which is currently held per your standing directive. **I am not proposing it now.** I name it only because Layer 1's read-side fix can be deployed today without it; the schema work is the long-term containment.

### Risk if neither layer is applied

The daily briefing continues to mix cross-tenant LLM analysis prose on any day with multi-tenant overlap. Recent observed dates: 2026-05-27 (2 tenants), 2026-05-24 (2 tenants), 2026-05-19 (2 tenants). Frequency is low but the event class is structural; one such day per week is plausible going forward.

## 8. What this audit does NOT do

- Does not apply Layer 1.
- Does not propose Layer 2 schema work (PR #36 hold honored).
- Does not extend the audit to `generate-poi-report`'s `signal_agent_analyses` retrieval (line 476) — that one is scoped by `signal_id IN signals.map(s.id)` where signals are entity-scoped, which is transitively safe. Quick note: it should still be re-examined when Layer 2 lands.
- Does not assess whether the daily briefing's OTHER injected stores (`agent_beliefs`, `agent_debate_records`) need similar fixes. The earlier inventory (PR #45) showed `agent_beliefs` is client-scoped (`.eq("client_id", clientId)`) and `agent_debate_records` is client-scoped via `incidents!inner.client_id` — both correct. Only `signal_agent_analyses` lacks the scope guard.
- Does not measure whether the cross-tenant briefings that ran on 2026-05-19/24/27 produced operator-visible drift in those clients' downstream artifacts. That's a forensic question, distinct from "is contamination possible."

## 9. Decision requested

If Layer 1 is approved, the patch is ~5 lines in `generate-daily-briefing/index.ts`. Same prod-apply discipline as PR #42 and #44 (workflow_dispatch deploy + invoke + validate). Layer 2 remains held until your separate direction.
