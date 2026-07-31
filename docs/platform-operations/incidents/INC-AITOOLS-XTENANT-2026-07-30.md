# INC-AITOOLS-XTENANT-2026-07-30 — cross-tenant exposure via ai-tools-query (+ create-operator-invite escalation)

**Status:** CONTAINED. **Class:** cross-tenant data exposure / privilege escalation.
**PIPEDA:** this document is the breach record required regardless of reportability determination.

## Finding A — ai-tools-query unauthenticated cross-tenant intelligence path
- **What:** the `ai-tools-query` edge function ran `verify_jwt=false` and derived tenant/client scope
  from a **caller-supplied `tenant_id`** (not the authenticated JWT), exposing ~22 tools that returned
  operational intelligence for **any** tenant. Also contained an entity-write-by-UUID-regardless-of-tenant bug.
- **Window live:** first git commit **2025-11-22**; hard-disabled (503, no service-role client, no DB read)
  **2026-06-12** (`48ff0c09`; env-flag kill-switch attempted 2026-06-10 `411c3ed6`). ~6.5 months.
- **Tools (22) / data classes reachable cross-tenant:**
  - Signals/threat intel: get_recent_signals, get_related_signals, search_signals, get_active_incidents, lookup_ioc_indicator
  - **Client-sensitive:** get_client_critical_assets, get_client_operational_context, get_client_risk_profile, get_client_risk_summary, search_clients
  - Entities/POIs: get_entity_details, get_entity_summary_for_signal, search_entities
  - Investigations/KB: search_investigations, search_knowledge_base
  - Writes/actions: update_risk_profile, draft_response_tasks, recommend_playbook, integrate_incident_management, trigger_manual_scan
  - Metadata: get_source_reputation, get_monitoring_stats

### Bounding facts (mitigating)
- **Discoverability:** the function NAME was in the public frontend bundle **only 2025-11-22 → 2025-11-25**
  (3 commits, then routing moved to dashboard-ai-assistant). For the remaining ~6.4 months the name was
  NOT in the frontend. Project ref + anon key are (normally) in the bundle throughout.
- **Data timeline:** NO tenant data existed until **2026-03-05** (Petronas first real signals 2026-03-29).
  **The discoverable window (Nov 22–25 2025) and the data-bearing window (Mar–Jun 2026) DO NOT OVERLAP.**
- **Per-tenant exposure overlap (data present AND vuln live, to 2026-06-12):**
  | Tenant / client | First data | Signals in overlap | Sensitivity (operator-confirmed) |
  |---|---|---|---|
  | Petronas Canada (Silent Shield Ops) | 2026-03-29 | 992 | see PECL breakdown below |
  | BC Place (Critical Risk Team) | 2026-05-18 | 153 | **open-source data only (operator-confirmed)** |
  | Trent Reznor (Critical Risk Team) | 2026-05-20 | 11 | **test tenant, ZERO personal data (operator-confirmed)** |
  | Kilbacks (SSO, personal) | 2026-06-11 | 26 | personal/test tenant (Aaron) |
  | Cascade / _qa / _benchmark / _invariant | — | — | test tenants |

### PECL (Petronas) data classes reachable in the window (created_at < 2026-06-12), by sensitivity
- **Signals — 992, ALL public-source origin.** By monitor: monitor-news-google 324, monitor-rss-sources 142,
  monitor-naad-alerts 43 (public emergency), monitor-cisa-kev 16 (public CVE), monitor-wildfires 9 (public NRCan),
  monitor-csis 2, unknown-legacy 456 (origin unrecorded — same public-OSINT population). Publisher kinds:
  aggregator 180 / outlet 125 / sensor 26 / advocacy 3 / official 1 / internal (Fortress-derived) 145 / no-source 512.
  **No private-intelligence origin** (no breach data, dark web, or POI-investigation-derived signals).
- **Client-confidential business intelligence — 1 `clients` row**, fields: high_value_assets (**7**), locations (**18**),
  monitoring_keywords (**42**), competitor_names (**9**), supply_chain_entities (**15**), employee_count (present),
  risk_assessment (populated jsonb), threat_profile (populated jsonb), monitoring_config (populated jsonb). Proprietary,
  not personal — Petronas critical-infrastructure list, threat posture, supply chain, competitors.
- **Personal information (named individuals) — HIGHEST sensitivity: 788 PECL person-entity records** + **2 investigations**
  reachable via get_entity_details / search_entities / search_investigations. (knowledge_base_articles are not
  client-scoped — no client_id.) This is the class that makes PECL a PIPEDA personal-data consideration.

