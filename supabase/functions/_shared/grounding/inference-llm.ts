// WO-GROUNDING-01 Phase 4 — the model-backed EntailmentJudge (Deno/edge only). Kept SEPARATE from derived-claim.ts
// so the core + golden stay runtime-agnostic (the golden injects a judge; it must not import ai-gateway).
//
// ── CORRELATED-FAILURE DISCLOSURE (stated, not discovered later) ──────────────────────────────────────────────
// This judge is a MODEL. The non-sequitur case (case 3 in the golden: every term anchored, conclusion does not
// follow) is NOT catchable by term-containment — only by judging entailment, which for natural-language claims
// requires reasoning, i.e. a model. That means a model is gating a model's inference. The failure mode is
// CORRELATED: the same class of reasoning that produced an unsupported inference may also judge it sound. This is
// a known, accepted limitation of Phase 4 — the structural anchor check (inferenceAnchorCheck) is the only DETER-
// MINISTIC guarantee; entailment adds a model-judgment layer on top of it, not a proof. See WO-GROUNDING-01 §Phase 4.
//
// Mitigations that make the correlation less than 1 (not zero):
//   - The judge sees ONLY the anchor texts + the conclusion — no signal context, no client dossier, no outside
//     facts. It is instructed that missing information means NOT entailed (fail-closed), and that a recommendation/
//     prediction/causal claim is entailed only if the anchors state the causal/normative link, not merely the topic.
//   - It runs at temperature 0 on a DIFFERENT PROVIDER FAMILY than derivation (Gemini vs OpenAI), as a separate
//     call — not the same model and not the same generation (operator ruling 2026-07-31, WO §Phase 4).

import { callAiGatewayJson } from "../ai-gateway.ts";
import type { EntailmentJudge, EntailmentVerdict } from "./derived-claim.ts";

const SYSTEM =
  "You are a strict logical-entailment checker. You are given a set of PREMISES and one CONCLUSION. Decide whether " +
  "the CONCLUSION follows from the PREMISES ALONE, using NO outside knowledge and NO unstated assumptions. " +
  "Rules: (1) If the conclusion needs any fact not in the premises, it is NOT entailed. (2) A recommendation, " +
  "prediction, or causal/normative claim ('should', 'will', 'because', 'therefore') is entailed ONLY if the premises " +
  "explicitly state that link — sharing a topic with the premises is NOT entailment. (3) When uncertain, answer " +
  "entailed:false. Return JSON only: {\"entailed\": boolean, \"reason\": string}.";

// DECORRELATION (Amendment 8 / operator ruling 2026-07-31): the judge MUST NOT be the same model as derivation.
// Derivation runs OpenAI `gpt-4o-mini`; this gateway has no Claude route, so the strongest available decorrelation
// is a DIFFERENT PROVIDER FAMILY — Google Gemini (`gemini-2.5-flash`, verified working on this project's
// GEMINI_API_KEY). Different family ⇒ different training data + objective ⇒ the correlated-failure mode (same
// reasoning that produced a bad inference judging it sound) is materially reduced. The judge is a CHEAP call
// (anchors + conclusion only), so the extra provider costs nothing meaningful. Do NOT set this back to a gpt-*
// model while derivation uses gpt-* — that re-introduces the correlation this exists to break.
export function makeLlmEntailmentJudge(model = "gemini-2.5-flash"): EntailmentJudge {
  return async (inferenceText: string, overClaimTexts: string[]): Promise<EntailmentVerdict> => {
    const premises = overClaimTexts.map((t, i) => `P${i + 1}: ${t}`).join("\n");
    const { data, error } = await callAiGatewayJson<{ entailed?: boolean; reason?: string }>({
      model,
      functionName: "grounding-entailment",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `PREMISES:\n${premises}\n\nCONCLUSION: ${inferenceText}\n\nDoes the conclusion follow from the premises alone?` },
      ],
      // temperature/context are NOT top-level AiGatewayRequest fields — they were silently dropped before. temp 0
      // for determinism goes through extraBody; the phase tag goes through extraContext.
      extraBody: { temperature: 0, response_format: { type: "json_object" } },
      extraContext: { phase: "grounding-entailment", judge_model: model },
    });
    // Fail closed: any error / malformed judgment → NOT entailed (an inference is admitted only on an explicit,
    // well-formed "entailed:true"). A broken judge must never wave an inference through.
    if (error || !data || typeof data.entailed !== "boolean")
      return { entailed: false, reason: "entailment judge unavailable or malformed — failing closed (not entailed)" };
    return { entailed: data.entailed, reason: typeof data.reason === "string" ? data.reason : "" };
  };
}
