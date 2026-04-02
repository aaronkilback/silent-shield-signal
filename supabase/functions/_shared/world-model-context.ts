/**
 * World Model Context
 *
 * Fetches an agent's active world predictions and formats them into a
 * system prompt injection block. Imported by agent-chat to give agents
 * awareness of their own running forecasts.
 *
 * Usage:
 *   import { getAgentWorldModel, formatWorldModelContext } from "../_shared/world-model-context.ts";
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorldPrediction {
  id: string;
  prediction_text: string;
  domain: string;
  confidence_probability: number;
  expected_by: string | null;
  triggering_conditions: string[];
  falsifying_conditions: string[];
  status: string;
  created_at: string;
  confirmed_at?: string | null;
  refuted_at?: string | null;
}

// ── Data fetching ────────────────────────────────────────────────────────────

/**
 * Fetch the agent's current world model: active predictions plus recently
 * resolved (confirmed or refuted in the last 48 hours) for self-awareness.
 * Returns up to 8 predictions total (active first, then resolved).
 */
export async function getAgentWorldModel(
  supabase: any,
  agentCallSign: string,
  clientId?: string
): Promise<WorldPrediction[]> {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Active predictions
  let activeQuery = supabase
    .from('agent_world_predictions')
    .select(`
      id, prediction_text, domain, confidence_probability,
      expected_by, triggering_conditions, falsifying_conditions,
      status, created_at, confirmed_at, refuted_at
    `)
    .eq('agent_call_sign', agentCallSign)
    .eq('status', 'active')
    .order('confidence_probability', { ascending: false })
    .limit(6);

  if (clientId) {
    activeQuery = activeQuery.eq('client_id', clientId);
  }

  const { data: activePredictions, error: activeErr } = await activeQuery;
  if (activeErr) {
    console.error('[world-model-context] Failed to load active predictions:', activeErr);
  }

  // Recently resolved predictions (confirmed or refuted in last 48h)
  let resolvedQuery = supabase
    .from('agent_world_predictions')
    .select(`
      id, prediction_text, domain, confidence_probability,
      expected_by, triggering_conditions, falsifying_conditions,
      status, created_at, confirmed_at, refuted_at
    `)
    .eq('agent_call_sign', agentCallSign)
    .in('status', ['confirmed', 'refuted'])
    .or(`confirmed_at.gte.${fortyEightHoursAgo},refuted_at.gte.${fortyEightHoursAgo}`)
    .order('created_at', { ascending: false })
    .limit(4);

  if (clientId) {
    resolvedQuery = resolvedQuery.eq('client_id', clientId);
  }

  const { data: resolvedPredictions, error: resolvedErr } = await resolvedQuery;
  if (resolvedErr) {
    console.error('[world-model-context] Failed to load resolved predictions:', resolvedErr);
  }

  const all = [
    ...(activePredictions || []),
    ...(resolvedPredictions || []),
  ] as WorldPrediction[];

  // Cap at 8 total
  return all.slice(0, 8);
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Return the number of hours from now until a timestamp, as a readable string.
 * Negative = already past.
 */
function hoursUntil(isoString: string): string {
  const diffMs = new Date(isoString).getTime() - Date.now();
  const diffH = Math.round(diffMs / (1000 * 60 * 60));
  if (diffH < 0) return `${Math.abs(diffH)}h ago (overdue)`;
  if (diffH === 0) return 'imminent';
  return `expires in ${diffH}h`;
}

/**
 * Return a brief summary of a string array, truncated to ~80 chars.
 */
function conditionSummary(conditions: string[]): string {
  if (!conditions || conditions.length === 0) return 'none specified';
  const joined = conditions.join('; ');
  return joined.length > 80 ? joined.substring(0, 77) + '...' : joined;
}

/**
 * Format agent world model predictions into a system prompt injection block.
 * Returns an empty string if there are nothing to show.
 */
export function formatWorldModelContext(predictions: WorldPrediction[]): string {
  if (!predictions || predictions.length === 0) return '';

  const active = predictions.filter(p => p.status === 'active');
  const confirmed = predictions.filter(p => p.status === 'confirmed');
  const refuted = predictions.filter(p => p.status === 'refuted');

  const lines: string[] = [];

  lines.push('═══ YOUR ACTIVE WORLD MODEL ═══');

  if (active.length > 0) {
    lines.push(
      `You are currently tracking ${active.length} active prediction${active.length === 1 ? '' : 's'} about how situations will evolve. ` +
      `These represent your running forecast — update your analysis to be consistent with or explicitly revise these predictions.`
    );
    lines.push('');
    lines.push('ACTIVE FORECASTS:');

    for (const p of active) {
      const pct = Math.round(p.confidence_probability * 100);
      const domainTag = p.domain.toUpperCase();
      const expiry = p.expected_by ? hoursUntil(p.expected_by) : 'no deadline';
      lines.push(`▸ [${domainTag} | ${pct}% | ${expiry}] "${p.prediction_text}"`);
      lines.push(`  If true: ${conditionSummary(p.triggering_conditions)}`);
      lines.push(`  If false: ${conditionSummary(p.falsifying_conditions)}`);
    }
  } else {
    lines.push('You have no active forecasts at this time.');
  }

  const hasResolved = confirmed.length > 0 || refuted.length > 0;
  if (hasResolved) {
    lines.push('');
    lines.push('RECENTLY RESOLVED:');

    for (const p of confirmed) {
      const hoursAgo = p.confirmed_at
        ? Math.round((Date.now() - new Date(p.confirmed_at).getTime()) / (1000 * 60 * 60))
        : null;
      const when = hoursAgo !== null ? `confirmed ${hoursAgo}h ago` : 'recently confirmed';
      lines.push(`▸ [CONFIRMED ✓] "${p.prediction_text}" — ${when}`);
    }

    for (const p of refuted) {
      const hoursAgo = p.refuted_at
        ? Math.round((Date.now() - new Date(p.refuted_at).getTime()) / (1000 * 60 * 60))
        : null;
      const when = hoursAgo !== null ? `refuted ${hoursAgo}h ago` : 'recently refuted';
      lines.push(`▸ [REFUTED ✗] "${p.prediction_text}" — refuted by new evidence (${when})`);
    }
  }

  return '\n\n' + lines.join('\n') + '\n';
}
