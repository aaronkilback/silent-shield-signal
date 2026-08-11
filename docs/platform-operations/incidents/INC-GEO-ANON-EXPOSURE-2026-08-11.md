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
3. **Durable DB guarantee — TESTED 2026-08-11, DOES NOT WORK ON THIS SUPABASE INSTANCE, REVERTED.** `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (and `… FROM anon`) *recorded* a clean default ACL for role `postgres` (`{postgres,authenticated,service_role}` — anon removed) — but a **fresh function was still anon-executable: proven HTTP 200** on a throwaway via the publishable key. The built-in PUBLIC EXECUTE grant is re-applied on new functions regardless (not via any of the 6 Supabase event triggers — checked). So the DB-default guarantee is **not achievable here** — itself a *second* "looks-correct-does-nothing" control discovered the same hour ([[feedback_cheap_proxy_for_expensive_correct_signal]] 9th instance). **Reverted to the Supabase baseline default ACL.** The per-function `revoke … from anon, public` (2) is therefore the RELIABLE control, not a fallback.
4. **After-apply probe (exists):** agent-sentinel Probe 2f — the net that caught this. Keep.

Layered (revised): per-function revoke (2) is PRIMARY, caught **before apply** by `check-secdef-anon-grants.mjs`; Probe 2f (4) catches **after**. The DB-default (3) is unavailable on Supabase. This incident had only (4); (2) closes the before-apply gap.

## Retention — twice now we could not answer "was it exploited" (SCOPE separately, do not build)
Both INC-GEO-ANON-EXPOSURE (this) and INC-AITOOLS-XTENANT hit the same wall: **no log layer retains enough to confirm-or-deny anon access** — postgres logs ~30 min and don't log successful anon RPC selects; edge/API request logs not retained for the window; `audit_events` 98%-null-actor. This is now a **recurring blind spot**, not a one-off. **Scope (do not build):** what would it take to answer "was an anon-reachable surface actually called during its exposure window" — API-gateway request-log retention/export, a lightweight anon-RPC access log, or shipping request logs to durable storage. [[WO-EXPLOITABILITY-LOG-RETENTION]].

## Open (operator ruling)
- ~~Apply the durable `ALTER DEFAULT PRIVILEGES` guarantee~~ — **TESTED, doesn't work on Supabase, reverted (§3).** Per-function revoke + pre-apply check is the control.
- `check-secdef-anon-grants.mjs` wired **audit-first** (npm `check:secdef-anon`, `--audit` exits 0; 78 legacy file-hits reported, ~5 ever runtime-exposed). Promote to blocking (changed-files) after legacy triage.
