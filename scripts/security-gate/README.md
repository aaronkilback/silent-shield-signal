# WO-CI-SECURITY-GATE-01 — fail-closed security gate

AST-based (TypeScript compiler API, **not regex** — false negatives are the failure mode that matters).
If the checker cannot prove a function safe, it **fails**. This is the control that would have caught both
2026-07-30 findings (`ai-tools-query` cross-tenant reads, `create-operator-invite` role escalation) and the
partial fix (`adce9554`) that missed them.

## Run
- `npm run security-gate` — gate mode (Claude Code / you run this before push). Fails on any NEW violation, any
  violation in a changed file, or a baseline count increase.
- `npm run security-gate:test` — the gate on the gate (fixture negative test). Run in CI before the gate.
- `npm run security-gate:baseline` — regenerate `baseline.json` (only to RECORD a decrease after fixes).

## Checks
1. **verify_jwt allowlist** — any `verify_jwt=false` edge function must be listed in `public-endpoints.json`
   with a written justification. New unallowlisted `verify_jwt=false`, or true→false without an entry, fails.
2. **service-role + request-derived scope** (core) — fails any function that (a) uses the service-role key,
   (b) reads `client_id`/`tenant_id`/`entity_id` from the request/query/tool-arg, and (c) has no caller-vs-
   `tenant_users` membership check (`get_user_accessible_client_ids`/`getAccessibleClientIds` also accepted).
   **Per switch/case branch** — a handler where some branches check membership and others do not fails on the
   unchecked branches (the `adce9554` case). NOTE: `getUser()`/`getCallerIdentity()` alone is *identity*, not
   *membership*, and a `.eq('tenant_id', <caller-supplied>)` is not a membership check.
3. **role escalation** — fails any write to `user_roles`/`operator_invites`/`tenant_invitations`/`tenant_users`
   where the role derives from request input without an allowlist. `super_admin` must never be request-grantable.
4. **RLS on new tables** — fails any migration that creates a table without `ENABLE ROW LEVEL SECURITY` **and**
   at least one policy in the same migration.
5. **shared-helper routing** — fails any edge function that READS request data (anything beyond `req.method` —
   `req.json()`/`req.headers`/`req.url`/body/…) without referencing a shared identity / accessible-client helper
   (`getCallerIdentity`, `getUserFromRequest`, `requireAuth`, `getAccessibleClientIds`, `userCanAccessClient`,
   `getAccessibleRowOrNull`, `filterAccessibleRows`). This is the structural finding of INC-AITOOLS-XTENANT made
   into a gate: *every hand-rolled auth gate in that incident was exposed; every function on the shared helper was
   safe.* A 503 containment stub (reads only `req.method`) is exempt by construction and does not trip. Hand-rolled
   auth that is *currently correct* still fails — it must adopt the shared helper OR carry an
   `@security-exempt(check5)` annotation justifying why (see `create-operator-invite`, which hand-rolls a correct
   `tenant_users` membership gate and is annotated).

## Baseline ratchet
`baseline.json` records current violations by `check|file|symbol`. The gate fails on violations **not** in the
baseline, on any violation in a **changed** file (no longer grandfathered), or on any per-check count increase.
**The baseline total may DECREASE, never increase.** Burn it down; never add to it.

## Exemptions (fail-closed override)
Only via an explicit, greppable source annotation carrying a reason and date, which must appear in the PR diff:
```
// @security-exempt(check2): <reason> — 2026-07-31
```
Supported for `check1`–`check5`. The annotation must be **one line** (the matcher is single-line) and the em-dash
before the date must be the only em-dash in it.

## Item-4 burn-down
All 231 `verify_jwt=false` functions ship allowlisted as `LEGACY-UNREVIEWED — pending WO item 4 triage` so the
gate ships today. The check-2 baseline (54 functions after INC-AITOOLS-XTENANT containments) is the item-4 triage
worklist: `docs/platform-operations/backlog/WO-item4-check2-worklist.md`.

The check-5 baseline (214 functions) is the broader hand-rolled-auth burn-down — every function that reads a
request without the shared helper. Migrate each to `getCallerIdentity` + accessible-client scoping, or annotate
with a justification, until the count reaches zero. This is a superset of the check-2 worklist (check-2 is the
subset that is also service-role + request-scoped, i.e. actively exploitable today).
