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

### STANDING RULE — callerless is not proven by an invoke() search (2026-07-31, ratified)
**A function reachable as an AEGIS tool, or dispatched via the job queue, will NOT appear in an `invoke("fn")`
search.** Before declaring ANY function callerless (de-provision) or classifying its invoker in triage, ALSO search:
1. **AEGIS tool-routing tables** in `dashboard-ai-assistant/index.ts` AND `traveller-aegis-chat/index.ts`
   (`case "<tool_name>":` → `invoke("<fn>")`) — tool names are snake_case, function slugs are kebab-case.
2. **Job-queue dispatch types** (`type: '<fn>'` / `enqueueJob` / idempotencyKey) across all functions.
3. Frontend, other edge functions, cron/pg_cron, migrations, docs, and external curl/API integrations.
**Evidence:** batch-3 de-provision — an `invoke()` scan called 5 functions callerless; the full search found live
callers on 3 (`map-policy-to-controls` via the `map_policy_to_controls` AEGIS tool; `generate-monitoring-proposals`
via the job queue from agent-self-learning; `learn-from-investigations` dormant-but-documented). Deleting on the
scan alone would have broken the AEGIS chat tool + the monitoring-proposal job.

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
