# Capability Registry Enforcement — Implementation Design (TKT-3)

**Ticket:** #3 Capability Registry Enforcement · **Workstream:** Aegis Authority (Capability Registry AR1 / Receipts AR3 / Refusal AR4).
**Hard invariant:** *Aegis must determine authority before proposing action.* Never **offer → check later**; always **check → offer.**
**Status:** design for review. No production code, no deploy.

---

## 1. Current behavior analysis (verified against the tree)

- **No capability check exists.** Grep for `CanExecute / hasCapability / canCreate / capability_check` across `supabase/functions` returns **zero** hits. There is no enforcement layer today.
- **The existing action path gates the wrong axis.** `_shared/agent-actions.ts → proposeAction()` writes `agent_actions` rows by **permission tier** (`auto` → `auto_executing`; `propose` → `awaiting_approval`). That is *approval routing*, not *capability existence* — it answers "who must approve?", never "can this be done at all in this tenant/environment?"
- **Three ungated offer channels:**
  1. **Tool calls** — `aegis-tool-definitions.ts` tools are exposed unconditionally; `aegis-tool-executor.ts` runs them with no pre-check.
  2. **Structured proposals** — `proposeAction()` writes a proposal with no capability gate.
  3. **Prose offers** — the model says *"let's create an entity," "I'll pull that up," "I'll do a web search"* in free text, with nothing validating it.
- **Result:** capability is discovered **after** the operator commits (the Petronas failures). `system-capabilities.ts` / any prior `aegis-capability-registry.ts` are **descriptive/awareness** artifacts, not enforcement.

The hardest channel is **#3 (prose)** — it's model output, not a code path, so it cannot be fully prevented by code alone; it requires an output guard (below). Channels #1 and #2 are deterministically gateable.

## 2. Proposed architecture

A **fail-closed Capability Registry** consulted **before** any action is surfaced, on all three channels.

**Three-factor capability (all must hold; unknown ⇒ FALSE):**
```
CanExecute(action, ctx) =
      IMPLEMENTED(action)                      -- code: a wired, working executor exists
   ∧  ENV_ENABLED(action, ctx.environment)     -- config: voice|dashboard|ops · staging|prod · EIL on/off
   ∧  TENANT_AUTHORIZED(action, ctx.tenant)    -- runtime: tenant role/RLS authority for the verb
CanRead/Create/Update/Delete(resource, ctx) = same three-factor form on the resource verb.
```
- **IMPLEMENTED** is a *code fact* → declared in a code manifest (single source of truth for "is it built and wired").
- **ENV_ENABLED** is *config* → DB/registry table, tenant- and environment-keyed.
- **TENANT_AUTHORIZED** is *runtime* → reuse `tenant-isolation.ts` / role checks.
- **Fail-closed:** any factor unknown/error ⇒ `false` ⇒ not offered. (Don't offer what you can't prove you can do.)

**Three enforcement seams:**
1. **Tool exposure + executor** (deterministic): assemble the offered tool list from `getCapabilityManifest(ctx)`; `aegis-tool-executor` re-checks `CanExecute` before running (defense in depth).
2. **Structured proposals**: `proposeAction()` checks `CanExecute` before writing `agent_actions`; returns a boundary result if false.
3. **Response output-guard** (for prose): scan the drafted response for action-offer patterns, validate each against the registry; in enforce mode, rewrite the offer into an honest boundary before send.

**Context manifest injection** (soft, first line of defense — not relied on alone): inject `getCapabilityManifest(ctx)` ("what I can / cannot do here") into the Aegis system prompt so the model offers fewer unavailable actions.

**Receipts (AR3):** every check emits `{action, resource, verb, result, authority_source, channel, tenant, environment, ts}` to telemetry (reuse the flight-recorder chain-of-custody). Operator-facing exposure phased.

## 3. Required schema changes

```sql
-- Environment/tenant enablement + authority (the ENV_ENABLED / TENANT_AUTHORIZED axes).
-- IMPLEMENTED stays in code (capability manifest); this table never asserts a thing is built.
create table capability_registry (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null,            -- e.g. 'entity.create', 'web.search', 'workflow.execute'
  tenant_id uuid,                          -- null = applies to all tenants (global default)
  environment text not null,               -- 'voice' | 'dashboard' | 'ops' | '*'
  enabled boolean not null default false,  -- fail-closed default
  required_authority text,                 -- role/permission needed (RCUD/execute)
  notes text,
  updated_at timestamptz not null default now(),
  unique (capability_key, tenant_id, environment)
);

-- Capability-check receipts (telemetry; AR3).
create table capability_check_receipts (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null,
  verb text not null,                      -- read|create|update|delete|execute
  result boolean not null,
  authority_source text not null,          -- 'manifest' | 'environment' | 'tenant' | 'fail_closed'
  channel text not null,                   -- 'tool' | 'proposal' | 'prose_guard'
  tenant_id uuid, environment text,
  detail jsonb, at timestamptz not null default now()
);

-- Extend the existing proposal ledger with the check that gated it.
alter table agent_actions add column if not exists capability_checked boolean;
alter table agent_actions add column if not exists capability_result boolean;
alter table agent_actions add column if not exists authority_source text;
```
RLS: `capability_registry` and `capability_check_receipts` tenant-scoped (global rows readable; tenant rows isolated). Additive only.

