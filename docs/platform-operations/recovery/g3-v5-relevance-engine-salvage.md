# g3-v5 per-client relevance engine — SALVAGE (2026-08-13)

Recovered per operator ruling: the g3-v5 relevance system ran in prod (produced 940 `signal_relevance_shadow` rows) but is **prod-applied-unlanded** — none of it is in git. This file captures everything recoverable **before it is lost**. This is a salvage record, NOT a revive — do not wire it up from this doc; the revive-vs-rebuild decision is the operator's and needs the incident context.

## What is recoverable vs lost

| component | state | recoverable? |
|---|---|---|
| `compute-client-relevance` edge fn (**the ENGINE — LLM scoring logic**) | disabled stub in BOTH git and prod (v19); no prior-version content via API | **LOST** — unrecoverable |
| `gate3_enqueue_scoring` trigger fn | live in prod, not in git | ✅ recovered below |
| `signal_relevance_shadow` table | live in prod (940 rows), not in git | ✅ DDL below |
| `signals.gate3` column (jsonb) | live in prod, not in git | ✅ below |
| `client_risk_categories` table (the model INPUT) | live in prod (6 rows), not in git migrations | ✅ schema below |
| `gate3_relevance_live` feature flag | live in `app_feature_flags` | ✅ noted |

**The engine's scoring logic is gone.** A rebuild would use the surviving OUTPUT (940 shadow rows + the `breakdown` schema) and this contract as the spec — it is not a "revive the source" job, because the source no longer exists in any channel.

## Architecture (reconstructed from the surviving pieces)
1. **Input — `client_risk_categories`** (per-client risk taxonomy): `category_key, label, criticality, weight, polarity, persistence, match_spec jsonb, is_active`. This is the client-side relevance DEFINITION — relevance is scored as a *relation* between a signal and THIS client's risk categories. **6 rows total (Petronas); 0 for BC Place** — which is why the venue was never scored by g3 (the trigger requires active categories).
2. **Trigger — `gate3_enqueue_scoring`** on `signals`: if `gate3_relevance_live` flag is on AND `NEW.client_id` has active `client_risk_categories`, POST to `compute-client-relevance?mode=score_one&signal_id=…`.
3. **Engine — `compute-client-relevance`** (LOST): scored the signal against the client's categories → wrote `client_relevance` + `signal_quality` + `breakdown` to `signal_relevance_shadow` and `signals.gate3`.
4. **Output — `signal_relevance_shadow`**: `client_relevance` and `signal_quality` SEPARATED (relation vs property), plus a pathway `breakdown`.

## The disable (INC-AITOOLS-XTENANT-2026-07-30)
The engine was `verify_jwt=false`, service-role, read `client_id` from the request and wrote `signals.gate3` cross-client, gated only by a **STATIC hardcoded shared secret** (`x-smoke-key: ss-dr-smoke-9f3a2c`, visible in the trigger below) — not a tenant-membership check. That is the cross-tenant write vulnerability that got it hard-disabled. **Any revive MUST restore behind a caller `tenant_users`/membership check and rotate that secret.**

## Recovered: `gate3_enqueue_scoring` (trigger fn, verified from prod pg_get_functiondef)
```sql
CREATE OR REPLACE FUNCTION public.gate3_enqueue_scoring()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_live boolean; v_has_cats boolean;
begin
  select enabled into v_live from public.app_feature_flags where key='gate3_relevance_live';
  if coalesce(v_live,false) is not true then return null; end if;
  if NEW.client_id is null then return null; end if;
  select exists(select 1 from public.client_risk_categories where client_id=NEW.client_id and is_active) into v_has_cats;
  if not v_has_cats then return null; end if;
  perform net.http_post(
    url := 'https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/compute-client-relevance?mode=score_one&signal_id='||NEW.id::text,
    headers := jsonb_build_object('x-smoke-key','ss-dr-smoke-9f3a2c','Content-Type','application/json'),  -- STATIC SECRET — rotate on revive
    body := '{}'::jsonb, timeout_milliseconds := 20000);
  return null;
exception when others then
  raise warning 'gate3_enqueue_scoring failed (non-blocking) for signal %: %', NEW.id, sqlerrm;
  return null;
end $function$;
```

## Recovered: table DDL (shape only — capture into a baselined migration via WO-LEDGER-RECONCILE, never `db push`)
```sql
-- signal_relevance_shadow (OUTPUT; 940 prod rows, engine_version 'g3-v5', Petronas only)
CREATE TABLE public.signal_relevance_shadow (
  signal_id uuid, client_id uuid, client_relevance numeric, signal_quality numeric,
  breakdown jsonb, engine_version text, computed_at timestamptz);
-- signals.gate3 jsonb column (cross-client engine write target)
-- client_risk_categories (INPUT): id, client_id, tenant_id, category_key, label, criticality,
--   weight, polarity, persistence, match_spec jsonb, is_active, created_at, updated_at, created_by
```

## Recovered: the `breakdown` output contract (from a live g3-v5 shadow row)
```json
{ "tier": "low", "flags": [], "escalated": null, "rank_score": 0.1,
  "quality_gate": { "confidence": "anchored", "hard_exclude": false, "exclude_reason": null, "title_anchored": false },
  "relevance_gap": false, "suppressed_by": [], "assessed_paths": [], "relevant_because": [],
  "unassessable_paths": [], "confidently_irrelevant": true }
```
The model tracks: a tier, a rank_score, a quality gate (separate from relevance), assessed vs unassessable pathways, and explicit `relevant_because` reasons — a real relational model, not a keyword score.

## For the operator's revive-vs-rebuild decision (deferred)
- **There is no engine source to revive** — it is a rebuild, specced by the shadow output + this contract + `client_risk_categories`.
- The cross-tenant incident is a hard constraint (membership check + secret rotation).
- The venue archetype was never in the model at all (0 `client_risk_categories` for BC Place) — separate from the ingest-exclusion finding.