### Retention / auditability — plain statement
- **Per-invocation records are NOT retained.** `function_telemetry` has **0 records for ai-tools-query**
  (never instrumented) and retains only from 2026-04-30; Supabase edge request logs do not reach back
  into the window. **Therefore exploitation can be neither confirmed nor ruled out.**
- **Immutable event chain does NOT cover the window:** `audit_events` starts 2026-03-05 (misses the first
  ~3.5 months) and is **98% null-actor** where present. Writes made via the 5 write tools (clients risk
  profiles, entities-by-UUID, playbooks, manual scans) are not attributable for the window.

## Finding B — create-operator-invite super_admin escalation (LIVE until 2026-07-30)
- Any authenticated caller (incl. a no-tenant self-signup) could `create-operator-invite` with a
  caller-supplied `client_id` + `role` (NO allowlist) — including `role='super_admin'`. On accept,
  `accept-operator-invite` upserts `user_roles(super_admin)`; `is_super_admin` bypasses RLS entirely →
  full cross-tenant read. `operator_invites` = 0 rows → **never exploited**, but the path was live.

## Containment / fix (shipped 2026-07-30)
- `ai-tools-query` hard-disabled since 2026-06-12 (pre-existing).
- **create-operator-invite** (deployed): mandatory auth gate — role allowlist, super_admin never grantable,
  reject role ≥ caller's own, client-scoped invites require caller `tenant_users` admin/owner of the
  client's tenant, participant check mandatory for conversation-scoped, bare role-only invites rejected,
  `verify_jwt=true`.
- **accept-operator-invite** (deployed): phantom `client_users` write removed; defensive role allowlist.
- **Watchdog probe (e):** `operator_invite_membership_check()` RPC — any `operator_invites` whose creator
  lacks tenant membership for that client → CRITICAL. Negative-tested (fires 1 on seeded fixture, 0 clean).

## Amendment 2026-07-30 — determination reversal + field-level PII inventory

### SUPERSEDED operator determination
> ~~"Petronas = open source, no confidential client information."~~ — **SUPERSEDED 2026-07-30.**
Retained for the record: the assessment changed. **Corrected finding:** the PECL person-entity and
investigation records contain **confidential, PECL-internal personal information that is NOT
OSINT-derivable.** The "public OSINT" characterization applies to the 992 *signals*, not to the
*entity/investigation* records.

### Explicit flags (not OSINT-derivable → internal origin)
- **Employment-separation data present:** `former_employee`, `termination_reason`, `termination_year` —
  internal HR-class facts, not public.
- **Ethnicity / nationality fields present** (`ethnicity`, `nationality`) — special-category personal data,
  not OSINT-derivable.
- **Investigations carry a `police_file_number` and `maximo_number` (Maximo work-order refs)** — indicating
  **PECL-internal / law-enforcement origin**, not open source.

### Field-level PII inventory — 788 PECL person entities (created_at < 2026-06-12), FIELD NAMES ONLY
Columns: `id, name, type, aliases, description, risk_level, attributes(jsonb), created_by, created_at,
updated_at, is_active, threat_score, threat_indicators, associations, active_monitoring_enabled,
current_location, monitoring_radius_km, confidence_score, entity_status, address_street, address_city,
address_province, address_postal_code, address_country, client_id, tenant_id, ai_assessment(jsonb),
ai_assessed_at, quality_score, priority_scan_requested_at, deleted_at, deletion_reason, visibility_class`.

Populated (of 788): name 788 · description 344 · risk_level 288 · threat_score 177 · threat_indicators 157 ·
aliases 45 · phone 29 · email 27 · contact_info 24 · current_location 12 · associations 11 · employment 11 ·
home-address 3 · social handles 2 · nationality/ethnicity 1 · ai_assessment 0.

Flagged categories: **photographs 15 (`entity_photos`) · home addresses 3 · associates 11 (+2 relationship
edges) · employment history 11 · social handles 2**; NONE for dates-of-birth, vehicle/property, family members.

### Field-level inventory — 2 PECL investigations
Columns: `id, file_number, maximo_number, prepared_by, created_by_name, synopsis, information,
recommendations, file_status, incident_id, police_file_number, cross_references, correlated_entity_ids,
intake_email_tag, next_review_at`. Populated (of 2): file_number/maximo_number/prepared_by/created_by_name/
synopsis/file_status/intake_email_tag 2 · correlated_entity_ids (link to persons) 2 · information 1 ·
**police_file_number 1** · recommendations/incident_id/cross_references 0.

