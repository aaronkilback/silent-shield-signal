# WO-DECOUPLE-MARKETING-FROM-FORTRESS-PROD — marketing apex must not carry a Fortress-prod credential

**Logged:** 2026-08-02 (apex-audit ruling, P3). **Status:** SCOPE ONLY — do not build. **Priority:** hygiene, NOT remediation.

## Finding
The live apex `silentshieldsecurity.com` (repo `silent-shield-fortress`, CF Pages) ships a Supabase client pointed at **`kpuqukppbmwebiptqmog` — the Fortress *prod* project** — with that project's anon key baked into the public bundle. Confirmed from the live bundle + a valid-key probe. The marketing schema it expects (`orders`, `contact_messages`, `visitor_daily_summary`, `aegis_conversations`) does **not** exist there (404 PGRST205) — the marketing data layer is effectively pointed at the wrong database (which is also why the `/admin` dashboard "black-screens" and needs null-guards).

## Why it is hygiene, not remediation
The anon key is **public by design** — it ships in *both* the marketing bundle **and** the Fortress app bundle at `fortress.silentshieldsecurity.com`. So decoupling the marketing site removes one distribution channel but **fixes none** of the anon-surface findings (those were remediated directly on Fortress prod — see `20260802210000_anon_surface_hardening_audit.sql` + agent-sentinel Probe 2f). Decoupling is still correct: **a public marketing site should not hold a credential to tenant intelligence at all**, even a properly-RLS'd one — it widens the audience that can probe the surface and couples marketing uptime/keys to Fortress prod.

## Scope (do not build)
1. **Provision a separate Supabase project for marketing** (orders, contact_messages, visitor_*, aegis_conversations, academy_*, etc. — the schema the marketing bundle references). Move/recreate those tables there.
2. **Repoint the marketing build** (`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` CF Pages env) at the marketing project. The apex then never carries a Fortress-prod credential.
3. **Reconcile the schema drift**: some marketing-ish tables (`academy_*`) *do* live in Fortress prod today while others (`orders`, `contact_messages`) live nowhere reachable — inventory what the apex actually needs and where it currently resolves (mostly 404).
4. **RLS-at-Creation on the new project** from day one (the doctrine that just proved load-bearing here).
5. **Keep `/admin`'s guard server-side on the new project too** — the current email allowlist is client-side only; pair it with a real RLS/role gate on whatever tables the new admin reads.

## RULING (operator, 2026-08-02) — CRM STAYS IN THE MARKETING PROJECT
**The CRM tables (`orders`, `contact_messages`, `aegis_conversations`, `visitor_*`) stay in the marketing project `pwnzwxfzjkjsbfwtfyip`. Do NOT move them to Fortress prod (`kpuqukppbmwebiptqmog`).** Co-locating payment records + PII + sales conversation logs with tenant intelligence is exactly the coupling this WO removes. They already exist in `pwnzw` (created there with RLS + admin policies per the marketing repo migrations). The decouple work is therefore: **repoint the live apex bundle off Fortress prod and back onto the marketing project** (its intended home), so the public bundle stops carrying a Fortress-prod credential — NOT a data migration into Fortress prod.
- `/admin` gating (Access vs separate host) + server-side role enforcement on the marketing project remain open design items (the marketing project has its own `app_role` enum: admin/moderator/user).

## Dependency / sequencing
Independent of the Fortress-prod anon-surface hardening (already done). Can proceed on its own timeline. Until then, Fortress prod RLS is the load-bearing control and agent-sentinel Probe 2f guards it.
