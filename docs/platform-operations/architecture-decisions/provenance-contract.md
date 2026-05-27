# ADR — Platform-Wide Fail-Closed Provenance Contract

**Status:** **RATIFIED as platform doctrine 2026-05-26.** (Design accepted; implementation is separately gated and not yet performed — see the sequencing plan.) Track B Step 2.

## Locked doctrine (binding)
1. **Bare ownerless artifacts are forbidden.** Every asset must be client-owned, tenant-owned, user-owned, `global_shared`, `system`, or parent-owned through a **non-null owned parent**.
2. **Service-role writers are not trusted by default.** Because service-role bypasses RLS, the **non-bypassable backstop is DB CHECK constraints** + mandatory provenance assertion at the **shared write seam**.
3. **RLS is defense-in-depth, not the primary enforcement** for service-role writers.
4. **NULL fallback is prohibited.** No `client_id || null`. No `unassigned/` storage-path fallback. No silent downgrade to ownerless.
5. **Unknown provenance fails closed or quarantines.** It must **never** create an operator-visible asset.

(Original design follows.)
**Incident:** INC-XTEN, reframed as a **platform-wide provenance-integrity incident** (null-owned rows grew 19/6→21/7 *during* containment → active contamination from multiple writers, not one).
**Core principle:** **No artifact may exist without unambiguous ownership provenance.** A bare `NULL` owner is forbidden; the only "ownerless" artifacts allowed are those *explicitly marked* `global_shared` or `system`. Enforcement is **fail-closed** and — because most writers are service-role (RLS-bypassing) — must be anchored at the **DB layer**, not just app code or RLS.

---

## 0. Grounding evidence (live schema, authoritative)
Ownership-column reality across asset tables (✓=present; nullability noted):

| Table | tenant_id | client_id | user_id | parent FK | null-owned now |
|---|---|---|---|---|---|
| signals | ✓ null | ✓ null | — | source_id | **21** / 1391 |
| incidents | ✓ null | ✓ null | — | — | **7** / 110 |
| entities | ✓ null | ✓ null | — | — | 0 / 2927 |
| archival_documents | ✗ | ✓ null | — | — | **33** / 355 (Track A) |
| investigations | ✗ | ✓ null | — | — | 0 / 7 |
| itineraries | ✗ | ✓ null | — | — | 0 |
| reports | ✓ null | ✓ null | — | — | census needed |
| poi_reports | ✗ | ✗ | — | entity_id | census needed |
| poi_investigations | ✓ null | ✓ null | — | entity_id | — |
| generated_reports | **✓ NOT NULL** | ✓ null | ✓ | — | 0 / 3 |
| tenant_chunks | **✓ NOT NULL** | ✗ | — | doc_id | — |
| entity_content / entity_photos | ✗ | ✗ | — | entity_id | (inherit entity) |
| ingested_documents | ✗ | ✗ | — | source_id | (inherit source) |
| expert_knowledge | ✗ | ✗ | — | source_id | global by design |
| global_chunks | ✗ | ✗ | — | doc_id | global by design |
| attachments, document_hashes, geospatial_maps, media_assets, travel_alerts, workspace_evidence, investigation_attachments, expert_profiles | ✗ | ✗ | varies | varies | **no ownership column at all** |

**Corrections to earlier triage:** `reports` *does* have `tenant_id`+`client_id` (nullable, unpopulated) — not "no columns"; `generated_reports.tenant_id` is already `NOT NULL`. Two tables (`tenant_chunks`, `generated_reports`) already enforce tenant — they are the in-repo proof the model is achievable.

---

## 1. Canonical provenance model

Every artifact carries a **provenance descriptor** resolved at creation:
```
{ owner_kind: 'client' | 'tenant' | 'user' | 'global_shared' | 'system',
  tenant_id, client_id, user_id, asset_class }
```
Add a single discriminator column **`asset_class`** to every asset table (text, NOT NULL, no default in the long run). Validity rule per `owner_kind`:

| owner_kind | Required fields | Meaning | Examples |
|---|---|---|---|
| **client-owned** | `client_id` NOT NULL; `tenant_id` = `clients.tenant_id` (denormalized, kept consistent) | belongs to one client | signals, incidents, archival_documents, investigations, itineraries, entities, poi_reports |
| **tenant-owned** | `tenant_id` NOT NULL (client_id NULL allowed) | tenant-wide, not client-specific | tenant_chunks, tenant-wide reports |
| **user-owned** | `user_id` NOT NULL (+ `tenant_id` for scoping) | personal artifact | generated_reports, ai_assistant_messages, bug_reports |
| **global_shared** | `asset_class='global_shared'`; tenant/client/user all NULL **but marked** | cross-tenant reference/library | expert_knowledge, global_chunks, generic threat primers/playbooks |
| **system** | `asset_class='system'` + system actor id; tenant_id optional | platform-generated, pre-attribution | synthetic intel, platform telemetry |

