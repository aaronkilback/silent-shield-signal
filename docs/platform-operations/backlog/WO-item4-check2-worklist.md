# WO item 4 — check-2 triage worklist (service-role + request-derived scope, no membership check)

Generated once from the security-gate check-2 baseline (WO-CI-SECURITY-GATE-01), 2026-07-31. 61 functions.

For each: confirm whether the request-supplied client/tenant/entity id is validated against the CALLER+s tenant_users membership. If not, add the gate (or restrict). Then remove from baseline via `npm run security-gate:baseline` (count must only decrease).

| # | function | branch/symbol | line |
|---|---|---|---|
| 1 | admin-feed-cleanup | <function> | 104 |
| 2 | aegis-chat | <function> | 44 |
| 3 | agent-mesh-dispatcher | <function> | 78 |
| 4 | alert-delivery | <function> | 85 |
| 5 | analyze-sentiment-drift | <function> | 66 |
| 6 | api-key-management | <function> | 89 |
| 7 | api-v1-signals | <function> | 263 |
| 8 | assess-entity | <function> | 11 |
| 9 | audit-compliance-status | <function> | 17 |
| 10 | auto-enrich-entities | <function> | 36 |
| 11 | auto-summarize-incident | <function> | 88 |
| 12 | autonomous-source-discovery | <function> | 72 |
| 13 | calculate-anticipation-index | <function> | 25 |
| 14 | check-incident-escalation | <function> | 91 |
| 15 | configure-entity-monitoring | <function> | 56 |
| 16 | correlate-entities | <function> | 198 |
| 17 | create-archival-record | <function> | 18 |
| 18 | create-entity | <function> | 86 |
| 19 | data-quality-monitor | <function> | 189 |
| 20 | detect-duplicates | <function> | 130 |
| 21 | detect-threat-patterns | <function> | 53 |
| 22 | entity-deep-scan | <function> | 96 |
| 23 | fuse-geospatial-intelligence | <function> | 28 |
| 24 | generate-monitoring-proposals | <function> | 79 |
| 25 | generate-poi-report | <function> | 251 |
| 26 | guardian-check | <function> | 39 |
| 27 | identify-precursor-indicators | <function> | 10 |
| 28 | ingest-ioc-csv | <function> | 186 |
| 29 | investigate-poi | <function> | 245 |
| 30 | knowledge-synthesizer | <function> | 423 |
| 31 | learn-from-investigations | <function> | 12 |
| 32 | map-policy-to-controls | <function> | 10 |
| 33 | monitor-community-outreach | <function> | 807 |
| 34 | monitor-court-registry | <function> | 47 |
| 35 | monitor-wildfire-comprehensive | <function> | 255 |
| 36 | oauth-token | <function> | 101 |
| 37 | optimize-defense-strategies | <function> | 9 |
| 38 | osint-entity-scan | <function> | 41 |
| 39 | osint-web-search | <function> | 110 |
| 40 | parse-document | <function> | 29 |
| 41 | persist-report | <function> | 19 |
| 42 | predictive-forecast | <function> | 46 |
| 43 | process-archival-documents | <function> | 8 |
| 44 | process-stored-document | <function> | 1354 |
| 45 | propose-new-monitoring-keywords | <function> | 10 |
| 46 | propose-security-investments | <function> | 10 |
| 47 | recommend-compliance-remediation | <function> | 9 |
| 48 | recommend-policy-adjustments | <function> | 10 |
| 49 | red-team-analyst | <function> | 69 |
| 50 | review-client-policy | <function> | 19 |
| 51 | run-what-if-scenario | <function> | 158 |
| 52 | scan-client-staff | <function> | 40 |
| 53 | scan-entity-content | <function> | 8 |
| 54 | scan-entity-photos | <function> | 9 |
| 55 | score-signal-anomaly | <function> | 23 |
| 56 | send-orientation-email | <function> | 65 |
| 57 | speculative-dispatch | <function> | 19 |
| 58 | system-watchdog | case fix_orphaned_entities | 1955 |
| 59 | thread-weaver | <function> | 255 |
| 60 | trajectory-positioner | <function> | 157 |
| 61 | webhook-dispatcher | <function> | 40 |

