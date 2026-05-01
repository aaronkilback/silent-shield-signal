/**
 * Wildfire-specific agent tools — same upstream sources used by
 * generate-wildfire-daily-report. Registering them here makes them
 * available to ANY agent on the next deploy of any function that
 * imports agent-tools-core.ts.
 *
 * Sources:
 *   • CWFIS WFS (NRCan) — active fire hotspots, perimeters, lightning
 *   • Open-Meteo — daily weather + estimated FWI (Fire Weather Index)
 *   • Environment Canada MSC — AQHI observations + forecast
 *   • Open-Meteo Geocoding — name → coords
 */

import { registerTool, type ToolHandler } from "./agent-tools.ts";

const CWFIS_WFS = "https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs";

// ── Helpers ──────────────────────────────────────────────────────────
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// FWI estimator copy of the one in generate-wildfire-daily-report
// (kept identical so the chat tools and the report agree when given
// the same inputs).
function estimateFwi(tempC: number, rhPct: number, windKmh: number, precipMm: number): number {
  const dryness = Math.max(0, 100 - rhPct) / 100;
  const heat = Math.max(0, tempC - 5) / 30;
  const wind = Math.min(1, windKmh / 30);
  const wet = Math.max(0, 1 - precipMm / 5);
  const raw = (dryness * 50 + heat * 30 + wind * 20) * wet;
  return Math.round(Math.max(0, Math.min(80, raw)));
}

function fwiDanger(fwi: number): string {
  if (fwi < 8) return "Low";
  if (fwi < 17) return "Moderate";
  if (fwi < 30) return "High";
  if (fwi < 50) return "Very High";
  return "Extreme";
}

function aqhiCategory(v: number | null): string {
  if (v == null) return "Unavailable";
  if (v <= 3) return "Low";
  if (v <= 6) return "Moderate";
  if (v <= 10) return "High";
  return "Very High";
}

// ── 1. lookup_location_coords ────────────────────────────────────────
const lookupLocationCoords: ToolHandler = {
  name: "lookup_location_coords",
  description:
    "Converts a place name (e.g. 'Fort St. John, BC' or 'Kitimat') into latitude/longitude. Use BEFORE any geo-scoped wildfire tool when the operator gives a name. Free Open-Meteo geocoding; no API key.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Place name to geocode." },
      country: { type: "string", description: "ISO country code (e.g. 'CA'). Optional but recommended." },
    },
    required: ["name"],
  },
  execute: async (args: any) => {
    const rawName = String(args?.name || "").trim();
    if (!rawName) return { error: "name required" };

    // Open-Meteo geocoding silently returns no results for fully-
    // qualified names like "Fort St. John, BC" — the trailing region
    // qualifier kills the match. Try the full string first, then fall
    // back to just the head segment (everything before the first
    // comma) and finally to the country-stripped name.
    const candidates = [rawName];
    const head = rawName.split(",")[0]?.trim();
    if (head && head !== rawName) candidates.push(head);

    const country = args?.country ? String(args.country) : "CA";

    const tryOne = async (q: string) => {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("name", q);
      url.searchParams.set("count", "3");
      url.searchParams.set("language", "en");
      url.searchParams.set("format", "json");
      if (country) url.searchParams.set("countryCode", country);
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return { httpError: r.status, results: [] as any[] };
      const j = await r.json();
      return { httpError: null, results: Array.isArray(j?.results) ? j.results : [] };
    };

    try {
      let lastHttp: number | null = null;
      let used: string | null = null;
      let results: any[] = [];
      for (const q of candidates) {
        const out = await tryOne(q);
        if (out.httpError) lastHttp = out.httpError;
        if (out.results.length > 0) {
          used = q;
          results = out.results;
          break;
        }
      }
      const top = results.slice(0, 3).map((g: any) => ({
        name: g.name,
        admin1: g.admin1,
        country: g.country_code,
        lat: g.latitude,
        lng: g.longitude,
      }));
      if (top.length === 0) {
        return {
          name: rawName,
          found: false,
          tried: candidates,
          http_error: lastHttp,
          hint:
            "If the operator's location is well-known, try common aliases (e.g. 'Fort St. John' instead of 'Fort St. John, BC'). For Petronas Canada operations, key locations: Fort St. John 56.25,-120.85 · Kitimat 54.05,-128.65 · Dawson Creek 55.76,-120.24 · Fort Nelson 58.81,-122.70.",
        };
      }
      return { name: rawName, found: true, matched_query: used, matches: top, primary: top[0] };
    } catch (e: any) {
      return { error: e?.message || "geocoding failed", name: rawName };
    }
  },
};

