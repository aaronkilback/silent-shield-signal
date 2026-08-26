// WO-GROUNDING-01 Phase 2 — the LLM-backed DeriveCandidates adapter (Deno/edge only). Kept SEPARATE from
// derivation.ts so that module stays runtime-agnostic + node-testable (the golden test must not import ai-gateway).
import { callAiGatewayJson } from "../ai-gateway.ts";
import { derivationPrompt, type DeriveCandidates, type CandidateClaim } from "./derivation.ts";

/**
 * Build a DeriveCandidates backed by the AI gateway. The model is given ONE signal's text + the derivation prompt
 * and must return JSON {claims:[{text,span,asserts_client_impact}]}. Anything malformed → treated as no claims
 * (silence), never a fabricated claim. Grounding is still enforced downstream by createDerivedClaim (R2/R3/R4).
 */
export function makeLlmDeriveCandidates(clientName: string, model = "gpt-4o-mini"): DeriveCandidates {
  return async (_signalId, signalText) => {
    const { data, error } = await callAiGatewayJson<{ claims?: CandidateClaim[] }>({
      model,
      functionName: "grounding-derivation",
      messages: [
        { role: "system", content: "You extract ONLY what a single intelligence signal supports about a client, quoting exact spans. Return JSON only. If nothing, return an empty claims list." },
        { role: "user", content: derivationPrompt(clientName, signalText) },
      ],
      context: { phase: "grounding-derivation" },
    } as Parameters<typeof callAiGatewayJson>[0]);
    if (error || !data || !Array.isArray(data.claims)) return [];
    return data.claims.filter(
      (c): c is CandidateClaim => !!c && typeof c.text === "string" && typeof c.span === "string" && c.text.trim().length > 0,
    );
  };
}