### LEGAL HOLD (enacted 2026-07-30)
The 788 person entities + their 15 `entity_photos` + the 2 investigations are **FROZEN** pending legal
review — no modification, deletion, or reclassification. Mechanism: `legal_hold` boolean column on
`entities`/`entity_photos`/`investigations` (set true on the held set), enforced by BEFORE UPDATE OR DELETE
trigger `block_legal_hold_writes()` (raises on any held row). Held person entities were quiesced
(`active_monitoring_enabled=false`) so live monitors skip them and do not hit the block. Migration
`20260730203000_inc_aitools_legal_hold.sql`.

## Amendment 3 2026-07-30 — EXPLOITATION DIFFICULTY REVISED (more severe)

> ~~Prior: exploitation required obtaining a valid `tenant_id` (UUID), assessed as the hardest step
> with no obvious external source.~~ — **SUPERSEDED / CORRECTED 2026-07-30.**

**Corrected assessment (verified against pre-containment git `adce9554`):** **no `tenant_id` was required.**
- `search_clients` took only a `query` string, applied **no tenant filter**, and returned **`id` (client_id),
  name, industry, status, contact_email, locations, and signal/incident counts for ALL clients across ALL tenants.**
- The read/search tool class — `get_recent_signals`, `get_active_incidents`, `search_signals`,
  `search_entities`, `search_investigations` — was **callable with no `tenant_id`** and returned **client
  identifiers, client names (`clients(name)` joins), entity identifiers with `current_location` and
  `threat_score`, and investigation `file_number`s and `synopsis`.**
