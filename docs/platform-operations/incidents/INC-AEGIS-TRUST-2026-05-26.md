# INC-AEGIS-TRUST — Aegis Perception/Action Trust Audit (2026-05-26)

**Verdict:** Aegis's **writes** through the dashboard are *improving but not yet trusted* — they are better post PROD-EE / INC-XTEN C3, but remain in-scope and uncertified until the Provenance Doctrine (INC-XTEN) fully closes; do not describe them as "mostly safe." Its **perception is NOT coherent or tenant-safe.** Multiple read paths are wholly unscoped (verified), so Aegis routinely surfaces **other tenants' data as the current tenant's ground truth**, and under/over-counts. This is **evidence-only triage — no fixes applied.**

Surfaces: `dashboard-ai-assistant/index.ts` (primary), `ai-tools-query/index.ts` (query backend), `agent-chat/index.ts` (peer agents), `_shared/handlers-signals-incidents.ts`, `_shared/common-operating-picture.ts`. All run `verify_jwt=false` + service_role → **RLS is bypassed everywhere; scoping is 100% application-layer.**

## Trust matrix (✅ verified by direct read; ☑ agent-cited file:line, high confidence)
| Capability | Works | Partial | Broken | Tenant-safe | Evidence |
|---|---|---|---|---|---|
| `get_recent_signals` (dashboard handler) | ✅ | | | **Yes** | `tenant_id=tenantId` + fixture exclusion `handlers-signals-incidents.ts:104-110` ☑ |
| **`get_active_incidents` (dashboard handler)** | | | **✅ BROKEN** | **NO** | **NO tenant filter** — only `.in(status)` + optional client_id, `handlers-signals-incidents.ts:199-216` ✅verified → returns ALL tenants' incidents |
| **`search_entities`** (dashboard + ai-tools-query) | | | **BROKEN** | **NO** | `ilike(name)` across all entities, `handlers…:257` / `ai-tools-query:44-52` ✅verified |
| **`get_active_incidents` / `get_recent_signals` / `get_entity_details` (ai-tools-query)** | | | **✅ BROKEN** | **NO** | `ai-tools-query:14-65` ✅verified — `tenant_id` param discarded, all cross-tenant |
| **`query_fortress_data` (ai-tools-query, all types)** | | | **BROKEN** | **NO** | `tenant_id` accepted, never used, `ai-tools-query:581-777` ☑ |
| **`update_risk_profile`** (action) | | | **BROKEN** | **NO** | cross-tenant **WRITE** — mutates any entity threat_score, no tenant check, `ai-tools-query:370-406` ☑ |
| `query_fortress_data` signals/incidents/clients (dashboard) | ✅ | | | Yes | `tenant_id=tenantId` `index.ts:6002/6016/6045` ☑ |
| `query_fortress_data` **entities** (dashboard) | | **PARTIAL** | | partial | `client_id IN scopedClientIds` `index.ts:6024-6041` ☑ — **undercounts null-client entities** |
| `agent_self_assessment` entity count | | | **BROKEN** | **NO** | entity count **unscoped** `index.ts:9278` ☑ (signals/incidents scoped, entities missed) → Vince #1 |
| `search_archival_documents` / `get_document_content` | | **PARTIAL** | | partial | `client_id IN scopedClientIds`; `archival_documents` has **no tenant_id col**; null-client docs invisible; silent `[]` `index.ts:1605/1686` ☑ → Vince #3 |
| `get_security_reports` / `get_report_content` | ✅ | | | Yes | `reports.tenant_id=tenantId` `index.ts:1402/1448` ☑ |
| `generate_fortress_report` (bulletin) (action) | | **PARTIAL** | | client-scoped | client resolved in-tenant `:7966`; but **7-day signed URL on private bucket + not persisted to `reports`** `:8278/8302` ☑ → Vince #4 |
| `create_entity` (action) | | **PARTIAL** | | mostly | writes suggestion w/ tenant_id `:2312`; **dup-check `ilike(name)` UNSCOPED** `:2277` (leaks foreign entity existence) ☑ |
| `inject_test_signal` / `submit_ai_feedback` (action) | ✅ | | | Yes | tenant filters `:4674/2800` ☑ |
| agent-chat `create_signal/entity/incident` (action) | ✅ | | | mostly | C3-hardened (null-ownership blocked) `:1726-1838`; but no caller auth, any client_id accepted ☑ |
| agent-chat `query_fortress_data` / `cross_reference_entities` | | | **BROKEN** | **NO** | unscoped `:1847/1875` ☑ |
| **`buildCOP`** (always-on prompt context) | | | **✅ BROKEN** | **NO** | incidents/signals/entities/watchlist **all global, no tenant filter** `common-operating-picture.ts:50-102` ✅verified |
| bulk monitoring toggle (`active_monitoring_enabled`) | | | **✅ ABSENT** | n/a | **no such tool exists**; `update_entity` declared in TENANT_SCOPED_TOOLS `:267` but **no case/definition** → Vince #2 |

