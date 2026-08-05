# WO-PUBLIC-ENDPOINT-UPTIME — synthetic uptime for visitor-facing endpoints (SCOPE, do not build)

**Ruling 2026-08-05 (operator).** `aegis-chat` returned 503 to every homepage visitor for **5 days undetected**. `system-watchdog` smoke-tests a **hardcoded internal list only** (`osint-collector`, `send-daily-briefing`, `autonomous-operations-loop`, `system-ops`, `knowledge-synthesizer`) and **never asserts a real 200 from anything a visitor touches.** A public outage that long, unseen, is the proof the gap is real.

## Scope
1. **A synthetic probe over the user-facing endpoint set** (not the internal cron list). Explicit registry of visitor-reachable functions + routes: the homepage chat, the marketing/protection pages, `/authorize/:token`, `/conversations` (CRM), academy endpoints, snapshot flows — anything a non-operator hits.
2. **Assert real health, not mere reachability.** A 503 stub still "responds." The probe must assert the **expected 2xx + expected shape** (e.g. chat returns a completion field; a page returns 200 + a known marker), and specifically **flag any endpoint returning 403/503/`{disabled:true}`** — the containment-stub signature. (Had this existed, it would have caught aegis-chat on day 0, and would today flag the whole 19-stub batch that is user-facing.)
3. **Alerting sized to the surface:** a visitor-facing 503 is **high/critical** (revenue + trust), distinct from an internal cron being quiet. Route to the SMS critical channel (`dispatch-critical-sms`) for public-facing down, email for internal.
4. **Cross-check against the containment ledger:** any endpoint in the user-facing registry whose function is a known 503 stub (`scripts/check-containment-ledger.mjs`) should surface as "user-facing capability DOWN," not just "endpoint unhealthy" — ties the uptime check to the burndown so a contained user-facing function is loud, not silent.
5. **Cadence:** every 5–15 min; store results (uptime history) so an outage's start time is known (aegis-chat's 5-day gap had no recorded start).

## Why this is its own control
Watchdog watches *crons* (is the work happening). Registry-is-a-Promise watches *registered jobs*. **Nothing watches whether a visitor gets a working response.** This is the third leg — the same class as this week's findings (a self-report narrower than its name), applied to the public surface. Build after the AEGIS public-assistant rebuild so the homepage endpoint it probes is the real one.
