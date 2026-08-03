# WO-CRM-V1-CONVERSATION-TRACKER — manual sales-conversation tracker (Phase-1 plan, items 4 + 6)

**Status:** ✅ **Slice 1 LIVE + CLOSED (2026-08-03).** Deployed to prod via `main` merge `61d2f8e` (marketing site, CF Pages). Full path validated end-to-end: Cloudflare Access OTP → CRM login → capture → TODAY (follow-ups due) → Contacted today. RLS team model live on the Canada-Central CRM project (`doedbzdgpkkdiubodvzb`). See "Slice 1 shipping notes" below. **Target project:** a NEW dedicated CRM Supabase project (operator-created, option 2) — **NOT** pwnzw. `pwnzw` is DELETED (not in operator's Supabase account, Lovable account gone); the "CRM stays in pwnzw" ruling is **VOID**. UI = marketing repo route `/conversations` (NOT `/admin`), behind Cloudflare Access. **V1 = manual entry, no platform integrations.**

**Data residency (operator ruling 2026-08-03):** the CRM project is created in **Canada (Central)** (`ca-central-1`), not `us-west-1`. Project ref **`doedbzdgpkkdiubodvzb`** (`silent-shield-crm`), owning org **`jgoadshubgxnlekprnsd`** (same org as Fortress prod + staging). Client sales-conversation records (PII + deal context) stay in **Canadian jurisdiction** by design. Any future CRM data movement (replicas, backups, exports, downstream analytics) must preserve Canadian residency. Full ADR: `docs/platform-operations/architecture-decisions/crm-data-residency.md`.

**Team model (operator Correction, Phase-2 ruling):** ships WITH Slice 1, not after. `org_id` on both CRM tables; roles `rep`/`manager`/`admin`; reps see their own-assigned, managers see all in org, admin sees all; `assigned_to` separate from `created_by`; handoff (`crm_assign`) moves assignment + writes an `assigned` event. Proven three-user on staging 2026-08-03 (rep A / rep B / manager — rep-isolation, manager-visibility, handoff-moves-visibility, event-logged all green). Migration: marketing repo `supabase/migrations/20260803140000_crm_slice1_conversation_tracker.sql`. Frontend: `src/pages/Conversations.tsx` on branch `feat/crm-slice1` (dedicated CRM client via `VITE_CRM_SUPABASE_URL`/`VITE_CRM_SUPABASE_ANON_KEY`, inline CRM login).

**Env-var durability (operator ruling 2026-08-03) — DO NOT "clean up":** the marketing repo now ships a **deliberately committed** `.env.production` (force-added past `.gitignore`, commit `765d181` on `feat/crm-slice1`) holding all four public `VITE_*` values (Fortress-prod URL + publishable key, CRM URL + anon key). This is intentional, not a leak: anon/publishable keys are public by design and already ship in the browser bundle; RLS is the control. It exists because the site's prior build environment (Lovable account) is **gone** — committing the public values removes the dependency so any build (CF Pages / local wrangler / CI) inlines the correct backend. Real env vars still override the file. **Nobody may delete this file or "fix" it by removing the keys** — doing so re-introduces the risk that the next deploy loses these values and the site 500s. Header comment in the file forbids ever adding a `service_role`/Stripe/server-side secret there.

## Slice 1.5 — BUILT, awaiting deploy (2026-08-03)

Branch `feat/crm-slice1.5` (`2833e35`), off main. Two additions:
1. **Outbound sources** — `outbound_dm` + `profile_visit` added to the `source` CHECK + capture chips (outbound-first order, default `outbound_dm`). Migration `supabase/migrations/20260803160000_crm_slice1_5_outbound_sources.sql` (drop+re-add `crm_conversations_source_check`). **Run this in the CRM project SQL editor BEFORE deploying the frontend** — the migration only widens the allowed set, but the new chips fail on insert until it's applied. Proven on a staging fixture (new accepted, existing accepted, garbage rejected).
2. **Open-in-platform deep link** — each TODAY row's handle is a new-tab link. `platformLink()`: LinkedIn→profile, X→profile (no reliable handle-based DM deep link), **Instagram→DM thread via `ig.me/m/<user>`** (reliable mobile deep link). Strips leading `@`; suppresses when the handle is a name (whitespace)/empty or platform is `other`. Truth table proven (14 cases). **DM-deep-link finding:** only Instagram has a reliable handle-based DM link (`ig.me/m`); X and LinkedIn DM links need a numeric/member id we don't store, so both open the profile (Message button is one tap from there).

Deploy = D-GIT (Git-connected): run the migration in the CRM project first, then merge `feat/crm-slice1.5`→main. No auto-deploy issues; no new env vars.

## Slice 1 shipping notes (2026-08-03)

### Phantom-org root cause (seeding incident) — RESOLVED
First login hit *"No org membership found for this user."* Root cause: the **first seed used a UID (`46632e2d-…`) that was not a real user in this project** — it created org `a1112af7-…` owned by a phantom UID, so no login could ever match it. The real login user is **`a4e7ea60-…`** (`ak@silentshieldsecurity.com`). **Fix:** deleted the orphan `crm_org_members` row(s) whose `user_id` is not in `auth.users`, then reseeded `a4e7ea60` as `admin` with a fresh org. Login then resolved and the C smoke passed.

> **Seeding discipline (future reps/managers/orgs):** ALWAYS run `select id, email from auth.users order by created_at;` FIRST and paste the UID **from its output** — never from a chat message, a copied value, or another project. UUIDs are per-project (see the environment-specific-IDs rule). Diagnostic for "no membership": `select u.id,u.email,(m.user_id is not null) as has_membership from auth.users u left join public.crm_org_members m on m.user_id=u.id;` — a phantom membership row (org exists, `is_real_user=false`) is the signature.

### Outstanding follow-ups (LOG — do not build)
1. **CRM project Site URL was `localhost:3000`** (Supabase default) → **fixed to `https://silentshieldsecurity.com`**. Before the fix, every auth email (confirmations, magic links, password resets) pointed at localhost. Fixed 2026-08-03; note for any future Supabase project: set Site URL + redirect URLs at creation, before inviting users.
2. **Cloudflare Access policy still allows `Akilback@hotmail.com`** (the personal account used to stand up the project). Action: add `ak@silentshieldsecurity.com`, verify it authenticates, **then remove the personal `hotmail` address** before onboarding any rep — the allowlist should be the corporate identity, not the personal one.

**Governing constraint:** logging must be fast enough to do daily. If one entry > ~10s, it fails. So: one-action capture, one-tap everything, everything optional except the 3 fields that open a conversation. **The TODAY list is the product; metrics are below the fold.**

## Item 4a — SCHEMA (5 tables; event-sourced so metrics are free)

### `conversations` (one row per conversation — the core object)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| owner_user_id | uuid | the operator; RLS scopes to owner |
| platform | text | enum: `linkedin`/`x`/`instagram`/`other` (A) |
| handle | text | their @handle / name |
| source | text | enum: `follow`/`comment`/`story_view`/`inbound_dm`/`referral` (A) |
| stage | text | enum: `lead`/`qualified`/`offer_made`/`closed_won`/`closed_lost`, default `lead` (B) |
| last_contact_at | timestamptz | drives cadence; set = now() on create + on every "contacted today" (C) |
| followup_index | int | index into the cadence array `[0,1,1,2,3,5,8,13]`; ++ on each "contacted" (C) |
| awaiting_reply | bool | true after you send, false when they reply → drives "no reply in 48h" (C) |
| last_outbound_at / last_inbound_at | timestamptz | who spoke last (no-reply detection) |
| current_state / desired_state / primary_roadblock | text | qualification short fields, all optional (D) |
| urgency | int | 1–5, optional (D) |
| fit | text | `yes`/`no`/`maybe`, optional (D) |
| objection_tags | text[] | multi-select tags, seeded list (F) |
| notes | text | free text, never required (D) |
| closed_at / close_reason | timestamptz / text | won/lost |
| created_at / updated_at | timestamptz | |

**Derived, not stored:** `next_followup_due = last_contact_at + cadence[followup_index] days`; `days_since_last_touch = now() - last_contact_at`. (Compute in the query/view — nothing to keep in sync.)

### `conversation_events` (append-only — the source of ALL metrics, G)
`id, conversation_id fk, event_type, from_stage, to_stage, metadata jsonb, occurred_at default now(), actor_user_id`
- `event_type` ∈ `created`, `contacted`, `reply_received`, `stage_change`, `offer_made`, `offer_response`, `objection_changed`, `closed`.
- Every stage change writes `stage_change` (from→to) → **time-in-stage and cycle time come free** (B). Every "contacted today" writes `contacted`. Daily counters (G) are just `count(*) … where event_type=X and occurred_at::date = today`.

### `offers` (offers logged against the 7 tiers, E)
`id, conversation_id fk, tier_key fk->tiers, amount_cents, interval, status (made/accepted/declined/no_response), made_at, responded_at`
- `amount_cents`/`interval` **auto-fill from `tiers`** on insert (no typing prices). "Offers made, no response" = `status='made' and responded_at is null and made_at < now()-Xh`.

### `tiers` (reference — the single source of truth for pricing, E)
`tier_key pk, name, amount_cents, interval (one_time/monthly), has_checkout bool, payment_link, sort_order`
Seed (canonical 7, same as AEGIS / protection page):
`fortified_16 $500 one_time`, `digital_exposure_report $1,000 one_time`, `vulnerability_snapshot $10,000 one_time`, `sentinel $7,500 monthly`, `command $12,500 monthly`, `blackshield $25,000 monthly`, `sovereign_protocol $50,000 monthly has_checkout=false`. The offer dropdown reads this table.

### objections
V1: `objection_tags text[]` on the conversation (fast, one write). Seed the picklist: `price, timing, spouse/partner, need-to-think, tried-before, doing-fine-alone, trust, not-interested` (F). Write an `objection_changed` event on change so Objection Analysis has timestamped input. (A join table is the v2 only if per-objection timing is needed.)

**RLS:** all tables owner-scoped (`owner_user_id = auth.uid()`), RLS enabled at creation, server-side (not the client-side gate). Reuse the marketing project's role model.

## Item 4b — SCREENS (4; the list is the product)

1. **TODAY (default landing) — "what I owe" (C).** Three derived lists, no stored to-do:
   - **Follow-ups due:** `next_followup_due <= today` and stage active. Most-overdue first.
   - **No reply in 48h:** `awaiting_reply and last_outbound_at < now()-48h` and stage active.
   - **Offers pending:** `offers.status='made' and responded_at is null` past a threshold.
   - Each row: **who · platform · stage · days-since-last-touch · one-tap "Contacted today"** (sets `last_contact_at=now()`, `followup_index++`, `awaiting_reply=true`, writes `contacted` event → resets the cadence clock). Stage chevron advances stage in one tap (writes `stage_change`).
   - Metrics **below the fold**.
2. **New conversation (one-action modal, A).** Platform (4 buttons) · handle (text) · source (5 chips) → Save. Nothing else. <10s. Writes the row + `created` event.
3. **Conversation detail (fills in as it develops).** Stage control (one tap, B) · qualification short fields (D) · offer dropdown (7 tiers, amount auto-fills, E) · objection chips (F) · notes. All optional.
4. **Metrics (below fold / separate, G).** Daily counters (opened/replied/qualified/offers-made/closed) + funnel + time-in-stage + cycle time + objection analysis — all `select … from conversation_events`. Zero separate data entry.

## Cadence engine (C)
Array `[0,1,1,2,3,5,8,13]` days. On create: `last_contact_at=now()`, `followup_index=0` → due today. On "Contacted today": `last_contact_at=now()`, `followup_index = min(index+1, 7)` → next due in `cadence[index]` days. Beyond index 7, hold at 13-day cadence (or a `dormant` flag). Reply received → `awaiting_reply=false`, `last_inbound_at=now()` (clears the 48h-stale flag).

## Item 6 — BUILD ORDER (smallest usable thing first; analytics last)
- **Slice 1 — RUN CONVERSATIONS TOMORROW MORNING (the MVP).** Tables `conversations` + `conversation_events` (`created`/`contacted`/`stage_change`). Screens: **New-conversation one-action modal** + **TODAY list with follow-ups-due + one-tap "Contacted today" + one-tap stage advance**. This alone = capture in <10s, work the cadence daily, advance stages. No qualification/offer/objection/metrics yet. **This is the answer to "smallest thing I can use tomorrow."**
- **Slice 2 —** the other two TODAY lists: no-reply-48h (needs `awaiting_reply`/`last_inbound_at` + a "they replied" tap) and offers-pending (needs Slice 4).
- **Slice 3 —** qualification short fields (D) on detail.
- **Slice 4 —** `tiers` seed + `offers` + offer dropdown (E) → unlocks offers-pending list.
- **Slice 5 —** objection tags (F).
- **Slice 6 —** metrics/analytics panel (G), derived from `conversation_events`. Below the fold, last.

Each slice is independently shippable and usable. Slices 1–2 are the daily driver; 3–5 enrich; 6 is analytics.