## Domain findings
**1. PERCEPTION — NOT coherent.** Signals (dashboard) + reports are tenant-safe. **Incidents, entities (search), and the entire `ai-tools-query` backend + `buildCOP` are unscoped** → Aegis sees all tenants. Entities/documents (dashboard `query_fortress_data`) use the WRONG column (`client_id` not `tenant_id`) → undercount. Empirical CRT perception (ground-truth vs tenant-filter): incidents 7 vs 1 (6 client-owned null-tenant hidden), entities 62=62 (CRT clean post-backfill; 37 null-tenant entities remain elsewhere), signals 120=120.

**2. ACTION — mixed.** Tenant-correct: dashboard create_entity (suggestion), inject_test_signal, agent-chat create_* (C3). **Broken/absent:** bulk monitoring toggle (no tool), `update_risk_profile` (cross-tenant write), generate_fortress_report (expiring/unrecoverable link). Document processing + report generation work but with the perception/link gaps below.

**3. TENANT ISOLATION — multiple confirmed leaks.** (a) wrong-tenant query: YES — `ai-tools-query` (all), `get_active_incidents`/`search_entities` handlers, `buildCOP`, agent-chat reads. (b) service-role before scoping: YES — `ai-tools-query` is wholesale service-role + unscoped; `buildCOP` runs pre-auth. (c) stale cache: LOW — `getScopedClientIds` WeakMap is per-request (`index.ts:391-407`); fresh client per request. (d) context leak: YES via (a)/(b). **Dashboard tenant DERIVATION is sound** (`userTenantId` from `tenant_users`, spoof-proof `:10061-10082`) — the failure is downstream tools ignoring the resolved tenantId, and the "TENANT_SCOPED_TOOLS" gate giving false assurance (it blocks unauthenticated callers but the handlers still don't filter).

**4. TOOL INTEGRITY** — see matrix. Cross-cutting: `verify_jwt=false` on all three surfaces means `ai-tools-query`/`agent-chat` are also directly invocable with the anon key (live exploitability code-indicated, not HTTP-probed).

**5. TRUTH DISCIPLINE — partial presented as full.** Silent `[]` on tenant/RLS exclusion (docs `:1593`); entity undercount reported as authoritative total (`:6176`); `update_risk_profile` returns success without tenant check; `lookup_ioc_indicator` returns a confident verdict from a cross-tenant corpus (`ai-tools-query:827`); `trigger_osint_scan` returns `success:true` on a 404 (`handlers…:645`); `create_entity` false "already exists" from a foreign tenant (`:2277`); agent-chat query errors swallowed to `{success:true,count:0}` (`:1861`); report link handed over as durable when it expires in 7 days (`:8311`).

## The 4 Vince cases — root causes (verified)
1. **Entity count mismatch** — `agent_self_assessment` counts entities **unscoped** (`index.ts:9278`, while signals/incidents on :9276-9277 ARE scoped); `query_fortress_data` entities filters by **`client_id`** (`:6024`) so it drops null-client entities. Two code paths → two wrong numbers. Correct = count by `entities.tenant_id`.
2. **Bulk monitoring toggle failure** — **no Aegis tool toggles `active_monitoring_enabled`** (bulk or single). `update_entity` is registered (`:267`) but has no implementation; `configure-entity-monitoring` edge fn exists but isn't exposed. Aegis can't do it → hallucinates success or refuses.
3. **Uploaded report not retrievable** — `search_archival_documents`/`get_document_content` filter `client_id IN scopedClientIds` (`:1605/:1686`); `archival_documents` has **no tenant_id column**, uploads land with null `client_id`, → invisible; returns `{success:true, documents:[]}` so Aegis says "not found." (Same root as INC-XTEN INC-DOC-002.)
4. **Broken signed artifact link** — `generate_fortress_report` bulletin path uploads to private `osint-media` with a **7-day `createSignedUrl`** (`:8278`) and **never persists to the `reports` table** (`:8302-8315`), so after expiry there's no re-sign path → InvalidJWT/expired. (Same class as INC-ART-CLUSTER INC-ART-001.)

## Recommended remediation (NOT done — audit only; each needs its own gated change)
- **P0 isolation:** scope `ai-tools-query` by tenant (or stop routing tenant-bearing tools to it); fix `get_active_incidents`/`search_entities`/`search_signals_by_entity`/`get_signal_incident_status` handlers to filter by tenant; scope `buildCOP`; scope agent-chat reads + add caller auth. These are the same open-RLS/unscoped-service-role class as INC-XTEN's doctrine — **fold into the sibling sweep (#19) but at P0 given Aegis surfaces it to operators.**
- **P1 correctness:** count/filter entities + documents by `tenant_id` (needs `archival_documents.tenant_id` — ties to INC-XTEN Phase 3/2C); fix `agent_self_assessment` entity count.
- **P1 capability:** expose a tenant-scoped bulk monitoring toggle tool.
- **P1 artifacts:** durable report delivery (persist + authenticated proxy, per the no-raw-signed-URL ADR).
- **Truth discipline:** distinguish "0 results" from "hidden by scope"; never return success on failed scans/cross-tenant writes.

**No mutations. Evidence-based. Fixes are separate, gated work.**