// Build a CWFIS-style BBOX (minLon,minLat,maxLon,maxLat) from a center
// point + radius. Server-side filtering keeps payloads small.
function bboxFromCircle(lat: number, lng: number, radiusKm: number): string {
  const latDeg = radiusKm / 111;
  const lngDeg = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  return `${lng - lngDeg},${lat - latDeg},${lng + lngDeg},${lat + latDeg}`;
}

// ── 2. get_wildfire_hotspots_near ────────────────────────────────────
const getWildfireHotspotsNear: ToolHandler = {
  name: "get_wildfire_hotspots_near",
  description:
    "Returns CWFIS active wildfire hotspots from the last 24h within `radius_km` of (lat, lng). Same VIIRS/MODIS feed monitor-wildfires and the wildfire daily report use. Each hotspot is pre-enriched by NRCan with FRP (fire radiative power, MW), HFI (head fire intensity, kW/m), ROS (rate of spread, m/min), FWI, and fuel type. Flaring signature: high FRP + low HFI (<500 kW/m) + low FWI (<8) + close to known facility. Wildfire signature: HFI > 500 kW/m, ROS > 0, fuel_type set.",
  parameters: {
    type: "object",
    properties: {
      lat: { type: "number", description: "Latitude." },
      lng: { type: "number", description: "Longitude." },
      radius_km: { type: "number", description: "Search radius in km. Default 50." },
    },
    required: ["lat", "lng"],
  },
  execute: async (args: any) => {
    const lat = Number(args?.lat);
    const lng = Number(args?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "lat/lng required" };
    const radiusKm = Number(args?.radius_km || 50);
    const bbox = bboxFromCircle(lat, lng, radiusKm);
    const url =
      `${CWFIS_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeName=public:hotspots_last24hrs&outputFormat=application/json` +
      `&BBOX=${bbox},EPSG:4326&srsName=EPSG:4326&count=150`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return { error: `CWFIS HTTP ${r.status}` };
      const j = await r.json();
      const features = j?.features ?? [];
      const within = features
        .map((f: any) => {
          const p = f.properties || {};
          const c = f.geometry?.coordinates ?? [];
          // Prefer properties.lat/lon (always lat/lng); fall back to
          // geometry only if srsName worked.
          const fLat = Number.isFinite(p.lat) ? p.lat : c[1];
          const fLng = Number.isFinite(p.lon) ? p.lon : c[0];
          if (!Number.isFinite(fLat) || !Number.isFinite(fLng)) return null;
          const distance_km = haversineKm({ lat, lng }, { lat: fLat, lng: fLng });
          if (distance_km > radiusKm) return null;
          return {
            lat: fLat,
            lng: fLng,
            distance_km: Math.round(distance_km * 10) / 10,
            frp_mw: p.frp ?? null,
            hfi_kw_per_m: p.hfi ?? null,
            ros_m_per_min: p.ros ?? null,
            fwi: p.fwi ?? null,
            fuel_type: p.fuel_type ?? p.fuel ?? null,
            estimated_area_ha: p.estarea ?? null,
            within_perimeter: !!p.within_perimeter,
            sensor: p.sensor ?? null,
            agency: p.agency ?? null,
            detected_at: p.rep_date ?? p.hotspot_time ?? null,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.distance_km - b.distance_km);
      return {
        radius_km: radiusKm,
        center: { lat, lng },
        count: within.length,
        hotspots: within.slice(0, 25),
      };
    } catch (e: any) {
      return { error: e?.message || "CWFIS fetch failed" };
    }
  },
};

// ── 3. get_active_fire_perimeters_near ───────────────────────────────
const getActiveFirePerimetersNear: ToolHandler = {
  name: "get_active_fire_perimeters_near",
  description:
    "Returns CWFIS m3_polygons_current (active fire perimeters) near a location. Use to determine if a hotspot has matured into a perimeter-tracked fire (i.e. agencies are actively managing it).",
  parameters: {
    type: "object",
    properties: {
      lat: { type: "number" },
      lng: { type: "number" },
      radius_km: { type: "number", description: "Default 100." },
    },
    required: ["lat", "lng"],
  },
  execute: async (args: any) => {
    const lat = Number(args?.lat);
    const lng = Number(args?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "lat/lng required" };
    const radiusKm = Number(args?.radius_km || 100);
    const bbox = bboxFromCircle(lat, lng, radiusKm);
    const url =
      `${CWFIS_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeName=public:m3_polygons_current&outputFormat=application/json` +
      `&BBOX=${bbox},EPSG:4326&srsName=EPSG:4326&count=100`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return { error: `CWFIS HTTP ${r.status}` };
      const j = await r.json();
      const features = j?.features ?? [];
      // Polygons have arrays of arrays — take centroid (rough average) for distance check.
      const within = features
        .map((f: any) => {
          const props = f.properties || {};
          const geomType = f.geometry?.type;
          const rawCoords = f.geometry?.coordinates;
          // Polygon → coords[0] is outer ring of [[lng,lat], ...].
          // MultiPolygon → coords[0][0] is outer ring of first polygon.
          let outerRing: any[] | null = null;
          if (geomType === "Polygon" && Array.isArray(rawCoords)) {
            outerRing = rawCoords[0];
          } else if (geomType === "MultiPolygon" && Array.isArray(rawCoords)) {
            outerRing = rawCoords[0]?.[0];
          }
          if (!Array.isArray(outerRing) || outerRing.length === 0) return null;
          let sumLat = 0;
          let sumLng = 0;
          let n = 0;
          for (const pt of outerRing) {
            if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
              sumLng += pt[0];
              sumLat += pt[1];
              n++;
            }
          }
          if (n === 0) return null;
          const cLat = sumLat / n;
          const cLng = sumLng / n;
          const distance_km = haversineKm({ lat, lng }, { lat: cLat, lng: cLng });
          if (distance_km > radiusKm) return null;
          return {
            centroid: { lat: cLat, lng: cLng },
            distance_km: Math.round(distance_km * 10) / 10,
            area_ha: props.poly_ha ?? props.area_ha ?? null,
            firstdate: props.firstdate ?? null,
            lastdate: props.lastdate ?? null,
            agency: props.agency ?? null,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.distance_km - b.distance_km);
      return {
        radius_km: radiusKm,
        center: { lat, lng },
        count: within.length,
        perimeters: within.slice(0, 10),
      };
    } catch (e: any) {
      return { error: e?.message || "CWFIS fetch failed" };
    }
  },
};

// ── 4. get_lightning_strikes_near ────────────────────────────────────
const getLightningStrikesNear: ToolHandler = {
  name: "get_lightning_strikes_near",
  description:
    "Returns BCLDN/CWFIS cloud-to-ground lightning strikes from the last 24h within `radius_km` of (lat, lng). Latent-ignition risk — strikes without a corresponding hotspot can smoulder for 24-72 hours before becoming visible fires.",
  parameters: {
    type: "object",
    properties: {
      lat: { type: "number" },
      lng: { type: "number" },
      radius_km: { type: "number", description: "Default 50." },
    },
    required: ["lat", "lng"],
  },
  execute: async (args: any) => {
    const lat = Number(args?.lat);
    const lng = Number(args?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "lat/lng required" };
    const radiusKm = Number(args?.radius_km || 50);
    const bbox = bboxFromCircle(lat, lng, radiusKm);
    const url =
      `${CWFIS_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeName=public:lightning_obs_24h&outputFormat=application/json` +
      `&BBOX=${bbox},EPSG:4326&srsName=EPSG:4326&count=200`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return { error: `CWFIS HTTP ${r.status}`, hint: "BCLDN can be intermittently unavailable." };
      const j = await r.json();
      const features = j?.features ?? [];
      const within = features
        .map((f: any) => {
          const props = f.properties || {};
          const c = f.geometry?.coordinates ?? [];
          const sLat = Number.isFinite(props.lat) ? props.lat : c[1];
          const sLng = Number.isFinite(props.lon) ? props.lon : c[0];
          if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return null;
          const distance_km = haversineKm({ lat, lng }, { lat: sLat, lng: sLng });
          if (distance_km > radiusKm) return null;
          return {
            lat: sLat,
            lng: sLng,
            distance_km: Math.round(distance_km * 10) / 10,
            polarity: props.polarity ?? null, // -1 negative, +1 positive
            time: props.stroke_time ?? props.time ?? props.obs_time ?? null,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.distance_km - b.distance_km);
      const positive = within.filter((s: any) => Number(s.polarity) > 0).length;
      return {
        radius_km: radiusKm,
        center: { lat, lng },
        count: within.length,
        positive_strikes: positive,
        strikes: within.slice(0, 30),
        note:
          "Positive strokes are higher-energy and more frequently linked to ignitions. Cross-reference against get_wildfire_hotspots_near for latent-ignition risk.",
      };
    } catch (e: any) {
      return { error: e?.message || "BCLDN fetch failed" };
    }
  },
};

// ── 5. get_fire_weather_index ────────────────────────────────────────
const getFireWeatherIndex: ToolHandler = {
  name: "get_fire_weather_index",
  description:
    "Returns today's estimated Fire Weather Index (FWI) and 3-day forecast for a location, derived from Open-Meteo daily weather. Same estimator the wildfire daily report uses. FWI thresholds: <8 Low · 8–16 Moderate · 17–29 High · 30–49 Very High · >=50 Extreme.",
  parameters: {
    type: "object",
    properties: {
      lat: { type: "number" },
      lng: { type: "number" },
    },
    required: ["lat", "lng"],
  },
  execute: async (args: any) => {
    const lat = Number(args?.lat);
    const lng = Number(args?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "lat/lng required" };
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set(
      "daily",
      [
        "temperature_2m_max",
        "relative_humidity_2m_min",
        "wind_speed_10m_max",
        "wind_direction_10m_dominant",
        "precipitation_sum",
      ].join(",")
    );
    url.searchParams.set("timezone", "America/Vancouver");
    url.searchParams.set("forecast_days", "4");
    try {
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { error: `Open-Meteo HTTP ${r.status}` };
      const j = await r.json();
      const d = j?.daily;
      if (!d) return { error: "no daily data" };
      const today = {
        temp_max_c: d.temperature_2m_max?.[0] ?? null,
        rh_min_pct: d.relative_humidity_2m_min?.[0] ?? null,
        wind_max_kmh: d.wind_speed_10m_max?.[0] ?? null,
        wind_dir_deg: d.wind_direction_10m_dominant?.[0] ?? null,
        precip_mm: d.precipitation_sum?.[0] ?? null,
      };
      const fwi = estimateFwi(
        today.temp_max_c ?? 0,
        today.rh_min_pct ?? 50,
        today.wind_max_kmh ?? 0,
        today.precip_mm ?? 0
      );
      const forecast = [1, 2, 3].map((i) => {
        const f = estimateFwi(
          d.temperature_2m_max?.[i] ?? 0,
          d.relative_humidity_2m_min?.[i] ?? 50,
          d.wind_speed_10m_max?.[i] ?? 0,
          d.precipitation_sum?.[i] ?? 0
        );
        return {
          date: d.time?.[i] ?? null,
          fwi: f,
          danger: fwiDanger(f),
          temp_max_c: d.temperature_2m_max?.[i] ?? null,
          precip_mm: d.precipitation_sum?.[i] ?? null,
        };
      });
      return {
        location: { lat, lng },
        today: { ...today, fwi, danger: fwiDanger(fwi) },
        forecast,
        thresholds: "Low<8 · Moderate 8–16 · High 17–29 · Very High 30–49 · Extreme ≥50",
      };
    } catch (e: any) {
      return { error: e?.message || "Open-Meteo fetch failed" };
    }
  },
};

// ── 6. get_air_quality_index ────────────────────────────────────────
const getAirQualityIndex: ToolHandler = {
  name: "get_air_quality_index",
  description:
    "Returns Environment Canada AQHI (Air Quality Health Index) observations + forecast for a community. Useful when wildfire smoke might be impacting air quality. Defaults to BC_FSJ (Fort St. John). Other Canadian community codes work — try BC_VAN (Vancouver), BC_PRG (Prince George), AB_CAL (Calgary), etc.",
  parameters: {
    type: "object",
    properties: {
      community_code: {
        type: "string",
        description: "Environment Canada community code, e.g. 'BC_FSJ'. Default 'BC_FSJ'.",
      },
    },
  },
  execute: async (args: any) => {
    const code = String(args?.community_code || "BC_FSJ");
    try {
      const obs = await fetch(
        `https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?f=json&sortby=-date_observed&limit=3&location_id=${encodeURIComponent(code)}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!obs.ok) return { error: `MSC HTTP ${obs.status}`, community_code: code };
      const obsJson = await obs.json();
      const latestObs = obsJson?.features?.[0]?.properties;
      const currentRaw = latestObs?.aqhi ?? null;
      const current = currentRaw != null ? Math.round(currentRaw) : null;

      const fcRes = await fetch(
        `https://api.weather.gc.ca/collections/aqhi-forecasts-realtime/items?f=json&sortby=-date_issued&limit=6&location_id=${encodeURIComponent(code)}`,
        { signal: AbortSignal.timeout(6000) }
      );
      const fcJson = fcRes.ok ? await fcRes.json() : null;
      const fcFeatures = fcJson?.features ?? [];
      const forecast = fcFeatures.slice(0, 3).map((f: any) => {
        const p = f.properties ?? {};
        const v = p.aqhi != null ? Math.round(p.aqhi) : null;
        return { period: p.forecast_period ?? "", aqhi: v, category: aqhiCategory(v) };
      });
      return {
        community_code: code,
        current,
        category: aqhiCategory(current),
        observed_at: latestObs?.date_observed ?? null,
        forecast,
      };
    } catch (e: any) {
      return { error: e?.message || "AQHI fetch failed", community_code: code };
    }
  },
};

// ── Register all wildfire tools ──────────────────────────────────────
registerTool(lookupLocationCoords);
registerTool(getWildfireHotspotsNear);
registerTool(getActiveFirePerimetersNear);
registerTool(getLightningStrikesNear);
registerTool(getFireWeatherIndex);
registerTool(getAirQualityIndex);
