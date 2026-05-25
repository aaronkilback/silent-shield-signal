# Asserted Admission Architecture — Phase A, slice 2

**Status:** DESIGN for review. No mutations. No implementation.
**Scope:** `parse-document`, `parse-travel-security-report`, `vip-deep-scan`. Defines the **asserted admission mode** of the shared controller (alongside external + synthetic).
**Core principle:** asserted intelligence enters because a *human action* (upload / submit / request) vouches for it. Its provenance anchor is therefore the **submitted artifact + the actor + where in the artifact it came from** — not a web URL.

---

## 1. Grounded current state (the provenance loss to fix)
| Writer | Trigger | Provenance it HAS | Provenance it LOSES | Dedup today |
|---|---|---|---|---|
| `parse-document` (`:131`) | user uploads a document | `content_hash`, `filename`, `mimeType`, matched `client_id` | **no `uploaded_by`, no document-record id, no extraction ref** | `content_hash` (reject-dup ✓) |
| `parse-travel-security-report` (`:199`) | analyst uploads a third-party provider report | a **stored report record** (id + `uploaded_by` + `parsed_data` + provider + location + dates) | signal keeps only `source_provider` — **drops `report_id` + `uploaded_by` + incident ref** | **none** (re-upload floods) |
| `vip-deep-scan` (`:364`) | VIP intake wizard | `entity_id`, `investigation_id`, `client_id`, `source='vip_intake_wizard'` | extraction n/a (it's a status row) | **none** |

`vip-deep-scan`'s row is a **"scan initiated" status event**, not a finding → see Decision 9.4 (workflow vs intelligence).

## 2. Asserted artifact sub-types
Asserted mode has three sub-types; required provenance + the publisher-class question differ per sub-type:

| `asserted_artifact_type` | Writer | Artifact id | Actor | Extraction ref | Third-party published? |
|---|---|---|---|---|---|
| `document` | parse-document | `source_document_id` (stored doc record) or `content_hash` | `asserted_by` (uploader) | matched rule/keyword span | usually **no** (analyst-authored/arbitrary) → publication_ts optional |
| `report` | parse-travel-security-report | `source_report_id` (the stored report record) | `asserted_by` (uploader) | incident index / passage | **yes** (provider published it) → publication_ts **required** (incident/report date) |
| `scan` | vip-deep-scan | `source_scan_id` = `investigation_id` | `asserted_by` (requesting analyst) | n/a (whole intake) | no → publication_ts n/a |

## 3. Provenance anchor (Q1) — required triple
Asserted provenance = **`{ artifact_type, artifact_id, asserted_by, asserted_at, extraction_ref }`**, carried structurally on the signal (in the `dgic`/provenance metadata), replacing `source_url`:
- **artifact_id** — stable id of the submitted thing (document record / report record / investigation id). For documents without a stored record, `content_hash` is the interim anchor; long-term, persist a document artifact record (mirrors the report pattern, which already stores one).
- **asserted_by** — the user id who uploaded/submitted/requested. **Mandatory** — an assertion with no actor is unaccountable.
- **asserted_at** — when the human submitted it.
- **extraction_ref** — for multi-item artifacts (a report with N incidents), which item/passage this signal came from, so each item is traceable and dedup-able.

## 4. Asserted admission contract (Q2) — 13 fields × asserted mode
| Field | Asserted-mode rule |
|---|---|
| canonical_title | Required. |
| **source_url** | **May be ABSENT.** Not evaluated. Replaced by the §3 provenance triple. |
| **source_artifact_id** | **Structural-required** — the artifact anchor (doc/report/scan id, or content_hash for docs). |
| **asserted_by** | **Structural-required** — the human actor. |
| extraction_ref | **Structural-required for multi-item artifacts** (`report`); optional for whole-artifact (`document` rule-match, `scan`). |
| source_platform | Required = the asserted source (e.g., `analyst_upload`, `<provider>`, `vip_intake_wizard`). |
| retrieval_path | Required = artifact_type + ingestion route. |
| relevance_score | Required. Human assertion raises the baseline, but a score is still recorded. |
| relevance_rationale | Required (the analyst's reason / extracted summary). |
| connection_type | Content-derived where possible (`direct_naming`, `regulatory`, …); else **`analyst_asserted`** (first-class fallback — a human vouched for relevance). |
| entity_linkage | Required = `client_id` and/or `entity_id`. (`ENTITY_LINKAGE_NONE` if neither.) |
| event_ts | Required = the artifact/incident date. |
| publication_ts | **Required only for `report` sub-type** (third-party published); optional for `document`/`scan`. |
| detection_ts | = now (= asserted_at for the ingest moment). |
| chronology_coherent | event ≤ publication (if present) ≤ detection. |
| ai_reasoning | Required for crit/high (extracted from artifact or analyst note). |
| confidence + explanation | Required; explanation may cite "analyst-asserted from <artifact>". |
| disposition | Default `monitor`; `investigate`/`escalate` per content + severity. |

## 5. Asserted-mode findings taxonomy (Q4)
- **structural (asserted):** `SOURCE_ARTIFACT_MISSING`, `ASSERTED_BY_MISSING`, `ENTITY_LINKAGE_NONE`, `EXTRACTION_REF_MISSING` (report sub-type only). **SOURCE_URL_* NOT evaluated.**
- **doctrine (asserted):** `EVENT_TS_ABSENT`, `STALE_EVENT`, `PUBLICATION_TS_ABSENT` (**report sub-type only**), `CRIT_HIGH_REASONING_REQUIRED`, `CRIT_HIGH_CONFIDENCE_EXPL_REQUIRED`.
- **semantic_review (asserted):** `EXTRACTION_FIDELITY_UNVERIFIED` (does signal text faithfully represent the artifact passage? — deferred AI), `ASSERTED_RELEVANCE_QUALITY_UNVERIFIED` (did the analyst over-assert? — deferred).
- **What makes it operator-visible vs sub_grade:** decision_grade requires artifact_id + asserted_by + entity/client linkage + event_ts (+ extraction_ref for reports, + publication_ts for reports) + crit/high reasoning. **Today all three writers would be sub_grade** (they drop asserted_by / artifact_id / extraction_ref) — which is exactly the gap asserted mode forces them to close.

## 6. Dedup (Q3) — reject-as-duplicate (artifacts are static, unlike synthetic)
Asserted artifacts don't evolve in place (unlike synthetic patterns), so the model is **reject-as-duplicate → return existing signal_id** (as `parse-document` already does on `content_hash`). Per sub-type key:
| Sub-type | Dedup key |
|---|---|
| document | `content_hash` (or `source_document_id`) + `client_id` |
| report | `source_report_id` + `extraction_ref` (incident index/hash) + `entity/asset` |
| scan | `source_scan_id` (`investigation_id`) + `entity_id` + scan_phase |
A re-issued report with a new `valid_date` = a new artifact version (new `source_report_id`) ⇒ legitimately new signals.

## 7. Operator visibility + UI label (Q5)
Asserted signals display as their **artifact type**, not raw signal — driven by **structured** `dgic.mode='asserted'` + `asserted_artifact_type`, never a title-string convention:
- `document` → **"Document-derived"** badge + link to the source document.
- `report` → **"Report-derived (third-party: <provider>)"** badge + link to the report record.
- `scan` → **"Analyst-asserted (intake)"** badge + link to the investigation.
The badge + artifact deep-link (via `source_artifact_id`) make provenance one click away for the operator.

## 8. Per-writer refactor mapping (each direct insert → `admitSignal(candidate,"asserted")`)
- **parse-document:** capture `asserted_by` (the uploading user — currently missing) + persist/-reference a document artifact id; build `candidate` (artifact_type='document', content_hash, client_id, rule-match as extraction_ref) → `admitSignal`. Keep content_hash dedup.
- **parse-travel-security-report:** propagate the **already-stored** `report_id` + `uploaded_by` into each incident candidate (artifact_type='report', extraction_ref=incident index, publication_ts=incident/report date) → `admitSignal`; **adds the missing per-incident dedup**.
- **vip-deep-scan:** decide first whether the "scan initiated" row is intelligence or workflow (9.4). If kept, artifact_type='scan', source_scan_id=investigation_id, asserted_by=requesting analyst → `admitSignal`; likely lands `monitor`/sub_grade (no finding content) which is *correct*.

## 9. Open decisions (need your call before finalizing)
1. **Document artifact id:** require persisting a document artifact record (giving `source_document_id` + linking to storage), or accept `content_hash` as the interim anchor for `document` sub-type (my lean: content_hash now, artifact record as a fast-follow — mirrors how `report` already stores a record)?
2. **`asserted_by` for `parse-document`:** it currently doesn't capture the uploader. Confirm the upload entrypoint can supply the authenticated user id (so `ASSERTED_BY_MISSING` is satisfiable). If uploads can be system-triggered (no user), how do we anchor the actor?
3. **`connection_type='analyst_asserted'` as a first-class fallback** (when content connection isn't derivable) — acceptable, or must asserted intel always carry a content-derived connection_type?
4. **`vip-deep-scan` "scan initiated" — intelligence or workflow?** Recommend reclassifying it as a **workflow/audit event** (off the operator intelligence feed) rather than a signal; if it stays a signal, it should be `monitor` disposition + clearly labelled, and will read as sub_grade (no finding). Your call.
5. **Report incident extraction_ref granularity:** incident array index vs a content hash of the incident (hash is stabler across re-parses) — pick the dedup anchor.
