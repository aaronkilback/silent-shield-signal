# WO-CHECK5-BURNDOWN-01 — hand-rolled-auth burn-down

**Status:** STANDING background task. **Read-only until each batch is ruled on by the operator.**
**Opened:** 2026-07-31. **Provenance:** INC-AITOOLS-XTENANT-2026-07-30 — every finding came from a function with
hand-rolled auth; every function on the shared `getCallerIdentity`/`userCanAccessClient` gate was clean.

## Root-cause population
- **214 CHECK-5 violations** (read request without shared identity/accessible-client helper) — the root-cause set.
- **54 CHECK-2 violations** (service-role + request-derived scope, no membership check) — a SUBSET, authenticated-
  or-worse and exploitable today. **Burn down check-2 first.**
- Baseline may only DECREASE. A cleared entry gets `@security-exempt(check2/check5): <reason> — <date>`; no reason = not cleared.
- Prefer migrating to the shared `getCallerIdentity` gate over new bespoke checks (bespoke checks are what failed).
- Contain on sight anything unauthenticated with a data-plane path.

## Batch ledger (check-2, batches of 10)
| Batch | Functions | Ruled | Result |
|---|---|---|---|
| 1 | (10, see below) | RULED 2026-07-31 | check2 54→44, check5 214→204, total 294→274 |
| 2–6 | (remaining 44) | not started | — |

Baseline: batch 0 = **294**; after batch 1 = **274** (check2 44, check5 204, check4 25, check3 1).

### Batch 1 outcome (2026-07-31)
- **CONTAINED (503, DEPLOYED):** aegis-chat (v110), assess-entity (v93).
- **FIXED + DEPLOYED (getCallerIdentity + userCanAccessClient, via CLI bundle):** analyze-sentiment-drift,
  audit-compliance-status. Service-role internal callers pass; user callers bound to client; anon rejected.
- **CLEARED:** alert-delivery — `@security-exempt(check2/check5)` annotated.
- **FIXED IN CODE, DEPLOY-BLOCKED:** agent-mesh-dispatcher, auto-enrich-entities, auto-summarize-incident,
  autonomous-source-discovery, admin-feed-cleanup — all now call `requireInternalCaller` (new `_shared/require-internal-caller.ts`).
- **Gate taught the shared helpers** requireInternalCaller/checkInternalCaller (check2 + check5) and userCanAccessClient
  (check2). Negative test green.

### Cutover (2026-07-31) — DESCOPED to 6 functions, wiring staged for review
Secret digest-verified identical in function-secrets + vault (`fortress_internal_secret`). Caller enumeration
revealed the full gated set's callers = ~14 (not 6) — gating knowledge-synthesizer pulls in dashboard-ai-assistant
(primary chat) + system-watchdog + a job-worker path. **Descoped** per operator.
- **IN (6, tight blast radius):** auto-enrich-entities, auto-summarize-incident, autonomous-source-discovery,
  detect-threat-patterns, monitor-court-registry, admin-feed-cleanup (operator-invoked, no wiring).
- **Wirings staged (NOT applied/deployed — diffs printed for review):** 2 fn callers (data-quality-monitor→auto-summarize,
  auto-orchestrator→detect-threat, env-sourced header) + 5 cron rewires (migration `20260731210000_wo_check5_cutover_cron_headers.sql`,
  vault-sourced header, each command preserved verbatim + header only). monitor-community-outreach has no live cron → no wiring.
- **Apply order after review:** apply cron migration + deploy the 2 fn callers FIRST → then deploy the 6 gated functions →
  then verify each cron's next run (response code + work-done evidence, not a 200 no-op). Any 401 → roll back that caller, not the gate.

### Cutover EXECUTED 2026-07-31 — verification status (WO stays OPEN until the 3 nightly confirm)
Applied migration `wo_check5_cutover_cron_headers` (crons re-created — jobnames stable, new jobids 226–230);
deployed 2 fn callers (auto-orchestrator, data-quality-monitor) + 6 gated functions. Vault gate pre-verified
(header present + resolves to len 44 on all 5 crons; value never printed).