## 4. Required service changes

New `_shared/capability-registry.ts`:
- `CAPABILITY_MANIFEST` — code constant: `capability_key → { implemented: boolean, verbs, resource, executor_ref }`. The **IMPLEMENTED** source of truth.
- `canExecute(action, ctx): { allowed, authority_source }` — three-factor, fail-closed.
- `canCRUD(verb, resource, ctx)` — same.
- `getCapabilityManifest(ctx)` — resolved CAN/CANNOT list for prompt injection + tool-list assembly.
- `recordCapabilityReceipt(...)` — writes the receipt (telemetry).

Wiring:
- `aegis-tool-executor.ts` — `canExecute` gate before running any tool; deny → boundary result + receipt.
- Tool-list assembly (`aegis-tool-definitions.ts` consumers) — expose only manifest-allowed tools for `ctx`.
- `agent-actions.ts → proposeAction()` — `canExecute` before the `agent_actions` insert; if false, return boundary (no proposal written); stamp `capability_checked/result/authority_source`.

## 5. Required Aegis orchestration changes

- **Manifest in context:** inject `getCapabilityManifest(ctx)` into the Aegis system prompt (reduce prose offers). Soft — not the enforcement.
- **Structured-offer routing:** any action Aegis intends to offer is expressed as a structured proposal validated by the registry *before* it reaches the operator; non-executable → replaced with an AR4 honest-boundary line.
- **Output guard (the prose backstop):** post-generation, scan the drafted response for offer patterns (`create|delete|update|execute|run|search|pull up|let's …`) tied to a capability_key; validate each via `canExecute`; **observe mode** → log would-block receipts; **enforce mode** → rewrite the offer to the boundary statement before send.
- **Boundary templates (AR4):** *"I cannot currently create entities in this environment."* / *"ArcGIS references exist in signal metadata; I do not have retrieval capability for the underlying map."* / *"I cannot determine whether entity-creation authority is available here."* (never the bare "the map doesn't exist").

## 6. Required tests

1. **Offered ⇒ Executable.** For every capability the manifest marks allowed in `ctx`, the corresponding action executes successfully (no offer without a passing executor).
2. **Non-Executable ⇒ Honest Boundary.** When `canExecute=false`, no tool is exposed, no proposal is written, and the response contains the boundary statement — **before** any offer. (Prose-channel test: a forced model offer of an unavailable action is rewritten by the output guard.)
3. **Environment drift.** Toggling `capability_registry.enabled` (or env) flips the next response immediately — no caching; `getCapabilityManifest` reflects the change on the next call.
4. **Tenant isolation.** A capability enabled for Tenant A is `false` for Tenant B; receipts/registry rows never cross tenants.
5. **Fail-closed.** Unknown capability_key / registry error ⇒ `canExecute=false` ⇒ not offered.
6. **Petronas regressions (must be impossible in enforce mode):** offer entity creation when unavailable · offer web search when unavailable · offer agent creation when unavailable · offer workflow execution when unavailable · discover inability only after commitment.

## 7. Rollout plan (observe → enforce, staging → prod)

Feature flag `capability_enforcement_mode ∈ {off, observe, enforce}` (default `off`).
1. **Schema + service + manifest** (additive; mode `off`).
2. **Observe (staging):** registry computes, **receipts logged**, output-guard logs would-block — **nothing blocked.** Measure the *offer-then-would-fail* rate; populate `capability_registry` env/tenant rows from observed gaps.
3. **Enforce structured channels (staging):** tool exposure/executor + `proposeAction` block; output guard still observe.
4. **Enforce output guard (staging):** prose offers rewritten. Validate the 6 regressions.
5. **Prod:** repeat observe-burn-in → enforce, gated on a clean would-block review. Verify deployed bundles after each function deploy (markers + intended-only delta); preserve `verify_jwt`.

## 8. Rollback plan

- **Instant:** flip `capability_enforcement_mode` → `observe` (stops blocking, keeps receipts) or `off`. No DDL.
- **Per-channel:** independent toggles for tool-gate / proposal-gate / output-guard so one can be relaxed without the others.
- **Full:** additive schema → drop the two tables + three `agent_actions` columns; remove `_shared/capability-registry.ts` wiring. No data loss.

## 9. Acceptance criteria

- **Hard invariant holds:** no action reaches the operator without a passing `canExecute` (check → offer), verified across all three channels.
- The four Petronas offers (entity creation · web actions · workflow execution · agent creation) are **impossible** when the capability is unavailable.
- **Fail-closed:** unknown ⇒ not offered.
- **Tenant- and environment-aware:** isolation holds; drift reflected on the next response.
- **Receipts present:** every offer/proposal carries `capability_checked / result / authority_source`.
- Inability is **never** discovered after commitment.

---

**Honest scope note.** Channels #1 (tools) and #2 (proposals) are deterministically enforceable and will be airtight in enforce mode. Channel #3 (prose) is model output — manifest injection *reduces* bad offers and the output guard *catches* them, but 100% prose prevention depends on the output guard running in enforce mode (telemetry-first to tune patterns). This is called out so "offered ⇒ executable" is not overstated for free-text before the guard is enforcing — consistent with the invariant we're enforcing.
