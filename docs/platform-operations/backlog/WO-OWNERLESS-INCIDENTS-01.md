# WO-OWNERLESS-INCIDENTS-01 — 363 null-client (ownerless) incidents

**Logged:** 2026-08-01. **Class:** Provenance Doctrine / INC-XTEN violation — ownerless artifact. **Same class as the null-client alerts that could not route** (INC-ALERT-DELIVERY): an artifact with no owner cannot be scoped, delivered, or acted on.

## Finding
**363 incidents exist with `client_id IS NULL`** (non-test), created **2026-05-19 → 2026-07-03**, all now closed. An incident with no client is unownable: it cannot be routed to a recipient, scoped to a tenant, or surfaced in a client view — the incident-layer twin of the null-client Amber Alert / Civil Emergency alerts.

## What created them
- **360 of 363 have `created_by_function = NULL`** (+ 3 `ai-decision-engine`) — a creation path that neither attributes a client nor stamps its own name. Composition is dominated by **`[PATTERN]` threat-type-cluster incidents** ("Threat type cluster: N violence signals in 72h") plus `violence` / `wildfire` / `operational` types. These are the pattern-clustering meta-incidents (signals-about-signals) — which the WO-INCIDENT-QA gate now excludes from incident creation, but which pre-gate created incidents freely, and did so **without a client_id** (a cluster spanning unattributed signals has no single client).

## The spike (06-08 → 06-29) and why it stopped
Weekly counts: 05-18 **5** · 05-25 **2** · 06-08 **31** · 06-15 **109** · 06-22 **127** · 06-29 **89** · then **stops ~07-03**. The 06-08→06-29 window is ~356 of the 363 — a pattern-clustering run producing violence-dominant cluster incidents at scale with no client attribution. **Stop (~07-03) correlates with the pattern-signal recalibration era** (#83 severity recalibration 2026-07-09 capped [PATTERN] at MEDIUM + common-noun suppression; the WO-INCIDENT-QA gate 2026-07-28 then excluded [PATTERN] from incident creation entirely) — but the stop *predates* both by days, so the precise trigger needs deploy-history correlation around 2026-07-03. **Open:** identify the exact change that halted null-client pattern-incident creation on ~07-03.

## Why it matters / scope
- **Ownerless incidents violate the Provenance Doctrine invariant** (`client_id IS NOT NULL OR tenant_id … OR asset_class IN ('global_shared','system')`). A pattern cluster spanning multiple clients should either be attributed to each affected client (fan-out) or be a `system`/`global_shared` analytic artifact — never a bare ownerless incident.
- **The gate already closes the forward path** ([PATTERN] excluded from incident creation). This WO is about (a) confirming no ownerless-incident path remains, and (b) the disposition of the 363 historical rows (they are closed; decide archive vs backfill-owner vs leave).
- **Cross-ref:** the null-client alert routing gap (INC-ALERT-DELIVERY product boundary) — same ownerless class, different layer.
