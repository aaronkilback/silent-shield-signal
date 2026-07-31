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
| 1 | admin-feed-cleanup, aegis-chat, agent-mesh-dispatcher, alert-delivery, analyze-sentiment-drift, assess-entity, audit-compliance-status, auto-enrich-entities, auto-summarize-incident, autonomous-source-discovery | PENDING operator ruling | — |
| 2–6 | (remaining 44) | not started | — |

Baseline after batch 0 (pre-ruling): **check2=54, check5=214, check4=25, total=294.**

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
