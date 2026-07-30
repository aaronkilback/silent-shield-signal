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

## Open
- ai-tools-query re-enable stays gated behind the caller→scope gate (Generic Tool Path Clearance Phase B).
- Item 4 (full triage of the 232 verify_jwt=false functions + the ~25 request-client-scoped list) pending.
- Notify CRT (vinced) and consider customer disclosure per PIPEDA — operator decision.
