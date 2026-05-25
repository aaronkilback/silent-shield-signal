# DGIC Admission Controller — Architecture (canonical)

**Status:** ARCHITECTURE for review. No mutations. No implementation.
**Supersedes/unifies:** the per-slice designs (synthetic, asserted-classification). Those remain the detailed rationale; this is the consolidated controller.
**Principle:** DGIC is the canonical admission controller. Every operator-visible signal enters through `admitSignal(candidate, classification)`. `ingest-signal` is the *external-crawled* caller; it is not special.

---

## 1. Classification model (trust model vs mechanics, kept separate)

```
mode            = external | asserted | synthetic        // TRUST MODEL — how much we vouch & how we grade
  external.acquisition = crawled | supplied              // MECHANICS — how the content arrived (NOT trust)
  asserted.subtype     = document                        // (extensible)
investigation_lifecycle                                   // NOT a signal admission mode — workflow record
```

- **mode** answers *"what is the trust model and grading profile?"*
- **acquisition** (external only) answers *"how did it arrive — crawled by us, or supplied by a human?"* — a delivery mechanic, **not** a trust statement. Supplied external content is **still graded with full external rigor** (see §4).
- `investigation_lifecycle` does **not** call `admitSignal`; it records to an investigation timeline (§5.4).

```ts
type Classification =
  | { mode: 'external'; acquisition: 'crawled' | 'supplied' }
  | { mode: 'asserted'; subtype: 'document' }
  | { mode: 'synthetic' };
```

---

## 2. The controller pipeline (single path, profile-dispatched)

```ts
async function admitSignal(candidate, cls: Classification, ctx): Promise<AdmissionResult> {
  const p   = profileFor(cls);                 // selects: pre-gates, dedup, DGIC finding-set, label, provenance schema
  const pre = p.preGates(candidate);           // cheap mode-specific structural checks (inform findings; P1 still admits)
  const dup = await p.dedup(candidate, ctx);   // mode-specific (reject-return-existing OR synthetic update-existing)
  if (dup.hit) return p.onDuplicate(dup, candidate);
  const dgic = evaluateDGIC(candidate, cfg, cls);   // SHARED evaluator, profile = cls (§6)
  const row  = stamp(candidate, dgic, cls);         // dgic.{mode,acquisition,subtype} + provenance + status
  const ins  = await insert(row);                   // single atomic insert — verdict rides it
  recordLatencyTelemetry(dgic, cls);                // function_telemetry context
  return { admitted: true, signal_id: ins.id, dgic_status: dgic.status, findings: dgic.findings };
}
```
Pure-sync DGIC; no AI inline; audit-only in P1 (admits regardless of verdict; no `quality_status` change).

---

## 3. Master profile matrix

