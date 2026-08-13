# WO-FORENSIC-SURFACE-COMPLETENESS-01 — Re-triage every incident closed on a "hallucination" finding

**Status:** LOGGED, not started. Awaiting operator prioritization.
**Class:** method failure (not a defect). The kind that produces confident wrong answers at scale.
**Provenance:** INC-CTX-CONTAM re-diagnosis, 2026-08-12. A forensic examined seven *retrieval* surfaces, found the phrase in none, and concluded the model **invented** it — while the phrase sat verbatim in the always-on system prompt the whole time. The search space was assumed complete; the model's instruction context was never in it. Operator: *"every other incident closed on a hallucination finding was closed by the same reasoning with the same blind spot."*

## The finding
A "hallucination" / "parametric" / "the model made it up" root-cause verdict is a **claim of exhaustive negative search**. It is only valid if the space searched provably includes **every input the model received** — not just the retrieval stores. The standard forensic checked retrieval surfaces and stopped; the instruction context (system prompt, tool/function definitions, persona/directive blocks, few-shot examples, injected COP/memory) was outside the set. Absence-from-retrieval was read as absence-from-context. See memory `feedback-negative-finding-needs-complete-search`.

## Scope (two parts — do NOT bundle beyond these; they share one acceptance test)
1. **Re-triage** every incident whose closed/ratified root cause is "parametric" / "hallucination" / "free-association" / "model-invented," against the **expanded surface set**: assembled system prompt, tool definitions, persona, few-shot examples, injected context (COP/memory/retrieved docs), in addition to retrieval stores. For each: confirm the fact was in NO input, or reclassify as contamination and correct the record (as INC-CTX-CONTAM §9 was corrected).
2. **Amend the standard forensic checklist** so a negative "not in any store" finding cannot be signed off until the instruction-context surfaces are swept. A negative finding must state its search space explicitly; bare "not found" is not acceptable.

## Acceptance criterion (single)
Every hallucination-closed incident has a re-triage note citing the expanded surface set (with the specific prompt/tool-def/persona checked), AND the forensic runbook requires instruction-context surfaces before any "parametric" verdict. Re-triage that reclassifies produces a §-correction on that incident's record.

## Related (same shape — confident conclusion on an unverified completeness assumption)
- 93% over-attribution (unexamined matcher) — the week's opening problem.
- Confident all-clear over 224 signals (unexamined attribution gap) — the empty-set guard.
- INC-CTX-CONTAM (unexamined prompt surface) — this incident.

Not started. One finding, one WO.

## Rule addition (2026-08-13, Q1 ruling) — "carries no tenant facts" is a claim requiring proof

Extends the finding from retrieval-negatives to **unscoped shared reads in per-tenant assemblies**. INC-CTX-CONTAM §4 exempted `autonomous_scan_results` from tenant-scoping with the bare assertion "carries no tenant facts." It was false: the table's `risk_score` was rendered as a per-client `Risk posture: N/100`. That is the **second** unscoped-shared-read → per-client-answer leak in two days (the first: the static prompt roster, Class C).

**The rule:** in any per-tenant prompt/answer assembly, an unscoped read (a query with no `tenant_id`/`client_id` filter, whether because the caller omitted one or because the table has no scope column) may only stand if it is **proven** to emit nothing tenant-attributable — sampled output, not an assumption. A table with no scope column that still feeds a per-tenant answer is a defect by construction: it cannot be scoped, so its output must be either provably tenant-neutral or removed. "Carries no tenant facts" written in a containment doc without a sampled-output proof is exactly the incomplete-search-space error this WO is about, pointed at the write/assembly side instead of the forensic side.

**Sweep target (add to scope):** enumerate every unscoped `.from()` inside `buildCOP` and any other always-on per-tenant context builder; for each, prove tenant-neutrality or scope/remove it.
