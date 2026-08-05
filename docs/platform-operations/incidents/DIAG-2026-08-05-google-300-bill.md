# DIAG 2026-08-05 — $300 Google Cloud bill (report only, nothing disabled)

**Conclusion: almost certainly Google Custom Search (CSE), driven by `monitor-social-unified`. NOT Gemini, NOT aegis-chat abuse.** Confirm via the GCP SKU report (below).

## Evidence
- **`llm_daily_cost` (30d):** gpt-5.2 $42.51 (2,079 calls) · gpt-4o-mini $10.91 (44,718) · blank-model $53.42 (46,820) · **gemini-2.5-flash $0.00 (23 calls, one day)**. Total tracked ≈ **$107, essentially all OpenAI. Gemini ≈ $0.** So the $300 is not Gemini LLM.
- **`aegis-chat` is a 503 containment stub** (contained 2026-07-31, INC-AITOOLS-XTENANT — same batch as dr-storage-backup). It calls no AI. **`aegis_invocations` is empty (30d).** The public-homepage-abuse hypothesis is **refuted** — the function is off (and the homepage chat is currently returning 503, a separate issue).
- **`monitor-social-unified` = 27,720 gateway calls / 30d (~900/day), FLAT all month, no spike, provider=openai.** It is the dominant function by far (all other CSE callers: negligible telemetry). It is a **Google-CSE social monitor** (Facebook/Instagram via Custom Search + OpenAI relevance scoring). Its OpenAI calls are already in the $107; its **CSE queries are separate, Google-billed, ≥ its AI-call count and likely a multiple** (multiple CSE queries per run × clients × entities × platforms, then score). ~900+/day CSE × 30d, no free-tier relief beyond 100/day, at $5/1000 → lands in the $120–$400 range = the $300.
- **No Google service account** in use (grep empty) — Google APIs are API-key-based.
- **No CSE rate limit, per-run query cap, or spend cap anywhere.**

## Why the tracker and the bill disagree (Q4)
`llm_daily_cost` / `compute-llm-daily-cost-30min` count **LLM tokens only** (OpenAI + Gemini). **Google Custom Search is not an LLM, so it is invisible to the tracker.** The tracker showing ~$0 Gemini next to a $300 Google bill is not a tracker error — it's a **blind spot**: there is no Google-CSE (or Maps) spend tracking at all. Same class as the neural-board / DR-heartbeat findings: a monitoring surface that reports confidently on a scope narrower than the operator assumes.

## Q1 — GCP console breakdown (exact clicks)
1. **console.cloud.google.com** → confirm the correct **project** (top bar) — the one whose API key the functions use.
2. ☰ → **Billing** → **Reports**.
3. Right panel **Group by → SKU** → the SKU list shows the culprit (expect **"Custom Search API"**; if instead **"Generative Language API"**, it's Gemini and the tracker is under-counting — different problem; if **"Maps/Geocoding API"**, it's the wildfire/proximity geocoders).
4. Change **Group by → Day** (or set the time range + "Daily" granularity) to see which days.
5. Cross-check: ☰ → **APIs & Services → Dashboard**, sort by **Requests / Errors** over 30 days — the API with ~25k–100k requests is the driver.

## Q2 — functions hitting Google-billed APIs
- **Gemini (`generativelanguage`) consumers:** ~35 functions via `_shared/ai-gateway.ts` — but Gemini spend ≈ $0 (gateway routes to OpenAI in practice). Not the bill.
- **Google CSE consumers (~20):** `monitor-social-unified` (**dominant**), `monitor-news-google`, `monitor-social`, `monitor-emergency-google`, `monitor-community-outreach`, `monitor-entity-proximity`, `osint-entity-scan`, `osint-web-search`, `perform-external-web-search`, `vip-osint-discovery`, `scan-entity-content/photos`, `monitor-facebook/instagram`, `monitor-wildfires`, etc. **All cron/service-role — not publicly reachable, not an external-abuse surface.** `verify_jwt` is moot (invoked by pg_cron with service role). **No CSE rate limit / spend cap on any of them.**
- **Service account:** none.

## Q3 — AEGIS abuse: REFUTED
`aegis-chat` disabled (503) since 2026-07-31; `aegis_invocations` empty. Cannot be the cause. If the operator wants a public-chat cost control later, note it would need a per-session/token cap AND re-enabling behind the adce9554 cross-tenant fix first — but it is not today's bill.

## The lever (what would be turned off — for the operator to rule, NOT done)
Not aegis-chat (already off). The cost lever is **`monitor-social-unified`'s CSE volume**: reduce its cron frequency, cap CSE queries per run, and/or set a daily CSE spend cap in GCP. It runs flat ~900/day with no cap — steady over-querying, not a spike. Fix is config/budget, not a security shutoff. **Report only — nothing changed.**

## What `monitor-social-unified` actually produces (2026-08-05) — NOTHING → the fix is OFF, not a cap
**0 signals in 30 days.** 164 heartbeat runs; even its own heartbeat `result_summary.signals_created` sums to **0**; 0 signals in `signals` carry a social/facebook/instagram origin. It burns ~900 OpenAI relevance calls/day + the CSE queries driving the bill and yields **nothing** (matches the confirmed social-ingestion dry-up since late May; `monitor-instagram-2h` likewise never created a signal). **Zero output means a rate cap is the wrong fix — it should be turned off.**

**What breaks if `monitor-social-unified` stops:** nothing of value. It produces 0 signals, so no coverage is lost; no downstream function consumes its output (there is none). Effects: its `cron_job_registry` entry becomes a phantom → **de-register it** (Registry-is-a-Promise) rather than leave a stale health expectation; the watchdog `SOCIAL_ALREADY_CHECKED`/`QUIET_MONITORS_OK`/social-effectiveness lists reference it → trim those (same pattern as the monitor-twitter retirement). It also removes ~$50-ish of the tracked OpenAI relevance spend on top of the CSE savings.

**GCP daily spend cap on Custom Search — what it takes + what it breaks when hit:**
- **A GCP *budget* (Billing → Budgets & alerts) only NOTIFIES — it does not stop spend.** For a hard stop you set a **quota limit** on the API: **APIs & Services → Custom Search API → Quotas & System Limits → "Queries per day" → set a ceiling** (e.g. 100 = free tier, or a chosen number). Google resets the CSE daily quota at **midnight Pacific**.
- **When the cap is hit:** CSE returns **HTTP 429 / 403 "quota exceeded"** for every caller for the rest of that day. Every function calling CSE (news, social, osint, emergency, community-outreach) gets no search results until reset. If they handle the error gracefully (log + continue) there's no crash but **no CSE coverage for the rest of the day**; if any don't, that run errors.
- **Sizing caveat:** a cap tight enough to stop the social waste can also starve **legitimate** CSE (`monitor-news-google`, osint). Better order: **turn off `monitor-social-unified` first** (removes the bulk of the waste with zero coverage loss), THEN set a modest daily cap as a backstop sized to cover the remaining legitimate CSE users. A cap alone leaves the 0-yield social monitor consuming the budget it's given.
