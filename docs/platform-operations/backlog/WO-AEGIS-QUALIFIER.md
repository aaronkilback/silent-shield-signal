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
