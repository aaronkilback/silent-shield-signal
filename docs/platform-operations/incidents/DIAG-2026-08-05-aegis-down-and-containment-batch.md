# DIAG 2026-08-05 — AEGIS public chat down 5 days undetected + the full containment batch still off

**Report only.** Surfaced from the $300-bill investigation: `aegis-chat` has returned 503 to every homepage visitor since 2026-07-31 (INC-AITOOLS-XTENANT containment) and **nothing detected it.** A pricing fix was deployed to it 2026-08-04 without knowing it was dead.

## Q1 — is anything watching public-facing endpoint health? NO.
- `system-watchdog` smoke-tests a **hardcoded internal list only** — `osint-collector`, `send-daily-briefing`, `autonomous-operations-loop`, `system-ops`, `knowledge-synthesizer`. **`aegis-chat` and every other user-facing endpoint are not tested.**
- There is **no synthetic uptime/health check on the public homepage AI endpoint** — nothing hits `aegis-chat` and asserts "200 with a real completion." A 503 is invisible to the platform. The 5-day undetected outage is the proof.
- **Gap:** no public-endpoint health monitor exists. A minimal one (hit each user-facing function, assert not-503 + expected shape, alert on regression) would have caught this on day 0. (Scope, not built.)

## Q2 — full INC-AITOOLS-XTENANT containment batch STILL disabled (19 × 503 stubs)
Verified by line count (stubs ≤ ~32 lines) + the burndown ledger `WO-CHECK5-BURNDOWN-01` LOG A. `aegis-chat` + `dr-storage-backup` 503 confirmed live in prod; rest are committed stubs per the ledger (read-only until each is ruled).

**USER-FACING (operator or public) — 7:**
| Function | What it does | Reach |
|---|---|---|
| **aegis-chat** | AI chat on the marketing **homepage** | 🔴 **PUBLIC, no login** |
| assess-entity | "Assess" button → AI threat assessment | operator |
| entity-deep-scan | deep OSINT scan of an entity | operator *(not in LOG A — unledgered)* |
| investigate-poi | POI OSINT investigation + writes | operator |
| generate-poi-report | POI dossier / report | operator |
| generate-lesson-video | Academy lesson video (HeyGen) | Academy user |
| notify-bug-report | support bug report → email/SMS | support widget |

**INTERNAL / PIPELINE / AGENT-TOOL — 12:**
| Function | What it does |
|---|---|
| ai-tools-query | AEGIS agent tool backend (cross-tenant read tool — the adce9554 root) |
| query-fortress-data | cross-tenant data-query agent tool |
| **compute-client-relevance** | client relevance / cross-client signal scoring — **may compound the composite_confidence=0 starvation (DIAG-08-04 §3b)** |
| correlate-entities | entity correlation *(not in LOG A — unledgered)* |
| create-incident-job | incident-creation job |
| generate-decision-candidate | writes `aegis_recommendations` (decision layer) |
| fetch-url-content | URL fetch (agent-chat tool; SSRF-sensitive) |
| dr-storage-backup | DR storage backup cron (see WO-DR-CADENCE-REBUILD) |
| heygen-webhook | HeyGen video callback |
| webhook-dispatcher | outbound webhook dispatch |
| reingest-spin-workbook | one-shot workbook reingest |
| sync-buzzsprout | podcast episode sync |

**Two findings in the list itself:** (1) several *operator intelligence* features are quietly dead — assess-entity, entity-deep-scan, investigate-poi, generate-poi-report (the POI/entity workflow described as live in CLAUDE.md is contained). (2) **`entity-deep-scan` + `correlate-entities` are contained but NOT in the burndown ledger's LOG A** — the ledger undercounts the batch (17 documented vs 19 actually stubbed).

## Q3 — restoring aegis-chat safely
It was contained because it drove an **agent tool loop over signals/entities/incidents with a request-supplied `clientId` and no caller-membership check** — cross-tenant read (same shape as `ai-tools-query`/adce9554). The trap: verifying only the entry point isn't enough — **every tool in the loop must re-scope to the caller's tenant**.

But the harder truth for the **public homepage** case: a no-login public chat **cannot** do `getCallerIdentity` — there is no caller. So restoring the *contained* design safely is impossible; the contained version was a **tenant-tool chat wrongly exposed with no auth**. Safe options:
1. **Public product-assistant** — a new minimal chat with **zero data-plane access** (product/pricing Q&A only, no `clientId`, no signals/entities/incidents tools). Safe to be public because it touches no tenant data.
2. **Move the real AEGIS chat behind login** (it already exists as `dashboard-ai-assistant`, the primary authed chat) and **remove the homepage chat** entirely, or replace it with (1).
3. If a data-capable chat must ever be public, it needs per-request tenant binding from an authenticated session — which means it's not really public.
Recommendation to rule on later: homepage gets (1) or nothing; never re-expose the tenant-tool loop unauthenticated. Every restore also lands the real function in git (closes the deploy-drift orphan).

## Related: the $300 bill lever — `monitor-social-unified` produces NOTHING
30d: **0 signals** (its own heartbeat claims 0 across 164 runs), while burning ~900 OpenAI calls/day + the CSE queries driving the bill. **The fix is turning it off, not a rate cap.** See DIAG-2026-08-05-google-300-bill.md.
