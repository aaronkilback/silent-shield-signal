# 74 Ownerless Entities — Impact + Prioritization Assessment

**Task #181 · 2026-06-01** — read-only assessment in response to operator question following ER v1 substrate §10.5 side-finding. No remediation proposed; this answers impact and recommends A (block ER) vs B (continue + track separately).

---

## 1 · What are these 74 entities?

### Origin source
- **Client:** 74/74 belong to `client_id = Petronas Canada` (a real client owned by tenant `Silent Shield Operations`). The `client_id` is set; only `tenant_id` is missing — a denormalization gap, not an unknown-origin orphan.
- **Visibility class:** 74/74 are `'extracted'` (the default value of the `visibility_class` column; not yet reviewed/curated).
- **Created_by:** 74/74 NULL — no human creator. These are machine-extracted, not manually added.
- **Attributes / description / threat_score / ai_assessed_at:** all 74 have **empty `attributes ({}::jsonb)`, no description, no threat_score, no AI assessment.** They are bare extraction byproducts — names + types only.

### Creation path (identified)

Two writers emit entities without `tenant_id`:

1. **`supabase/functions/process-intelligence-document/index.ts:755-765`** — LLM extraction from documents. The INSERT sets only `name`, `type`, `confidence_score`, `entity_status: 'suggested'`, `is_active: true`. **No `tenant_id`. No `client_id`.**
2. **`supabase/functions/extract-predicted-events/index.ts:131-132`** — predicted-event extraction from signals. Sets `client_id` from the source signal but **omits `tenant_id`**. (Not the primary source for these 74 — those are person/organization/location/infrastructure, not events — but same class of defect.)

A backfill in `system-watchdog/index.ts:1843-1852` attempts to assign `client_id` to entities that already have a `tenant_id`, but it does NOT add `tenant_id` to entities that lack it (the loop indexes by `orphan.tenant_id` and only acts when tenant is known). So once an entity lands NULL-tenant, no maintenance step recovers it.

Net: the writers fail to call any tenant-resolving helper at insert time. Something else — likely a downstream client-match update — sets `client_id` after the fact.

### Age distribution
- **49 in last 7 days · 25 in 7–30d · 0 older than 30 days.**
- Newest: `2026-05-31T21:09Z` ("fossil fuel projects", infrastructure).
- Oldest: `2026-05-19T16:10Z` ("CIBC World Markets", organization).

These are **not legacy debris**. The writer is **actively producing more**. At the observed rate (~74 in 13 days ≈ 5–6/day), the population grows by ~150–200 per month if unaddressed.

### Active vs dormant
- 74/74 `is_active = true` — flagged active.
- 74/74 `active_monitoring_enabled = false` — NOT in any monitoring queue (none of the social/news monitors will hit these).
- 74/74 `deleted_at IS NULL`.
- 13/74 `entity_status = 'confirmed'`, 61/74 `'suggested'`.

So **schematically active but operationally inert** — no monitoring runs on them, no investigation work on them.

### Type breakdown
- 34 organizations
- 18 persons
- 13 locations
- 9 infrastructure

Names confirm the source class — Alberta/Canadian energy-industry extractions ("fossil fuel projects", "Alberta's energy minister", "CIBC World Markets", "tailings ponds", "Coastal GasLink", etc.).

---

## 2 · What operational risk do they create today?

| Risk class | Severity | Reasoning |
|---|---|---|
| **Immediate security risk** | LOW | No PII in `attributes` (all empty). No personal addresses, no contact info, no investigative content. Pure surface-level NLP byproducts (names + types). Nothing extractable that wouldn't already be in the parent signal/document. |
| **Tenant-isolation risk** | LOW–MODERATE | 71/74 entities mentioned by signals from only ONE tenant. 1/74 ("Canada's energy minister") mentioned by signals from 2 tenants — that one IS a cross-tenant overlap surface. 2/74 have no signal mentions. They are NOT in any operational tenant surface (no incidents, POI reports, relationships, clusters, watchlists, notifications). Tenant-facing readers that JOIN through `entity_mentions` or `document_entity_mentions` could surface them; readers that filter by `entities.tenant_id` will skip them. |
| **Future capability risk** | MODERATE | Multiple approved future capabilities (Account Cycling, Threat Attribution, Historical Reconstruction) need tenant-correct entity attribution. Any retrieval that filters by `entities.tenant_id` will silently EXCLUDE these from analysis — a quiet data gap. Any retrieval that doesn't filter will surface them in the wrong tenant context — a quiet leak. Both failure modes are silent. |
| **Data hygiene** | HIGH | Two active writers persist ownerless artifacts. Schema is permissive (column is nullable). Continues to accumulate at ~5–6/day. Every day deferred adds remediation cost. |

---

## 3 · Capability impact if these entities remain unresolved

### Entity Resolution v1 (just shipped substrate)
- **Impact: NONE during the substrate phase.** No writer/reader is live.
- **Impact on writer slice (future):** the writer clustering job will need to skip entities with `tenant_id IS NULL` (or fail-closed via the trigger). The trigger already enforces this; writer code will inherit honest refusal at insert time. **No rework — protected by substrate.**

### Account Cycling Detection (future)
- Cycling reasons over `actor_cluster_members` + their `first_seen_at`/`axes_evidence`. Because no ownerless entity can become a cluster member (trigger blocks), Cycling itself is **unaffected**.
- However, Cycling's INPUT layer (the candidate-generation step that compares entities) will silently miss any ownerless entity whose alternate identities ARE tenant-owned — i.e., if "Canada's energy minister" (ownerless) is actually the same actor as a tenant-owned entity, the link cannot form. **Functional gap, not a contamination gap.**