- `update_risk_profile`'s 404 path acted as a **tenant-membership oracle** and **echoed the probed `entity_id`**.
- Commit `adce9554` was a **partial** tenant-isolation fix (#79) that scoped only certain write/lookup tools
  (`update_risk_profile`, `lookup_ioc_indicator`) and **left the entire read class unscoped**.

**Exploitation required only: knowledge of the endpoint name, the request-body shape, and a single POST.
No authentication, no tenant identifier, no pivot.** This is materially more severe than the earlier
"needed a tenant_id UUID first" framing — there was no gating step at all.

**In-database auth trail:** `auth.audit_log_entries` is **empty (0 rows)** — GoTrue auth events route to the
Supabase analytics/log pipeline, not the DB table. **No in-database auth trail exists** to attribute or rule
out access (adds to: edge request logs not retained, `audit_events` starts 2026-03-05 / 98% null-actor, no
org platform audit log on Pro). Exploitation remains neither confirmable nor deniable at every log layer.

## Amendment 5 2026-07-31 — EXPOSURE WINDOW CORRECTED (NOT bounded to 2026-06-12)

> ~~Prior framing: the exposure window was 2025-11-22 → 2026-06-12 (ai-tools-query hard-disabled
> 2026-06-12), after which the person-entity PII class was no longer cross-tenant/unauthenticated
> reachable.~~ — **STRUCK / CORRECTED 2026-07-31. The prior date does not bound the exposure.**

**Two additional UNAUTHENTICATED paths to the SAME person-entity PII class were live until 2026-07-31:**
- **generate-poi-report** — verify_jwt=false, no caller auth ever. Reads `entity_id`, returns the full POI
  dossier (OSINT content, signals, watch-list, relationship graph) for any entity. First deploy **2026-04-02**;
  hard-disabled (503) **2026-07-31**. Window: **2026-04-02 → 2026-07-31, unauthenticated.** The
  "entity-scoped by design" annotation was verified FALSE as a safety claim (entity-scoped ≠ access-controlled).
- **investigate-poi** — verify_jwt=false, no caller auth. Reads `entity_id`, runs OSINT (Google CSE, HIBP,
  people-search/court sites), stores results + creates signals. First deploy **2026-04-02**; hard-disabled
  **2026-07-31**. Window: **2026-04-02 → 2026-07-31, unauthenticated.**

Both were reachable **before 2026-06-12 AND for ~7 weeks after** ai-tools-query closed. **The person-entity PII
class was continuously reachable via at least one unauthenticated/unscoped path from ~2026-04-02 to 2026-07-31.**

**Corrected per-path windows (all closed 2026-07-31 unless noted):**
| Path | Window | Auth | Closed |
|---|---|---|---|
| ai-tools-query | 2025-11-22 → 2026-06-12 | verify_jwt=false, caller-supplied tenant scope | hard-disable 48ff0c09 |
| generate-poi-report | **2026-04-02 → 2026-07-31** | verify_jwt=false, none | 503 (0861ad11) |
| investigate-poi | **2026-04-02 → 2026-07-31** | verify_jwt=false, none | 503 (0861ad11) |
| webhook-dispatcher | 2026-01-14 → 2026-07-31 | verify_jwt=false, spoofable | 503 (0861ad11) |
| scan-client-staff | 2026-04-24 → 2026-07-31 | verify_jwt=true, no membership check | FIXED (caller tenant_users gate) |
| api-key-management | 2026-01-14 → 2026-07-31 | verify_jwt=true, admin but not tenant-scoped | FIXED (tenant gate) |

Discovery route: the WO-CI-SECURITY-GATE-01 check-2 triage (2026-07-31) surfaced these; contained same day.
Per-invocation logs remain non-retained (function_telemetry/edge logs) — exploitation of these paths can be
neither confirmed nor ruled out, same as ai-tools-query.

## Amendment 4 2026-07-30 — operator statements (ALL PENDING VERIFICATION) + verification evidence

Three operator statements recorded 2026-07-30. Each is marked **pending verification** and checked by query
below. **Sourcing does not alter classification:** personal data extracted from any source and held in Fortress
remained personal information under Fortress's control and was within scope of the exposure. A **3Si contractual
dimension** may apply and is noted as open.

### Statement 1 — "Platform use is test/parallel; PECL file systems are the operational system of record."
**Verification (creation path + date distribution of the 788 person entities):**
- created_by: **776 NULL (automated/service-role), 12 by akilback@hotmail.com (manual)** — creation is overwhelmingly automated, not hand-entered.
- by month: 2025-11 **184**, 2025-12 17, 2026-01 **163**, 2026-02 **276**, 2026-03 65, 2026-04 21, 2026-05 43, 2026-06 19.
- **640 of 788 (81%) were created before 2026-03-01 — i.e. before operational SIGNAL monitoring began (signals first appear 2026-03-29).**
- 593 `document_entity_mentions` link the 788 to ingested documents; 13 PECL `ingested_documents` exist.
**Assessment:** the *timing* is **consistent** with pre-operational / backfill / document-ingestion population (81% predate live monitoring), which does not contradict "test/parallel." **Not confirmable as intent from data alone.** Whether PECL's own file systems are the SoR is **outside the DB and unverifiable here.** The records are real PII regardless of intent.

### Statement 2 — "The 2 investigation records were entered to exercise the interface."
**Verification:** both investigations created **2026-05-04**, `prepared_by`/`created_by_name` = **Aaron Kilback** (`5f48f826…`), `file_status=closed`, both carry `maximo_number` (one also `police_file_number`), neither linked to an incident.
**Assessment:** **consistent** — both hand-created by the operator on a single day and closed. Intent not independently confirmable; the Maximo/police-file content mirrors real PECL-internal formats.

### Statement 3 — "termination_reason, former_employee, nationality, ethnicity derive from 3Si vendor documents uploaded for analysis, not direct collection."
**Verification (extraction provenance on the sensitive fields):**
- Only **2 entities** carry any of the four fields (each field on 1 entity).
- **Neither has any `document_entity_mentions` link (0)**, no `source_investigation`, no `source_document`/`3si`/`upload` attribute. One was **created manually by Aaron** (2026-04-03, no provenance keys); the other automated (2026-05-11, `investigation_status` only).
- **0 documents in `ingested_documents` are tagged "3Si"/"3si".**
**Assessment:** **NOT CORROBORATED.** There is **no stored provenance** linking these fields to a 3Si (or any) uploaded document. The claimed extraction chain is not recorded anywhere in the DB; one of the two records was hand-entered by the operator. This is itself a **provenance gap** — the special-category fields (ethnicity/nationality) and HR-class fields (termination) have no source attribution on record.

### Classification (unchanged)
Per the note: sourcing does not alter classification. Whatever the origin, these were personal information under Fortress's control and within the exposure scope. **Open: 3Si contractual dimension** (added to §6 open items of the RESPONSE record).

## Open
- ai-tools-query re-enable stays gated behind the caller→scope gate (Generic Tool Path Clearance Phase B).
- Item 4 (full triage of the 232 verify_jwt=false functions + the ~25 request-client-scoped list) pending.
- Notify CRT (vinced) and consider customer disclosure per PIPEDA — operator decision.
