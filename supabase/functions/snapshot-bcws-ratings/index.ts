/**
 * Daily snapshot of the official BCWS fire danger rating for the 5
 * Petronas-monitored AWS stations. Decoupled from the (heavy) wildfire
 * daily report generator so we don't depend on operator-triggered
 * reports to maintain rating history.
 *
 * Source: BCWS British_Columbia_Danger_Rating_-_View FeatureServer/7.
 * Spatial query per station's lat/lng — same source the public BCWS
 * dashboard and Petronas's published report consume.
 *
 * Output: one upserted row per station per day in
 * wildfire_station_ratings, with days_at_current_rating computed via
 * a 30-day backward walk over the same table.
 *
 * Why a cron is required: 'Days at Current Rating' (Petronas's flagship
 * column) is only honest if the table has at least N consecutive days
 * of recorded ratings. Without this cron the column maxes out at the
 * number of times the daily report has been manually generated.
 *
 * Scheduled at 13:00 UTC = 06:00 MT, ahead of the 07:00 MT daily
 * briefing and any morning manual report.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { fetchBCWSDangerRatingAtPoint } from "../_shared/bcws.ts";

// MUST stay in sync with the STATIONS list in
// generate-wildfire-daily-report — same five Petronas-monitored AWS.
const STATIONS = [
  { id: 'hudson_hope',   name: 'Hudson Hope',   lat: 56.033, lon: -121.900 },
  { id: 'graham',        name: 'Graham',        lat: 56.575, lon: -122.537 },
  { id: 'wonowon',       name: 'Wonowon',       lat: 57.017, lon: -122.491 },
  { id: 'pink_mountain', name: 'Pink Mountain', lat: 57.058, lon: -122.534 },
  { id: 'muskwa',        name: 'Muskwa',        lat: 58.772, lon: -122.656 },
];

function ratingToCode(rating: string): 'L' | 'M' | 'H' | 'VH' | 'E' {
  const r = (rating || '').toLowerCase();
  if (r === 'extreme') return 'E';
  if (r === 'very high') return 'VH';
  if (r === 'high') return 'H';
  if (r === 'moderate') return 'M';
  return 'L';
}

async function getConsecutiveDays(supabase: any, stationId: string, rating: string): Promise<number> {
  // Walk backwards from today; count consecutive days at the same rating.
  const { data, error } = await supabase
    .from('wildfire_station_ratings')
    .select('rating_date, danger_rating')
    .eq('station_id', stationId)
    .order('rating_date', { ascending: false })
    .limit(60);
  if (error || !data || data.length === 0) return 1;
  let count = 0;
  for (const row of data) {
    if (row.danger_rating === rating) count++;
    else break;
  }
  return Math.max(count, 1);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, 'snapshot-bcws-ratings-daily');

  try {
    const today = new Date().toISOString().slice(0, 10);
    const results: Array<Record<string, unknown>> = [];
    let okCount = 0;
    let fallbackCount = 0;

    for (const station of STATIONS) {
      let rating: string | null = null;
      let code: 'L' | 'M' | 'H' | 'VH' | 'E' = 'L';
      let source: 'bcws_official' | 'no_polygon_match' | 'fetch_error' = 'bcws_official';
      let fetchError: string | null = null;

      try {
        const r = await fetchBCWSDangerRatingAtPoint(station.lat, station.lon);
        if (r) {
          rating = r.rating;
          code = ratingToCode(r.rating);
          okCount++;
        } else {
          source = 'no_polygon_match';
          fallbackCount++;
        }
      } catch (e: any) {
        source = 'fetch_error';
        fetchError = e?.message || String(e);
        fallbackCount++;
        console.warn(`[snapshot-bcws-ratings] ${station.name}: ${fetchError}`);
      }

      // No fallback to estimateFwi here — this function's purpose is to
      // record the OFFICIAL rating's history. If BCWS doesn't have a
      // value, skip the upsert so we don't pollute consecutive-day
      // counts with synthetic ratings.
      if (rating === null) {
        results.push({ station: station.id, skipped: true, source, fetchError });
        continue;
      }

      // Upsert today's rating.
      const upsertResult = await supabase
        .from('wildfire_station_ratings')
        .upsert({
          station_id: station.id,
          station_name: station.name,
          rating_date: today,
          danger_rating: rating,
          danger_code: code,
        }, { onConflict: 'station_id,rating_date' });
      if (upsertResult.error) {
        console.warn(`[snapshot-bcws-ratings] upsert failed for ${station.name}: ${upsertResult.error.message}`);
        results.push({ station: station.id, error: upsertResult.error.message });
        continue;
      }

      // Now compute days_at_current_rating including today's row.
      const days = await getConsecutiveDays(supabase, station.id, rating);
      const updateResult = await supabase
        .from('wildfire_station_ratings')
        .update({ days_at_current_rating: days })
        .eq('station_id', station.id)
        .eq('rating_date', today);
      if (updateResult.error) {
        console.warn(`[snapshot-bcws-ratings] days update failed for ${station.name}: ${updateResult.error.message}`);
      }

      results.push({
        station: station.id,
        rating,
        code,
        days_at_current_rating: days,
        source,
      });
      console.log(`[snapshot-bcws-ratings] ${station.name}: ${code} (${rating}) — days=${days}`);
    }

    await completeHeartbeat(supabase, hb, {
      stations_processed: STATIONS.length,
      bcws_ok: okCount,
      bcws_fallback: fallbackCount,
      results,
    });

    return successResponse({
      success: true,
      date: today,
      stations: results,
      bcws_ok: okCount,
      bcws_fallback: fallbackCount,
    });
  } catch (err: any) {
    console.error('[snapshot-bcws-ratings] fatal:', err);
    await failHeartbeat(supabase, hb, err);
    return errorResponse(err?.message || 'Unknown error', 500);
  }
});
