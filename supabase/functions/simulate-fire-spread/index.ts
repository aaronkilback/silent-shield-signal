/**
 * Public Wildfire Portal — fire spread simulation endpoint.
 *
 * Phase A (this commit): pure spread engine. Mock weather/topography
 * inputs unless caller supplies them. Returns GeoJSON FeatureCollection
 * with one polygon per checkpoint hour, plus a `metadata` object
 * documenting the model, parameters used, and known limitations.
 *
 * Phase B will swap mock weather for live Open-Meteo hourly forecast
 * + DEM elevation + per-cell hourly time-stepping.
 *
 * verify_jwt=false so the public Wildfire Portal can call it
 * directly. Request schema:
 *
 *   POST /functions/v1/simulate-fire-spread
 *   {
 *     "lat":             56.0,
 *     "lng":            -121.0,
 *     "ignition_time":   "2026-05-03T13:00:00Z",  // optional, default = now
 *     "duration_hours":  48,                      // optional, default 48, max 72
 *     "weather": {                                // optional — Phase A defaults
 *       "tempC":   22, "rhPct":  35,
 *       "windKph": 20, "windDir": 270,
 *       "ffmc":    90, "bui":    60
 *     }
 *   }
 *
 * Response:
 *   {
 *     "type": "FeatureCollection",
 *     "metadata": {...},
 *     "features": [{ "type": "Feature", "properties": {...}, "geometry": {...} }, ...]
 *   }
 */

import { simulateSpread } from "../_shared/fire-spread-engine.ts";
import { DEFAULT_FUEL } from "../_shared/fbp-fuel.ts";

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
  tempC:   22,   // °C  — mid-day fire-season air
  rhPct:   35,   // %   — moderately dry
  windKph: 20,   // 10m wind speed — driving fire spread
  windDir: 270,  // wind FROM the west
  ffmc:    90,   // Fine Fuel Moisture Code — high but not extreme
  bui:     60,   // Build Up Index — average for active fire weather
};

function num(v: unknown, def: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return def;
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

    const weather = {
      tempC:   num(body?.weather?.tempC,   DEFAULT_WEATHER.tempC),
      rhPct:   num(body?.weather?.rhPct,   DEFAULT_WEATHER.rhPct),
      windKph: num(body?.weather?.windKph, DEFAULT_WEATHER.windKph),
      windDir: num(body?.weather?.windDir, DEFAULT_WEATHER.windDir),
      ffmc:    num(body?.weather?.ffmc,    DEFAULT_WEATHER.ffmc),
      bui:     num(body?.weather?.bui,     DEFAULT_WEATHER.bui),
    };

    const tStart = Date.now();
    const result = simulateSpread({
      ignitionLat: lat,
      ignitionLng: lng,
      ignitionTime,
      durationHours,
      weather,
      fuel: DEFAULT_FUEL,
    });
    const compute_ms = Date.now() - tStart;

    // Wrap as a GeoJSON FeatureCollection so the client renders directly
    // on Leaflet without re-shaping. The metadata block stays at the
    // top level (not GeoJSON-spec but commonly tolerated).
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
      metadata: { ...result.metadata, compute_ms },
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
