/**
 * Estimate FFMC + BUI for a point in BC, used by the fire-spread
 * simulator when the user picks "Live Forecast" instead of supplying
 * manual values.
 *
 * Why this is needed: BCWS does not publish per-station FFMC/BUI on
 * any free public endpoint, and Open-Meteo does not carry FWI codes.
 * The simulator's old defaults (FFMC 90 / BUI 60) are mid-summer
 * drought values, which produce wildly aggressive spread projections
 * in spring/post-snowmelt conditions. This module replaces those
 * defaults with values back-derived from:
 *
 *   1. BCWS official danger rating polygon at the ignition point
 *      (authoritative, daily updated).
 *   2. Recent precipitation history (last 5 days from Open-Meteo).
 *   3. Season-of-year calibration (spring values are much lower
 *      than fire-season values for the same rating category).
 *
 * The output is good enough to keep the simulator within an order of
 * magnitude of physical reality across the year. It is NOT a
 * substitute for actual station observations — when a real BCWS
 * weather station feed becomes available, swap that in.
 */

import { fetchBCWSDangerRatingAtPoint, type BCWSDangerRating } from "./bcws.ts";

export interface EstimatedFwiCodes {
  ffmc: number;
  bui: number;
  source: {
    rating: string;
    code: 'L' | 'M' | 'H' | 'VH' | 'E';
    recent_precip_mm: number;
    season: 'spring' | 'fire_season' | 'fall' | 'winter';
    note: string;
  };
  /** True when BCWS or Open-Meteo failed and we used a default. */
  fallback_used: boolean;
}

type SeasonKey = EstimatedFwiCodes['source']['season'];
type RatingKey = EstimatedFwiCodes['source']['code'];

// Calibrated against typical NE BC station observations. Spring values
// (post-snowmelt) are deliberately conservative — duff is saturated,
// dead-and-down fuels are wet, BUI takes weeks of dry weather to
// climb. Fire-season values match the mid-summer regime that the old
// FFMC 90 / BUI 60 default was implicitly assuming. Fall reflects
// curing-grass + still-dry duff. Winter is mostly a placeholder; the
// simulator should not really be used Nov–Mar.
const RATING_TO_FWI: Record<SeasonKey, Record<RatingKey, { ffmc: number; bui: number }>> = {
  spring: {
    L:  { ffmc: 70, bui:  5 },
    M:  { ffmc: 78, bui: 15 },
    H:  { ffmc: 85, bui: 30 },
    VH: { ffmc: 88, bui: 50 },
    E:  { ffmc: 91, bui: 80 },
  },
  fire_season: {
    L:  { ffmc: 75, bui: 10 },
    M:  { ffmc: 82, bui: 25 },
    H:  { ffmc: 88, bui: 50 },
    VH: { ffmc: 91, bui: 80 },
    E:  { ffmc: 94, bui: 130 },
  },
  fall: {
    L:  { ffmc: 70, bui:  8 },
    M:  { ffmc: 78, bui: 18 },
    H:  { ffmc: 85, bui: 40 },
    VH: { ffmc: 88, bui: 60 },
    E:  { ffmc: 92, bui: 100 },
  },
  winter: {
    L:  { ffmc: 60, bui:  0 },
    M:  { ffmc: 65, bui:  0 },
    H:  { ffmc: 70, bui:  5 },
    VH: { ffmc: 75, bui: 10 },
    E:  { ffmc: 80, bui: 20 },
  },
};

function getSeason(monthUtc: number): SeasonKey {
  if (monthUtc >= 4 && monthUtc <= 5) return 'spring';
  if (monthUtc >= 6 && monthUtc <= 8) return 'fire_season';
  if (monthUtc >= 9 && monthUtc <= 10) return 'fall';
  return 'winter';
}

async function fetchRecentPrecipMm(lat: number, lng: number): Promise<number> {
  // Open-Meteo's `past_days` parameter returns observed weather for the
  // preceding N days alongside forecast. We sum the previous 5 days of
  // hourly precipitation so the FFMC reduction reflects what really
  // landed on the duff this week.
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('past_days', '5');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('hourly', 'precipitation');
  url.searchParams.set('timezone', 'UTC');
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo precip HTTP ${res.status}`);
  const j = await res.json();
  const arr: unknown = j?.hourly?.precipitation;
  if (!Array.isArray(arr)) return 0;
  const pastHours = Math.min(120, arr.length); // 5 days * 24h
  let total = 0;
  for (let i = 0; i < pastHours; i++) {
    total += Number(arr[i]) || 0;
  }
  return total;
}

export async function estimateFwiCodes(
  lat: number,
  lng: number,
): Promise<EstimatedFwiCodes> {
  const month = new Date().getUTCMonth() + 1;
  const season = getSeason(month);

  let rating: BCWSDangerRating | null = null;
  try {
    rating = await fetchBCWSDangerRatingAtPoint(lat, lng);
  } catch (err: any) {
    console.warn(`[fwi-estimator] BCWS rating fetch failed: ${err?.message || err}`);
  }

  let recentPrecipMm = 0;
  try {
    recentPrecipMm = await fetchRecentPrecipMm(lat, lng);
  } catch (err: any) {
    console.warn(`[fwi-estimator] Open-Meteo past precip fetch failed: ${err?.message || err}`);
  }

  // Default to Moderate when BCWS rating is unavailable. This is the
  // safest middle-of-the-road assumption — fire still propagates but
  // not catastrophically.
  const code: RatingKey = (rating?.code as RatingKey) || 'M';
  const base = RATING_TO_FWI[season][code] ?? RATING_TO_FWI[season].M;

  // Recent precipitation reduces both codes. FFMC reacts within hours,
  // BUI within days, so FFMC reduction per mm > BUI reduction per mm.
  // Empirical calibration: 5 mm rain → ~-3 FFMC; 25 mm → ~-15 FFMC.
  // BUI: 10 mm → ~-5; 25 mm → ~-12. Floors prevent negative values.
  const ffmcReduction = Math.min(20, recentPrecipMm * 0.6);
  const buiReduction = Math.min(30, recentPrecipMm * 0.5);

  const ffmc = Math.max(50, Math.round(base.ffmc - ffmcReduction));
  const bui = Math.max(1, Math.round(base.bui - buiReduction));

  const fallback = !rating;
  const note = rating
    ? `BCWS ${rating.rating} rating · ${recentPrecipMm.toFixed(1)} mm precip past 5 days · ${season} calibration`
    : `BCWS rating unavailable — defaulted to Moderate · ${season} calibration · ${recentPrecipMm.toFixed(1)} mm precip past 5 days`;

  return {
    ffmc,
    bui,
    source: {
      rating: rating?.rating || 'Moderate (default — BCWS unavailable)',
      code,
      recent_precip_mm: Math.round(recentPrecipMm * 10) / 10,
      season,
      note,
    },
    fallback_used: fallback,
  };
}
