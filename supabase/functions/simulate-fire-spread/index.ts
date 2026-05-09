/**
 * Public Wildfire Portal — fire spread simulation endpoint.
 *
 * Phase B (current): live Open-Meteo hourly weather + DEM-driven
 * per-cell slope. Falls back to manual weather snapshot when caller
 * sets weather_mode='manual' or when Open-Meteo is unavailable.
 *
 * Request body:
 *   {
 *     "lat":             56.0,
 *     "lng":            -121.0,
 *     "ignition_time":   "2026-05-03T13:00:00Z",  // optional, default = now
 *     "duration_hours":  48,                      // optional, 1..72
 *     "weather_mode":    "forecast" | "manual",   // optional, default 'forecast'
 *     "weather": {                                // used in 'manual' mode
 *       "tempC":   22, "rhPct":  35,
 *       "windKph": 20, "windDir": 270,
 *       "ffmc":    90, "bui":    60
 *     }
 *   }
 *
 * Response: GeoJSON FeatureCollection (one polygon per checkpoint hour)
 * + a `metadata` object documenting model parameters and limitations.
 */

import { simulateSpread, type HourlyWeatherSlice } from "../_shared/fire-spread-engine.ts";
import { DEFAULT_FUEL } from "../_shared/fbp-fuel.ts";
import { fetchHourlyForecast, fetchElevations, bilinearInterp } from "../_shared/open-meteo-data.ts";
import { estimateFwiCodes, type EstimatedFwiCodes } from "../_shared/fwi-estimator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  lat?: unknown;
  lng?: unknown;
  ignition_time?: unknown;
  duration_hours?: unknown;
  weather_mode?: unknown;
  weather?: {
    tempC?: unknown;
    rhPct?: unknown;
    windKph?: unknown;
    windDir?: unknown;
    ffmc?: unknown;
    bui?: unknown;
  };
  /**
   * Optional starting perimeter (GeoJSON Polygon). When provided, the
   * simulator seeds every cell inside the polygon as already-burning
   * at t=0 and propagates outward — projecting an existing BCWS fire
   * forward in time rather than starting from a single ignition point.
   * Coordinates: [lng, lat] pairs, GeoJSON convention.
   *   { "type": "Polygon", "coordinates": [[[lng,lat],[lng,lat],...]] }
   * The lat/lng fields above are still required and used as the grid
   * center (typically the polygon centroid; the UI computes this).
   */
  ignition_perimeter?: {
    type?: string;
    coordinates?: unknown;
  } | null;
}

const DEFAULT_WEATHER = {
  tempC: 22, rhPct: 35,
  windKph: 20, windDir: 270,
  ffmc: 90, bui: 60,
};

const CELL_SIZE_M = 250;
const GRID_RADIUS_M = 30000;
const N_CELLS = Math.ceil(GRID_RADIUS_M * 2 / CELL_SIZE_M);
// Coarse stride for elevation sampling — every 20th cell = 5 km between
// sample points. Open-Meteo elevation API rate-limits after ~5 rapid
// calls, so we cap total samples at ~169 (2 batches at 100 each).
// At 250m cell scale, Copernicus DEM (~30m) already over-samples; the
// interpolation loss between 5km samples is small for fire-spread use.
const ELEV_STRIDE = 20;

function num(v: unknown, def: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return def;
}

function repeatSnapshot(snap: HourlyWeatherSlice, hours: number): HourlyWeatherSlice[] {
  const out: HourlyWeatherSlice[] = new Array(hours);
  for (let i = 0; i < hours; i++) out[i] = { ...snap };
  return out;
}

/**
 * Build a slope-percent grid covering N_CELLS × N_CELLS cells. Sample
 * elevations at every ELEV_STRIDE-th cell from Open-Meteo, bilinearly
 * interpolate to fill the grid, then compute slope magnitude per cell
 * via central-difference gradient. Returns null on any fetch failure
 * — caller falls back to flat terrain.
 */
