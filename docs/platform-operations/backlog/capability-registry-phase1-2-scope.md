# Capability Registry — Phase 1–2 Implementation Scope (deterministic channels, observe-first)

**Scope:** registry service · manifest · config · receipts · tool-executor gate · `proposeAction` gate · observe telemetry · deterministic-channel tests.
**Out of scope:** prose output guard · enforcement-on-prose · prod deploy.
**Goal:** make deterministic offered actions capability-checked and measurable first.

> **Reconciliation to confirm.** Acceptance says "tool exposure respects CanExecute" and "proposeAction cannot create an unavailable proposal" (= blocking), while the instruction says "do not implement enforcement mode yet." Resolution: the deterministic **enforce branch is built and proven by tests**, but Phase 1–2 **ships running `observe`** (compute + record, no behavior change) to measure the offer-then-would-fail rate. Flipping the two deterministic channels to `enforce` is a later, evidence-gated **config flip (no new code)**. Prose enforcement is not built at all. Flagging for reviewer sign-off.

---

## A. File manifest

**New**
- `supabase/functions/_shared/capability-registry.ts` — service + manifest + checks + receipt writer.
- `supabase/migrations/<ts>_capability_registry_observe.sql` — 2 tables + `agent_actions` columns + RLS (additive).
- `supabase/functions/_shared/__tests__/capability-registry.test.ts` — deterministic-channel tests.

**Modified**
- `supabase/functions/_shared/aegis-tool-executor.ts` — gate in `executeTool` + ctx threading.
- `supabase/functions/_shared/agent-actions.ts` — gate in `proposeAction` + ctx field.
- Tool-list assembly callers (orchestrators: `agent-chat`, `dashboard-ai-assistant`, `aegis-chat`) — pass `CapabilityContext`; filter offered tools (enforce) / record (observe).

## B. Schema (DDL, additive)

```sql
create table capability_registry (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null,                 -- '<resource>.<verb>' e.g. entity.create, web.search
  tenant_id uuid,                               -- null = global default
  environment text not null default '*',        -- 'voice'|'dashboard'|'ops'|'*'
  enabled boolean not null default false,        -- FAIL-CLOSED default
  required_authority text,                       -- role/permission for the verb
  notes text, updated_at timestamptz not null default now(),
  unique (capability_key, tenant_id, environment)
);
create table capability_check_receipts (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null, verb text not null,
  result boolean not null,                       -- allowed?
  would_block boolean not null,                  -- observe: would enforce have blocked?
  authority_source text not null,                -- 'manifest'|'environment'|'tenant'|'fail_closed'
  channel text not null,                         -- 'tool_exposure'|'tool_exec'|'proposal'
  mode text not null,                            -- 'observe'|'enforce'
  tenant_id uuid, environment text, actor text,
  detail jsonb, at timestamptz not null default now()
);
alter table agent_actions add column if not exists capability_checked boolean;
alter table agent_actions add column if not exists capability_result  boolean;
alter table agent_actions add column if not exists authority_source    text;
```
RLS: both tables tenant-scoped (global rows readable; tenant rows isolated). Index `capability_check_receipts (at)`, `(capability_key, mode)`.

## C. Capability manifest (the IMPLEMENTED axis — code source of truth)

```ts
// capability_key → is a wired, working executor present? (code fact, honest)
export const CAPABILITY_MANIFEST: Record<string, { implemented: boolean; verbs: string[]; resource: string }> = {
  'entity.read':       { implemented: true,  verbs:['read'],   resource:'entity' },
  'entity.create':     { implemented: true,  verbs:['create'], resource:'entity' },   // fn exists; ENV-gated off by default
  'agent.create':      { implemented: true,  verbs:['create'], resource:'agent'  },   // fn exists; ENV-gated off
  'workflow.execute':  { implemented: false, verbs:['execute'],resource:'workflow' }, // no wired executor → hard false
  'web.search':        { implemented: false, verbs:['execute'],resource:'web'    },   // EIL not built → hard false
  'arcgis.read':       { implemented: false, verbs:['read'],   resource:'arcgis' },   // not wired → hard false
  // ... signals/incidents/etc read = implemented:true
};
// Unknown key ⇒ treated as implemented:false (fail-closed).
```
Config (`capability_registry` rows) controls **ENV_ENABLED/TENANT_AUTHORIZED**; default `enabled=false`, so nothing is offered until a row (or the runtime authority check) grants it.

## D. `capability-registry.ts` service

```ts
export interface CapabilityContext { tenantId: string | null; environment: string; actorId?: string; mode: 'observe'|'enforce'|'off'; }
export interface CapabilityVerdict { allowed: boolean; wouldBlock: boolean; authoritySource: 'manifest'|'environment'|'tenant'|'fail_closed'; }

// Three-factor, fail-closed.
export async function canExecute(sb, capabilityKey: string, ctx: CapabilityContext): Promise<CapabilityVerdict>;
export async function canCRUD(verb, resource, ctx): Promise<CapabilityVerdict>;   // composes capabilityKey = `${resource}.${verb}`
export async function getAllowedTools(sb, toolNames: string[], ctx): Promise<{allowed: string[]; excluded: {tool,key}[]}>;
export async function recordCapabilityReceipt(sb, r): Promise<void>;
```
Logic of `canExecute`:
1. `IMPLEMENTED` = `CAPABILITY_MANIFEST[key]?.implemented === true` else **false**.
2. `ENV_ENABLED` = a `capability_registry` row matching (key, tenant|null, environment|'*') with `enabled=true`; default **false**.
3. `TENANT_AUTHORIZED` = runtime role/RLS check (reuse `tenant-isolation.ts`) for `required_authority`; default **false** if unknown.
4. `allowed = IMPLEMENTED ∧ ENV_ENABLED ∧ TENANT_AUTHORIZED`. Any error/unknown ⇒ `allowed=false`, `authoritySource='fail_closed'`.
5. `wouldBlock = !allowed`. **Mode `off`** → returns `allowed=true` (bypass) but still records. **`observe`** → returns the true verdict for recording; callers DO NOT act on it. **`enforce`** → callers act on `allowed`.
6. Always `recordCapabilityReceipt(...)`.

