# ADR — Aegis Tenant Intelligence Retrieval Surface (cross-asset reasoning)

**Status:** DESIGN (no code). Refines the **Aegis (tenant) MODE-A read capability** in `aegis-authority-modes.md` into a concrete cross-asset reasoning spec. This is **tenant Aegis, not Aegis Ops.**

**Decision:** Tenant Aegis reasons across the **whole tenant intelligence graph** — it is a broad intelligence officer, not a single-table lookup. All retrieval is **tenant-scoped FIRST** (the caller's own tenant), with **approved-clean L2 enrichment SECOND**. Bound by the ratified **Cross-Tenant Retrieval Exclusivity** amendment: no tenant-facing path may directly query cross-tenant/global/service-role stores or unscoped helpers — everything goes through `tenantRetrieve()`.

## Governing rule — CERTIFIED-SAFE ALLOWLIST, DEFAULT-DENY (RATIFIED 2026-05-27)
**Tenant Aegis may retrieve ONLY from certified-safe surfaces through `tenantRetrieve()`. Any uncertified surface is unavailable by default.** Retrieval is an **allowlist, not a denylist** — a surface is unreachable until it is explicitly certified and added to `CERTIFIED_TENANT_SURFACES`. `tenantRetrieve()` refuses any asset not in that set; Aegis honest-refuses ("I can't retrieve that yet — that source isn't certified for tenant access"). This inverts the historical default (available-unless-flagged), which is how unscoped/keyless surfaces leaked.

**A surface is CERTIFIED-SAFE only when ALL hold:**
1. **Declared scope key** — it is reached *exclusively* through `tenantRetrieve()` with one of the five declared scope-key patterns (below); no raw `.from()` path to the same data remains.
2. **Isolation proof** — a cross-tenant probe returns **only** caller-tenant rows (0 cross-tenant), empirically verified — including the parent-join / edge-join / client-cascade surfaces that have no own tenant key.
3. **No leaky sibling** — every other path to the same data (ai-tools-query, handlers, agent-chat) is closed or also seam-routed (R2).
4. **L2 content certified** (for any L2 surface) — content-anonymization proven (L2 audit + NER scan = 0); contaminated stores are never certified.

Certification is **per-surface and recorded** in the table below. Adding a surface to the allowlist requires its proof to pass; until then it stays **UNCERTIFIED → unavailable**.

## The tenant intelligence graph — required surfaces, real tables, scope keys
The required surfaces map to heterogeneous scope keys. **5 scoping patterns**, and several surfaces have **no tenant key of their own** (must be scoped by join to an owned parent) — these are the historical leak sites.

| Required surface | Real table | Scope key | Pattern | Status today |
|---|---|---|---|---|
| entities | `entities` | `tenant_id` | direct | ✅ scopable (search/count were unscoped — INC-AEGIS-TRUST) |
| entity scan results | `entity_content` | `entity_id → entities.tenant_id` | parent-join | ⚠ no own key |
| entity relationships | `entity_relationships` | `entity_a_id/​entity_b_id → entities.tenant_id` | edge-join (both endpoints in-tenant) | ⚠ no own key |
| entity mentions | `entity_mentions` | `entity_id → entities.tenant_id` | parent-join | ⚠ no own key |
| investigations | `investigations` | `client_id → clients.tenant_id` | client-cascade | ⚠ no `tenant_id` |
| investigation findings | `investigations` (jsonb) / `poi_reports`(`entity_id`) | via parent | parent-join | ⚠ |
| uploaded documents | `archival_documents` | `client_id` only | client-cascade | ❌ **no `tenant_id` — INC-CRT-DOCUMENT-SCOPE** |
| executive reports | `reports`, `generated_reports`, `poi_reports` | `tenant_id` (reports/generated); `entity_id` (poi) | direct / parent-join | ✅ reports scopable |
| signals | `signals` | `tenant_id` | direct | ✅ (dashboard handler scoped; ai-tools-query path unscoped) |
| incidents | `incidents` | `tenant_id` | direct | ⚠ handler currently **unscoped** (INC-AEGIS-TRUST) |
| source intelligence | `sources` | `created_by_tenant_id` (+ null-tenant = global, separate) | direct(ish) | ✅ owned-source fix shipped (INC-CRT) |
| timeline history | derived: `signals`/`incidents`/`entity_content`.`created_at` deltas | via each parent's scope | composed | composed |

(Tables that don't exist as named: `entity_scan_results`→`entity_content`; `incident_timeline`/`investigation_findings`/`activity_feed`→derived/embedded.)

## Retrieval contract — one seam knows every scope key
**`tenantRetrieve(asset, tenantCtx, …)` is the only path to L1**, and it encodes the per-asset scope key from the table above:
- **direct** (entities/signals/incidents/reports/generated_reports): `WHERE tenant_id = caller`.
- **parent-join** (entity_content/mentions/poi_reports): `JOIN entities ON entity_id WHERE entities.tenant_id = caller`.
- **edge-join** (entity_relationships): both endpoints must resolve to in-tenant entities; a cross-tenant edge is refused, not returned.
- **client-cascade** (investigations, archival_documents-until-fixed): `client_id IN (clients WHERE tenant_id = caller)`.
- **owned/global** (sources): `created_by_tenant_id = caller` ∪ approved global/null-tenant sources.

Cross-asset reasoning assembles a **tenant-scoped correlation pack** by composing these scoped reads (e.g., entity → its scans → mentions → relationships → signals → incidents → documents → reports → timeline), **all filtered to the caller's tenant before assembly.** Aegis reasons over that pack. **L2 enrichment is layered on after** via `globalLearning()` — approved-clean only (source reliability, detection heuristics, threat archetypes, anonymized trends), never raw cross-tenant facts.

## Use-case → retrieval pattern
| Operator question | Pattern (all tenant-scoped) |
|---|---|
| "Which entities are connected?" | `entity_relationships` edge-join → resolve names from `entities` |
| "Have we seen this pattern before?" | tenant `signals`/`incidents` history + sequence match; **then** L2 threat archetypes ("resembles fleet pattern Y") |
| "What links this person to the prior investigation?" | `entities` → `investigations` (client-cascade) + `entity_mentions`/`entity_content` join |
| "What changed in the last 7 days?" | `created_at`/`updated_at` deltas across signals/incidents/entities/scans/reports (tenant-scoped), composed timeline |
| "Summarize the threat picture." | tenant COP: scoped signals (severity) + open incidents + top entities + recent scans; **then** L2 anonymized fleet context |
| "Correlate documents + signals + entities" | `archival_documents`(scoped) ∪ `entity_content` ∪ `signals` joined on entity/keyword, tenant-scoped |
| "Identify escalation indicators" | signal severity/velocity + incident status transitions + threat_score deltas, tenant-scoped; L2 escalation heuristics second |

Composition discipline: *"For CRT, I see X across entities/signals/incidents [L1]. Based on fleet patterns, this resembles Y [L2]."* — never "across the platform."

## Constraints (ratified doctrine)
- **Tenant-only retrieval**, unless **explicitly approved sanitized L2** (the ratified-L2 set: `expert_profiles`, `knowledge_base_articles`, `source_credibility_scores`, `sequence_patterns`, `threat_trajectories`, `world_knowledge_sources`, `agent_learning_sessions[proactive]`). The contaminated free-text stores (`expert_knowledge`/`global_learning_insights`/`agent_beliefs`) stay **blocked** until INC-LEARN-CONTAM remediation.
- **No cross-tenant disclosure**, no impersonation — this is Aegis (tenant), and cross-tenant correlation is an Aegis Ops operation, never tenant Aegis.
- Honest gaps: if a surface returns nothing, distinguish "none in your tenant" from "not yet retrievable."

## Hard dependencies + roadmap slot
This is **roadmap Phase K (Aegis tenant capabilities)** and is **NOT safe to enable until its prerequisites land** — several listed surfaces leak today:
1. **R1 retrieval seam** — must encode all 5 scope-key patterns (this ADR is its requirements spec for reads). Phase B.
2. **R2 class-D leak fixes** — incidents handler, `search_entities`, `ai-tools-query`, agent-chat reads must be tenant-scoped first. Phase C.
3. **INC-CRT-DOCUMENT-SCOPE** — `archival_documents.tenant_id` (no own tenant key today) before documents enter the correlation pack. Phase L.
4. **L2 classification + INC-LEARN-CONTAM remediation** — before any L2 enrichment beyond the ratified-clean subset.

Under default-deny, **no surface is available until certified through `tenantRetrieve()`** — there is no "already-available" subset by inheritance. As R1 lands, the **direct-`tenant_id` surfaces** (entities, signals, incidents-once-handler-scoped, reports, generated_reports) are the first certification candidates (simplest isolation proof); the **parent-join / edge-join / client-cascade** surfaces certify as their join-scoping is proven; **archival_documents** cannot certify until INC-CRT-DOCUMENT-SCOPE adds `tenant_id`; **L2** surfaces certify only from the ratified-clean set. The cross-asset graph expands one certified surface at a time — never by default.

### Certification status (2026-05-27): **NONE certified.** `tenantRetrieve()` does not exist yet (R1 pending) and leaky sibling paths are open (R2 pending), so by rule the allowlist is currently empty. Certification begins as R1 ships.

**No mutations. Design. This is tenant Aegis (MODE A), bounded to the tenant graph + approved-clean L2.**
