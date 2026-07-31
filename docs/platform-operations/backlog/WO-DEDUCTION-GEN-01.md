# WO-DEDUCTION-GEN-01 — the inference GENERATOR produces non-entailing conclusions

**Logged:** 2026-07-31 (surfaced by the WO-GROUNDING-01 Phase-4 empirical run on PECL 7/23–7/30).
**Class:** generation-side soundness defect (upstream of the entailment judge). Sibling of the
`WO-FABRICATED-FINDINGS-01` class — Fortress emitting model output that overstates what the evidence supports.

## The finding
The derivation/deduction pass generated **23 candidate inferences** from real 7/23–7/30 PECL signals. The operator
hand-labelled **0 of 23 as entailed** — every conclusion introduced a causal/normative/predictive step
("indicates a proactive approach", "may complicate", "signifies a strengthening", "necessitates immediate
intervention") that its anchor facts did not support. This is the **same defect as the "Strategic Deductions"
blocks in report `6027f0ac`.**

**Key point: this is a GENERATION problem, not only a judging problem.** The Phase-4 entailment judge is a
*containment* layer; it caught 21/23 and false-admitted 2. But even a **perfect** judge would reject the entire
generated output — because the generator itself produces conclusions that do not follow. Tuning or hardening the
judge does not make the DEDUCTIONS surface produce value; it only decides how much unsound output gets blocked.

## Why it happens (hypothesis)
The generation prompt asks for "ONE analytic conclusion you would draw" from a set of facts. Absent an explicit
entailment constraint, the model does what analysts-in-prose do: it *extrapolates* — adds implication, motive,
trajectory, recommendation. That is exactly what binding-at-derivation exists to forbid at the claim level, but
the inference/deduction generator was not held to the same bar.

## Required outcome (definition of done)
1. The generator must produce conclusions that **follow from their anchors**, or produce **nothing** for that
   anchor set. Silence is correct; a fluent non-sequitur is not. (Same doctrine as derivation: no anchor support →
   no claim.)
2. Acceptance is measured, not asserted: on a labelled real-data sample, **operator-labelled entailment rate of
   generated conclusions must be high** (target set with the operator), not ~0.
3. The DEDUCTIONS report surface **ships empty rather than fluent-but-unsupported** until (1)+(2) hold.

## Dependencies / relationship to WO-GROUNDING-01
- The entailment judge (WO-GROUNDING-01 Phase 4) stays as the containment backstop, but is **not** a substitute
  for fixing generation. Order: fix generation → re-measure entailment rate → only then consider shipping.
- A **second labelled set containing genuine entailments** is required before the judge's precision can be claimed
  (WO-GROUNDING-01 "LIMIT ON THIS RESULT"). That set can be built from the generator's output once it produces
  real entailments.

## Sibling note — R4 client-alias over-inclusion (scope guard)
Surfaced in the same run: `buildGroundingDeps` treats **every** tenant `organization` entity with aliases as a
client alias (returned Greenpeace/Huawei/foreign intel services/Unist'ot'en/C-IRG for PECL). R4's client-impact
guard is therefore too permissive. Narrow Amendment-7a resolution to the client's **own** org-identity entity.
Small, separable fix; tracked here so it is not lost.
