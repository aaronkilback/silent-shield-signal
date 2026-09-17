# Asserted Writers — Classification (decision before architecture)

**Status:** CLASSIFICATION for review. No mutations. No implementation.
**Hypothesis under test:** "asserted" may be a *family* of admission modes, not one. The three writers are classified along 7 dimensions; the test is whether their differences are **parametric** (same mode, different config) or **structural** (genuinely different admission logic).

---

## Classification cards

### 1. Document-derived — `parse-document`
| Dimension | Finding |
|---|---|
| Provenance anchor | The **uploaded document IS the content**. Anchor = document artifact (`content_hash`/doc record id) + **uploader** (`asserted_by`). |
| Structural required | artifact_id, asserted_by, client linkage, title. |
| DGIC differences | No `source_url`; **`publication_ts` absent** (analyst-supplied/arbitrary doc, not published); one artifact → (usually) one signal; title-match deferred. |
| Dedup | `content_hash` → reject-as-duplicate (artifact is static). |
| Operator-visible req | artifact + uploader + linkage; content is **human-vouched**. |
| UI label | "Document-derived" + link to doc. |
| Belongs in a shared asserted mode? | **Yes — this is the prototypical "asserted."** A human supplies an artifact; the artifact is the claim; provenance = artifact + actor. |

### 2. Investigation-derived — `vip-deep-scan`
| Dimension | Finding |
|---|---|
| Provenance anchor | An **investigation/scan request** (`investigation_id`) + requesting analyst + the entity. **But the row is a "scan initiated" STATUS event — it carries no finding.** |
| Structural required | If it were intel: a finding. It has none. |
| DGIC differences | No content/finding → fails entity-relevance + reasoning on substance; "reasoning" = "a scan was started." |
| Dedup | `investigation_id` + entity (one initiation per investigation). |
| Operator-visible req | Questionable — should an operator see "scan queued"? That's lifecycle, not intelligence. |
| UI label | "Analyst-asserted (intake)" / workflow. |
| Belongs in a shared asserted mode? | **No — misfit.** There is no asserted *claim* here. An investigation is a **container that PRODUCES intelligence elsewhere** (via `monitor-travel-risks`, property scans, correlations) — it doesn't assert a piece of intel the way an upload does. |

### 3. Report-derived — `parse-travel-security-report`
| Dimension | Finding |
|---|---|
| Provenance anchor | A **third-party PUBLISHED report** (`source_report_id`, stored) + uploader + the specific **incident/passage**. The true origin is the **provider**, with its own publication date + authority. |
| Structural required | report_id, asserted_by, **extraction_ref (per incident)**, **publication_ts (required — it's published)**, provider. |
| DGIC differences | **Unlike document/asserted, `publication_ts` IS required**; multi-item (N incidents → N signals); provider = source authority; staleness applies. No crawlable `source_url`, but a publisher + date exist. |
| Dedup | `report_id` + incident_ref (per item). |
| Operator-visible req | report_id + uploader + incident ref + publication + provider. |
| UI label | "Report-derived (third-party: <provider>)". |
| Belongs in a shared asserted mode? | **Partially — it's a HYBRID.** Provenance is asserted (uploader), but the **content is external published intelligence** that merely *arrived by upload instead of crawl*. Its grading rules (publication, provider, multi-item, staleness) are **external's**, not document-asserted's. |

---

## Cross-analysis — parametric vs structural divergence
The three differ **structurally**, not just parametrically:
- **Cardinality:** document = 1 artifact→1 signal; report = 1 artifact→N signals (extraction_ref mandatory); investigation = 0 findings (status only).
- **Publication semantics:** document = none; report = **required** (published); investigation = n/a.
- **Content origin:** document = human-supplied (vouched); report = **third-party published** (external content); investigation = none (process state).
- **What grades it:** document by human vouch + artifact integrity; report by **external content rules** + delivery provenance; investigation by… nothing (it's not a finding).

Forcing all three into one "asserted" mode would **mis-model report-derived** (lose publication/provider/staleness rigor by treating published content like an internal memo) and **mis-classify investigation-derived** (treat a workflow event as intelligence).

---

## CLASSIFICATION DECISION

**Not a single asserted mode. The "asserted family" is heterogeneous, and only one of the three is truly asserted:**

| Writer | Correct classification | Rationale |
|---|---|---|
| `parse-document` | **`asserted` mode (document)** — the true asserted mode | Human supplies the artifact; artifact = the claim; provenance = artifact + actor; no publication. |
| `parse-travel-security-report` | **`external` mode, `delivery='asserted'` variant** — NOT a new asserted mode | Third-party *published* content; needs external content rules (publication_ts, provider, multi-item, staleness). Only the *delivery* (upload) and missing crawl-URL differ → handle as external + asserted-delivery provenance overlay, not a separate asserted subclass (avoids duplicating external's grading logic). |
| `vip-deep-scan` | **Not an admission mode — workflow/investigation-lifecycle event** | No asserted claim; a container that produces intel elsewhere. Reclassify off the intelligence feed; its findings admit via their own (external/synthetic) modes. |

**Net mode taxonomy after this slice:**
```
external   { delivery: crawled | asserted }     ← reports = external + delivery:asserted
asserted   (document)                            ← human-supplied artifact as content
synthetic                                        ← derived (detect-threat-patterns)
[investigation lifecycle]  = NOT a signal admission mode (workflow record)
```

---

## Implied admission architecture (only the parts this decision settles)

- **`asserted` mode** is scoped to **document-derived** only. Provenance triple `{document_artifact_id|content_hash, asserted_by, asserted_at}`; structural: artifact_id + asserted_by + linkage; `SOURCE_URL_*` + `PUBLICATION_TS_ABSENT` not evaluated; dedup = content_hash reject-dup; UI = "Document-derived". (This is the only writer that needs a genuinely new mode.)
- **`external` mode gains a `delivery` dimension** (`crawled` default | `asserted`). `parse-travel-security-report` becomes `external` + `delivery:asserted`: keeps external content grading (publication_ts **required**, provider as platform, per-incident extraction_ref + dedup, staleness), **adds** asserted-delivery provenance (`source_report_id`, `asserted_by`) and **waives** `source_url` (no crawl URL). This propagates the already-stored `report_id`/`uploaded_by` the signal currently drops, and adds the missing per-incident dedup. UI = "Report-derived (third-party: provider)".
- **`vip-deep-scan`** stops writing to `signals`. The "scan initiated" event moves to an investigation-lifecycle/workflow record (off the operator intelligence feed). Removes the bypass by **removing the signal write**, not by routing it. Real investigation findings already flow through their own writers/modes.

This means **only `parse-document` requires the new `asserted` mode**; `report` folds into `external`, and `vip-deep-scan` leaves signal admission entirely.

---

## Open decisions (before finalizing the architecture)
1. **Confirm the taxonomy:** `external{crawled|asserted-delivery}` + `asserted(document)` + `synthetic`, with investigation-lifecycle as a non-signal workflow concept — agree, or do you want `report` kept as its own `asserted-report` subclass for surfacing clarity even at the cost of duplicated grading logic?
2. **`vip-deep-scan` reclassification:** approve removing it from `signals` (→ investigation-lifecycle record), vs keeping a labelled low-grade "intake" signal?
3. **`delivery` as a stamped dimension** on external signals (`dgic.delivery='asserted'`) to drive the "Report-derived / hand-delivered" UI label and provenance link — agree?
4. **parse-document `asserted_by`:** still the open data question — can the upload entrypoint supply the authenticated uploader id? (Gates whether `ASSERTED_BY_MISSING` is satisfiable for the one true asserted mode.)
