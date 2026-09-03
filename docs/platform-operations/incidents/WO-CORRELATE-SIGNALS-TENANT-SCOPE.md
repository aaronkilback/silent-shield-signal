# WO-CORRELATE-SIGNALS-TENANT-SCOPE — cross-tenant correlation defect (2026-09-01, incident-grade write-up)

**Classification:** Structural tenant-isolation defect. **NOT a realized exposure — NOT a disclosure event.** Recorded incident-grade so a future client conversation or security review sees the analysis, not just the conclusion.

**Status:** CONTAINED (correlate-signals undeployed 2026-09-01). Fix pending (rebuild with tenant + is_test predicates + `client_id` on groups). 33 mixed structures + 25 cross-tenant groups pending step-3 cleanup.

---

## What happened

`correlate-signals` (invoked per-signal by `ingest-signal:2621`, fire-and-forget) built correlation groups from a candidate pool with **no tenant, no client, and no `is_test` predicate**:

```
// correlate-signals/index.ts:70 (fallback scan)
supabase.from('signals')
  .select('id, normalized_text, category, severity, location, confidence, source_id, created_at, correlation_group_id, is_primary_signal')
  .gte('created_at', timeWindowAgo)
  .neq('id', signal_id)
  .order('created_at', {ascending:false})
  .limit(100);
```

It pulled the **100 most recent signals platform-wide** (across all tenants and clients), handed them to an LLM (gpt-4o-mini) that judged "same or related event" at similarity ≥70, and stamped the matched signals with a shared `correlation_group_id`. The group `INSERT` (`:197`) also **never set `client_id`/`tenant_id`** — groups were born null-owner.

## Scope of the defect (measured)

- **25 correlation groups span two distinct real tenants** — every one pairs **Critical Risk Team + Silent Shield Operations**.
- **32 groups span two distinct real clients**, including a concrete group binding **BC Place (CRT tenant) + Petronas Canada (Silent Shield Ops tenant) + Kilbacks (Silent Shield Ops)** — correlated on a shared public CVE (Broadcom VMware vCenter path-traversal) and a Microsoft SharePoint advisory.
- **Most recent member: 2026-08-19** — the defect was live in production until containment.
- The correlation basis in the inspected groups is **shared public CVE / advisory content** (generic vulnerability intel affecting many orgs), not one client's confidential data. This bounds *how bad* a realized exposure would have been; it does not change *whether* one occurred.

## Why it is NOT a realized exposure (read-path evidence — recorded in full)

The cross-tenant links exist as stored `correlation_group_id` values, but **no read path returns a group's cross-tenant members to a user**. Every consumer of `signal_correlation_groups` / `signals.correlation_group_id` was traced:

**Q1 — Can a user in one tenant retrieve another tenant's signal through a group? NO.**
- Group **member signals** are read from the `signals` table, which has RLS enabled with tenant-scoped SELECT policies: `signals_select_tenant_scoped` and `signals_tenant_select` = `client_id IN (SELECT client_id FROM get_user_accessible_client_ids())`. A user querying `signals` by `correlation_group_id` receives **only members whose client they can access** — cross-tenant members are filtered by RLS.
- The `signal_correlation_groups` table itself has a tenant SELECT policy: `signal_correlation_groups_tenant_select` = `client_id IN get_user_accessible_client_ids()`. Because the writer never set `client_id`, cross-tenant groups have **NULL client_id → invisible to every non-service-role user** (double protection).
- Frontend consumers verified, all under user JWT (RLS applies): `SignalDetailDialog` (`:156`/`:167`), `Signals.tsx` (`:94` — explicit `tenant_id` + fail-closed), `ThreatStatusBar`, `EscalationPipeline`, `MatchingDashboard`, `MatchingTrendChart` (all `.eq('client_id', …)`).

**Q2 — Has any generated artifact ever included a cross-tenant group member? NO.**
- **No artifact-builder consumes correlation groups.** `generate-daily-briefing`, `generate-security-briefing`, `briefing-chat-response`, `generate-executive-report`, `generate-report` = **0 references** to `correlation_group_id`/`signal_correlation_groups`. The only edge read of signals by `correlation_group_id` anywhere is `correlate-signals:72` (the writer itself). `dashboard-ai-assistant:1329` is a schema-description docstring (a `tables:[…]` list), not a query.
- `report_claim_manifest` binds **0** signals total → 0 cross-tenant citations. (Caveat, Absence-Is-Not-A-Value: the manifest is empty, so this is weak alone — the strong evidence is the consumer-path proof that nothing builds an artifact from groups.)

**Q3 — Does RLS catch it, or does a service-role read bypass it? RLS catches it; no bypass path exists.**
- The reads that could surface members run under user JWT, where `signals` RLS filters cross-tenant members.
- The only service-role reader of correlation groups was `correlate-signals` (the writer) — it consumes members to form groups; it does not expose them into any tenant-facing artifact.

**Conclusion:** structural/storage defect, not realized exposure. **The RLS layer is the only reason this is a fix rather than a phone call** — defense-in-depth did its job. Correlation was crossing the tenant boundary in storage; RLS prevented it from ever reaching a user.

## Containment

Undeployed `correlate-signals` 2026-09-01 (`supabase functions delete`; invoke → HTTP 404). `ingest-signal`'s call is fire-and-forget (`.then()`, wrapped "don't fail the main request"), so ingest is unaffected. Re-enable only with the fix — never the current version.

## The fix (both predicates, non-negotiable together)

1. **Same-provenance for `is_test`** — candidate pool matches the subject signal's `is_test` (never mix test/real).
2. **Tenant scoping** — candidate pool scoped to the subject signal's tenant (never cross-tenant). *A test-filtered but still cross-tenant `correlate-signals` is the same defect with less noise in it — do not ship one without the other.*
3. **Groups carry `client_id`/`tenant_id` going forward** — a null-owner group is safe only by accident (same lesson as `detect-threat-patterns` being safe only by client-scoping). Set owner from the subject signal at `INSERT`.

## Sibling finding (same sweep)

`system-ops` contradiction detection (`:839`) is the **same shape** — platform-wide candidate pull (`.limit(300)`, no client filter) that **deliberately pairs cross-client** (`:873` `a.client_id !== b.client_id`). Currently **0 contradictions produced** (latent, never realized), but it needs the same tenant predicate. Open question for ruling: is `signal_contradictions` an operator-only surface (cross-tenant intended) or tenant-facing? `storyline-engine` has a narrower null-client fall-through hole (2 mixed storylines).

## Companion doctrines
Tenant-isolation-audit-checklist (service-role queries need explicit tenant filters; RLS-only fails open under service-role — here it held because the *readers* are user-JWT, but the *writer* had no tenant guard). Population-Before-Check (this escaped two prior sweeps because it never touches `entity_mentions`). Sibling of WO-ENTITY-MENTION-CONTAMINATION.
