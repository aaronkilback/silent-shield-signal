# INC-GEO-ANON-EXPOSURE-2026-08-11 — anon-EXECUTE-able SECURITY DEFINER RPC leaked client + household coordinates

**Status:** CONTAINED (revoked 2026-08-11 14:46Z). **Class:** anon data exposure (physical-location PII). **Caught by:** agent-sentinel Probe 2f → operator SMS.

## What
`public.client_geo_points()` — `SECURITY DEFINER`, no args — returned **every active client's asset names + exact lat/lon** to the anonymous internet: 8 rows, 5 PECL infrastructure assets **+ 3 Kilbacks household assets (children's school + 2 residences), precise coordinates.** Verified live with the public publishable key (returned the full set; post-fix returns HTTP 401 "permission denied").

## Root cause — the trap: `revoke from anon` ≠ `revoke from public`
The migration (`20260810170000_client_geo_points_rpc.sql`) **did** revoke — `revoke all on function … from anon, authenticated` — and its header even said "service-role only." But it **missed `public`.** Postgres grants `EXECUTE` to **PUBLIC by default** on `CREATE FUNCTION`, and the `anon` role **inherits through PUBLIC**. Revoking the named roles `anon`/`authenticated` while leaving PUBLIC intact left the function anon-EXECUTE-able. The sibling functions shipped the same day used `revoke … from anon, public` (correct) and were never exposed. **The defect was not a forgotten revoke — it was a revoke that named the wrong grantee.**

## Exposure window + attribution (stated plainly)
- **Window:** created 2026-08-10 ~17:00Z → revoked 2026-08-11 14:46Z ≈ **21.75 hours.**
- **Discoverability is real, not theoretical:** the anon/publishable key is public in the marketing bundle (apex ships Fortress prod's anon key — CLAUDE.md apex-audit). Endpoint + body shape are a single POST.
- **Was it called by an anon caller? UNKNOWN — no log retention answers it.** Postgres logs retain only ~30 min (and do not log successful anon RPC selects); the PostgREST/API request logs (which would show the POSTs) failed to fetch via MCP and, per INC-AITOOLS-XTENANT, Supabase edge/API request logs are not retained for the window. **Exploitation can be neither confirmed nor ruled out** — same log-retention gap as INC-AITOOLS-XTENANT. Given real discoverability, treat as reachable.

## Sweep — was it the only one?
Yes. Of **5 functions created since 2026-08-07**: `client_geo_points` (leaked, now fixed); `approve_entity_suggestion_batch`, `entity_suggestion_batches`, `containment_stale_check` (all correctly `revoke … from anon, public`); `tg_sca_append_only` (non-SECDEF trigger, not RPC-exposed). Comprehensive current runtime sweep: the only SECDEF functions with anon/PUBLIC EXECUTE are the 4 known-allowlisted (`get_user_accessible_client_ids`, `operator_invite_membership_check` — auth.uid()-scoped, return `[]` to anon; `st_estimatedextent` PostGIS; `handle_new_user` auth trigger). **Probe 2f now returns `[]`.**

## The control worked — record both halves
**Probe 2f (agent-sentinel, `security_anon_surface_scan()` → SMS) fired correctly on its FIRST real trigger and the SMS channel delivered** — surfacing a live exposure of the operator's family's home and school coordinates within a day of it shipping. This is the **output-assertion / "the door is shut" doctrine working end-to-end**: a deterministic after-apply probe caught what a same-day human revoke-discipline missed. The defect is worth recording; so is the control that found it. See [[feedback_output_assertion_probe_caught_the_secdef_leak]].

## Fix (applied) + process fix (layered)
1. **Applied (operator-ordered):** `revoke execute … from anon, public; grant execute … to authenticated, service_role;` — verified anon HTTP 401, Probe 2f clean. Migration file corrected for parity (with the root-cause note).
2. **Before-apply guard (built):** `scripts/check-secdef-anon-grants.mjs` — fails if a migration creates a `SECURITY DEFINER` non-trigger function without a `revoke … from … public` naming it, or explicitly grants EXECUTE to public/anon. Proven: passes the fixed changed-files, fails a synthetic `revoke from anon`-only. **Run changed-files-scoped** in pre-apply (a full-history run reports **78** file-level hits, but the runtime sweep shows only ~5 were ever actually exposed — the rest were revoked out-of-band or never got the default; a full-history blocking gate would be false-heavy, so this ships **audit-first / changed-files** per [[feedback_audit_before_blocking_ci]]).
3. **Durable DB guarantee (SCOPE — needs operator go, do not apply unilaterally):** `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` so new functions are **never** anon-EXECUTE-able by default — the class becomes structurally impossible, not regex-caught ([[feedback_regex_ci_guards_are_transitional]]: DB guarantee > typed API > regex). This changes default behavior for all future functions (correct per doctrine — no function should be PUBLIC-execute); it is a DB-wide privilege change, so it wants an explicit ruling, not a silent apply.
4. **After-apply probe (exists):** agent-sentinel Probe 2f — the net that caught this. Keep.

Layered: template/default (3) prevents → pre-apply check (2) catches before → Probe 2f (4) catches after. This incident had only (4); (2) and (3) close the before-apply gap.

## Open (operator ruling)
- Apply the durable `ALTER DEFAULT PRIVILEGES` guarantee (§3)? — recommend yes; it's the real class-fix.
- Wire `check-secdef-anon-grants.mjs` into the pre-apply lane (changed-files) — audit-first.
