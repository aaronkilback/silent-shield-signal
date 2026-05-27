# INC-CRT-DOCUMENT-SCOPE — tenant documents not retrievable / mis-scoped (2026-05-27)

**Class:** customer-visible trust defect (tenant uploads a document, then Aegis says it can't find it). Formalized as its own incident per operator decision — remediation overlaps INC-XTEN Phase 3 but the customer-facing defect deserves explicit ownership + closure criteria.

**Status:** OPEN. Remediation executes within INC-XTEN Phase 3 (archival/storage), but closure is tracked here independently.

## Defect
- `archival_documents` has **no `tenant_id` column**; reads scope by `client_id IN scopedClientIds` (`dashboard-ai-assistant:1605/1686`).
- Tenant uploads frequently land with **null `client_id`** → invisible to the owning tenant; `search_archival_documents`/`get_document_content` return a **silent `[]`**, so Aegis reports "not found" for a document the customer just uploaded. (= INC-AEGIS-TRUST Vince #3.)
- Null-owned documents are simultaneously at risk of being **globally readable via permissive RLS** (the INC-DOC-002 class) — a disclosure risk on the same rows that are invisible to their rightful owner.

## Root cause
Documents were never bound to a provenance owner at write time (no `tenant_id`, nullable `client_id`, no `assertProvenance` at the upload seam), and the read path scopes by the wrong/partial column. This is the document instance of the broader Provenance Doctrine + Cross-Tenant Retrieval Exclusivity gaps.

## Explicit closure criteria (ALL required)
1. **Ownership column** — `archival_documents.tenant_id` exists, NOT NULL, enforced by CHECK (Provenance Doctrine invariant; service-role-proof). `client_id` retained where applicable but never the sole owner.
2. **Write binds provenance** — the upload/ingest path sets `tenant_id` (+ `client_id` where relevant) via the shared write seam; **no NULL fallback**; unknown provenance fails closed / quarantines.
3. **Existing rows resolved** — every current null-owned `archival_documents` row is either operator-attributed to its true tenant (audited) or quarantined; none remain bare-ownerless.
4. **Read scopes by tenant** — tenant-facing retrieval scopes by `tenant_id` via `tenantRetrieve()`; cross-tenant document access is Aegis-Ops-only (Retrieval Exclusivity amendment).
5. **Honest empty vs hidden** — Aegis distinguishes "you have no such document" from "hidden by scope"; it never returns a silent `[]` that reads as a false "not found" for the tenant's own document.
6. **No global-readable null-namespace docs** — RLS + CHECK close the INC-DOC-002 disclosure path; a null/foreign-owned doc is never analyst-visible cross-tenant.
7. **Validation (must pass, staging→prod):** (a) upload a doc as tenant CRT → Aegis retrieves + summarizes it; (b) cross-tenant probe for that doc → not visible, indistinguishable from not-found; (c) a legacy null-owned doc → not analyst-visible until attributed; (d) re-run a doc-title NER scan → no tenant doc titles leaked into shared/global stores (ties to INC-LEARN-CONTAM).

## Relationship
- Executes inside **INC-XTEN Phase 3** (archival/storage high-risk runbook) — shares the migration + backfill machinery.
- Disclosure side aligns with **INC-DOC-002 / INC-ART cluster** (null-namespace doc readability, storage ownership).
- Closure here is independent: INC-XTEN Phase 3 may have broader scope; this incident closes when criteria 1–7 pass for documents specifically.

**Evidence-based. No mutations. Remediation gated under INC-XTEN Phase 3 (roadmap phase L).**
