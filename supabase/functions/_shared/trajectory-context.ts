/**
 * Trajectory Context Builder
 *
 * Fetches active threat trajectory positions and formats them as
 * intelligence context for injection into agent system prompts.
 * Agents use this to anticipate NEXT phases, not just describe current state.
 */

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface TrajectoryPosition {
  trajectory_name: string;
  threat_type: string;
  current_phase: number;
  total_phases: number;
  phase_name: string;
  phase_description: string | null;
  phase_indicators: string[];
  next_phase_name: string | null;
  next_phase_indicators: string[];
  confidence: number;
  estimated_next_phase_at: string | null;
  percent_through: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         GET ACTIVE TRAJECTORIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetches active trajectory positions from the database, joining in
 * trajectory metadata and current + next phase details.
 *
 * @param supabase   - A Supabase service-role client
 * @param clientId   - Optional: filter to a specific client's positions
 * @param agentCallSign - Currently unused, reserved for future per-agent filtering
 * @returns Up to 4 active trajectory positions with full phase context
 */
export async function getActiveTrajectories(
  supabase: any,
  clientId?: string,
  agentCallSign?: string
): Promise<TrajectoryPosition[]> {
  // Build the query — join positions → trajectories → phases
  let query = supabase
    .from("trajectory_positions")
    .select(
      `
      current_phase,
      confidence,
      estimated_next_phase_at,
      threat_trajectories (
        trajectory_name,
        threat_type,
        total_phases
      ),
      trajectory_phases!inner (
        phase_number,
        phase_name,
        description,
        indicators
      )
    `
    )
    .eq("is_active", true)
    // Join condition: trajectory_phases.phase_number = trajectory_positions.current_phase
    .eq("trajectory_phases.phase_number", supabase.raw("trajectory_positions.current_phase"))
    .order("confidence", { ascending: false })
    .limit(4);

  if (clientId) {
    query = query.eq("client_id", clientId);
  }

  const { data: positions, error } = await query;

  if (error || !positions) {
    console.error("[trajectory-context] Failed to load trajectory positions:", error?.message);
    return [];
  }

  // For each position, also fetch the NEXT phase
  const results: TrajectoryPosition[] = [];

  for (const pos of positions) {
    const trajectory = pos.threat_trajectories;
    const currentPhaseData = pos.trajectory_phases;

    if (!trajectory || !currentPhaseData) continue;

    const currentPhaseNum = pos.current_phase;
    const totalPhases = trajectory.total_phases;
    const percentThrough = Math.round((currentPhaseNum / totalPhases) * 100);

    // Fetch next phase if it exists
    let nextPhaseName: string | null = null;
    let nextPhaseIndicators: string[] = [];

    if (currentPhaseNum < totalPhases) {
      const { data: nextPhase } = await supabase
        .from("trajectory_phases")
        .select("phase_name, indicators")
        .eq("trajectory_id", pos.trajectory_id)
        .eq("phase_number", currentPhaseNum + 1)
        .maybeSingle();

      if (nextPhase) {
        nextPhaseName = nextPhase.phase_name;
        nextPhaseIndicators = nextPhase.indicators ?? [];
      }
    }

    results.push({
      trajectory_name: trajectory.trajectory_name,
      threat_type: trajectory.threat_type,
      current_phase: currentPhaseNum,
      total_phases: totalPhases,
      phase_name: currentPhaseData.phase_name,
      phase_description: currentPhaseData.description ?? null,
      phase_indicators: currentPhaseData.indicators ?? [],
      next_phase_name: nextPhaseName,
      next_phase_indicators: nextPhaseIndicators,
      confidence: pos.confidence,
      estimated_next_phase_at: pos.estimated_next_phase_at ?? null,
      percent_through: percentThrough,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         FORMAT TRAJECTORY CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Formats a list of active trajectory positions into a structured intelligence
 * block for injection into agent system prompts.
 *
 * Designed to orient agents toward ANTICIPATION — what happens next — rather
 * than mere description of current state.
 */
export function formatTrajectoryContext(positions: TrajectoryPosition[]): string {
  if (positions.length === 0) {
    return "";
  }

  const lines: string[] = [
    "═══ THREAT TRAJECTORY INTELLIGENCE ═══",
    `${positions.length} active threat${positions.length === 1 ? "" : "s"} positioned on known escalation arcs. Use this to anticipate what comes NEXT, not just describe what is happening NOW.`,
    "",
  ];

  for (const pos of positions) {
    const trajectoryLabel = pos.trajectory_name.toUpperCase();
    const phaseLabel = `Phase ${pos.current_phase}/${pos.total_phases} — ${pos.phase_name} | ${pos.percent_through}% through arc`;
    const confidencePct = Math.round(pos.confidence * 100);

    lines.push(`▸ [${trajectoryLabel} | ${phaseLabel}]`);

    if (pos.phase_description) {
      lines.push(`  Current: ${pos.phase_description}`);
    } else if (pos.phase_indicators.length > 0) {
      lines.push(`  Current indicators: ${pos.phase_indicators.slice(0, 3).join(", ")}`);
    }

    if (pos.next_phase_name) {
      const nextIndicators =
        pos.next_phase_indicators.length > 0
          ? `watch for: ${pos.next_phase_indicators.slice(0, 4).join(", ")}`
          : "no specific indicators on record";
      lines.push(`  NEXT PHASE: ${pos.next_phase_name} — ${nextIndicators}`);
    } else {
      lines.push(`  NEXT PHASE: None — this is the final phase of the arc`);
    }

    if (pos.estimated_next_phase_at) {
      const nextAt = new Date(pos.estimated_next_phase_at);
      const nowMs = Date.now();
      const diffHours = Math.round((nextAt.getTime() - nowMs) / (1000 * 60 * 60));
      if (diffHours > 0) {
        lines.push(`  Estimated onset: within ${diffHours} hour${diffHours === 1 ? "" : "s"} based on historical patterns`);
      } else if (diffHours <= 0) {
        lines.push(`  Estimated onset: OVERDUE — next phase may have already begun`);
      }
    }

    lines.push(`  Confidence: ${confidencePct}%`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