| Profile | Provenance anchor | source_url | publication_ts | Dedup | UI label |
|---|---|---|---|---|---|
| external/crawled | `source_url` (canonical) + publisher(host) + retrieval_path | **required** | required (publisher) | url(30d)+title(24h)+near-dup | publisher name |
| external/**supplied** | **`source_artifact_id`** + **publisher identity** + retrieval_path + **`supplied_by`/`supplied_at`** | **waived** (no crawl URL) | **required** (published content) | `source_artifact_id`+`extraction_anchor` (reject-dup) **+ near-dup vs corpus** | "Supplied intelligence — Report-derived (\<provider\>)" + artifact link |
| asserted/document | `document_artifact_id`/`content_hash` + **`asserted_by`** (mandatory) + asserted_at | waived | **not evaluated** (human-authored) | `content_hash` (reject-dup) | "Document-derived" + doc link + uploader |
| synthetic | `contributing_signal_ids` (non-empty) + `generator_id` | not evaluated | not evaluated | (pattern_type,entity_id,24h) **update-existing** | "Pattern Intelligence / synthetic" |
| investigation_lifecycle | — (not a signal) | — | — | investigation_id+entity | (not in feed) |

---

## 4. Per-mode detail

### 4.1 external / crawled — `ingest-signal` (today, unchanged)
Classic external: F-034 source gates, AI relevance gate, url/title/near-dup, publication required. This is the v0.2 evaluator profile as-is. `acquisition='crawled'` (default).

### 4.2 external / supplied — `parse-travel-security-report`
**Full external rigor preserved (constraint):** publication_ts **required**, publisher/source identity **required**, source artifact id **required**, extraction anchor **required**, staleness applies, AI relevance gate applies, near-dup vs the existing corpus applies (a supplied incident already crawled elsewhere should dedup). **Only relaxation:** `source_url` waived (uploaded PDF/report has no crawl URL) → replaced by `source_artifact_id` (the stored report record, which already exists) + publisher identity.
- **Supplied-provenance overlay (added on top of external):** `supplied_by` (uploader — already captured on the report record, currently dropped by the signal), `supplied_at`, `acquisition='supplied'`.
- Structural set: `SOURCE_ARTIFACT_MISSING`, `PUBLISHER_MISSING`, `EXTRACTION_ANCHOR_MISSING`, `SUPPLIED_BY_MISSING`, `ENTITY_LINKAGE_NONE`, `PUBLICATION_AFTER_DETECTION`. Doctrine: `PUBLICATION_TS_ABSENT` (**required** — published), `EVENT_TS_ABSENT`, `STALE_EVENT`, crit/high reasoning+conf-expl. `SOURCE_URL_*` not evaluated.
- Dedup: `source_report_id + extraction_anchor` (per-incident; reject-dup) + near-dup vs corpus. Fixes today's missing per-incident dedup; re-issued report (new valid_date) = new artifact version = new signals.

### 4.3 asserted / document — `parse-document`
Trust model = human vouches for the supplied artifact; the artifact *is* the content.
- Provenance: `document_artifact_id` (content_hash interim; doc record fast-follow) + **`asserted_by` (MANDATORY)** + asserted_at.
- **Uploader identity is mandatory (locked):** if the upload entrypoint cannot supply the authenticated uploader id, **this path is structurally invalid until fixed** (`ASSERTED_BY_MISSING` → never decision-grade). Build prerequisite, not a runtime warning.
- Structural: `SOURCE_ARTIFACT_MISSING`, `ASSERTED_BY_MISSING`, `ENTITY_LINKAGE_NONE`. `SOURCE_URL_*` + `PUBLICATION_TS_ABSENT` not evaluated.
- Dedup: `content_hash` reject-dup (already present).
- Distinct from external/supplied: no publisher, no publication requirement, no per-item extraction (whole doc = the claim) — which is exactly why it's its own *mode*, not an acquisition of external.

### 4.4 synthetic — `detect-threat-patterns`
Per the finalized synthetic design (see `synthetic-admission-detect-threat-patterns.md`): contributing_signal_ids anchor, `connection_type='pattern_correlation'`, update-existing dedup, publisher/source-url not evaluated, "Pattern Intelligence" label.

### 4.5 investigation_lifecycle — `vip-deep-scan` (removed from signals)
**Not a signal admission mode (locked).** The "scan initiated" event moves to an **investigation-lifecycle / audit-history record** (investigation timeline), **off the operator signal feed**. `vip-deep-scan` stops writing to `signals` entirely — bypass removed by **removing the signal write**, not routing it. Real investigation findings flow through their own modes (external/crawled scans, synthetic correlations).

---

## 5. `evaluateDGIC` parameterization
`evaluateDGIC(input, cfg, cls: Classification)` — the only behavioral change vs v0.2 is **which finding set runs**, selected by `cls`:
- `external/crawled` → v0.2 external profile (unchanged).
- `external/supplied` → external profile **minus** `SOURCE_URL_*` **plus** `SOURCE_ARTIFACT_MISSING`/`SUPPLIED_BY_MISSING`/`EXTRACTION_ANCHOR_MISSING`; publication still required.
- `asserted/document` → artifact+asserted_by+linkage; no url, no publication.
- `synthetic` → contributing-signals profile.
Stays pure/sync. Publisher-class (publication requirement) = `external` (both acquisitions); excluded for `asserted` + `synthetic`.

---

## 6. Stamping & schema impact (P0 extension)
On the signal (extends the P0 `dgic` jsonb — no new hot columns):
- `dgic.mode`, `dgic.acquisition` (external), `dgic.subtype` (asserted).
- Provenance block in `dgic.provenance`: `{ source_artifact_id?, supplied_by?, asserted_by?, publisher?, extraction_anchor?, generator_id?, contributing_signal_ids? }`.
- `connection_type` column already covers `pattern_correlation`; add `analyst_asserted` allowed value for asserted/document where no content connection derivable.
- Existing columns reused: `publication_ts`, `event_date`, `relevance_score`, `confidence`, disposition fields.
- UI label is derived from `dgic.mode`+`dgic.acquisition`+`dgic.subtype` (structured), never title strings.

---

## 7. Writer → classification mapping (the canonical-controller fix)

| Writer | Classification | Refactor |
|---|---|---|
| all `monitor-*` via `ingest-signal` | external / crawled | none (becomes the explicit external-crawled caller) |
| `parse-travel-security-report` | external / **supplied** | propagate stored `report_id`+`uploaded_by`→`supplied_by`; per-incident `extraction_anchor`+dedup; → `admitSignal` |
| `parse-document` | asserted / document | **capture authenticated uploader (`asserted_by`) — prerequisite**; content_hash artifact id; → `admitSignal` |
| `detect-threat-patterns` | synthetic | per synthetic slice; → `admitSignal` |
| `vip-deep-scan` | investigation_lifecycle | **stop writing `signals`**; write investigation-lifecycle/audit record instead |
| remaining bypass externals (`monitor-weather`, `visibility-gap-scanner`, `monitor-macro-indicators`, `monitor-wildfire-comprehensive`) | external / crawled | route through `ingest-signal`/`admitSignal` (next slice) |

After this, **no function writes `signals` directly except via `admitSignal`** → bypass canary green → Phase C DB trigger can enforce it.

---

## 8. Locked decisions reflected
1. Taxonomy: `external{acquisition: crawled|supplied}` + `asserted{document}` + `synthetic` + `investigation_lifecycle` (non-signal). ✓
2. `acquisition='supplied'` (mechanics) ≠ `asserted` (trust). ✓
3. `vip-deep-scan` removed from signals → investigation timeline/audit. ✓
4. asserted/document **requires authenticated uploader**; entrypoint that can't supply it is structurally invalid until fixed. ✓
5. **External-supplied preserves full external rigor** (artifact id + publication_ts + publisher identity + extraction anchor); only `source_url` is waived. ✓

---

## 9. Open items (not designed here)
- **External-supplied near-dup vs corpus:** confirm supplied incidents are dedup-checked against existing crawled signals (recommended — avoids double-reporting the same incident from a report + a news crawl).
- **Document artifact record** (vs content_hash) timing — fast-follow.
- **Investigation-lifecycle record** target (existing `investigations`/timeline table vs new) — design in the investigation_lifecycle slice.
- **Sequencing** of the controller extraction (Phase B) vs the per-writer routing — recommend: extract `admitSignal` + profiles first (with external/crawled = current ingest-signal behavior, behavior-preserving), then route writers one mode at a time, then Phase C trigger.
