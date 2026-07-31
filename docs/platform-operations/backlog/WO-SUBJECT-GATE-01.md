# WO-SUBJECT-GATE-01 — subject-of-interest gate before enrichment

**Status:** LOGGED — do NOT build yet (design first).
**Opened:** 2026-07-31. **Provenance:** INC-AITOOLS-XTENANT-2026-07-30 Amendment 6 (entity-governance finding) + Amendment 8(f).

## Finding

**No subject-of-interest gate exists.** A named individual becomes an investigable, deep-scannable subject with
**no human authorization step**:
- **Entity creation is extraction-confidence-based.** `correlate-entities` auto-creates a person entity when
  `confidence >= MIN_AUTO_CREATE_CONFIDENCE`; `create-entity` checks only name+type validity. Any individual
  extracted from a signal/document with sufficient confidence becomes a person entity — including incidental
  bystanders (consistent with 605/788 name-only PECL records).
- **Enrichment is AI-agent-invoked.** `agent-chat` tool calls reach `entity-deep-scan` / `osint-entity-scan` /
  `investigate-poi`; a **model's decision** can trigger deep OSINT collection (HIBP, web search, model-generated
  "sanctions/criminal/property" assessments, photographs) against a subject with **no human in the loop**.

### Concrete illustrations (Amendment 8(f), operator-confirmed)
- **Ashley Callingbull** entered PECL via extraction, was AI-enriched into the **most deeply-collected** subject
  (155 content rows + 15 photos + special-category fields) — **no operator instructed targeting her.**
- **Amber Bracken** entered via a dossier uploaded **to test document→entity creation** — not an intelligence
  target — and was nonetheless enriched (34 content rows, POI report generated).

A model deciding to run adverse-media/OSINT collection on a private individual, with no authorizing human and no
recorded purpose, is a collection-governance and privacy failure independent of the auth defects in this incident.

## Scope (design targets — not yet implemented)
- **A person enters an investigable state by explicit human decision only.** Entity existence ≠ authorization to
  investigate. Introduce a distinct, human-set state (e.g. `subject_status = investigable`) that extraction
  CANNOT set.
- **Enrichment tools refuse to run against any subject not in that state.** `entity-deep-scan`,
  `osint-entity-scan`, `investigate-poi`, `scan-client-staff` fail closed unless the target is in the
  human-authorized state. (Fail-closed, honest-refusal — consistent with the action-integrity doctrine.)
- **Every enrichment run records the authorizing human and the stated purpose** — `authorized_by` (user id) +
  `purpose` on each run, non-null, enforced at the write seam (not prompt discipline). Closes the Amendment 6
  gap: today `entity_content.metadata` records only `scan_type`, no invoker/`requested_by`.

## Related
- INC-AITOOLS-XTENANT Amendment 6 (governance finding) + 8(f).
- Provenance Doctrine / Aegis action-integrity (CLAUDE.md) — actor ≠ owner; no implied capabilities; fail-closed.
- [[feedback_three_resources_doctrine]] — attention/consequence discipline; here applied to *who may be collected on*.
- WO-FABRICATED-FINDINGS-01 (what the enrichment produces, once it is authorized to run).
