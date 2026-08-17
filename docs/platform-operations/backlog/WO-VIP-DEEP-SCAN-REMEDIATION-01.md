# WO-VIP-DEEP-SCAN-REMEDIATION-01 — the scan behind the intake is a disabled-and-untracked P0 kill-switch

**Status:** OPEN — evidence recorded 2026-08-17. DO NOT BUILD until ruled. This WO exists because **nothing was tracking the remediation** — that absence is part of the finding.

## What the user hits (point 1)
`VIPDeepScanWizard.tsx:566 handleSubmit()` → `supabase.functions.invoke("vip-deep-scan", { body: { intakeData: formData } })` (L587). The deployed function (ACTIVE, **version 92, updated 2026-06-27**) is a 21-line deny-all stub returning **HTTP 503 `{error:"SERVICE_UNAVAILABLE", message:"vip-deep-scan is temporarily unavailable pending security remediation."}`** before any DB/service-role/downstream/external call. supabase-js throws on non-2xx → the `catch` (L602) fires → generic toast **"Failed to initiate deep scan. Please try again."** (L606). The network response carries the real SERVICE_UNAVAILABLE message; the UI masks it as a retryable error. **"Try again" can never succeed** — it is a deliberate disable, not a transient fault.

## Is the pipeline built, or is the button pointing at something unbuilt? (point 2 — the honest answer)
**It was BUILT, then deliberately DISABLED. Not unbuilt.** The pre-containment version (git `8b210f85`, 405 lines) was a real pipeline: created an entity + `entity_relationships`, `travelers` + `itineraries`, an **`investigations` record**, invoked `monitor-darkweb` + `osint-entity-scan` + `monitor-travel-risks`, and wrote a `signals` row. On **2026-06-27 (commit `0112d6b7`)** it was replaced with the deny-all stub as **P0 containment** — a confirmed **authenticated cross-tenant write + integrity exposure**: body `client_id` trusted without membership validation; stale-schema writes to investigations/entity_relationships/signals; swallowed persistence failures.

**The honest part:** there is **NO tracked remediation.** vip-deep-scan is absent from `containment-registry.md`; there is no open WO or incident doc for the re-enable; the containment commit has no body beyond its subject. It has sat disabled ~7 weeks with the full 9-step intake, 13-item compliance review, email-OTP, and authorization portal all live in front of it. **The intake is a finished front door to a deliberately-bricked, then forgotten, pipeline.** This is not an error to debug in a live function — the function has no downstream by design right now.

## What it produces / where output goes / does the path exist (point 3)
Original outputs: an **`investigations` record** (the primary artifact the report layer reads), an entity + relationship graph, travelers/itineraries, downstream monitor results (darkweb/osint/travel-risk), and a `signals` row. **All those destination paths EXIST and are live** (investigations, entities, signals tables + the three monitors are deployed; `generate-poi-report` can render from an investigation). So the OUTPUT targets exist — it is the PRODUCER that is disabled. There is no separate report-document/storage artifact in the original; the investigation record + downstream signals were the output.

## Remediation scope (for ruling — NOT built)
Re-enabling is a security build, not a fix, and it maps to doctrine already exercised this month:
- **Tenant-membership validation on `client_id`** (never trust body client_id — validate the caller can access it; the exact `getAccessibleClientIds` gate `generate-executive-report` uses).
- **Schema-current writes** (the stale-schema writes to investigations/entity_relationships/signals must be brought to current shape).
- **Fail-loud persistence** (no swallowed persistence failures — the same fail-loud discipline as `ingest_decisions` / the attribution constraint work).
- Provenance/ownership on everything the scan creates (Provenance Doctrine — entity/investigation/signal all owner-scoped).
Until then: the intake should surface the real state (not "try again"), or be gated behind the capability being live.
