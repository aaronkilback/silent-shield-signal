/**
 * Trajectory Positioner — Threat Arc Positioning Agent
 *
 * Accepts a signal or incident and maps it onto the closest known threat
 * escalation trajectory. Returns where on the arc the threat currently sits,
 * how far through the arc it is, and what to watch for next.
 *
 * POST body: {
 *   signal_id?: string,
 *   incident_id?: string,
 *   signal_type: string,        // cyber, physical, insider, geopolitical, etc.
 *   title: string,
 *   description: string,
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

interface PositionerRequest {
  signal_id?: string;
  incident_id?: string;
  signal_type: string;
  title: string;
  description: string;
  client_id?: string;
}

interface TrajectoryRow {
  id: string;
  trajectory_name: string;
  threat_type: string;
  description: string | null;
  total_phases: number;
  typical_duration_hours: number | null;
  historical_accuracy: number;
}

interface PhaseRow {
  phase_number: number;
  phase_name: string;
  description: string | null;
  indicators: string[] | null;
  typical_duration_hours: number | null;
  next_phase_probability: number | null;
}

interface AiPhaseResult {
  phase_number: number;
  confidence: number;
  reasoning: string;
  estimated_next_phase_hours: number | null;
}

interface PositionResult {
  trajectory_name: string;
  current_phase: number;
  phase_name: string;
  confidence: number;
  next_phase_estimate: string | null;
  total_phases: number;
  percent_through: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         THREAT TYPE MAPPING
// Maps loose signal_type strings → canonical threat_type values in DB
// ═══════════════════════════════════════════════════════════════════════════

function resolveThreatTypes(signalType: string): string[] {
  const t = signalType.toLowerCase();

  if (
    t.includes("cyber") ||
    t.includes("ransomware") ||
    t.includes("phishing") ||
    t.includes("malware") ||
    t.includes("intrusion") ||
    t.includes("apt") ||
    t.includes("hack")
  ) {
    return ["cyber"];
  }
  if (t.includes("insider") || t.includes("employee") || t.includes("sabotage")) {
    return ["insider_threat"];
  }
  if (
    t.includes("geopolit") ||
    t.includes("diplomatic") ||
    t.includes("sanction") ||
    t.includes("conflict")
  ) {
    return ["geopolitical"];
  }
  if (
    t.includes("physical") ||
    t.includes("surveillance") ||
    t.includes("attack") ||
    t.includes("bomb") ||
    t.includes("assault")
  ) {
    return ["physical"];
  }
  if (t.includes("supply") || t.includes("vendor") || t.includes("third party")) {
    return ["supply_chain"];
  }
  if (
    t.includes("social") ||
    t.includes("fraud") ||
    t.includes("scam") ||
    t.includes("engineer")
  ) {
    return ["fraud"];
  }
  if (
    t.includes("narcotic") ||
    t.includes("drug") ||
    t.includes("crime") ||
    t.includes("organ")
  ) {
    return ["narcotics"];
  }

  // Fallback: try all — let AI pick the best fit
  return ["cyber", "physical", "insider_threat", "geopolitical", "fraud", "supply_chain", "narcotics"];
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

  let body: PositionerRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { signal_id, incident_id, signal_type, title, description, client_id } = body;

  if (!signal_type || !title || !description) {
    return errorResponse("Missing required fields: signal_type, title, description", 400);
  }

  const supabase = createServiceClient();

  // ─── Load matching trajectories ────────────────────────────────────────
  const threatTypes = resolveThreatTypes(signal_type);

  const { data: trajectories, error: trajError } = await supabase
    .from("threat_trajectories")
    .select("id, trajectory_name, threat_type, description, total_phases, typical_duration_hours, historical_accuracy")
    .in("threat_type", threatTypes)
    .eq("is_active", true);

  if (trajError) {
    console.error("[trajectory-positioner] Failed to load trajectories:", trajError.message);
    return errorResponse("Failed to load trajectory library", 500);
  }

  if (!trajectories || trajectories.length === 0) {
    return successResponse({ positioned: false, reason: "No matching trajectories found for signal type" });
  }

  // ─── Load phases for each trajectory ────────────────────────────────────
  const trajectoryIds = (trajectories as TrajectoryRow[]).map((t) => t.id);

  const { data: allPhases, error: phasesError } = await supabase
    .from("trajectory_phases")
    .select(
      "trajectory_id, phase_number, phase_name, description, indicators, typical_duration_hours, next_phase_probability"
    )
    .in("trajectory_id", trajectoryIds)
    .order("phase_number", { ascending: true });

  if (phasesError) {
    console.error("[trajectory-positioner] Failed to load phases:", phasesError.message);
    return errorResponse("Failed to load trajectory phases", 500);
  }

  const phasesByTrajectory: Record<string, PhaseRow[]> = {};
  for (const phase of (allPhases ?? []) as (PhaseRow & { trajectory_id: string })[]) {
    if (!phasesByTrajectory[phase.trajectory_id]) {
      phasesByTrajectory[phase.trajectory_id] = [];
    }
    phasesByTrajectory[phase.trajectory_id].push(phase);
  }

  // ─── Ask AI to position on each trajectory ──────────────────────────────
  let bestMatch: {
    trajectory: TrajectoryRow;
    aiResult: AiPhaseResult;
    matchedPhase: PhaseRow;
  } | null = null;

  for (const trajectory of trajectories as TrajectoryRow[]) {
    const phases = phasesByTrajectory[trajectory.id] ?? [];
    if (phases.length === 0) continue;

    const phaseDescriptions = phases
      .map(
        (p) =>
          `Phase ${p.phase_number} — ${p.phase_name}: ${p.description ?? ""}. Indicators: ${(p.indicators ?? []).join(", ")}.`
      )
      .join("\n");

    const { data: aiResult, error: aiError } = await callAiGatewayJson<AiPhaseResult>({
      model: "openai/gpt-5.2",
      functionName: "trajectory-positioner",
      messages: [
        {
          role: "system",
          content:
            "You are a threat trajectory analyst. Given a signal or incident, determine which phase of the provided escalation arc it best matches. Be precise and conservative — only claim high confidence if the evidence clearly fits.",
        },
        {
          role: "user",
          content:
            `Signal/Incident: "${title}"\nDescription: ${description}\n\nTrajectory: "${trajectory.trajectory_name}" (${trajectory.description ?? ""})\n\nPhases:\n${phaseDescriptions}\n\nReturn JSON:\n{\n  "phase_number": <integer 1-${trajectory.total_phases}>,\n  "confidence": <0.0-1.0>,\n  "reasoning": "<one sentence explanation>",\n  "estimated_next_phase_hours": <integer or null if no next phase or unknown>\n}`,
        },
      ],
    });

    if (aiError || !aiResult) {
      console.warn(`[trajectory-positioner] AI failed for trajectory ${trajectory.trajectory_name}:`, aiError);
      continue;
    }

    // Validate phase number is in range
    const phaseNum = Math.min(Math.max(Math.round(aiResult.phase_number), 1), trajectory.total_phases);
    const clampedResult = { ...aiResult, phase_number: phaseNum };

    if (!bestMatch || clampedResult.confidence > bestMatch.aiResult.confidence) {
      const matchedPhase = phases.find((p) => p.phase_number === phaseNum) ?? phases[0];
      bestMatch = { trajectory, aiResult: clampedResult, matchedPhase };
    }
  }

  // ─── Require minimum confidence to persist ───────────────────────────────
  if (!bestMatch || bestMatch.aiResult.confidence < 0.60) {
    return successResponse({
      positioned: false,
      reason: "No trajectory match exceeded confidence threshold of 0.60",
    });
  }

  const { trajectory, aiResult, matchedPhase } = bestMatch;

  // ─── Estimate next phase timestamp ──────────────────────────────────────
  let estimatedNextPhaseAt: string | null = null;
  if (aiResult.estimated_next_phase_hours !== null && aiResult.estimated_next_phase_hours > 0) {
    const nextAt = new Date(Date.now() + aiResult.estimated_next_phase_hours * 60 * 60 * 1000);
    estimatedNextPhaseAt = nextAt.toISOString();
  }

  // ─── Check for existing active position on this client+trajectory ────────
  let existingNote: string | null = null;
  if (client_id) {
    const { data: existing } = await supabase
      .from("trajectory_positions")
      .select("id, current_phase, notes")
      .eq("trajectory_id", trajectory.id)
      .eq("client_id", client_id)
      .eq("is_active", true)
      .maybeSingle();

    if (existing && existing.current_phase < aiResult.phase_number) {
      existingNote =
        `ESCALATION: Advanced from Phase ${existing.current_phase} to Phase ${aiResult.phase_number} — ${aiResult.reasoning}`;
      console.log(`[trajectory-positioner] Escalation detected: ${trajectory.trajectory_name} phase ${existing.current_phase} → ${aiResult.phase_number}`);
    }
  }

  // ─── Upsert trajectory position ──────────────────────────────────────────
  const upsertPayload = {
    trajectory_id: trajectory.id,
    signal_id: signal_id ?? null,
    incident_id: incident_id ?? null,
    client_id: client_id ?? null,
    current_phase: aiResult.phase_number,
    confidence: aiResult.confidence,
    positioned_by: "trajectory-positioner",
    estimated_next_phase_at: estimatedNextPhaseAt,
    notes: existingNote ?? aiResult.reasoning,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  // Try to update existing active position for this client+trajectory first
  if (client_id) {
    const { data: updated } = await supabase
      .from("trajectory_positions")
      .update(upsertPayload)
      .eq("trajectory_id", trajectory.id)
      .eq("client_id", client_id)
      .eq("is_active", true)
      .select("id")
      .maybeSingle();

    if (!updated) {
      // No existing record — insert new
      const { error: insertError } = await supabase
        .from("trajectory_positions")
        .insert(upsertPayload);

      if (insertError) {
        console.error("[trajectory-positioner] Insert failed:", insertError.message);
      }
    }
  } else {
    // No client_id — always insert a new position
    const { error: insertError } = await supabase
      .from("trajectory_positions")
      .insert(upsertPayload);

    if (insertError) {
      console.error("[trajectory-positioner] Insert failed:", insertError.message);
    }
  }

  const percentThrough = Math.round((aiResult.phase_number / trajectory.total_phases) * 100);

  const result: PositionResult = {
    trajectory_name: trajectory.trajectory_name,
    current_phase: aiResult.phase_number,
    phase_name: matchedPhase.phase_name,
    confidence: aiResult.confidence,
    next_phase_estimate: estimatedNextPhaseAt,
    total_phases: trajectory.total_phases,
    percent_through: percentThrough,
  };

  console.log(
    `[trajectory-positioner] Positioned on "${trajectory.trajectory_name}" Phase ${aiResult.phase_number}/${trajectory.total_phases} (${aiResult.confidence.toFixed(2)} confidence)`
  );

  return successResponse(result);
});
