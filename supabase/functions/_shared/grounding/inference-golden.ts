// WO-GROUNDING-01 Phase 4 golden test — Inference validity (entailment).
// Three cases, per operator ruling:
//   1. REJECT — conclusion requires an OUTSIDE fact/term not in the anchors. Caught STRUCTURALLY (deterministic).
//   2. ADMIT  — conclusion follows purely from the anchors.
//   3. REJECT — NON-SEQUITUR: every term is anchored, but the conclusion does not follow. Term-containment ADMITS
//               this (proven below); only the ENTAILMENT judge rejects it.
//
// HONEST LIMITATION (printed at run): the structural anchor check CANNOT distinguish case 3 from case 2 — both have
// every term anchored. Distinguishing them requires judging entailment, which for natural-language claims is a
// MODEL call → a model gating a model → CORRELATED failure. The injected judge below is a STUB standing in for that
// model; this golden proves the PLUMBING (structural catches case 1; the judge's verdict is honored for cases 2/3;
// fail-closed on a broken judge), NOT that a real model reliably distinguishes case 2 from case 3. See inference-llm.ts.
//
// Run: node --experimental-strip-types supabase/functions/_shared/grounding/inference-golden.ts

import { inferenceAnchorCheck, validateInference, type EntailmentJudge, type EntailmentVerdict } from "./derived-claim.ts";

// Anchors — two claims about a Uniper LNG offtake agreement. Constructed so that EVERY salient term in the case-3
// conclusion ("Petronas Canada", "pricing") is present in an anchor — the whole point of case 3.
const ANCHORS = [
  "Petronas Canada holds an LNG offtake agreement with Uniper.",
  "The Uniper LNG offtake agreement affects Petronas Canada pricing exposure.",
];
const OVER = ["c0", "c1"]; // claim ids (validity of ids is not what this test exercises)

const CASE1 = "The offtake agreement triggers a CER regulatory review."; // CER = outside term not in anchors
const CASE2 = "Petronas Canada has an LNG offtake agreement with Uniper."; // restates an anchor
const CASE3 = "Petronas Canada should reassess its pricing strategy."; // recommendation — every SALIENT term anchored, conclusion unsupported

// STUB entailment judge standing in for the model in inference-llm.ts. It returns what a CORRECT entailment model
// should: the restatement follows; the recommendation does not. This is a stand-in, NOT proof a real model does so.
const stubJudge: EntailmentJudge = async (conclusion): Promise<EntailmentVerdict> => {
  if (conclusion === CASE2) return { entailed: true, reason: "restates premise P1 directly" };
  if (conclusion === CASE3) return { entailed: false, reason: "recommendation ('should reassess') is not stated by any premise — topical overlap is not entailment" };
  return { entailed: false, reason: "not evaluated / fail-closed" };
};
// A broken/unavailable judge — must fail closed (never admit).
const brokenJudge: EntailmentJudge = async () => { throw new Error("judge offline"); };
const safeBroken: EntailmentJudge = async (c, o) => { try { return await brokenJudge(c, o); } catch { return { entailed: false, reason: "judge offline — fail closed" }; } };

const run = async () => {
  console.log("═══ WO-GROUNDING-01 Phase 4 — inference validity (entailment) golden ═══\n");

  // ── Layer 1: STRUCTURAL anchor check alone (deterministic, no model) ──
  console.log("STRUCTURAL anchor check alone (term-containment):");
  const s1 = inferenceAnchorCheck(CASE1, ANCHORS);
  const s2 = inferenceAnchorCheck(CASE2, ANCHORS);
  const s3 = inferenceAnchorCheck(CASE3, ANCHORS);
  console.log(`   case1 (outside term):  grounded=${s1.grounded}  ungrounded=[${s1.ungrounded.join(", ")}]`);
  console.log(`   case2 (follows):       grounded=${s2.grounded}`);
  console.log(`   case3 (non-sequitur):  grounded=${s3.grounded}  ← structural ADMITS the non-sequitur (every term anchored)`);

  // ── Layer 2: full validateInference (structural + entailment) ──
  console.log("\nFULL validateInference (structural + entailment judge):");
  const r1 = await validateInference({ text: CASE1, over: OVER }, ANCHORS, stubJudge);
  const r2 = await validateInference({ text: CASE2, over: OVER }, ANCHORS, stubJudge);
  const r3 = await validateInference({ text: CASE3, over: OVER }, ANCHORS, stubJudge);
  const r3b = await validateInference({ text: CASE2, over: OVER }, ANCHORS, safeBroken); // fail-closed check
  const show = (label: string, r: Awaited<ReturnType<typeof validateInference>>) =>
    console.log(`   ${label}: ${r.ok ? "ADMIT" : `REJECT (${r.reason}) — ${r.detail}`}`);
  show("case1", r1);
  show("case2", r2);
  show("case3", r3);
  show("case2 w/ broken judge", r3b);

  const checks = {
    "case1 REJECT structurally (outside term 'cer', judge never needed)": !r1.ok && r1.reason === "inference_introduces_outside_term" && /cer/.test(r1.detail),
    "case2 ADMIT (follows purely from anchors)": r2.ok === true,
    "case3 REJECT via entailment (inference_not_entailed)": !r3.ok && r3.reason === "inference_not_entailed",
    "structural ALONE admits case3 (the limitation — term-containment cannot catch a non-sequitur)": s3.grounded === true,
    "structural ALONE rejects case1 (deterministic)": s1.grounded === false,
    "structural cannot distinguish case2 from case3 (both grounded)": s2.grounded === true && s3.grounded === true,
    "broken/unavailable judge FAILS CLOSED (does not admit)": r3b.ok === false && (r3b as { reason: string }).reason === "inference_not_entailed",
  };

  console.log("");
  let pass = true;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "XXXX FAIL"} — ${k}`); pass = pass && v; }

  console.log(
    "\nLIMITATION (stated, not tuned away): case 3 and case 2 are INDISTINGUISHABLE to the structural check — both\n" +
    "have every term anchored. Only the entailment judge separates them, and that judge is a MODEL. A model gating a\n" +
    "model is a CORRELATED failure mode: the reasoning that yields a bad inference may also judge it sound. The\n" +
    "deterministic guarantee stops at the anchor check; entailment is a mitigation layer, not a proof. (inference-llm.ts)");

  console.log(`\n${pass ? "✅ PHASE 4 GOLDEN PASS — outside-term caught structurally; non-sequitur caught only by entailment; fail-closed on broken judge."
                       : "❌ PHASE 4 GOLDEN FAIL."}`);
  process.exit(pass ? 0 : 1);
};
run();
