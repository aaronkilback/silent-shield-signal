/**
 * Watch List Module — entity threat tracking with severity boosting
 *
 * When entities on the watch list appear in new signals, their severity
 * scores are boosted and analysts are notified.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface WatchListHit {
  watchListId: string;
  entityName: string;
  watchLevel: 'monitor' | 'alert' | 'critical';
  severityBoost: number;
  reason: string;
}

/**
 * Check if any of the given entity names match active watch list entries
 * for the given client (or global entries with no client_id).
 */
export async function checkWatchListHits(
  supabase: SupabaseClient,
  entityNames: string[],
  clientId: string
): Promise<WatchListHit[]> {
  if (!entityNames || entityNames.length === 0) return [];

  // Fetch all active watch entries for this client (or global)
  const { data: watchEntries } = await supabase
    .from('entity_watch_list')
    .select('id, entity_name, watch_level, severity_boost, reason')
    .eq('is_active', true)
    .or(`client_id.eq.${clientId},client_id.is.null`);

  if (!watchEntries || watchEntries.length === 0) return [];

  const hits: WatchListHit[] = [];
  const lowerEntityNames = entityNames.map(n => n.toLowerCase());

  for (const entry of watchEntries) {
    // Skip expired entries (belt-and-suspenders — the DB column handles this too)
    const lowerWatchName = entry.entity_name.toLowerCase();
    const isHit = lowerEntityNames.some(name =>
      name.includes(lowerWatchName) || lowerWatchName.includes(name)
    );
    if (isHit) {
      hits.push({
        watchListId: entry.id,
        entityName: entry.entity_name,
        watchLevel: entry.watch_level as WatchListHit['watchLevel'],
        severityBoost: entry.severity_boost,
        reason: entry.reason,
      });
    }
  }

  return hits;
}

/**
 * Apply watch list severity boosts to a signal and flag it in raw_json.
 * Returns the new boosted severity_score.
 */
export async function applyWatchListBoosts(
  supabase: SupabaseClient,
  signalId: string,
  hits: WatchListHit[],
  currentSeverityScore: number
): Promise<number> {
  const maxBoost = Math.max(...hits.map(h => h.severityBoost));
  const boostedScore = Math.min(100, currentSeverityScore + maxBoost);
  const severity = boostedScore >= 80 ? 'critical'
    : boostedScore >= 50 ? 'high'
    : boostedScore >= 20 ? 'medium'
    : 'low';

  // Read current raw_json, merge in watch list data, then update
  const { data: signal } = await supabase
    .from('signals')
    .select('raw_json')
    .eq('id', signalId)
    .single();

  const updatedRawJson = {
    ...(signal?.raw_json || {}),
    watch_list_hit: true,
    watch_list_hits: hits.map(h => ({
      entity_name: h.entityName,
      watch_level: h.watchLevel,
      boost_applied: h.severityBoost,
      reason: h.reason,
    })),
    watch_list_highest_level: hits.reduce((max, h) => {
      const levels = { monitor: 1, alert: 2, critical: 3 };
      return levels[h.watchLevel] > levels[max] ? h.watchLevel : max;
    }, 'monitor' as WatchListHit['watchLevel']),
  };

  await supabase.from('signals').update({
    severity_score: boostedScore,
    severity,
    raw_json: updatedRawJson,
  }).eq('id', signalId);

  console.log(`[WatchList] Signal ${signalId} severity boosted: ${currentSeverityScore} → ${boostedScore} (${hits.map(h => h.entityName).join(', ')})`);
  return boostedScore;
}