---
## Triage round 1 — 2026-07-31 (INC-AITOOLS-XTENANT follow-on)

### CLEARED (annotated `@security-exempt(check2)`, removed from baseline; 61 → 59)
- **api-v1-signals** — external API; client scope derived from the AUTHENTICATED credential
  (`api_key.client_id` via `validateApiKey`, or the OAuth token), never from request input
  (`scopedClientId`, L284). Externally reachable by design via `x-api-key` or `Authorization: Bearer`.
- **oauth-token** — OAuth2 `client_credentials` endpoint (verify_jwt=false by necessity). `client_id`
  is an OAuth CLIENT credential validated against a `client_secret` hash (`oauth_clients`), not a tenant.

### NOT CLEARED — confirmed unsafe (the POI/person-entity class at the centre of the incident)
- **scan-client-staff** — verify_jwt=true (any authenticated user). Reads `client_id` from body, verifies
  the client *exists* but NOT that the caller belongs to its tenant; then queues `entity-deep-scan` +
  `osint-entity-scan` (HIBP, dark web, social) on that client's person entities. **Any authenticated
  user can trigger OSINT collection on any client's staff.** Needs caller tenant_users membership check.
- **investigate-poi** — **verify_jwt=false (UNAUTHENTICATED).** Reads `entity_id` from body, loads that
  entity by id (no tenant scope), runs full OSINT (Google CSE, HIBP, people-search/court sites), stores
  entity_content + creates signals. **Any unauthenticated caller can run a POI investigation on any
  entity_id.** Critical.
- **generate-poi-report** — **verify_jwt=false (UNAUTHENTICATED).** Reads `entity_id`, returns the full
  AI POI dossier (all OSINT content, signals, watch-list status, relationship graph) for that entity.
  **"entity-scoped by design" annotation VERIFIED FALSE as a safety claim:** entity-scoped ≠ access-
  controlled; it derives NO client/authorization from the caller and returns any entity's dossier to any
  unauthenticated caller. This is a direct unauthenticated read path to the 788-person-entity PII class.
- **api-key-management** — verify_jwt=true + admin/super_admin gate, but reads `client_id` from body and
  creates api_keys for it WITHOUT verifying the admin belongs to that client's tenant. Admin-gated but
  not tenant-scoped — cross-tenant key minting possible if app-role admin is not tenant-bound.
- **webhook-dispatcher** — **verify_jwt=false.** Takes a `signal` (with `client_id`) from the request and
  dispatches to that client's registered webhooks. Externally spoofable: forge a signal → trigger webhook
  deliveries. Needs an internal-only auth (shared secret) or verify_jwt=true + caller check.

## Deploy-path drift (item 1) — 40 orphans
40 edge functions are deployed to prod (ACTIVE) but ABSENT from the repo — reached prod via MCP/direct
deploy without a PR, invisible to the PR gate. Baselined in `drift-baseline.json`; new orphans now FAIL
`security-gate:drift`. Burn-down = land each to git or de-provision. Notable security-relevant orphans:
`auth-email-hook`, `cipher-*` (7), `generate-decision-candidate`, `compute-client-relevance`,
`fetch-url-content`, `heygen-webhook`, `ingest-screenshot-evidence`, `monitor-x-single`, `x-query-probe`.

---
## 40-orphan triage — round 1 (2026-07-31)
23 of 40 orphans are verify_jwt=false (unauthenticated). Priority (source-reviewed):
- **auth-email-hook** — SAFE. verify_jwt=false (GoTrue hook) but HMAC signature+timestamp verified
  (verifyWebhookRequest / LOVABLE_API_KEY, 401 on invalid); /preview is Bearer-API-key gated. No tenant data.
