# WO-FABRICATED-FINDINGS-01 — model output stored under authoritative lookup labels

**Status:** LOGGED — do NOT build yet (design first).
**Priority:** HIGHEST product-integrity priority.
**Opened:** 2026-07-31. **Provenance:** INC-AITOOLS-XTENANT-2026-07-30 Block-A verification, Amendment 8(a).

## Finding

`entity-deep-scan` asserts **sanctions**, **criminal-records**, and **property/public-records** screening
*determinations* from **model output**, and stores them under authoritative `content_type` labels
(`sanctions_screening`, `criminal_records`, `public_records`) with **confidence scores up to 80** and synthetic
`deep-scan://…` URIs — presenting model guesses as verified lookups.

**No real sanctions / criminal / property API is called anywhere in the function.** The only real external
calls are HIBP (breach), Google CSE (web search), and CISA KEV (vuln feed). The "sanctions/registry screening"
path (`entity-deep-scan/index.ts` L632–687) is a **prompt** to Perplexity `sonar` / OpenAI `gpt-4o-mini` whose
JSON output is parsed and stored as a screening result.

### Evidence (stored rows; `created_by=null`, `benchmark_source_document_id=null`)
- `criminal_records` / Nikolai Vance — `url="https://[provincial court records database]"` (unfilled placeholder).
- `criminal_records` / Nick Vashouk — `url=eservices.alberta.ca/court-of-kb-criminal-search-**request**.html`
  (a manual request *form* presented as a source, not a data API).
- `public_records` / Nikolai Vance — content = **`"I can't help with this request…"`** (an LLM refusal stored
  as a public record).
- `sanctions_screening` — synthetic `deep-scan://…/sanctions_screening/…Clear` URIs; text = model "No match found."

### Defect class (THIRD instance)
Same class as:
1. **`SOURCE: FORTRESS INTELLIGENCE PLATFORM`** — model-authored content presented as a sourced citation.
2. **The wildfire signal cited for the Uniper claim** — a generated/ungrounded artifact presented as evidence.
3. **This** — model assessments under real-lookup labels with verification-implying confidence + fake source URIs.

The pattern is the finding: **Fortress emits model-generated content wearing the authority of a real
lookup/source.** This is a product-integrity failure, not a per-function bug.

## Scope (design targets — not yet implemented)
- **No artifact may carry a lookup-implying label without a real lookup.** Labels like `sanctions_screening`,
  `criminal_records`, `public_records` are reserved for outputs of an actual external authority query.
- **Model-derived assessments must be labelled as model-derived** (e.g. a distinct `content_type` /
  `derivation: model`) and **must NOT carry a confidence score implying verification.** Model self-certainty ≠
  correctness (see `feedback_confidence_is_not_correctness`).
- **Audit and correct-or-quarantine every existing artifact carrying a false lookup label** — sweep
  `entity_content` for `content_type in ('sanctions_screening','criminal_records','public_records')` and any
  synthetic `deep-scan://` / placeholder / refusal-text rows; relabel as model-derived or quarantine.
- **The existing legal hold governs: correct forward, do not delete historical rows** (Provenance Doctrine +
  legal-hold: strike/relabel/annotate, never destroy evidence).

## Related
- [[project_inc_ctx_contam]] (parametric/world-knowledge asserted as tenant fact — epistemic sibling)
- Grounding-State Doctrine (CLAUDE.md) — "no grounding trace → no claim"; here: "no lookup → no lookup label."
- WO-SUBJECT-GATE-01 (who/whether these scans should run at all).
