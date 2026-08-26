# WO-AEGIS-PUBLIC-ASSISTANT-REBUILD — public product assistant, zero data-plane access (SCOPE, do not build)

**Ruling 2026-08-05 (operator): option 1.** Rebuild the homepage chat as a **public product assistant with NO access to signals, entities, incidents, or any tenant table.** Never re-expose the tenant tool loop unauthenticated (that is what INC-AITOOLS-XTENANT contained).

## Homepage state RIGHT NOW (answered — it IS a broken widget)
`AegisChat` renders in the hero (`AegisHero.tsx`) and is live in the current marketing bundle. It posts to `/functions/v1/aegis-chat`, which has been a **503 stub since 2026-07-31**. On send, the catch shows `toast.error("Something went wrong. Please try again.")`. So a visitor sees a working-looking chat, types, and gets an error — **a broken widget presented as a product feature.** Per the operator: that is worse than removing it, and **removing it is a same-day fix** (drop `<AegisChat/>` from `AegisHero`, or replace with a static CTA) — do that while this rebuild is scoped.

## Scope
1. **New function, zero data-plane.** No `clientId`, no service-role reads of signals/entities/incidents/clients/any tenant table. It cannot be tricked into tenant data because it has no code path to it. verify_jwt can stay false (public) precisely because it touches nothing sensitive.
2. **Its only factual source = the 7 canonical tiers + payment links** (same source as the protection page / AegisChat PRODUCTS): fortified_16 $500, digital_exposure_report $1,000, vulnerability_snapshot $10,000, sentinel $7,500/mo, command $12,500/mo, blackshield $25,000/mo, sovereign_protocol $50,000/mo. Scope: product, pricing, qualification only. System prompt is the tier table; refuse anything requiring tenant data ("that's handled after onboarding").
3. **Caps (public + uncapped is how bills happen):**
   - **Per-session message cap** (e.g. ≤ 10 messages/session, keyed by a session id).
   - **Daily token ceiling** (platform-wide hard stop, e.g. 2M tokens/day → refuse with a "back tomorrow / book a call" message).
   - Small model (gpt-4o-mini class). Log to `aegis_invocations` (currently empty because the fn is off) so volume is actually observable this time.
4. **Abuse floor:** per-IP/session rate limit (`rate_limit_tracking`), and the daily ceiling as the absolute backstop.

## CATEGORY CONSTRAINT (2026-08-22) — the root cause, not the 503
`AegisChat` was a coded implementation of a **sell-by-chat DM playbook (Martell) + Hormozi offer mechanics**,
applied to **anonymous cold web traffic**. Those playbooks assume a **warm prospect, a human operator, and
qualification before any offer** — none of the three were present. **That is the root cause, not the 503.**

**Category constraint:** Silent Shield sells **protective intelligence, not coaching.** The buyer is
screening for **discretion and accuracy.** Conversion mechanics that work where the downside is a refund
**actively disqualify us** where the downside is being wrong about someone's safety.

**Prohibited on any public-facing surface, permanently:**
- urgency or scarcity language (spots remaining, limited, act now)
- priority/expedite upsells or order bumps
- exit-intent capture or objection-harvesting prompts
- automated systems speaking in Aaron's voice to a stranger
- any generated artifact offered as a free sample of Fortress output

**Retained and correct:**
- discovery before offer; no pain, no next step
- current state, desired state, roadblock, cost of inaction
- one clear next step per surface
- leaning out rather than pushing

**Lead product = the Digital Exposure Report ($1,000, one business day, sourced findings).** It is the
free-tier replacement: real work, real findings, no pressure mechanics. **Nothing generated and unverified
is ever offered to a prospect.** This supersedes AegisChat's "Free Preliminary Snapshot — AI-generated, not
verified" and its `/free-risk-snapshot` route; both are retired, not carried into `src/config/products.ts`.

## Cost at plausible traffic
gpt-4o-mini, ~5K input + ~1K output per session ≈ **$0.002/session**.
- 50 sessions/day → ~$0.10/day (~$3/mo)
- 200 sessions/day → ~$0.40/day (~$12/mo)
- 1,000 sessions/day → ~$2/day (~$60/mo)
**Daily token ceiling (2M tok) hard-caps the worst case at ~$1.50/day (~$45/mo)** regardless of traffic or abuse. The cap — not the traffic — is the point; the original was contained for being unbounded.

## Restore ≠ this
The contained `aegis-chat` cannot be safely restored as-is — a no-login public chat has no caller identity, so tenant scoping is impossible. This WO **replaces** it with a data-plane-less assistant. The real tenant-capable AEGIS already exists behind login (`dashboard-ai-assistant`) — leave that as the authed path.
