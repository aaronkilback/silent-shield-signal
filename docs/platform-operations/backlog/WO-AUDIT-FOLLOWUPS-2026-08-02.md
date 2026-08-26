# WO-AUDIT-FOLLOWUPS-2026-08-02 — apex-audit follow-ups (log/scope, do not build)

## FU-1 — Auth-graph oracles: make parameterized variants `auth.uid()`-scoped (Item 5, LOG)
The P1 anon-surface fix revoked anon EXECUTE on the parameterized auth-graph oracles (`has_role(uuid,…)`, `is_super_admin(uuid)`, `get_user_accessible_client_ids(uuid)`, `get_user_tenant_ids(uuid)`, `is_tenant_member(uuid,uuid)`, `is_workspace_owner(…)`, etc.) but **re-granted `authenticated`** (required — 175 TO-public RLS policies call them). So any **authenticated** user can still call them for an **arbitrary `_user_id`** and read the authorization graph (proven: `is_super_admin(<admin>)→true`, `get_user_accessible_client_ids(<admin>)→real client IDs`). **Signup being disabled is the only thing gating a stranger from this — that is a configuration flag, not a control.**

**Fix (do not build now):** replace the parameterized variants used inside RLS with **`auth.uid()`-scoped** versions (no `_user_id` parameter — they answer only about the *caller*), so they self-limit regardless of signup state. Callers inside RLS already pass `auth.uid()`, so this is mechanical; audit for any call site passing a non-`auth.uid()` id (those are the actual privilege checks and need the operator/Ops seam, not a public RPC). Retire the parameterized overloads from the PostgREST-exposed schema (or move to a non-exposed schema). Acceptance: no authenticated user can query the auth graph for a user_id other than their own.

## FU-2 — CRITICAL-only SMS alert channel via Twilio (Item 4, SCOPE)
**Ruled:** SMS via Twilio (already wired — MFA uses `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE`), critical only, volume near-zero so it never gets muted. Not built.

**Volume reality (last 30d):** 11 distinct critical findings fired — but mostly operational: 4 same-day secret-age warnings, recurring registry-phantoms, alert-delivery routing (one with 20 recurrences). Paging on *all* criticals ≈ 11/30d → would get muted. **The scope must be narrow.**

**Scope:**
- **Page only on the security-exposure class** — `category='security_posture'` criticals (the Probe 2f anon/authenticated-surface breaches). **Over the last 30 days that set = 0** (Probe 2f is new + fired clean). That is the near-zero bar. Operational criticals (secret-age, registry-phantom, alert-delivery) stay on email/dashboard.
- **Page once per NEW finding** (dedupe on `fingerprint` / `first_seen_at`), never per recurrence — else a recurring critical spams.
- **Wire in `system-watchdog`** where `isCritical` already forces the email: add a parallel `if (finding.category==='security_posture' && isNewCritical) sendSms(...)` via a small Twilio call (reuse the MFA Twilio creds), to a dedicated operator number.
- **Guardrail:** a monthly self-test SMS + a cap (e.g. ≤3 SMS/day, overflow → email) so a probe bug can't storm the channel. If volume ever exceeds ~1-2/week, the channel is mis-scoped — fix the scope, don't mute.