**Gate behavior verified via `net.http_post` (real cron path) + `net._http_response`:**
| Function | with vault header | no internal header | status |
|---|---|---|---|
| detect-threat-patterns | **200**, `clients_scanned:9` (work) | 401 "missing internal authorization" | ✅ FULLY VERIFIED |
| monitor-court-registry | **200**, "Scanned 2 court registry sources" (work) | (gate live) | ✅ FULLY VERIFIED |
| auto-enrich-entities | — (not exercised) | 401 "missing internal authorization" | ⏳ gate live; header-auth UNVERIFIED |
| autonomous-source-discovery | — | 401 "missing internal authorization" | ⏳ gate live; header-auth UNVERIFIED |
| auto-summarize-incident | — | 401 "missing internal authorization" | ⏳ gate live; header-auth UNVERIFIED |
| admin-feed-cleanup | — | 401 "missing internal authorization" (behind verify_jwt=true) | ✅ gate live; operator sends header |

**UNVERIFIED until first post-deploy SCHEDULED run — DO NOT close the WO:**
- **auto-enrich-entities** — next run ~tomorrow 03:00 UTC. Check: heartbeat/`net._http_response` = 200 (not 401), AND entities enriched (heartbeat `result_summary` items_processed > 0 / entities.updated_at bump).
- **auto-summarize-incident** — ~tomorrow 03:30 UTC. Check: 200, AND incidents got titles/summaries (heartbeat `auto-summarize-incidents-nightly` result). Also the **data-quality-monitor→auto-summarize** fn-caller path (env-sourced header) is unexercised — confirm on its next auto_fix run.
- **autonomous-source-discovery** — next run **Sunday 03:00 UTC** (weekly `0 3 * * 0`). Check: 200, AND sources inserted. **→ CONFIRMED FAILED 2026-08-07 (log, do not fix today):** fired Sun 2026-08-02 03:00, **0 heartbeats ever** (`source-discovery-weekly` phantom, ever_succeeded=false). Root cause = **secret drift**: the cron sends `x-fortress-internal` from `vault.decrypted_secrets['fortress_internal_secret']`, but `requireInternalCaller` (gate at L72, before `startHeartbeat` at L81) rejects it → the vault value ≠ the fn's `FORTRESS_INTERNAL_SECRET` env (or env unset). Fix = align edge-fn `FORTRESS_INTERNAL_SECRET` with `vault.fortress_internal_secret` (config, not code). DIAG-2026-08-07. Also fold the heartbeat-before-gate fix in (WO-OUTPUT-ASSERTION-MONITORING mode 2 — this fn is one of the audited 9).
- **auto-orchestrator→detect-threat** fn-caller path (env-sourced header) unexercised — confirm on auto-orchestrator's next run (detect-threat itself already accepts the header, so low risk).
- **Any 401 on a scheduled run → roll back THAT caller's wiring (re-run its original cron command / revert the fn header), NOT the gate.** Original cron commands captured in `20260731210000_wo_check5_cutover_cron_headers.sql` header comment + git history.

### WO-CUTOVER-KSYNTH-01 (deferred — its own change)
Gate knowledge-synthesizer + agent-mesh-dispatcher + generate-monitoring-proposals. Left UNGATED in prod for now
(status quo, not a regression). Blockers to resolve first: (a) locate the job-worker that dispatches
generate-monitoring-proposals from the agent-self-learning enqueue (`type:'generate-monitoring-proposals'`) — it must
send the header; (b) review the knowledge-synthesizer call sites in dashboard-ai-assistant (L9859) + system-watchdog
(L2481) + ingest-expert-media (L128/173) + process-security-report (L995) in isolation before wiring.