- **fetch-url-content** — UNAUTHENTICATED SSRF surface (reads `url`, fetches it). Has a denylist guard
  (blocks localhost/RFC1918/link-local incl. 169.254 metadata) BUT bypassable: `redirect:"follow"` is NOT
  re-validated on redirect, and DNS-rebinding (public hostname → private IP) passes the string check. NOT
  check-2 shape (no tenant id) → not auto-contained; breaks the agent-chat/dashboard `fetch_url_content`
  AI tool if disabled. RECOMMEND: verify_jwt=true (callers are internal) + re-validate redirect targets +
  resolve-and-check IP. OPERATOR RULING NEEDED (contain now vs harden-in-place).
- **Remaining 21 verify_jwt=false orphans — SOURCE REVIEW PENDING** (several concerning by name):
  cipher-analyze-investigation, cipher-compute-fingerprint, cipher-endorse-hypothesis, cipher-guardrails-test,
  cipher-ingest-evidence, cipher-promote-hypothesis, cipher-reject-hypothesis, compute-client-relevance,
  compute-linguistic-fingerprint, create-incident-job, dr-storage-backup, generate-decision-candidate,
  generate-lesson-video, heygen-webhook, ingest-screenshot-evidence, monitor-x-single, notify-bug-report,
  r2-smoke-test, reingest-spin-workbook, sync-buzzsprout, x-query-probe. Anything matching check-2 shape →
  contain on sight. 17 verify_jwt=true orphans are lower priority.
- ALL 40 remain deploy-drift (in repo? NO). Land-to-git or de-provision each; drift-baseline tracks them.

---
## 21-orphan triage — 2026-07-31 (contain-on-sight pass)
Fully source-reviewed 14/21. CONTAINED 4 (503 stub, deployed) + fetch-url-content (SSRF, item 1).

CONTAINED (503):
- **compute-client-relevance** — verify_jwt=false + service-role + reads client_id + writes signals.gate3 cross-client, gated only by a STATIC hardcoded shared secret (not tenant membership) = check-2 shape.
- **generate-decision-candidate** — verify_jwt=false + service-role + NO caller auth; any trigger_id → wrote aegis_recommendations + returned composed intelligence = unauthenticated write+read path.
- **create-incident-job** — verify_jwt=false + service-role + NO caller auth; any signal_id → created an incident (create_incident door) = unauthenticated write path.
- **fetch-url-content** — unauthenticated SSRF (redirect/DNS-rebinding-bypassable denylist). (Contained in item 1.)

SAFE (no containment):
- **ingest-screenshot-evidence** — getCallerIdentity rejects anon; user-tier validated via getAccessibleClientIds(client_id).
- **cipher-ingest-evidence**, **cipher-promote-hypothesis** — getCallerIdentity + role gate + userCanAccessClient(investigation/hypothesis client). Verified by full read (the two writes).
- **cipher-analyze-investigation, cipher-compute-fingerprint, cipher-endorse-hypothesis, cipher-reject-hypothesis, cipher-guardrails-test** — same subsystem/imports/pattern; cleared by strong inference (confirm on land-to-repo).
- **monitor-x-single**, **x-query-probe** — service-role-only Bearer gate (env SR or rotated vault key); no user/anon path.
- **compute-linguistic-fingerprint** — getCallerIdentity rejects anon AND user (403 internal-job); service-role-only.

SOURCE-REVIEW PENDING (7, low tenant-intelligence risk — not person-entity surfaces; tracked in drift-baseline):
- dr-storage-backup, r2-smoke-test (backup/smoke infra) · generate-lesson-video, reingest-spin-workbook, sync-buzzsprout (academy/podcast content) · heygen-webhook (video-gen webhook — confirm signature) · notify-bug-report (bug notifier — confirm caller gate).