## E. Wiring — tool channel

`aegis-tool-executor.ts`, in `executeTool(toolName, args, supabaseClient, userId, ctx?)` — **add `ctx` param**; insert after handler lookup (current line ~60), before `handler(...)`:
```ts
const key = TOOL_TO_CAPABILITY[toolName];           // map; unknown ⇒ fail-closed
const v = await canExecute(supabaseClient, key ?? `unknown.${toolName}`, ctx);
if (ctx?.mode === 'enforce' && !v.allowed) {
  return boundaryResult(toolName, v);               // honest boundary, no execution
}
// observe: proceed; receipt already recorded by canExecute
```
**Tool exposure** (assembly in orchestrators): `getAllowedTools(sb, candidateToolNames, ctx)` → in `enforce`, offer only `allowed`; in `observe`, offer all but record `excluded` as `would_block`. Missing `ctx` ⇒ fail-closed receipts (surfaces un-threaded call sites).

## F. Wiring — proposeAction channel

`agent-actions.ts`: add `ctx: CapabilityContext` to `ProposedAction`; add `ACTIONTYPE_TO_CAPABILITY` map. Insert after the readonly check (current line ~58), before the insert:
```ts
const key = ACTIONTYPE_TO_CAPABILITY[input.actionType] ?? `unknown.${input.actionType}`;
const v = await canExecute(supabase, key, input.ctx);
// stamp the row regardless (audit)
const capFields = { capability_checked: true, capability_result: v.allowed, authority_source: v.authoritySource };
if (input.ctx.mode === 'enforce' && !v.allowed) {
  return { action_id: '', status: 'refused_capability', permission_tier: input.permissionTier,
           message: boundaryMessage(input.actionType, v) };   // NO agent_actions row written
}
// else proceed to insert (include capFields)
```
Result: in enforce, an unavailable action **cannot** create a proposal; in observe, it's written but flagged `capability_result=false` (measurable).

## G. Observe-mode telemetry & the headline metric

- Every check writes a receipt (`mode`, `result`, `would_block`, `channel`, `authority_source`, tenant/env).
- **Offer-then-would-fail rate** = `count(would_block=true) / count(all checks)` over the window, sliced by `capability_key`, `channel`, `tenant`, `environment`. This is the Phase 1–2 deliverable: it quantifies how often Aegis is *about to* offer an unavailable action — the Petronas failure rate, made visible — before any blocking.
- Dashboard: a small Neural-Constellation panel reading `capability_check_receipts` (top would-block capability_keys, rate trend).

## H. Mode flag

`capability_mode` config (per-environment): `off | observe | enforce`. Phase 1–2 default **observe** (staging). `off` = full bypass (rollback). Deterministic `enforce` = later config flip after observe evidence (no new code). Prose channel absent.

## I. Tests (deterministic channels)

1. **Offered ⇒ Executable** — for every manifest-allowed+enabled key, the gate returns `allowed=true` and the handler runs (enforce mode).
2. **Non-Executable ⇒ Honest Boundary** — `enforce` + unavailable key: tool not exposed, executor returns boundary (no handler call), `proposeAction` returns `refused_capability` with **no `agent_actions` row**.
3. **Environment drift** — toggle a `capability_registry.enabled` row → next `canExecute` reflects it immediately (no caching).
4. **Tenant isolation** — key enabled for Tenant A ⇒ `allowed=false` for Tenant B; no receipt/registry cross-tenant read.
5. **Fail-closed** — unknown key, missing ctx, or registry error ⇒ `allowed=false`, `authoritySource='fail_closed'`.
6. **Observe mode** — verdict computed + receipt written + `would_block` set, but behavior unchanged (tool runs, proposal written) — and the offer-then-would-fail rate query returns correct counts.
7. **Petronas regressions (enforce):** entity.create / web.search / agent.create / workflow.execute, when unavailable, are not exposed and cannot be proposed.

## J. Rollout / rollback

- **Phase 1–2 rollout:** apply migration (additive) → ship service + gates running **observe** on staging → seed `capability_registry` env/tenant rows → collect offer-then-would-fail rate → review. (Prod + enforce-flip are later phases.)
- **Rollback:** set `capability_mode=off` (instant, no DDL); per-channel disable; full = drop 2 tables + 3 columns, remove wiring. No data loss.

## K. Open decisions for reviewer

1. **Confirm the observe-vs-enforce reconciliation** (build+test enforce, ship observe).
2. **ctx threading:** approve adding `CapabilityContext` to `executeTool` and `ProposedAction` (signature change across orchestrator call sites); missing-ctx = fail-closed receipt (surfaces gaps).
3. **capability_key taxonomy** (`<resource>.<verb>`) + the two maps (`TOOL_TO_CAPABILITY`, `ACTIONTYPE_TO_CAPABILITY`) — initial coverage list.

*No code written, no deploy. Phase 1–2 = deterministic channels, observe-first, measurable. Prose guard scoped separately after this evidence.*