**Canonical anchor = `client_id`** for the dominant class; `tenant_id` is **denormalized** from `client_id` (for RLS performance + the existing `get_user_accessible_client_ids()` model) and kept consistent by a trigger or generated column. **Parent-keyed tables** (entity_content, entity_photos, investigation_attachments, media_assets) inherit ownership via a **NOT NULL parent FK** whose parent is itself owned — they need no own client column but must never be more-orphaned than their parent.

**The invariant (one sentence):** for any artifact row, `client_id IS NOT NULL OR tenant_id IS NOT NULL OR user_id IS NOT NULL OR asset_class IN ('global_shared','system') OR (parent_fk IS NOT NULL)` — and **never** all-null-unmarked.

---

## 2. Fail-closed enforcement points (defense in depth; DB layer is the backstop)

Ordered outermost→innermost; the inner layers are the ones that actually hold:

| Layer | Enforcement | Holds against |
|---|---|---|
| **Frontend** | Disable create UI without a resolved client/tenant; never send unowned create. **Advisory only — not a security boundary.** | honest users |
| **Shared controller (`createArtifact`)** | One choke-point seam all writers call: resolves + validates the provenance descriptor, rejects unmarked-null (mirrors `ingest-signal:289-310` #256). | app-path drift |
| **Edge `assertProvenance(payload, ctx)`** | Shared helper invoked before every insert; fail-closed. Co-located with the service-role client wrapper so raw `.insert()` is the exception, not the norm. | edge writers |
| **RLS `WITH CHECK`** | Tenant-scoped INSERT policies (`client_id IN get_user_accessible_client_ids()` or marked-global) on every asset table. Already on signals/incidents/archival reads — extend to INSERT + all tables. | **authenticated** (frontend PostgREST) writers |
| **DB CHECK constraint** | `CHECK (`the §1 invariant`)` on every asset table. **The non-bypassable backstop.** | **service_role + raw SQL** (which bypass RLS) |
| **Storage path convention** | objects pathed `{tenant_id}/{client_id}/…` (or `global/…`); no `unassigned/`/root. Storage RLS `WITH CHECK` on `foldername[1]`. | storage writers |
| **CI static-grep guard** | fail build on any `.insert(` into an asset table not routed via `createArtifact`/`assertProvenance`; on any new `client_id || null`; on `unassigned/` paths. | future bypass writers |

**Key insight:** the dominant writer class is **service-role (RLS-bypassing)** — so RLS alone is insufficient. The **DB CHECK constraint is mandatory** as the one layer no writer can bypass. `assertProvenance` + `createArtifact` give clean errors early; the CHECK guarantees correctness even when they're skipped.

---

## 3. Exception model (legitimately ownerless — but MARKED, never bare-null)

An artifact may omit client/tenant **only** if it carries an explicit marker:

| Exception | Marker | Access model |
|---|---|---|
| **Global/shared knowledge** | `asset_class='global_shared'` | expert_knowledge, global_chunks, vendor threat primers/playbooks, cookbooks. Readable cross-tenant by a deliberate shared-knowledge RLS (all authenticated, or a knowledge-entitlement table) — **not** the open `auth.uid() IS NOT NULL` anti-pattern. |
| **Synthetic / system intelligence** | `asset_class='system'` + system actor | platform-generated pre-attribution intel; either a `system` tenant or marked global. Promotable to client-owned once correlated. |
| **User-owned personal** | `user_id` NOT NULL, `asset_class='user'` | AI chat, drafts, bug telemetry — owner is the user; no client required. |
| **Parent-derived** | NOT NULL parent FK | entity_content/photos, investigation_attachments, media_assets — owned via parent; parent must be owned. |

**Rule:** the absence of client_id is only legitimate when accompanied by a marker (`asset_class`) or a non-null owned parent. A row that is client-NULL **and** tenant-NULL **and** user-NULL **and** unmarked is a contract violation — rejected. This is exactly what was missing (the 355 archival + 21 signals + 7 incidents were bare-null, unmarked).

---

## 4. Migration path (existing null-owned rows — no grandfathering)

Disposition decision order per row: **attribute → quarantine → purge** (grandfather **rejected** — it perpetuates contamination).

| Table | null-owned | Disposition |
|---|---|---|
| archival_documents | 33 | Track A handled: 31 `quarantine_review` (operator adjudication; ~5 → candidate `global_shared`), 2 `deletion_candidate` (purge). |
| signals | 21 | Attribute where source/content resolves to a client; else `quarantine` (already invisible to tenants via RLS); purge confirmed junk. |
| incidents | 7 | Same as signals. |
| reports | census | Backfill `client_id`/`tenant_id` from `meta_json` (some carry client_id there); else quarantine. Then populate + tighten. |
| poi_reports | census | Derive client/tenant from `entity_id → entities.client_id/tenant_id`; quarantine if entity unowned. |
| entities, investigations, itineraries, generated_reports | 0 | clean — proceed straight to constraint. |

**Sequenced migration (each gated, reversible, operator-confirmed where ambiguous):**
1. Add `asset_class` + missing ownership columns (`tenant_id` on archival_documents/investigations/itineraries; `tenant_id`+`client_id` on poi_reports) — additive, nullable, safe.
2. Backfill/attribute existing rows (Track-A pattern, per table).
3. Quarantine the un-attributable (status flag; already RLS-invisible to tenants).
4. Purge confirmed test/junk.
5. **Only then** add the fail-closed CHECK + RLS `WITH CHECK` + tighten to NOT NULL (applying before backfill would break legitimate writers).
6. Update writers to `assertProvenance`/`createArtifact`; turn on the CI grep guard.

**Ordering is load-bearing:** constraints last. Enforce-before-backfill would convert silent contamination into hard write failures across the app.

---

## 5. Bypass analysis (who can evade the contract, and structural elimination)

| Bypass vector | Examples | Structural elimination |
|---|---|---|
| **Service-role writers** (RLS bypassed) | create-archival-record, process-archival-documents, ingest-email-intel, monitors, report generators (≥14) | **DB CHECK constraint** (non-bypassable) + mandatory `assertProvenance` in the service-role client wrapper; raw `.insert()` on asset tables flagged by CI grep. |
| **`--no-verify-jwt` external fns** | ingest-email-intel, create-archival-record | writer is the sole gate → `assertProvenance` + CHECK; resolve sender→client or **reject** (no NULL fallback; replace the 2-entry `SENDER_CLIENT_MAP` with a real registry + reject-unknown). |
| **Frontend direct PostgREST** | CreateEntityDialog, CreateItinerary, etc. | RLS `WITH CHECK` tenant-scoped INSERT policy rejects unmarked-null. |
| **Raw SQL / future writers** | any | CHECK constraint catches unconditionally. |
| **New code paths** | future | CI static-grep guard: no `.insert()` into asset tables outside `createArtifact`; no `client_id || null`; no `unassigned/` paths. |

**Conclusion:** structural elimination requires the **CHECK constraint (DB)** as the floor + a **single `createArtifact` seam** as the ceiling. RLS and frontend are intermediate layers, not the guarantee.

---

## 6. Folding in the two newly-found defects (contract demonstrates their fix)

- **`create_signal` `source` non-column** (signals has no `source` column; create_signal sets `source:` → always errors): under the contract, all artifact inserts go through `createArtifact` with a **validated column set**, so a phantom column can't be written. Immediate fix: drop/remap the `source` field (→ `source_id` FK or `raw_json.source_label`). Illustrates why per-call-site `.insert()` literals drift; a shared writer prevents it.
- **`suggest_entity` dead guard** (keyed on nonexistent `ai_agents.tenant_id` → always refuses): under the canonical model, agent-originated artifacts derive provenance from the **`client_id`** in the request → `clients.tenant_id` (the C3 model already deployed for create_*), **not** a nonexistent `agent.tenant_id`. Fix: re-key `suggest_entity` to the client-derived resolver (and decide whether `ai_agents` should carry an explicit tenant binding for global vs tenant agents). Illustrates why provenance resolution must be **one shared resolver**, not per-handler ad-hoc fields.

Both defects are symptoms of the same root: **no canonical provenance resolver + no validated write seam.** The contract eliminates the class.

---

## 7. What this ADR commits to (on ratification — separate, gated)
1. `asset_class` + ownership columns on all asset tables (additive).
2. `assertProvenance()` + `createArtifact()` shared seam; refactor writers to use them.
3. DB CHECK constraints (the §1 invariant) per asset table — **after** backfill.
4. RLS `WITH CHECK` tenant-scoped INSERT on all asset tables.
5. Storage `{tenant}/{client}/…` path convention + storage RLS write `WITH CHECK`.
6. CI static-grep guard (audit-only first, then blocking — per the audit-before-blocking doctrine).
7. Migration of existing null rows (attribute/quarantine/purge; no grandfather).
8. Fix the two defects as part of the writer refactor.

**No implementation in this document.** Ratification + each migration step is separately authorized. INC-XTEN closes only when the contract is enforced (CHECK live) + watchdog + CI regression + sibling sweep + runbook all exist.
