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

    // Slope grid is best-effort. Always attempt it (worth ~1-3s of
    // fetch latency for the meaningful improvement in spread fidelity).
    const tSlopeStart = Date.now();
    const slope = await buildSlopeGrid(lat, lng);
    const slopeMs = Date.now() - tSlopeStart;
    if (slope) {
      console.log(`[simulate-fire-spread] slope grid built (elev ${slope.elevMin.toFixed(0)}-${slope.elevMax.toFixed(0)}m) in ${slopeMs}ms`);
    }

    const tSimStart = Date.now();
    const result = simulateSpread({
      ignitionLat: lat,
      ignitionLng: lng,
      ignitionTime,
      durationHours,
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