async function buildSlopeGrid(
  centerLat: number,
  centerLng: number,
): Promise<{ slopeGrid: Float32Array; elevMin: number; elevMax: number } | null> {
  try {
    const center = N_CELLS >> 1;
    const cosLat = Math.cos(centerLat * Math.PI / 180);

    // Coarse sample grid: every ELEV_STRIDE cells, plus the boundary.
    const coarseW = Math.ceil(N_CELLS / ELEV_STRIDE) + 1;
    const coarseH = coarseW;
    const coarseLats: number[] = [];
    const coarseLngs: number[] = [];
    for (let cy = 0; cy < coarseH; cy++) {
      for (let cx = 0; cx < coarseW; cx++) {
        const cellX = Math.min(N_CELLS - 1, cx * ELEV_STRIDE);
        const cellY = Math.min(N_CELLS - 1, cy * ELEV_STRIDE);
        const dxM = (cellX - center) * CELL_SIZE_M;
        const dyM = (center - cellY) * CELL_SIZE_M;
        coarseLats.push(centerLat + dyM / 111320);
        coarseLngs.push(centerLng + dxM / (111320 * cosLat));
      }
    }

    const elevations = await fetchElevations(coarseLats, coarseLngs);
    if (elevations.length !== coarseLats.length) return null;

    // Bilinearly interpolate elevation to every fine cell.
    const fineElev = new Float32Array(N_CELLS * N_CELLS);
    for (let y = 0; y < N_CELLS; y++) {
      for (let x = 0; x < N_CELLS; x++) {
        const cx = x / ELEV_STRIDE;
        const cy = y / ELEV_STRIDE;
        fineElev[y * N_CELLS + x] = bilinearInterp(elevations, coarseW, coarseH, cx, cy);
      }
    }

    // Slope per cell via central-difference gradient. dE/dx and dE/dy
    // in metres/cell — divide by cell size to get rise/run, then *100.
    const slope = new Float32Array(N_CELLS * N_CELLS);
    let elevMin = Infinity;
    let elevMax = -Infinity;
    for (let y = 0; y < N_CELLS; y++) {
      for (let x = 0; x < N_CELLS; x++) {
        const idx = y * N_CELLS + x;
        const e = fineElev[idx];
        if (e < elevMin) elevMin = e;
        if (e > elevMax) elevMax = e;
        const xPrev = x === 0 ? x : x - 1;
        const xNext = x === N_CELLS - 1 ? x : x + 1;
        const yPrev = y === 0 ? y : y - 1;
        const yNext = y === N_CELLS - 1 ? y : y + 1;
        const dEx = (fineElev[y * N_CELLS + xNext] - fineElev[y * N_CELLS + xPrev]) / ((xNext - xPrev) * CELL_SIZE_M);
        const dEy = (fineElev[yNext * N_CELLS + x] - fineElev[yPrev * N_CELLS + x]) / ((yNext - yPrev) * CELL_SIZE_M);
        const grad = Math.sqrt(dEx * dEx + dEy * dEy);
        slope[idx] = grad * 100; // percent
      }
    }
    return { slopeGrid: slope, elevMin, elevMax };
  } catch (err: any) {
    console.warn(`[simulate-fire-spread] slope grid fetch failed: ${err?.message || err}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as RequestBody;

    const lat = num(body?.lat, NaN);
    const lng = num(body?.lng, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return new Response(
        JSON.stringify({ error: "lat and lng are required (numeric)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ignitionTime = typeof body?.ignition_time === "string" && body.ignition_time
      ? body.ignition_time
      : new Date().toISOString();

    let durationHours = num(body?.duration_hours, 48);
    durationHours = Math.max(1, Math.min(72, durationHours));

    const requestedMode = body?.weather_mode === "manual" ? "manual" : "forecast";
    // Track whether the caller explicitly supplied FFMC/BUI vs. let
    // them default. In forecast mode without explicit values we
    // back-derive from BCWS rating + recent precip (see
    // _shared/fwi-estimator.ts) so we don't apply mid-summer drought
    // defaults to spring/post-snowmelt conditions.
    const userSuppliedFfmc =
      body?.weather?.ffmc !== undefined && body?.weather?.ffmc !== null && body?.weather?.ffmc !== "";
    const userSuppliedBui =
      body?.weather?.bui !== undefined && body?.weather?.bui !== null && body?.weather?.bui !== "";
    const manualWeather = {
      tempC:   num(body?.weather?.tempC,   DEFAULT_WEATHER.tempC),
      rhPct:   num(body?.weather?.rhPct,   DEFAULT_WEATHER.rhPct),
      windKph: num(body?.weather?.windKph, DEFAULT_WEATHER.windKph),
      windDir: num(body?.weather?.windDir, DEFAULT_WEATHER.windDir),
      ffmc:    num(body?.weather?.ffmc,    DEFAULT_WEATHER.ffmc),
      bui:     num(body?.weather?.bui,     DEFAULT_WEATHER.bui),
    };

    let hourlyWeather: HourlyWeatherSlice[];
    let actualMode: "forecast" | "manual" = requestedMode;
    let forecastError: string | null = null;
    let ffmc = manualWeather.ffmc;
    let bui = manualWeather.bui;
    let fwiSource: EstimatedFwiCodes['source'] | null = null;
    let fwiEstimateError: string | null = null;

    if (requestedMode === "forecast") {
      try {
        const tFetchStart = Date.now();
        const forecast = await fetchHourlyForecast(lat, lng, durationHours);
        if (forecast.length < 1) throw new Error("Empty forecast response");
        hourlyWeather = forecast.map((w) => ({
          time: w.time,
          tempC: w.tempC, rhPct: w.rhPct,
          windKph: w.windKph, windDir: w.windDir,
          precipMm: w.precipMm,
        }));
        // Pad to durationHours if forecast came up short.
        while (hourlyWeather.length < durationHours) {
          hourlyWeather.push(hourlyWeather[hourlyWeather.length - 1]);
        }
        console.log(`[simulate-fire-spread] forecast fetched (${hourlyWeather.length}h) in ${Date.now() - tFetchStart}ms`);
      } catch (err: any) {
        forecastError = err?.message || String(err);
        console.warn(`[simulate-fire-spread] forecast failed, degrading to manual: ${forecastError}`);
        actualMode = "manual";
        hourlyWeather = repeatSnapshot({
          tempC: manualWeather.tempC, rhPct: manualWeather.rhPct,
          windKph: manualWeather.windKph, windDir: manualWeather.windDir,
          precipMm: 0,
        }, durationHours);
      }
    } else {
      hourlyWeather = repeatSnapshot({
        tempC: manualWeather.tempC, rhPct: manualWeather.rhPct,
        windKph: manualWeather.windKph, windDir: manualWeather.windDir,
        precipMm: 0,
      }, durationHours);
    }

    // FFMC/BUI back-derivation. Only fires in forecast mode and only
    // when the caller did NOT explicitly supply values. The defaults
    // (90/60) are mid-summer drought levels — applying them in
    // spring/post-snowmelt produced wildly aggressive projections
    // (operator caught this on a Mile-132 Alaska Hwy run May 2026).
    // Now we pull the BCWS official danger rating at the ignition
    // point + last 5 days of precipitation from Open-Meteo and map to
    // a season-aware FFMC/BUI table.
    if (actualMode === "forecast" && (!userSuppliedFfmc || !userSuppliedBui)) {
      const tFwiStart = Date.now();
      try {
        const est = await estimateFwiCodes(lat, lng);
        if (!userSuppliedFfmc) ffmc = est.ffmc;
        if (!userSuppliedBui) bui = est.bui;
        fwiSource = est.source;
        console.log(`[simulate-fire-spread] FWI estimate FFMC=${est.ffmc} BUI=${est.bui} in ${Date.now() - tFwiStart}ms (${est.source.note})`);
      } catch (err: any) {
        fwiEstimateError = err?.message || String(err);
        console.warn(`[simulate-fire-spread] FWI estimate failed, keeping defaults: ${fwiEstimateError}`);
      }
    }

    // Slope grid is best-effort. Always attempt it (worth ~1-3s of
    // fetch latency for the meaningful improvement in spread fidelity).
    const tSlopeStart = Date.now();
    const slope = await buildSlopeGrid(lat, lng);
    const slopeMs = Date.now() - tSlopeStart;
    if (slope) {
      console.log(`[simulate-fire-spread] slope grid built (elev ${slope.elevMin.toFixed(0)}-${slope.elevMax.toFixed(0)}m) in ${slopeMs}ms`);
    }

    // Parse optional starting perimeter. Validates the GeoJSON shape
    // and pulls the outer ring as [lng, lat] pairs the engine expects.
    // Bad input (wrong type / fewer than 3 points / non-numeric coords)
    // falls through to point ignition with a warning rather than failing
    // — operators should still get a simulation when they pass a
    // malformed polygon.
    let ignitionPerimeter: Array<[number, number]> | undefined;
    let ignitionPerimeterError: string | null = null;
    const rawPerim = body?.ignition_perimeter;
    if (rawPerim && typeof rawPerim === "object") {
      const coords = (rawPerim as any).coordinates;
      const type = (rawPerim as any).type;
      if (type !== "Polygon") {
        ignitionPerimeterError = `ignition_perimeter.type must be 'Polygon' (got '${type}'). Falling back to point ignition.`;
      } else if (!Array.isArray(coords) || !Array.isArray(coords[0])) {
        ignitionPerimeterError = "ignition_perimeter.coordinates must be a polygon ring array. Falling back to point ignition.";
      } else {
        const ring = coords[0] as unknown[];
        const parsed: Array<[number, number]> = [];
        for (const pt of ring) {
          if (!Array.isArray(pt) || pt.length < 2) continue;
          const [lngVal, latVal] = pt as number[];
          if (Number.isFinite(lngVal) && Number.isFinite(latVal)) {
            parsed.push([Number(lngVal), Number(latVal)]);
          }
        }
        if (parsed.length < 3) {
          ignitionPerimeterError = `ignition_perimeter ring needs >= 3 valid points (got ${parsed.length}). Falling back to point ignition.`;
        } else {
          ignitionPerimeter = parsed;
          console.log(`[simulate-fire-spread] perimeter ignition: ${parsed.length}-vertex ring`);
        }
      }
      if (ignitionPerimeterError) console.warn(`[simulate-fire-spread] ${ignitionPerimeterError}`);
    }

    const tSimStart = Date.now();
    const result = simulateSpread({
      ignitionLat: lat,
      ignitionLng: lng,
      ignitionTime,
      durationHours,
      ignitionPerimeter,
      hourlyWeather,
      ffmc,
      bui,
      fuel: DEFAULT_FUEL,
      slopeGrid: slope?.slopeGrid,
      weatherMode: actualMode,
    });
    const simMs = Date.now() - tSimStart;

    const features = result.checkpoints.map((c) => ({
      type: "Feature" as const,
      properties: {
        hour: c.hour,
        area_ha: Math.round(c.area_ha * 10) / 10,
        perimeter_km: Math.round(c.perimeter_km * 10) / 10,
        max_intensity_kw_per_m: c.max_intensity_kw_per_m,
        label: `${c.hour}h — ${Math.round(c.area_ha).toLocaleString()} ha`,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [c.polygon],
      },
    }));

    const response = {
      type: "FeatureCollection",
      metadata: {
        ...result.metadata,
        compute_ms: simMs,
        slope_fetch_ms: slope ? slopeMs : null,
        elevation_range_m: slope ? { min: Math.round(slope.elevMin), max: Math.round(slope.elevMax) } : null,
        forecast_error: forecastError,
        requested_mode: requestedMode,
        // Final FFMC/BUI used by the engine + where they came from.
        // UI surfaces this so the operator sees that "Live Forecast"
        // mode actually reflects today's BCWS rating + recent rain
        // instead of the old mid-summer defaults.
        ffmc_used: ffmc,
        bui_used: bui,
        ffmc_user_supplied: userSuppliedFfmc,
        bui_user_supplied: userSuppliedBui,
        fwi_source: fwiSource,
        fwi_estimate_error: fwiEstimateError,
        ignition_perimeter_error: ignitionPerimeterError,
      },
      features,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[simulate-fire-spread] unhandled:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
