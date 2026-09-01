# Synthetic Admission Architecture — `detect-threat-patterns` (FINAL, decisions locked)

**Status:** FINAL design for build. No mutations. No schema apply.
**Context:** `detect-threat-patterns` is the highest-priority bypass (LIVE: 59 operator-visible signals/14d) and the canonical *synthetic/derived* writer. This defines the **synthetic admission mode** of the shared controller; `ingest-signal` becomes the *external* caller of the same controller.

---

## 1. Architectural correction
DGIC — not `ingest-signal` — is the canonical admission controller. All intelligence enters via `admitSignal(candidate, mode)`. `ingest-signal` = `mode:"external"`; `detect-threat-patterns` = `mode:"synthetic"`.

## 2. The synthetic class
Four insert sites (`detect-threat-patterns/index.ts:151/221/285/348`) emit `[PATTERN]` signals derived from existing signals (`raw_json.contributing_signal_ids[]`, `entity_id`, `pattern_type`, `pattern_window_hours`, `severity_score`). No external `source_url`, no `publication_ts`; native linkage + reasoning.

## 3. Synthetic admission contract (locked)
| Field | Synthetic-mode rule |
|---|---|
| canonical_title | Required. Title-↔-source match waived; replaced by deterministic check: title references `entity_name` + `pattern_type`. |
| **source_url** | **`null` ACCEPTED iff (decision #1): `admission_mode='synthetic'` AND `contributing_signal_ids` non-empty AND provenance is carried by those contributing signals.** Long-term: add an internal deep-link to the pattern/insight record — **not a P1 blocker.** |
| source_platform | Required = `fortress_pattern_engine`. |
| retrieval_path | Required = `pattern_type` + `pattern_window_hours` + generator version. |
| **contributing_signal_ids** | **Structural-required (synthetic): non-empty.** This is the synthetic source-integrity anchor that replaces `source_url`. |
| relevance_score | Required; derived from `contributing_count` + `severity_score`. |
| relevance_rationale | Required = pattern description. |
| connection_type | **= `pattern_correlation` (first-class type — decision #2). NOT inherited from contributing signals.** |
| entity_linkage | Required = `entity_id` + contributing ids. |
| event_ts | Required = pattern window end (or latest contributing event). |
| publication_ts | Legitimately ABSENT — synthetic excluded from publisher-class ⇒ no `PUBLICATION_TS_ABSENT`. |
| detection_ts | = now. |
| chronology_coherent | window_end ≤ detection; no publication leg. |
| ai_reasoning | Required = pattern rationale (present by construction). |
| confidence + explanation | Required = pattern confidence + "N signals over W hours". |
| disposition | `investigate` default; `escalate` if `severity='critical'`. |

## 4. Synthetic-mode findings (taxonomy profile)
- **structural (synthetic):** `CONTRIBUTING_SIGNALS_EMPTY` (new), `PROVENANCE_MISSING` (no generator/retrieval_path), `ENTITY_LINKAGE_NONE` (no entity_id). **SOURCE_URL_* are NOT evaluated** (decision #1).
- **doctrine (synthetic):** `EVENT_TS_ABSENT`, `STALE_EVENT`, `CRIT_HIGH_REASONING_REQUIRED`, `CRIT_HIGH_CONFIDENCE_EXPL_REQUIRED`. **`PUBLICATION_TS_ABSENT` NOT applied.**
- **semantic_review (synthetic):** `CONTRIBUTING_SIGNALS_INTEGRITY_UNVERIFIED` (decision #4: P1 keeps "are contributing signals themselves decision-grade?" as deferred review — **not enforced**), `REASONING_ADEQUACY_UNVERIFIED`.
- **Deferred hard rule (later phase, decision #4):** synthetic intel must require **≥1 decision-grade contributing signal** before it is operator-visible. Recorded as intent now; not enforced in P1.

A well-formed pattern (non-empty evidence + entity + rationale) ⇒ **decision_grade** under synthetic mode.

## 5. Synthetic dedup — update-existing (decision #3)
- **Dedup key:** `pattern_type + entity_id + 24h rolling window`.
- On each run, for each candidate: find an existing synthetic signal with the same `(pattern_type, entity_id)` whose `updated_at` (or `created_at`) is within the last **24h**.
  - **Found ⇒ UPDATE that record** (no new feed item): union new `contributing_signal_ids`, refresh `contributing_count`, bump `severity_score` if escalated, **extend the timeline** (advance `event_ts`/window-end, set `updated_at=now`). The window *rolls forward* as the pattern persists.
  - **Not found / last update >24h ago ⇒ admit a NEW synthetic signal** (a fresh recurrence after a quiet gap).
- Effect: a persisting pattern is **one evolving feed item**, not daily duplicates.

## 6. Shared controller interface
```ts
type AdmissionMode = "external" | "asserted" | "synthetic";
async function admitSignal(candidate, mode: AdmissionMode, ctx): Promise<AdmissionResult> {
  const pre = preGatesFor(mode)(candidate, ctx);     // synthetic: contributing-signals non-empty + provenance
  const dup = await dedupFor(mode)(candidate, ctx);  // synthetic: (pattern_type,entity_id,24h) -> update-existing
  if (dup.isDuplicate) return await dup.updateExisting(candidate); // merge ids, extend timeline, bump score
  const dgic = evaluateDGIC(candidate, cfg, mode);   // SHARED evaluator, mode profile (§4)
  const row  = stamp(candidate, dgic, mode);         // dgic_status, dgic.findings, dgic.mode=mode
  const ins  = await insert(row);                    // single atomic insert (verdict rides it)
  recordLatencyTelemetry(dgic, mode);
  return { admitted: true, signal_id: ins.id, dgic_status: dgic.status, findings: dgic.findings };
}
```
`evaluateDGIC(input, cfg, mode)` stays pure/sync (synthetic adds only cheap array checks; contributing-integrity is deferred semantic_review, not inline).

## 7. `detect-threat-patterns` refactor
Each of the 4 direct inserts → `buildPatternCandidate({pattern_type, entityId, entityName, contributingSignalIds, windowHours, severity, severityScore, clientId, title, description, normalizedText})` then `await admitSignal(candidate, "synthetic", ctx)`. No direct `signals` insert remains ⇒ writer stops being a bypass ⇒ canary green for it.

## 8. Evaluator / config / labelling changes
- `evaluateDGIC(input, cfg, mode)` — add `mode`; gate the §4 profile on it. External profile unchanged.
- `connection_type` accepts first-class `pattern_correlation`.
- Publisher-class (`PUBLICATION_TS_ABSENT`) excludes `synthetic` / platform `fortress_pattern_engine`.
- `admission_mode` stamped in the `dgic` jsonb as `dgic.mode`. **Phase C's DB trigger keys off `dgic_status` + `dgic.mode`.**
- New codes: structural `CONTRIBUTING_SIGNALS_EMPTY`; semantic `CONTRIBUTING_SIGNALS_INTEGRITY_UNVERIFIED`.
- **Operator labelling (decision #5):** synthetic signals stay in the operator feed **only while clearly labelled synthetic / pattern-derived**. The label is driven by the **structured** `dgic.mode='synthetic'` (and existing `signal_type='pattern'`), **not** the `[PATTERN]` title string. The feed/detail UI must render a distinct "Pattern Intelligence / synthetic" badge for these. Long-term these move to a dedicated **Insights / Pattern Intelligence** surface (decision #5, not in this slice).

## 9. Locked decisions (2026-05-25)
1. **Provenance:** `source_url=null` allowed for synthetic iff `admission_mode='synthetic'` + non-empty `contributing_signal_ids` + provenance via those signals. Internal deep-link is a long-term add, not a P1 blocker.
2. **Connection type:** `pattern_correlation` is first-class; never inherited from contributing signals.
3. **Dedup:** update-existing; key `pattern_type + entity_id + 24h rolling window`; persisting pattern updates the existing record (merge ids / extend timeline) rather than duplicating.
4. **Contributing integrity:** P1 = `semantic_review` only (not enforced). Later phase requires ≥1 decision-grade contributing signal before operator-visible.
5. **Placement:** eventually a distinct Insights / Pattern Intelligence surface; for now allowed in the operator feed **only if clearly labelled synthetic / pattern-derived**.

## 10. Definition of done (this slice)
- `admitSignal(..., "synthetic")` exists in the shared controller; `evaluateDGIC` is mode-aware; synthetic profile per §4.
- `detect-threat-patterns` writes **zero** direct `signals` inserts — all 4 sites route through `admitSignal`.
- Synthetic dedup (§5) verified: a persisting pattern updates one feed item across runs (no duplicate flood).
- Every synthetic signal carries `dgic_status`, `dgic.findings`, `dgic.mode='synthetic'`, `connection_type='pattern_correlation'`; `source_url=null` accepted under the §3/decision-1 conditions; `PUBLICATION_TS_ABSENT` not raised.
- Operator feed renders a clear synthetic/pattern-derived label from `dgic.mode` (decision #5).
- Bypass canary green for `detect-threat-patterns`; admission behavior otherwise unchanged in P1 (audit-only — no quarantine, no visibility change beyond the label).
- Staging-first, gated; latency gate honored (synthetic checks are cheap/sync).
