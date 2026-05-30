# Decision Layer Option C — G2 Authorization Sheet (pre-C.0 sign-off)

**Status:** PROPOSED 2026-05-30 — signable authorization artifact for G2-revised Option C implementation. **This document does not, by itself, authorize implementation.** Operator sign-off on §1–§11 below converts the G2 architecture (`architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md`) into the binding pre-implementation contract for **C.0 only** (the first phase: canonical workspace tenancy on `investigation_workspaces.tenant_id`). C.1–C.4 + cross-phase audit + CI gate remain separately gated.

**Supersedes:**
- `decision-layer-option-c-authorization-sheet-2026-05-30.md` (v1 + v2) — RESCINDED by security review and G2 approval
- `decision-layer-option-c-cq-recommendations-2026-05-30.md` v2 — superseded by this sheet for CQ1 / CQ4 resolutions (the rest stand)
- `architecture-decisions/decision-layer-option-c-schema-patches-2026-05-29.md` v1/v2 — superseded as the operative ADR by the G2 architecture doc

**Companion artifacts (active):**
- `architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md` (G2 ADR — this sheet's pre-implementation contract)
- `decision-layer-option-c-v2-security-review-2026-05-30.md` (the review that led to G2)
- `architecture-decisions/decision-layer-doctrine-2026-05-29.md` (v2, RATIFIED)
- `architecture-decisions/decision-layer-r1-threshold-detection-2026-05-29.md` (R1 ADR, unchanged)

**Operator-stated 2026-05-30 (verbatim, locked binding clauses):**

> RC1 — Trigger enforcing tenant chain match.
> RC2 — `get_workspace_tenant_id` must raise an exception on path disagreement. No silent COALESCE winner.
> RC3 — Continuous drift-detection audit.
> RC4 — CI guard preventing writers from bypassing the canonical helper.
> RC5 — Promote tenant ownership to `investigation_workspaces`.
>
> Goal: **Single source of truth for workspace ownership.**

All five controls are mandatory. Each appears as an explicit sign-off item below.

---

## How to use this sheet

For each item: indicate `CONFIRM` (accept the default per the G2 ADR), `OVERRIDE → [value]` (substitute a value), or `DEFER` (where defer-eligible). C.0 implementation is **only** authorized when items §1, §2, §3, §4, §5, §6, §7, §10, §11 are confirmed. Items §8 (pilot tenant) and §9 (audit cadence) are defer-eligible through C.0 only; they bind before C.1.

---

## §1 — RC5 — Canonical workspace tenancy on `investigation_workspaces` (the load-bearing structural change)

C.0 adds `investigation_workspaces.tenant_id uuid NOT NULL` as the canonical source of truth. Backfill via the two-path COALESCE chain runs **once** here; the chain is never used again on any child table. Consistency CHECK + BEFORE INSERT/UPDATE trigger enforce the canonical value.

| Element | Status |
|---|---|
| ADD COLUMN `tenant_id uuid` | scoped to C.0 |
| Backfill via COALESCE(Path A, Path B), with HALT-on-disagreement guard | scoped to C.0 |
| ALTER COLUMN SET NOT NULL | scoped to C.0 |
| Named CHECK constraint `investigation_workspaces_provenance_ck` | scoped to C.0 |
| BEFORE INSERT/UPDATE trigger (auto-fill + raise on mismatch + raise on disagreement) | scoped to C.0 |
| `get_workspace_tenant_id(uuid)` RPC (raises on NULL) | scoped to C.0 |

**Operator action:** ☐ CONFIRM RC5 + C.0 scope as defined · ☐ OVERRIDE: ______________

---

## §2 — RC1 — Trigger enforcing tenant chain match on `cop_timeline_events`

C.1 adds the child-side trigger. Before INSERT/UPDATE, the trigger looks up `investigation_workspaces.tenant_id` for the row's `workspace_id`. Behavior:

- If `NEW.tenant_id` is NULL: auto-fill from workspace
- If `NEW.tenant_id` matches workspace: pass
- If `NEW.tenant_id` mismatches workspace: **RAISE EXCEPTION**
- If workspace has NULL tenant_id (should be impossible post-C.0; defense in depth): **RAISE EXCEPTION**

Service-role cannot spoof. Writer-provided `tenant_id` cannot diverge from workspace canonical.

**Operator action:** ☐ CONFIRM RC1 trigger on cop_timeline_events · ☐ OVERRIDE: ______________

---

## §3 — RC2 — RPC raises EXCEPTION on path disagreement (no silent COALESCE winner)

Per the G2 architecture: RC2's "raise on disagreement" lives in the **C.0 trigger** on `investigation_workspaces` (not in the RPC). This is structurally stronger — disagreement cannot persist, so the read RPC inherits the property for free.

- C.0 trigger raises EXCEPTION if Path A's tenant ≠ Path B's tenant when both populated
- The RPC `get_workspace_tenant_id` raises if `investigation_workspaces.tenant_id` is NULL (should be impossible post-C.0; defense in depth)
- Backfill HALT-on-disagreement guard surfaces existing data inconsistencies before they can be persisted with a silent COALESCE winner

**Operator action:** ☐ CONFIRM RC2 implemented at C.0 trigger + RPC level · ☐ OVERRIDE: ______________

---

## §4 — RC3 — Continuous drift-detection audit

Audit RPC `audit_cop_timeline_events_tenant_drift()` returns rows where the stored tenant_id differs from the canonical workspace tenant_id. Cron schedules nightly run; non-zero result creates a P1 incident in the incidents table.

A parallel audit on `investigation_workspaces` itself checks the trigger's invariant (Path A / Path B agreement) — defense in depth against a future trigger DISABLE.

Both audits ship as part of the C.1 phase (the cop_timeline_events audit) and C.0 phase (the workspace audit).

**Operator action:** ☐ CONFIRM RC3 audit + nightly cron + P1 alerting · ☐ OVERRIDE: ______________

---

## §5 — RC4 — CI guard preventing writers from bypassing the canonical helper

`scripts/check-cop-timeline-writer-discipline.mjs` static-grep guard. Fails CI on any `.from('cop_timeline_events').(insert|upsert|update)` outside `src/lib/cop-timeline-writer.ts` (the canonical writer helper introduced in C.2).

Lands before C.2 so the canonical helper is the only allowed path from day 1 of C.2. Wired into the Fortress CI workflow as a required check. Allowlist additions require explicit reviewer approval.

**Operator action:** ☐ CONFIRM RC4 CI guard wiring · ☐ OVERRIDE: ______________

---

## §6 — Revised phase plan

| Phase | Scope | Gate |
|---|---|---|
| **C.0** | RC5 + RC1 (parent) + RC2 + named Provenance CHECK on `investigation_workspaces`. Backfill from two-path COALESCE chain with HALT-on-disagreement guard. Staging-first then prod, parity verification. | This sheet |
| **C.1** | G3 schema on `cop_timeline_events` (one-hop backfill from canonical workspace tenancy) + RC1 child trigger + named Provenance CHECK + service-role manage RLS policy (per CQ2 v2). **Includes RC3 audit deployment for cop_timeline_events.** | C.0 green + separate operator GO |
| **CI gate** | RC4 static-grep guard deployed to CI workflow | Lands before C.2 (so the canonical helper is the only allowed path) |
| **C.2** | G3 writer plumb. New canonical helper `src/lib/cop-timeline-writer.ts`. `COPCanvas.tsx:178` retrofitted to call the helper (passes through to `addEvent` with workspace context; trigger auto-fills tenant_id). | C.1 green + RC4 deployed + separate operator GO |
| **C.3** | G1 schema migration (`investigations.next_review_at` column add + named Provenance CHECK) | C.2 green + separate operator GO |
| **C.4** | G1 editor plumb (form field + edge function payload field for `next_review_at`) | C.3 green + separate operator GO |

All phases reversible at the schema layer. Each phase its own operator GO. R1.1 remains **locked behind §8 inventory-rerun gate** regardless of C.0–C.4 completion.

**Operator action:** ☐ CONFIRM revised phase plan (C.0 → C.1 → CI gate → C.2 → C.3 → C.4) · ☐ OVERRIDE: ______________

---

## §7 — Verification + monitoring (all 8 automated tests + 6 monitors required)

Per the G2 architecture §7:

**Automated tests (CI):** AT1 trigger rejects mismatched tenant_id · AT2 C.0 backfill HALTS on disagreement (fixture) · AT3 adversarial service-role direct INSERT rejected · AT4 drift detector returns 0 in clean state · AT5 migration validation · AT6 RLS regression suite · AT7 PETRONAS/CRT cross-tenant contamination fixture · AT8 CI guard self-test

**Continuous production monitoring:** drift count (nightly) · workspace-consistency violation count (nightly) · trigger-state ENABLED (hourly) · NULL tenant_id (continuous) · RLS-policy change (continuous via DB audit log) · CI guard failure rate (per PR)

**Operator action:** ☐ CONFIRM full verification + monitoring scope · ☐ OVERRIDE: ______________

---

## §8 — Pilot tenant Phase 1 (defer-eligible through C.0 only)

Phase 1 = 24h sanity validation on an internal/test fixture after C.0 + C.1 + CI gate land. Validates:
- Schema migrations apply cleanly
- C.0 backfill HALT-on-disagreement guard works on a contrived fixture row (artificially create a workspace with conflicting parents in the test fixture, observe migration HALT)
- C.1 trigger rejects a contrived mismatched-tenant_id INSERT
- C.2 canonical helper writes a tenant-scoped event end-to-end
- RC3 audit returns 0 in the clean state
- RC4 CI guard catches a sample bad-writer PR

| Phase 1 fixture | Operator action |
|---|---|
| Recommended: dedicated `_pilot_optionc` fixture | ☐ CONFIRM `_pilot_optionc` ☐ Name alt: ______________ ☐ DEFER |

---

## §9 — Pilot tenant Phase 2 (defer-eligible through C.0 only; mandatory before C.1)

Phase 2 = 2-week empirical-lift window per the G2 architecture's success criterion. Real-tenant operator uses the Briefing Room timeline UI for actual principal events.

| Phase 2 primary tenant | Operator action |
|---|---|
| Recommended: **Petronas Canada (PECL)** primary; BCCH held until PECL +1 week clean | ☐ CONFIRM PECL primary ☐ OVERRIDE: ______________ ☐ DEFER (item 9 only) |

Item 9 may be deferred through C.0 (the canonical schema can land without a designated Phase 2 tenant). Must confirm before C.1.

---

## §10 — Option C is NOT R1.1 authorization (locked binding clause, unchanged)

Per operator 2026-05-30:

> *"Option C remains a commitment-inventory improvement effort. It is NOT authorization for R1.1."*

G2 completion (C.0 through C.4 green) does **NOT** authorize:
- R1.1 (C1 detector) · R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7
- R2 / R3 / R4 / R5 / R6
- Any prompt-assembly change
- Any output-shape change
- Any Decision Frame generation
- Any modification to the doctrine or the R1 ADR

R1.1 authorization remains a **separate, future operator GO** that depends on §11 below.

**Operator action:** ☐ CONFIRM Option C is NOT R1.1 authorization · ☐ OVERRIDE: ______________

---

## §11 — Post-Option-C re-run of the commitment inventory study (locked binding clause, unchanged)

Per operator 2026-05-30:

> *"After Option C is complete, I want the commitment inventory study re-run before any Decision Layer detector work is authorized."*

After C.4 green, **before** any R1.1 / R1.x / R2+ authorization conversation, the commitment inventory study is re-run against post-Option-C prod state and produced as a new artifact. The re-run study **is the gate** between Option C and any future detector authorization.

If §13 thresholds in the original ADR aren't met after 2 weeks of Phase 2 operation, the operator pivots to Option B (now view-shaped per CQ6) or Option E (conversation-extraction) rather than R1.1.

**Operator action:** ☐ CONFIRM re-run is the next mandatory gate · ☐ OVERRIDE: ______________

---

## §12 — Held items remain unchanged

P5 · P6 · Class B · PR #36 · R1.0 (deployed, unaffected) · **R1.1 (still NOT authorized; §11 gate stands)** · R1.2–R1.7 · R2–R6 · Decision Layer Doctrine · R1 ADR · I1 / I2 operator-locked invariants · R1 §B watchlist · Options A and F (rejected) · Options B / D / E (unchanged; B's eventual design scope still view-shaped per CQ6 v2).

**Operator-locked CQ1 strictness is preserved verbatim and strengthened by triggers.** No softening. No nullable transition.

**Operator action:** ☐ CONFIRM held items unchanged · ☐ OVERRIDE: ______________

---

## What sign-off on this sheet authorizes

If §1–§7, §10, §11, §12 are all `CONFIRM`ed (with §8, §9 either confirmed or deferred through C.0):

### ✅ Authorized by this sheet
- **C.0 only** — RC5 canonical workspace tenancy on `investigation_workspaces`:
  - `ALTER TABLE investigation_workspaces ADD COLUMN tenant_id uuid`
  - Backfill via COALESCE(Path A, Path B) with HALT-on-disagreement guard
  - `SET NOT NULL` + named Provenance CHECK
  - BEFORE INSERT/UPDATE trigger (RC1 parent-side enforcement, RC2 path-disagreement raise)
  - `get_workspace_tenant_id(uuid)` RPC creation
  - Staging-first then prod with parity verification
  - **Zero behavioral effect on Decision Layer detector path**

### ❌ NOT authorized by this sheet
- C.1 (cop_timeline_events column + child trigger + RLS + audit) — separate operator GO
- CI gate deployment (RC4) — separate operator GO
- C.2 (writer plumb + canonical helper) — separate operator GO
- C.3 (investigations column) — separate operator GO
- C.4 (investigation editor plumb) — separate operator GO
- G2 (incidents.principal_tier_deadline_at) — operator-deferred (was: not part of G2 either way)
- R1.1 — locked behind §11
- R1.2–R1.7 · R2–R6
- Any change to the Decision Layer Doctrine, R1 ADR, G2 ADR, any prior CQ recommendations, any held item
- Any prompt-assembly change · any output-shape change · any Decision Frame generation

Each subsequent phase has its own separate operator GO.

---

## Sign-off block

| Item | Operator decision | Date |
|---|---|---|
| §1 RC5 + C.0 scope | _to be marked by operator_ | _____________ |
| §2 RC1 trigger on cop_timeline_events | _to be marked by operator_ | _____________ |
| §3 RC2 raise on disagreement (at C.0 trigger + RPC) | _to be marked by operator_ | _____________ |
| §4 RC3 continuous drift audit | _to be marked by operator_ | _____________ |
| §5 RC4 CI guard | _to be marked by operator_ | _____________ |
| §6 Revised phase plan | _to be marked by operator_ | _____________ |
| §7 Verification + monitoring scope | _to be marked by operator_ | _____________ |
| §8 Phase 1 pilot fixture | _to be marked by operator (or DEFER)_ | _____________ |
| §9 Phase 2 primary tenant | _to be marked by operator (or DEFER through C.0)_ | _____________ |
| §10 Option C is NOT R1.1 authorization (locked) | _to be marked by operator_ | _____________ |
| §11 Re-run inventory study before any detector work (locked) | _to be marked by operator_ | _____________ |
| §12 Held items unchanged | _to be marked by operator_ | _____________ |
| **Authorization for C.0** | ☐ AUTHORIZED ☐ NOT YET AUTHORIZED | _____________ |
| Authorizing operator | _______________________________ | _____________ |

Operator's authorization signal in this session is the chat message "Authorize C.0 (G2)" (or equivalent unambiguous wording) with item-by-item decisions, after which §1–§12 above are recorded as the binding pre-implementation contract for C.0 only.

## Changelog

- **2026-05-30 v1 (G2)** — initial G2 authorization sheet. Supersedes the v1+v2 Option C authorization sheets (both rescinded by the security review and G2 approval). Captures the five required controls (RC1–RC5) as explicit sign-off items. Phase plan revised: C.0 (NEW per RC5) → C.1 → CI gate → C.2 → C.3 → C.4. Operator-locked §10 (Option C is not R1.1 authorization) and §11 (inventory-study re-run before any detector work) carried forward verbatim. Twelve items: ten mandatory + two defer-eligible (§8, §9 through C.0 only).
