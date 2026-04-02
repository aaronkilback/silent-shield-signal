/**
 * Red Team Analyst — Adversarial Falsification Agent
 *
 * Called automatically when any agent produces a high-confidence conclusion
 * (confidence > 0.75). Challenges the assessment from a devil's advocate
 * perspective: finds the weakest evidence link, the strongest counter-argument,
 * and the most plausible alternative hypothesis.
 *
 * POST body: {
 *   target_agent: string,
 *   conclusion: string,
 *   confidence: number,         // 0-1
 *   evidence_summary: string,
 *   signal_id?: string,
 *   incident_id?: string,
 *   client_id?: string
 * }
 */

import { callAiGatewayJson } from "../_shared/ai-gateway.ts";
import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface RedTeamRequest {
  target_agent: string;
  conclusion: string;
  confidence: number;
  evidence_summary: string;
  signal_id?: string;
  incident_id?: string;
  client_id?: string;
}

interface RedTeamAiResponse {
  red_team_challenge: string;
  alternative_hypothesis: string;
  weakest_evidence_link: string;
  confidence_adjustment: number;
  severity: "minor" | "moderate" | "major";
}

// ═══════════════════════════════════════════════════════════════════════════
//                              HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: RedTeamRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { target_agent, conclusion, confidence, evidence_summary, signal_id, incident_id, client_id } = body;

  if (!target_agent || !conclusion || confidence === undefined || !evidence_summary) {
    return errorResponse("Missing required fields: target_agent, conclusion, confidence, evidence_summary", 400);
  }

  // Skip if confidence is below threshold — no value in challenging weak assessments
  if (confidence < 0.70) {
    return successResponse({ skipped: true, reason: "confidence below threshold" });
  }

  const confidencePct = Math.round(confidence * 100);

  // ─── AI: Devil's Advocate Challenge ────────────────────────────────────
  const { data: aiResponse, error: aiError } = await callAiGatewayJson<RedTeamAiResponse>({
    model: "openai/gpt-5.2",
    functionName: "red-team-analyst",
    messages: [
      {
        role: "system",
        content:
          "DEVIL'S ADVOCATE MODE: You are the Red Team Analyst. Your ONLY job is to challenge, falsify, and find the holes in intelligence assessments. You are NOT trying to be helpful to the original analyst — you are trying to prove them wrong. Find the weakest link. Find the alternative explanation. Find what the evidence could actually mean if the first interpretation is wrong.",
      },
      {
        role: "user",
        content:
          `CHALLENGE THIS ASSESSMENT:\n\nOriginal agent: ${target_agent}\nConclusion: ${conclusion}\nConfidence claimed: ${confidencePct}%\nEvidence: ${evidence_summary}\n\nReturn JSON:\n{\n  "red_team_challenge": "the strongest argument that this conclusion is wrong",\n  "alternative_hypothesis": "what else could explain the same evidence",\n  "weakest_evidence_link": "the single most questionable piece of evidence",\n  "confidence_adjustment": 0.0-0.25 (how much to reduce confidence),\n  "severity": "minor|moderate|major" (how serious is this challenge)\n}`,
      },
    ],
  });

  if (aiError || !aiResponse) {
    console.error("[red-team-analyst] AI call failed:", aiError);
    return errorResponse("Red team analysis failed: AI unavailable", 502);
  }

  // Clamp confidence_adjustment to sane bounds (0–0.30)
  const adjustment = Math.min(Math.max(aiResponse.confidence_adjustment ?? 0, 0), 0.30);
  const adjustedConfidence = Math.max(confidence - adjustment, 0);

  // ─── Persist assessment ─────────────────────────────────────────────────
  const supabase = createServiceClient();

  const { error: insertError } = await supabase
    .from("red_team_assessments")
    .insert({
      target_agent,
      original_conclusion: conclusion,
      original_confidence: confidence,
      red_team_challenge: aiResponse.red_team_challenge,
      alternative_hypothesis: aiResponse.alternative_hypothesis,
      weakest_evidence_link: aiResponse.weakest_evidence_link,
      confidence_adjustment: adjustment,
      adjusted_confidence: adjustedConfidence,
      signal_id: signal_id ?? null,
      incident_id: incident_id ?? null,
      client_id: client_id ?? null,
      was_accepted: null, // to be updated by the target agent
    });

  if (insertError) {
    console.error("[red-team-analyst] DB insert failed:", insertError.message);
    // Non-fatal — still return the challenge to the caller
  }

  console.log(
    `[red-team-analyst] Challenged ${target_agent} | severity=${aiResponse.severity} | confidence ${confidence} → ${adjustedConfidence.toFixed(3)}`
  );

  return successResponse({
    challenge: aiResponse.red_team_challenge,
    alternative_hypothesis: aiResponse.alternative_hypothesis,
    weakest_evidence_link: aiResponse.weakest_evidence_link,
    confidence_adjustment: adjustment,
    adjusted_confidence: adjustedConfidence,
    severity: aiResponse.severity,
  });
});