### ingest-ioc-csv (HOLD — coded, NOT deployed; commit b4628122)
Consumer hunt: no code caller (external curl only, per CLAUDE.md); `api_keys` table has **0 rows**; usage = **1**
`microsoft_defender_ti` signal ever (2026-04-13), none since. Current state (verify_jwt=true + 0 provisioned keys)
is closed-by-default and breaks nothing. Deploy the api-v1-signals x-api-key change ONLY when IOC ingest is actually
needed, and provision the scoped api_key in the SAME change.

### ⚠ DEPLOY GATE for the 5 requireInternalCaller functions (do NOT deploy until BOTH done)
`requireInternalCaller` fails CLOSED (503) if `FORTRESS_INTERNAL_SECRET` is unset — deploying before wiring
would 503 every cron/internal caller. Required, in order:
1. **Set `FORTRESS_INTERNAL_SECRET`** (Supabase secret + vault) — CREDENTIAL MUTATION, needs explicit operator "execute now".
2. **Wire every caller to send `x-fortress-internal: <secret>`:** the cron `net.http_post` headers (migrations:
   add_source_discovery_cron, schedule_auto_summarize_incidents, secure_cron_tokens, watch_list_content_scan_trigger)
   + internal fn callers (knowledge-synthesizer→agent-mesh-dispatcher, data-quality-monitor→auto-summarize-incident).
3. **Then deploy the 5 together.** Until then prod runs the OLD unauthenticated versions (interim exposure —
   operator ruled "do not contain" these; they remain live pending the wire-up).

### CHECK-4 LOG B addendum — the 12 policy-less tables: contents + service-role writers (2026-07-31)
All 12 RLS-enabled, deny-by-default. **Every writer is service-role (edge fn or SECURITY-DEFINER RPC) — no anon/user writers.**
Deny-by-default is the correct secure posture for all 12 (nothing non-service-role reads them). Tenant-data ones flagged.

| Table | Holds | Service-role writer | Note |
|---|---|---|---|
| academy_agent_scores | academy agent judgment analytics | academy-score | internal analytics |
| alert_delivery_allowed_recipients | alert email allowlist | (seed/RPC) | internal delivery config |
| alert_emission_refusals | refused-alert audit (tier/reason/client_id/incident/signal) | (RPC) | audit |
| **client_geo_assets** | **TENANT geo assets (client_id, geom, buffer_km)** | (geo pipeline/RPC) | ⚠ tenant — any future policy must be tenant-scoped, never open |
| geo_place_gazetteer | place-name gazetteer (global reference) | (seed/RPC) | global, non-sensitive |
| harness_retrieval_verifications | retrieval-harness QA telemetry | (RPC) | internal QA |
| **hazard_pathway_scores** | **TENANT hazard scores (signal_id, client_id); 237 rows** | generate-executive-report | ⚠ tenant — deny-default safe; scoped policy only if a tenant surface reads it |
| incident_gate_decisions | incident admission-gate audit | (RPC) | audit |
| job_worker_lease | job-worker lease lock; 1 row | (RPC) | internal coordination |
| **misrouted_signals** | **cross-tenant routing audit — intended_client_id + intended_client_name; 24,301 rows** | ingest-signal | ⚠⚠ HIGHEST — cross-tenant client identifiers; deny-by-default is critical, MUST never get an open policy |
| operator_alert_bridge_state | operator alert-bridge cursor | alert-operator-bridge | internal operator state |
| **report_claim_manifest** | **TENANT report claim provenance (report_id, assertion, bound_signal_id)** | generate-executive-report | ⚠ tenant — deny-default safe |

Net: no live exposure — all writes service-role, all reads deny-by-default. The CHECK-4 finding is migration-hygiene
(RLS not enabled in the creating migration; enabled out-of-band later) → burn down via WO-LEDGER-RECONCILE (git↔prod
parity). Watch item: the 4 tenant-data tables must never receive an open (non-tenant-scoped) policy — especially misrouted_signals.

---

## LOG A — 15 contained 503 stubs needing resolution (fix-and-restore OR de-provision)
Decision driver per the "does anything consume this?" doctrine: verify a live consumer before choosing.

