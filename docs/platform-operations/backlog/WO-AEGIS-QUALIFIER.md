# WO-AEGIS-QUALIFIER — public qualification assistant (qualify → hand off, never close)

**Opened:** 2026-08-22 (promotes the operator-approved plan from chat to a durable WO).
**Binds to:** `WO-AEGIS-PUBLIC-ASSISTANT-REBUILD` (zero data-plane, caps, and the CATEGORY CONSTRAINT —
no urgency/scarcity/bump/exit-intent/unverified-sample mechanics). Those constraints govern.

## Purpose
Qualification, not closing. Three moves, then hand off — it does not sell, price, negotiate, or check out.
1. Surface the exposure concern. 2. Establish what changed recently (open question — no category prompting).
3. Confirm fit (principal / family office, not a security professional). Then hand off; Aaron responds personally.

## Build status
- **Step 1 — data model: DONE.** `aegis_qualifier_conversations` + `aegis_qualifier_purge_log` on the CRM
  project (`doedbzdgpkkdiubodvzb`); RLS deny-all-anon (service-role writes only); purge cron `not_fit`=7d,
  `in_progress`/`abandoned`=90d, `qualified` retained. Anon SELECT/INSERT proven denied.
- **Step 2 — send-sms operator-alert mode: DONE (deployed).** Additive `operator_alert` branch, gated on a
  direct service-role-key match, before `getClaims`; NO investigation_id, NO investigation logging; targets
  `AARON_ALERT_NUMBER` (env secret) so the recipient never enters source/chat. Live test still pending (see
  its own note — service-role key drift between out-of-band key and the function's injected env value).
- **Steps 3–5 — pending:** qualifier edge function (`aegis-qualify`, Fortress prod, verify_jwt=false, caps +
  rate-limit + zero data-plane), widget, CRM handoff write (`crm_conversations` + one SMS via operator_alert).

## Observability requirement — "0" must never be ambiguous (added 2026-08-24)
**The Live-intake panel (and any RLS-gated list) MUST visibly distinguish three states that currently all
render as an identical "0": (a) genuinely empty (no waiting/live visitors), (b) query failed (network/500),
(c) not authorized (no valid `auth.uid()` / RLS returned nothing / no membership).** Collapsing all three into
"0" is exactly how a real auth regression stayed invisible: a dual-`GoTrueClient` session race (two
`createClient()` for the CRM project on `/conversations`) invalidated the operator session, so every RLS read
returned empty — and the panel showed a calm "0" instead of "not authorized." A silently-empty operator surface
during a live-takeover window means a waiting visitor gets nothing.
- The list query must surface its `error` (render "couldn't load — retry", not 0) and its auth state (render
  "session expired — sign in" when `auth.uid()` is absent / membership check fails), separately from a true
  empty set ("no waiting visitors").
- **Structural fix already shipped (2026-08-24):** single shared CRM client (`src/integrations/crm/client.ts`);
  no component may `createClient()` the CRM project again. Add a build/lint guard against a second CRM
  `createClient` to prevent regression.
- Ties to WO-SITE-SURFACE-MONITOR: a silent-empty operator panel is the same failure family as the silent
  contact-form break — an absence rendered as a healthy zero.

## Fail-closed fallback string (CORRECTED 2026-08-22)
On any model/gateway error or out-of-scope refusal, the widget/system prompt returns the FIXED line — never
model-authored text:
> "I can't continue here — please call **(825) 904-8566**."
(Was the dead `778 220 4544`; corrected to the owned Twilio number `+1 825 904 8566`.)

## Published phone number = single source of truth (NEW, 2026-08-22)
**Root cause of the 778 mess:** two dead numbers (`778 655 0886`, `778 220 4544`) were hardcoded across two
repos with no canonical source, so a swap meant hunting every literal.
- **Single source:** one canonical `PUBLISHED_PHONE` (display + E.164) in **`fortress src/config/products.ts`**;
  every marketing surface (Hero, HomeSections, Navigation, qualifier fallback) references it, not a literal.
- **CI check (fortress build):** fail the build on **any hardcoded phone-number literal outside
  `src/config/products.ts`** — `tel:\+?1?\d{10}`, `\(\d{3}\)\s?\d{3}-\d{4}`, and bare `\d{10}` phone shapes.
  Audit-only first (per the transitional-guard doctrine), promote to blocking at zero.
- **Delivery repo (static HTML, separate build):** cannot import the fortress constant — give it its own
  build-time injection or a mirror constant + the same CI phone-literal guard, so both repos stay single-sourced.
- Sequencing: this refactor + guard is follow-on to the current literal `825` swap (which was the operator's
  explicit format instruction); the guard can only go blocking once the surfaces read from the single source.