### Threat Attribution (future)
- Attribution relies on the same entity graph + `entity_relationships`. Ownerless entities have **zero `entity_relationships`** in prod — so they cannot anchor an attribution chain. They neither propagate threat nor receive attribution. **Silent under-attribution gap if the analyst is actually trying to attribute a threat to one of these names.**

### Historical Reconstruction (future)
- HR queries the entity graph in a time-bounded window. If an analyst asks "who was active in BC energy controversies in May 2026?", the 18 ownerless `person` rows ("Alberta's energy minister", "Canada's energy minister") would be relevant but excluded from a tenant-scoped query. **Silent under-coverage.** If the same query used a tenant-blind path (which would be a doctrinal violation), they'd surface — but they'd surface with no provenance, no description, no evidence to support the answer.

### Image Recognition (future)
- Image Recognition keys off `entity_photos` (FK→entities). **0/74 ownerless entities have any photo.** Image Recognition is therefore **unaffected**. (And new Image Recognition writes would have to honor the entity's tenant via `entity_photos.tenant_id` — that's a separate constraint to verify when the IR capability is designed.)

---

## 4 · Does the new ER trigger fully protect Fortress?

**Plain-English answer: The trigger protects the ER capability completely. It does NOT protect Fortress as a whole — but Fortress doesn't need it to.**

### What the trigger DOES protect
- The trigger fires on `actor_cluster_members` INSERT/UPDATE. Any attempt to make one of these 74 entities a cluster member fails with SQLSTATE 23514 (Provenance Doctrine violation). **Proven in §10.2 Test 4 of the prod validation — used `2f01018f-…` (one of the 74) as the probe.**
- Cross-tenant clustering of any future tenant-owned entity with one of these is also impossible — the cluster tenant won't match the entity's NULL tenant.
- Therefore: **no incorrect clustering, no cross-tenant cluster contamination, no ER-capability failure** can be caused by these 74. The fail-closed behavior is total for ER.

### What the trigger does NOT protect
The trigger only enforces ER-table semantics. It is silent about:
- Tenant-scoped retrievals that JOIN through `entity_mentions`/`document_entity_mentions` (existing data path).
- Aegis chat responses that retrieve via the unified retrieval graph (depends on whether the surface is in `CERTIFIED_TENANT_SURFACES` and whether it filters by `entities.tenant_id`).
- Any future capability that reads entities without filtering by `tenant_id`.

The Provenance Doctrine backstop is a **per-table** non-bypassable seam, by design. ER's table has it; other tables need their own. The 74 entities can still appear in some non-ER tenant-facing path — but no such path is in scope for ER work.

**Net: the substrate eliminates ER's exposure. It does not (and is not meant to) close every retrieval path elsewhere in the system.**

---

## 5 · Rework test

> If skipping today's remediation causes a future approved capability to be rebuilt later, the foundation is mandatory.

| Future capability | Rework needed if 74 remain ownerless? |
|---|---|
| ER writer slice | NO — trigger handles fail-close at INSERT |
| Account Cycling Detection | NO — inherits ER's protection |
| Threat Attribution | NO at substrate; will surface as a Coverage Confidence gap, not a rebuild |
| Historical Reconstruction | NO at substrate; same as Attribution |
| Image Recognition | NO — independent surface |
| **Writer fix itself** | YES, eventually — if a future migration adds `entities.tenant_id NOT NULL`, the backlog must be remediated first. The longer we wait, the larger that backlog. |

The rework test is **PASS for capabilities, FAIL for the writer fix on a long enough horizon.** No capability we've approved needs to be rebuilt if the 74 (or 174, or 274) sit unresolved during the ER writer/reader build-out. But the writer fix becomes harder to retrofit the longer we wait, because each day adds ~5–6 more rows that the backfill must handle.

---

## Most important question — A vs B

### Option A — Critical foundation issue; address before continuing ER work
**Rejected** on the basis of the rework test plus the protection analysis:
- ER's specific capability is fully protected by the substrate trigger.
- The 74 are operationally inert (no monitoring, no incidents, no POIs, no relationships) — they cannot cause active operational harm today.
- The cross-tenant exposure surface is 1/74 entities (1.4%), and that exposure is via `entity_mentions` reachable only through joins not used by ER.
- Blocking ER on this is paying capacity to fix a contained data-hygiene issue while the actual capability rebuild risk is zero.

### Option B — Contained data-quality issue; track under INC-XTEN sibling sweep; ER proceeds
**Recommended**, with a small caveat:

- ER substrate is protective for ER.
- The 74 are inert today; the trigger contains the risk to ER.
- Track the writer fix under **task #19** (INC-XTEN sibling sweep) as a parallel non-blocking remediation. The writer fix is small and focused (2 files: `process-intelligence-document` and `extract-predicted-events`, plus a smoke test) and shouldn't compete with ER for capacity.
- **Caveat:** the writer continues to emit. The accumulation rate is low (~5–6/day) and the operational risk is contained, but the longer this runs the more expensive the eventual `tenant_id NOT NULL` migration becomes. Recommend scheduling the writer fix in the next available capacity window (after ER writer slice or interleaved), not deferring indefinitely.

### One-line recommendation

**Option B.** ER work proceeds. The 74 ownerless entities are a contained data-quality issue protected by the ER trigger; they do not change ER priorities. The writer fix is scheduled into the INC-XTEN sibling sweep stream (task #19) with non-urgent priority but a soft commitment to ship before the writer/reader slice ratifies — at which point a `tenant_id NOT NULL` migration becomes naturally available.

This discovery is informative — not blocking.