| # | Stub | Why contained | Recommendation |
|---|---|---|---|
| 1 | ai-tools-query | cross-tenant read tool (adce9554) | **FIX+restore** — high-value AI tool surface; restore behind getCallerIdentity + per-tool tenant scoping |
| 2 | compute-client-relevance | static-secret gate; cross-client signal write | **FIX+restore** service-role gate IF still consumed; else **de-provision** |
| 3 | create-incident-job | unauth incident creation | **FIX+restore** service-role/internal gate |
| 4 | dr-storage-backup | static-secret; storage read/write/delete | **FIX+restore** behind vault/service-role (DR infra) IF DR active; else **de-provision** |
| 5 | fetch-url-content | SSRF (redirect/DNS-rebinding) | **FIX+restore** verify_jwt=true + resolve-and-check IP + redirect re-validation (agent-chat tool) — operator ruling pending |
| 6 | generate-decision-candidate | unauth write aegis_recommendations | **FIX+restore** service-role gate |
| 7 | generate-lesson-video | unauth write + paid HeyGen call | **FIX+restore** auth gate IF academy video-gen used; else **de-provision** |
| 8 | generate-poi-report | unauth POI dossier read | **FIX+restore** getCallerIdentity + entity→client membership (+ WO-SUBJECT-GATE-01) |
| 9 | heygen-webhook | unauth webhook + arbitrary-URL fetch | **FIX+restore** with HMAC signature verification IF HeyGen used; else **de-provision** |
| 10 | investigate-poi | unauth OSINT + writes | **FIX+restore** getCallerIdentity + subject-gate (WO-SUBJECT-GATE-01) |
| 11 | notify-bug-report | unauth tenant read + mail/SMS | **FIX+restore** service-role/internal gate |
| 12 | query-fortress-data | cross-tenant query tool | **FIX+restore** getCallerIdentity IF used; else **de-provision** (check for successor) |
| 13 | reingest-spin-workbook | unauth tenant read/write (one-shot) | **De-provision** (one-shot job complete) OR fix behind service-role if reuse expected |
| 14 | sync-buzzsprout | unauth write episodes | **FIX+restore** auth gate IF podcast sync used; else **de-provision** |
| 15 | webhook-dispatcher | unauth spoofable dispatch | **FIX+restore** internal-secret gate (alert-delivery pattern) IF used; else **de-provision** |

Every restore must land the real function in git (closes the deploy-drift orphan too).

---

## LOG B — 25 tables flagged by CHECK-4 (created without RLS in-migration): RLS + policy status TODAY
**All 25 have RLS ENABLED today** — the live-exposure concern (RLS disabled) is NOT present; the CHECK-4 finding is
that the *creating migration* did not enable it in-file (DR/parity + hygiene gap), remediated out-of-band later.

**Has a policy today? — NO (RLS on, deny-by-default; correct only if service-role-only, broken if frontend-read):**
academy_agent_scores, alert_delivery_allowed_recipients, alert_emission_refusals, client_geo_assets,
geo_place_gazetteer, harness_retrieval_verifications, hazard_pathway_scores, incident_gate_decisions,
job_worker_lease, misrouted_signals, operator_alert_bridge_state, report_claim_manifest  — **(12)**

**Has a policy today? — YES:** academy_learner_profiles(1), academy_progress(1), academy_responses(1),
academy_scenarios(1), aegis_grounding_trace(2), aegis_prompt_trace(2), aegis_request_trace(2),
aegis_retrieval_trace(2), aegis_tool_trace(2), qa_test_results(2), itinerary_travelers(3),
ai_assistant_messages(5), signal_agent_analyses(6)  — **(13)**

Follow-up (not a live exposure): for the 12 policy-less tables, confirm each is service-role-only (deny-by-default
correct) vs frontend-read (needs a scoped policy). The CHECK-4 baseline itself burns down by back-filling the RLS
enable into the original migrations (git↔prod parity), tracked with WO-LEDGER-RECONCILE.
