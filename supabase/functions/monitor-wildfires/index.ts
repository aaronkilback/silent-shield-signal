/**
 * monitor-wildfires
 *
 * Detection source: CWFIS hotspots_last24hrs WFS (Canadian Wildland Fire
 * Information System). Each hotspot is a VIIRS/MODIS satellite detection
 * already enriched by NRCan with:
 *   - Weather from the nearest BC AWS / ECCC station (temp, RH, wind, precip)
 *   - Full FWI components (FFMC, DMC, DC, ISI, BUI, FWI)
 *   - FBP fire behaviour predictions (ROS, HFI, CFB, fuel type, estimated area)
 *   - Elevation, ecozone, estimated burned area
 *
 * Also fetches CWFIS active fire perimeters (m3_polygons_current) to
 * distinguish new ignitions from growth within a known active fire.
 *
 * Industrial flaring: cross-referenced against known oil/gas facilities.
 * Detections within 4km of a known facility → industrial_flaring signal.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

// ── Operational zones — Petronas Canada ──────────────────────────────────────
const OPERATIONAL_ZONES = [
  { minLat: 55.0, maxLat: 60.0, minLon: -125.0, maxLon: -119.0, label: 'Northeast BC (Peace/Montney)' },
  { minLat: 53.0, maxLat: 56.0, minLon: -130.0, maxLon: -125.0, label: 'Skeena/Kitimat corridor' },
  { minLat: 50.5, maxLat: 51.5, minLon: -115.0, maxLon: -113.5, label: 'Calgary region' },
];

// Single BBOX covering all zones (minLon,minLat,maxLon,maxLat — EPSG:4326)
const OPS_BBOX = '-130,50.5,-113,60';

// ── Season detection ─────────────────────────────────────────────────────────
function getFireSeason(): { isFireSeason: boolean; isShoulder: boolean; label: string } {
  const month = new Date().getMonth() + 1; // 1–12 UTC
  if (month >= 5 && month <= 9)  return { isFireSeason: true,  isShoulder: false, label: 'fire season (May–Sep)' };
  if (month === 4 || month === 10) return { isFireSeason: false, isShoulder: true,  label: 'shoulder season' };
  return { isFireSeason: false, isShoulder: false, label: 'off-season (Nov–Mar)' };
}

// ── Known industrial facilities ───────────────────────────────────────────────
const FACILITY_MATCH_KM = 4.0;
const INDUSTRIAL_FACILITIES = [
  { name: 'McMahon Gas Plant',                  lat: 56.218, lon: -120.821, type: 'gas_plant' },
  { name: 'Younger Gas Plant (Spectra)',         lat: 56.312, lon: -121.052, type: 'gas_plant' },
  { name: 'Jedney Gas Plant',                   lat: 56.478, lon: -121.641, type: 'gas_plant' },
  { name: 'Caribou Gas Plant (Progress Energy)', lat: 57.201, lon: -122.480, type: 'gas_plant' },
  { name: 'Lily Gas Plant',                     lat: 57.489, lon: -122.847, type: 'gas_plant' },
  { name: 'Sunrise Gas Plant (Progress Energy)', lat: 58.103, lon: -122.310, type: 'gas_plant' },
  { name: 'Aitken Creek Gas Plant',             lat: 57.680, lon: -122.561, type: 'gas_plant' },
  { name: 'Fort Nelson Gas Plant',              lat: 58.752, lon: -122.711, type: 'gas_plant' },
  { name: 'LNG Canada Terminal',                lat: 54.017, lon: -128.630, type: 'lng_terminal' },
  { name: 'Westcoast Energy Compressor Station', lat: 55.750, lon: -121.150, type: 'compressor' },
  { name: 'Taylor Gas Plant Area',              lat: 56.156, lon: -120.689, type: 'gas_plant' },
  { name: 'Dawson Creek Area Facilities',       lat: 55.760, lon: -120.235, type: 'industrial' },
];

// ── CWFIS hotspot (already FBP-enriched by NRCan) ────────────────────────────
interface CWFISHotspot {
  lat: number;
  lon: number;
  rep_date: string;
  source: string;
  sensor: string;
  satellite: string;
  // Weather from nearest BC AWS / ECCC station
  temp: number;
  rh: number;
  ws: number;        // km/h
  wd: number;        // degrees
  pcp: number;       // mm
  // FWI components
  ffmc: number;
  dmc: number;
  dc: number;
  isi: number;
  bui: number;
  fwi: number;
  // FBP fire behaviour
  fuel: string;      // e.g. "C3", "O1b"
  ros: number;       // rate of spread m/min
  hfi: number;       // head fire intensity kW/m
  cfb: number;       // crown fraction burned 0–100
  tfc: number;       // total fuel consumption kg/m²
  frp: number;       // fire radiative power MW
  estarea: number;   // estimated burned area m²
  elev: number;      // metres
  age: number;       // hours since detection
}

// ── Fetch NASA FIRMS MODIS static-land-source hotspots ───────────────────────
//
// FIRMS MODIS responses include a `type` field that classifies each hotspot:
//   0 = presumed vegetation fire
//   1 = active volcano
//   2 = other static land source (gas flares, industrial heat sources)
//   3 = offshore
//
// We use type=2 to override the heuristic classifier when CWFIS returns a
// hotspot at a location FIRMS has classified as a static gas-flare source.
// This catches flaring sites that are not in the static INDUSTRIAL_FACILITIES
// list — the classifier's previous false positives in NE BC (Peace/Montney)
// were exactly this case: real flare stacks producing high-FRP/high-HFI
// signatures that defeated the off-season-override and proximity rules.
//
// Requires NASA_FIRMS_MAP_KEY (free from https://firms.modaps.eosdis.nasa.gov/api/map_key/).
// Free tier: 5000 transactions / 10 min — well under our load.
//
// Note: VIIRS feeds (VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT) do NOT include the type
// field. Only MODIS_NRT does. So this overlay fixes ~half of false-positives
// (the MODIS-detected ones). The other half (VIIRS-detected) still depend on
// the heuristic rules.
async function fetchFirmsStaticSources(): Promise<Array<{ lat: number; lon: number }>> {
  const mapKey = Deno.env.get('NASA_FIRMS_MAP_KEY');
  if (!mapKey) {
    console.log('[Wildfires] NASA_FIRMS_MAP_KEY not set — skipping static-source overlay');
    return [];
  }

  // OPS_BBOX is "minLon,minLat,maxLon,maxLat" — FIRMS expects "west,south,east,north"
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/MODIS_NRT/${OPS_BBOX}/1`;

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FortressAI/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.warn(`[Wildfires] FIRMS overlay fetch failed: ${resp.status} ${resp.statusText}`);
      return [];
    }
    const csv = await resp.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const typeIdx = headers.indexOf('type');
    if (latIdx < 0 || lonIdx < 0 || typeIdx < 0) {
      console.warn('[Wildfires] FIRMS CSV missing expected columns');
      return [];
    }

    const sources: Array<{ lat: number; lon: number }> = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length <= typeIdx) continue;
      if (cols[typeIdx].trim() !== '2') continue; // only static land sources
      const lat = parseFloat(cols[latIdx]);
      const lon = parseFloat(cols[lonIdx]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        sources.push({ lat, lon });
      }
    }
    console.log(`[Wildfires] FIRMS overlay: ${sources.length} static-source hotspots in zone`);
    return sources;
  } catch (err) {
    console.warn('[Wildfires] FIRMS overlay error:', err instanceof Error ? err.message : err);
    return [];
  }
}

// Match radius for FIRMS overlay — 0.05° ≈ 5.5km at NE BC latitudes
const FIRMS_MATCH_DEG = 0.05;

function isFirmsStaticSource(
  lat: number,
  lon: number,
  staticSources: Array<{ lat: number; lon: number }>,
): boolean {
  for (const s of staticSources) {
    if (Math.abs(s.lat - lat) <= FIRMS_MATCH_DEG && Math.abs(s.lon - lon) <= FIRMS_MATCH_DEG) {
      return true;
    }
  }
  return false;
}

// ── Fetch CWFIS hotspots for operational zones ────────────────────────────────
async function fetchCWFISHotspots(): Promise<CWFISHotspot[]> {
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeName=public:hotspots_last24hrs` +
    `&outputFormat=application/json` +
    `&BBOX=${OPS_BBOX},EPSG:4326` +
    `&srsName=EPSG:4326`;

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'FortressAI/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`CWFIS hotspots WFS error: ${resp.status}`);

  const data = await resp.json();
  const hotspots: CWFISHotspot[] = [];

  for (const feature of data.features ?? []) {
    const p = feature.properties;
    if (!p?.lat || !p?.lon) continue;
    hotspots.push({
      lat: p.lat, lon: p.lon,
      rep_date: p.rep_date ?? '',
      source: p.source ?? 'NASA',
      sensor: p.sensor ?? 'VIIRS',
      satellite: p.satellite ?? '',
      temp: p.temp ?? 0,
      rh: p.rh ?? 0,
      ws: p.ws ?? 0,
      wd: p.wd ?? 0,
      pcp: p.pcp ?? 0,
      ffmc: p.ffmc ?? 0,
      dmc: p.dmc ?? 0,
      dc: p.dc ?? 0,
      isi: p.isi ?? 0,
      bui: p.bui ?? 0,
      fwi: p.fwi ?? 0,
      fuel: p.fuel ?? 'Unknown',
      ros: p.ros ?? 0,
      hfi: p.hfi ?? 0,
      cfb: p.cfb ?? 0,
      tfc: p.tfc ?? 0,
      frp: p.frp ?? 0,
      estarea: p.estarea ?? 0,
      elev: p.elev ?? 0,
      age: p.age ?? 0,
    });
  }

  return hotspots;
}

// ── Fetch CWFIS active fire perimeters ───────────────────────────────────────
interface FirePerimeter {
  name: string;
  areaHa: number;
  coordinates: number[][][]; // simplified polygon rings
}

async function fetchFirePerimeters(): Promise<FirePerimeter[]> {
  try {
    const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs` +
      `?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeName=public:m3_polygons_current` +
      `&outputFormat=application/json` +
      `&BBOX=${OPS_BBOX},EPSG:4326` +
      `&srsName=EPSG:4326`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FortressAI/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];

    const data = await resp.json();
    const perimeters: FirePerimeter[] = [];

    for (const feature of data.features ?? []) {
      const p = feature.properties;
      const geom = feature.geometry;
      if (!geom) continue;

      // Normalise: both Polygon and MultiPolygon → array of rings
      let rings: number[][][] = [];
      if (geom.type === 'Polygon') {
        rings = geom.coordinates;
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) rings = rings.concat(poly);
      }

      perimeters.push({
        name: p.firename ?? p.fire_id ?? 'Active fire',
        areaHa: p.areaha ?? p.area_ha ?? 0,
        coordinates: rings,
      });
    }

    return perimeters;
  } catch {
    return []; // non-critical — degrade gracefully
  }
}

// ── Point-in-polygon (ray casting) ───────────────────────────────────────────
function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function findContainingPerimeter(lat: number, lon: number, perimeters: FirePerimeter[]): FirePerimeter | null {
  for (const perim of perimeters) {
    for (const ring of perim.coordinates) {
      if (pointInRing(lat, lon, ring)) return perim;
    }
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Tiered hotspot classification ────────────────────────────────────────────
// Replaces the binary 4km radius with a three-tier model that uses distance,
// FRP, HFI, FWI, and season to separate fires from flares.
//
// Tier 1 (< 0.5km): very likely flare unless FRP is low AND it's fire season
//   with elevated FWI — in that case flag as ambiguous.
// Tier 2 (0.5–4km): ambiguous zone. High FRP + low HFI + off-season = flare.
//   Low-moderate FRP or active fire weather = wildfire with proximity note.
// Tier 3 (> 4km): standard wildfire classification.
// Fallback: detections with pure flare signature (high FRP + low HFI + high RH)
//   anywhere in the zone → industrial_flaring rather than silent suppression.

type ClassificationType = 'wildfire' | 'industrial_flaring' | 'ambiguous_near_facility';

interface Classification {
  type: ClassificationType;
  confidence: 'high' | 'medium' | 'low';
  facility?: { name: string; type: string; distKm: number };
  note?: string;
}

function classifyHotspot(
  hs: CWFISHotspot,
  firmsStaticSources: Array<{ lat: number; lon: number }> = [],
): Classification {
  const season = getFireSeason();

  // FIRMS overlay: if NASA FIRMS MODIS has classified this lat/lon as type=2
  // (static land source / gas flare) within the last 24h, that is authoritative
  // — override before any heuristic. Catches flaring sites we have not yet
  // added to INDUSTRIAL_FACILITIES.
  if (isFirmsStaticSource(hs.lat, hs.lon, firmsStaticSources)) {
    return {
      type: 'industrial_flaring',
      confidence: 'high',
      note: `NASA FIRMS MODIS classified this location as type=2 (static land source). Likely a gas flare or industrial heat source. Add to INDUSTRIAL_FACILITIES if you can identify the operator.`,
    };
  }

  let nearestFacility: { name: string; type: string; distKm: number } | null = null;
  for (const f of INDUSTRIAL_FACILITIES) {
    const dist = distanceKm(hs.lat, hs.lon, f.lat, f.lon);
    if (dist <= FACILITY_MATCH_KM && (!nearestFacility || dist < nearestFacility.distKm)) {
      nearestFacility = { name: f.name, type: f.type, distKm: dist };
    }
  }

  if (nearestFacility) {
    const { distKm } = nearestFacility;
    const fac = nearestFacility;

    if (distKm < 0.5) {
      // Very close — almost certainly a flare stack.
      // Exception: low FRP + elevated FWI during fire season = may be a real fire.
      if (hs.frp < 40 && season.isFireSeason && hs.fwi > 15) {
        return {
          type: 'ambiguous_near_facility', confidence: 'low', facility: fac,
          note: `${distKm.toFixed(1)}km from ${fac.name}. Low FRP (${hs.frp.toFixed(0)}MW) during fire season — possible real ignition. Verify on ground.`,
        };
      }
      return { type: 'industrial_flaring', confidence: 'high', facility: fac };
    }

    // 0.5km–4km: ambiguous zone
    const highFrp        = hs.frp > 120;
    const lowFireBehav   = hs.hfi < 500;   // industrial heat ≠ spreading fire
    const offSeasonOrDry = !season.isFireSeason || hs.fwi < 8;

    if (highFrp && lowFireBehav && offSeasonOrDry) {
      return { type: 'industrial_flaring', confidence: 'medium', facility: fac };
    }

    // Could be a real fire — create wildfire signal with a proximity warning
    return {
      type: 'ambiguous_near_facility', confidence: 'medium', facility: fac,
      note: `${distKm.toFixed(1)}km from ${fac.name} (${fac.type}). FRP: ${hs.frp.toFixed(0)}MW, HFI: ${hs.hfi.toFixed(0)}kW/m, FWI: ${hs.fwi.toFixed(0)}. Could be industrial — verify before escalating.`,
    };
  }

  // No facility nearby — check for flare signature anywhere in zone.
  // Previous code suppressed these silently; now we create an industrial_flaring
  // signal so there is a record of the thermal anomaly.
  if (hs.frp > 200 && hs.hfi < 500) {
    return { type: 'industrial_flaring', confidence: 'low', note: 'High FRP / low fire intensity — possible unknown flare source.' };
  }
  if (hs.frp > 100 && hs.rh > 65 && hs.hfi < 300) {
    return { type: 'industrial_flaring', confidence: 'low', note: 'High FRP in high-humidity conditions — inconsistent with wildfire behaviour.' };
  }

  // Off-season override: real wildfires in NE BC during Nov–Mar are essentially
  // impossible (snow cover, sub-zero temps, frozen fuels). Any low-fire-behaviour
  // hotspot in winter is an industrial source not yet in the facility registry.
  // Threshold HFI < 2000 kW/m — in winter even a moderate reading is suspect.
  // April (shoulder) is also included for NE BC — ground is still frozen and
  // active fire behaviour is not credible before mid-May in this region.
  if (!season.isFireSeason && hs.hfi < 2000) {
    return {
      type: 'industrial_flaring',
      confidence: 'medium',
      note: `${season.label} thermal anomaly with low fire behaviour (HFI ${hs.hfi.toFixed(0)} kW/m, FWI ${hs.fwi.toFixed(1)}) — classified as industrial source. Facility not in registry. If source identified, add to INDUSTRIAL_FACILITIES in monitor-wildfires.`,
    };
  }

  return { type: 'wildfire', confidence: 'high' };
}

function getOperationalZone(lat: number, lon: number): string | null {
  for (const z of OPERATIONAL_ZONES) {
    if (lat >= z.minLat && lat <= z.maxLat && lon >= z.minLon && lon <= z.maxLon) return z.label;
  }
  return null;
}

function fireDedupeKey(lat: number, lon: number, repDate: string): string {
  const gridLat = Math.round(lat * 4) / 4;
  const gridLon = Math.round(lon * 4) / 4;
  const day = repDate.slice(0, 10);
  return `wildfire:${gridLat}:${gridLon}:${day}`;
}

function degToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── FBP interpretation labels ─────────────────────────────────────────────────
function hfiLabel(hfi: number): string {
  if (hfi < 500)    return `${hfi.toFixed(0)} kW/m (low — ground crews can engage)`;
  if (hfi < 2000)   return `${hfi.toFixed(0)} kW/m (moderate — aerial support recommended)`;
  if (hfi < 4000)   return `${hfi.toFixed(0)} kW/m (high — direct attack not viable)`;
  if (hfi < 10000)  return `${hfi.toFixed(0)} kW/m (very high — extreme suppression difficulty)`;
  return `${hfi.toFixed(0)} kW/m (extreme — active crown fire, spotting likely)`;
}

function rosLabel(ros: number): string {
  if (ros < 5)   return `${ros.toFixed(1)} m/min (slow)`;
  if (ros < 20)  return `${ros.toFixed(1)} m/min (moderate)`;
  if (ros < 50)  return `${ros.toFixed(1)} m/min (fast)`;
  return `${ros.toFixed(1)} m/min (extreme — rapid evacuation threshold)`;
}

function fwiLabel(fwi: number): string {
  if (fwi < 5)   return `${fwi.toFixed(1)} (Very Low)`;
  if (fwi < 11)  return `${fwi.toFixed(1)} (Low)`;
  if (fwi < 22)  return `${fwi.toFixed(1)} (Moderate)`;
  if (fwi < 38)  return `${fwi.toFixed(1)} (High)`;
  return `${fwi.toFixed(1)} (Extreme)`;
}

// ── FBP elliptical fire spread projection ────────────────────────────────────
//
// Based on the Canadian Forest Fire Behaviour Prediction (FBP) System ellipse
// model (Alexander 1985; Hirsch 1996). The fire origin sits at one focus of
// the ellipse; the head fire is at the far end of the major axis.
//
// Inputs from CWFIS hotspot: ROS (m/min), wind speed (km/h), wind direction (°)
// Outputs: projected perimeter GeoJSON rings at 6h / 12h / 24h, plus
//          human-readable distances for the signal text.
//
// NOTE: This is a flat-terrain, uniform-fuel first-order estimate. It does not
// account for topographic channelling, spotting, or fuel heterogeneity.
// Label projections accordingly in signal text.

interface SpreadInterval {
  hours: number;
  forwardM: number;   // head fire distance from origin
  backM: number;      // back fire distance from origin
  flankM: number;     // max perpendicular half-width (semi-minor axis b)
  totalAreaHa: number;
  ring: number[][];   // GeoJSON ring [[lon,lat], ...]
}

interface SpreadProjection {
  lb: number;             // length-to-breadth ratio
  eccentricity: number;
  spreadAzimuth: number;  // direction fire moves (degrees from N, clockwise)
  spreadDir: string;      // compass label
  intervals: SpreadInterval[];
}

function calcLB(wsKph: number): number {
  // FBP System length-to-breadth ratio (Alexander 1985)
  return 1.0 + 8.729 * Math.pow(1.0 - Math.exp(-0.030 * wsKph), 2.155);
}

function buildEllipseRing(
  originLat: number,
  originLon: number,
  a: number,       // semi-major axis (m)
  b: number,       // semi-minor axis (m)
  e: number,       // eccentricity
  azRad: number,   // spread azimuth in radians (from North, clockwise)
  nPoints = 48,
): number[][] {
  // Ellipse center is displaced ae metres FORWARD from origin (origin is at back focus)
  const cxEast  = a * e * Math.sin(azRad);
  const cyNorth = a * e * Math.cos(azRad);
  const mPerDegLat = 111111;
  const mPerDegLon = 111111 * Math.cos(originLat * Math.PI / 180);
  const cLat = originLat + cyNorth / mPerDegLat;
  const cLon = originLon + cxEast  / mPerDegLon;

  const ring: number[][] = [];
  for (let i = 0; i <= nPoints; i++) {
    const theta = (i / nPoints) * 2 * Math.PI;
    // Local coords: x = right flank, y = forward (spread direction)
    const xLocal = b * Math.cos(theta);
    const yLocal = a * Math.sin(theta);
    // Rotate to geographic: forward azimuth α
    const eastM  =  xLocal * Math.cos(azRad) + yLocal * Math.sin(azRad);
    const northM = -xLocal * Math.sin(azRad) + yLocal * Math.cos(azRad);
    ring.push([cLon + eastM / mPerDegLon, cLat + northM / mPerDegLat]);
  }
  return ring;
}

function projectFireSpread(
  lat: number,
  lon: number,
  rosMperMin: number,
  wsKph: number,
  wdDeg: number,    // wind FROM direction (degrees)
): SpreadProjection | null {
  if (rosMperMin <= 0 || wsKph <= 0) return null;

  const lb = calcLB(wsKph);
  const e  = Math.sqrt(1 - 1 / (lb * lb));

  // Fire spreads TOWARD wind + 180°
  const spreadAzimuth = (wdDeg + 180) % 360;
  const azRad = spreadAzimuth * Math.PI / 180;

  const intervals: SpreadInterval[] = [];

  for (const hours of [6, 12, 24]) {
    const t = hours * 60; // minutes
    const dHead = rosMperMin * t;          // D_head = a(1+e)  →  a = dHead/(1+e)
    const a     = dHead / (1 + e);
    const b     = a / lb;                  // semi-minor axis
    const dBack = a * (1 - e);             // back fire distance from origin
    const areaHa = Math.PI * a * b / 10000;

    intervals.push({
      hours,
      forwardM: dHead,
      backM: dBack,
      flankM: b,
      totalAreaHa: areaHa,
      ring: buildEllipseRing(lat, lon, a, b, e, azRad),
    });
  }

  return { lb, eccentricity: e, spreadAzimuth, spreadDir: degToCompass(spreadAzimuth), intervals };
}

function formatSpreadProjection(proj: SpreadProjection): string {
  const lines: string[] = [];
  lines.push(
    `FBP Spread Projection (elliptical model, flat terrain — actual spread will vary with topography): ` +
    `Fire moving ${proj.spreadDir} (${proj.spreadAzimuth.toFixed(0)}°). ` +
    `Length-to-breadth ratio: ${proj.lb.toFixed(1)}.`
  );

  for (const iv of proj.intervals) {
    const fwdKm = (iv.forwardM / 1000).toFixed(1);
    const flKm  = (iv.flankM  / 1000).toFixed(1);
    const bkKm  = (iv.backM   / 1000).toFixed(1);
    lines.push(
      `  ${iv.hours}h: forward ${fwdKm} km, flanks ±${flKm} km, back ${bkKm} km — ` +
      `projected area ~${iv.totalAreaHa.toFixed(0)} ha.`
    );
  }

  return lines.join(' ');
}

// ── Lightning strike fetch (CWFIS) ───────────────────────────────────────────
interface LightningStrike {
  lat: number;
  lon: number;
  strokeTime: string;
  polarity: string;       // 'positive' | 'negative' | 'unknown'
  peakCurrentKA: number;
}

async function fetchLightningStrikes(): Promise<LightningStrike[]> {
  try {
    const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs` +
      `?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeName=public:lightning_obs_24h` +
      `&outputFormat=application/json` +
      `&BBOX=${OPS_BBOX},EPSG:4326` +
      `&srsName=EPSG:4326`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FortressAI/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.features ?? []).map((f: any) => {
      const coords = f.geometry?.coordinates;
      const p = f.properties ?? {};
      return {
        lat: coords?.[1] ?? p.lat ?? 0,
        lon: coords?.[0] ?? p.lon ?? 0,
        strokeTime: p.stroke_time ?? p.time ?? p.obs_time ?? '',
        polarity: p.polarity ?? p.type ?? 'unknown',
        peakCurrentKA: p.peak_current ?? p.amplitude ?? 0,
      };
    }).filter((s: LightningStrike) => s.lat !== 0 && s.lon !== 0);
  } catch {
    return []; // non-critical
  }
}

// Build signal text for a lightning strike that has no associated hotspot (latent risk)
function buildLightningSignalText(opts: {
  strike: LightningStrike;
  region: string;
  clientName: string;
  fwi?: number;
  nearHotspot?: boolean;
}): string {
  const { strike, region, clientName, fwi, nearHotspot } = opts;
  const lines: string[] = [];
  const polarity = strike.polarity === 'positive' ? 'positive cloud-to-ground (higher ignition probability)'
    : strike.polarity === 'negative' ? 'negative cloud-to-ground' : 'cloud-to-ground';
  const currentStr = strike.peakCurrentKA > 0 ? `, peak current ${Math.abs(strike.peakCurrentKA).toFixed(0)} kA` : '';

  lines.push(
    `Lightning strike recorded in ${region} — potential ignition source near ${clientName} operational areas.`
  );
  lines.push(
    `${polarity} lightning strike at ${strike.lat.toFixed(3)}°N, ${Math.abs(strike.lon).toFixed(3)}°W` +
    `${currentStr}. Time: ${strike.strokeTime || 'last 24h'}.`
  );

  if (nearHotspot) {
    lines.push(
      `A CWFIS thermal hotspot has been detected within 5km — this strike likely caused or is correlated with the active fire detection.`
    );
  } else {
    lines.push(
      `No thermal hotspot detected at this location yet. Lightning can smolder in duff layers for 24–72 hours before becoming a visible fire. ` +
      `Monitor this location for emerging smoke or hotspot detection in subsequent VIIRS passes.`
    );
  }

  if (fwi !== undefined && fwi >= 17) {
    lines.push(
      `Fire weather index at ${fwi.toFixed(0)} (${fwi >= 30 ? 'Very High/Extreme' : 'High'}) — dry fuel conditions significantly increase ignition probability from this strike.`
    );
  }

  lines.push(
    `Positive cloud-to-ground strikes carry 4–5× higher ignition probability than negative strokes. ` +
    `Latent lightning fires are a primary cause of remote ignitions in BC's boreal and sub-boreal zones.`
  );

  return lines.join(' ');
}

// ── Signal text builders ──────────────────────────────────────────────────────
function buildWildfireSignalText(opts: {
  hs: CWFISHotspot;
  region: string;
  clientName: string;
  perimeter: FirePerimeter | null;
  spread: SpreadProjection | null;
}): string {
  const { hs, region, clientName, perimeter, spread } = opts;

  const lines: string[] = [];
  const acqDate = hs.rep_date.slice(0, 10);
  const cfbPct = hs.cfb > 0 ? ` (${hs.cfb.toFixed(0)}% crown fraction burned — ${hs.cfb > 90 ? 'active crown fire' : hs.cfb > 10 ? 'intermittent crown fire' : 'surface fire'})` : '';
  const areaLabel = hs.estarea > 0 ? ` Estimated area: ${(hs.estarea / 10000).toFixed(1)} ha.` : '';
  const perimCtx = perimeter
    ? `This detection falls within the known active perimeter of ${perimeter.name} (${perimeter.areaHa.toFixed(0)} ha) — fire growth within an established perimeter.`
    : 'No prior perimeter match — possible new ignition or untracked fire.';

  lines.push(`Active wildfire detected near ${region}.`);
  lines.push(
    `${hs.source} ${hs.sensor} (${hs.satellite}) detected a thermal anomaly on ${acqDate} ` +
    `at ${hs.lat.toFixed(3)}°N, ${Math.abs(hs.lon).toFixed(3)}°W, ${hs.age}h ago. ` +
    `Fire Radiative Power: ${hs.frp.toFixed(1)} MW. Elevation: ${hs.elev}m.${areaLabel}`
  );

  // FBP fire behaviour (the core Prometheus/WISE FBP output)
  lines.push(
    `FBP Fire Behaviour (fuel type ${hs.fuel}): ` +
    `Head Fire Intensity: ${hfiLabel(hs.hfi)}. ` +
    `Rate of Spread: ${rosLabel(hs.ros)}.${cfbPct} ` +
    `Total fuel consumption: ${hs.tfc.toFixed(2)} kg/m².`
  );

  // FWI and weather from nearest BC AWS / ECCC station
  lines.push(
    `Fire Weather (nearest BC Wildfire Service AWS station): ` +
    `Temp ${hs.temp.toFixed(1)}°C, RH ${hs.rh.toFixed(0)}%${hs.rh < 25 ? ' ⚠ critically low' : hs.rh < 40 ? ' (low)' : ''}, ` +
    `wind ${hs.ws.toFixed(0)} km/h from ${degToCompass(hs.wd)}, ` +
    `precip ${hs.pcp.toFixed(1)} mm. ` +
    `FWI: ${fwiLabel(hs.fwi)}. ` +
    `FFMC ${hs.ffmc.toFixed(1)} / ISI ${hs.isi.toFixed(1)} / BUI ${hs.bui.toFixed(1)}.`
  );

  lines.push(perimCtx);

  // FBP elliptical spread projection
  if (spread) lines.push(formatSpreadProjection(spread));

  const season = getFireSeason();
  const seasonNote = season.isFireSeason
    ? `Active fire season conditions apply.`
    : season.isShoulder
      ? `Shoulder season — fire weather can fluctuate rapidly. Late-season snowmelt exposes dry duff layers vulnerable to ignition.`
      : `Off-season detection — thermal anomaly during winter/early spring warrants industrial source verification before wildfire classification.`;

  lines.push(
    `This fire is within the operational area of ${clientName}'s pipeline infrastructure, ` +
    `gas facilities, and right-of-way corridors in ${region}. ` +
    `Wildfires in this corridor pose direct risk to above-ground pipeline assets, compressor stations, and access roads. ` +
    seasonNote
  );

  return lines.join(' ');
}

function buildFlaringSignalText(opts: {
  hs: CWFISHotspot;
  facilityName: string;
  facilityType: string;
  facilityDistKm: number;
  region: string;
  clientName: string;
}): string {
  const { hs, facilityName, facilityType, facilityDistKm, region, clientName } = opts;
  const acqDate = hs.rep_date.slice(0, 10);
  const lines: string[] = [];

  lines.push(`Industrial flaring event detected at ${facilityName} (${facilityType}) in ${region}.`);
  lines.push(
    `${hs.source} ${hs.sensor} detected a thermal anomaly on ${acqDate} at ` +
    `${hs.lat.toFixed(3)}°N, ${Math.abs(hs.lon).toFixed(3)}°W — ` +
    `${facilityDistKm.toFixed(1)} km from ${facilityName}. ` +
    `Fire Radiative Power: ${hs.frp.toFixed(1)} MW. This is consistent with industrial flaring, not a wildfire.`
  );
  lines.push(
    `Weather at site: ${hs.temp.toFixed(1)}°C, RH ${hs.rh.toFixed(0)}%, ` +
    `wind ${hs.ws.toFixed(0)} km/h from ${degToCompass(hs.wd)}.`
  );
  lines.push(
    `Elevated or abnormal flaring at ${facilityName} may indicate operational changes, equipment issues, ` +
    `or emergency blowdown. Monitor for community air quality complaints and regulatory response. ` +
    `This is not a wildfire threat but may affect ${clientName} reputational and operational exposure.`
  );

  return lines.join(' ');
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const heartbeatAt = new Date().toISOString();
    const heartbeatMs = Date.now();

    console.log('[Wildfires] Starting CWFIS-enriched wildfire scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, locations')
      .not('locations', 'is', null);

    if (clientsError) throw clientsError;
    const client = (clients ?? [])[0];

    // Fetch CWFIS hotspots, perimeters, lightning, AND the NASA FIRMS static-source
    // overlay in parallel. FIRMS overlay is best-effort — if the API key is missing
    // or the call fails we proceed without it.
    const [hotspots, perimeters, lightningStrikes, firmsStaticSources] = await Promise.all([
      fetchCWFISHotspots(),
      fetchFirePerimeters(),
      fetchLightningStrikes(),
      fetchFirmsStaticSources(),
    ]);

    console.log(`[Wildfires] CWFIS: ${hotspots.length} hotspots, ${perimeters.length} perimeters, ${lightningStrikes.length} lightning strikes, ${firmsStaticSources.length} FIRMS static sources`);

    let signalsCreated = 0;
    let flaringsDetected = 0;
    let ambiguousDetected = 0;
    let duplicatesSuppressed = 0;
    let lightningSignals = 0;

    const seenThisRun = new Set<string>();
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    // ── Hotspot processing ──────────────────────────────────────────────────
    for (const hs of hotspots) {
      const zone = getOperationalZone(hs.lat, hs.lon);
      if (!zone) continue;

      // Dedup by grid cell + date
      const dedupeKey = fireDedupeKey(hs.lat, hs.lon, hs.rep_date);
      if (seenThisRun.has(dedupeKey)) { duplicatesSuppressed++; continue; }
      seenThisRun.add(dedupeKey);

      // NASA FIRMS Fire Map URL — the URL fragment #d:24hrs;@LON,LAT,ZOOM IS
      // parsed by the FIRMS SPA and centers the map on the hotspot with the past
      // 24h VIIRS/MODIS overlay, so operators can actually verify the detection.
      // (CWFIS firemaps ignored the lat/lon query params and always loaded the
      // default Canada-wide view.)
      const stableUrl = `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${hs.lon.toFixed(3)},${hs.lat.toFixed(3)},12.0z`;
      // Check signals table (not ingested_documents — ingest-signal never writes there)
      const { data: existing } = await supabase
        .from('signals')
        .select('id')
        .eq('source_url', stableUrl)
        .gte('created_at', twelveHoursAgo)
        .limit(1);
      if (existing && existing.length > 0) { duplicatesSuppressed++; continue; }

      if (!client) continue;

      const classification = classifyHotspot(hs, firmsStaticSources);
      const region = zone;

      if (classification.type === 'industrial_flaring') {
        // Industrial flaring — log only, no signal created
        flaringsDetected++;
        console.log(`[Wildfires] Flaring suppressed (no signal): ${classification.facility?.name ?? 'unknown'} FRP=${hs.frp.toFixed(1)}MW`);
        continue;
      }

      // Wildfire or ambiguous — both get a wildfire signal
      const perimeter = findContainingPerimeter(hs.lat, hs.lon, perimeters);
      const spread    = projectFireSpread(hs.lat, hs.lon, hs.ros, hs.ws, hs.wd);

      // Check for lightning correlation (strike within 5km of this hotspot)
      const correlatedStrike = lightningStrikes.find(s =>
        distanceKm(hs.lat, hs.lon, s.lat, s.lon) <= 5
      );

      let signalText = buildWildfireSignalText({ hs, region, clientName: client.name, perimeter, spread });

      if (classification.type === 'ambiguous_near_facility' && classification.note) {
        signalText += ` ⚠ FACILITY PROXIMITY: ${classification.note}`;
        ambiguousDetected++;
      }
      if (correlatedStrike) {
        const polarity = correlatedStrike.polarity === 'positive' ? 'positive (high ignition probability)' : correlatedStrike.polarity;
        signalText += ` ⚡ LIGHTNING CORRELATION: ${polarity} cloud-to-ground strike detected within 5km — lightning ignition probable.`;
      }

      const severity = hs.fwi >= 38 || hs.hfi >= 4000 ? 'critical'
        : hs.fwi >= 22 || hs.hfi >= 2000 ? 'high' : 'medium';

      const rawJson = {
        source_name: 'cwfis_viirs',
        classification: classification.type,
        classification_confidence: classification.confidence,
        facility_proximity: classification.facility ?? null,
        lightning_correlated: !!correlatedStrike,
        fwi: { ffmc: hs.ffmc, dmc: hs.dmc, dc: hs.dc, isi: hs.isi, bui: hs.bui, fwi: hs.fwi },
        fbp: { fuel: hs.fuel, ros: hs.ros, hfi: hs.hfi, cfb: hs.cfb, tfc: hs.tfc },
        ...(spread ? {
          spread_projection: {
            model: 'fbp_ellipse',
            lb: spread.lb,
            spread_azimuth: spread.spreadAzimuth,
            spread_direction: spread.spreadDir,
            intervals: spread.intervals.map(iv => ({
              hours: iv.hours,
              forward_km: +(iv.forwardM / 1000).toFixed(2),
              flank_km:   +(iv.flankM   / 1000).toFixed(2),
              back_km:    +(iv.backM    / 1000).toFixed(2),
              area_ha:    +iv.totalAreaHa.toFixed(1),
              geojson: { type: 'Polygon', coordinates: [iv.ring] },
            })),
            note: 'Flat-terrain uniform-fuel estimate. Does not account for topographic channelling or spotting.',
          }
        } : {}),
      };

      const { error } = await supabase.functions.invoke('ingest-signal', {
        body: {
          text: signalText,
          source_url: stableUrl,
          location: region,
          clientId: client.id,
          skip_relevance_gate: true,
          severity,
          raw_json: rawJson,
        },
      });

      if (!error) {
        signalsCreated++;
        const spreadNote = spread ? ` → ${spread.spreadDir} ${(spread.intervals[0].forwardM/1000).toFixed(1)}km/6h` : '';
        console.log(
          `[Wildfires] ${classification.type} (${classification.confidence}): ${region} — ` +
          `fuel=${hs.fuel}, HFI=${hs.hfi.toFixed(0)}kW/m, ROS=${hs.ros.toFixed(1)}m/min, FWI=${hs.fwi.toFixed(1)}` +
          `${correlatedStrike ? ' ⚡lightning' : ''}${spreadNote}`
        );
      }

      if (signalsCreated + flaringsDetected >= 10) break;
    }

    // ── Lightning processing (strikes with no nearby hotspot = latent risk) ──
    if (client && lightningStrikes.length > 0) {
      const seenStrike = new Set<string>();
      for (const strike of lightningStrikes) {
        const zone = getOperationalZone(strike.lat, strike.lon);
        if (!zone) continue;

        const strikeKey = `${Math.round(strike.lat * 10) / 10}:${Math.round(strike.lon * 10) / 10}`;
        if (seenStrike.has(strikeKey)) continue;
        seenStrike.add(strikeKey);

        // Only create a signal for strikes with no corresponding hotspot (latent risk)
        const hasNearbyHotspot = hotspots.some(h =>
          distanceKm(strike.lat, strike.lon, h.lat, h.lon) <= 5
        );
        if (hasNearbyHotspot) continue; // already correlated in the hotspot signal

        // Only flag latent strikes when FWI context suggests ignition risk
        // (during off-season with low FWI, a lone lightning strike has low consequence)
        const season = getFireSeason();
        if (!season.isFireSeason && !season.isShoulder) continue;

        const stableUrl = `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${strike.lon.toFixed(3)},${strike.lat.toFixed(3)},12.0z`;
        const { data: existingStrike } = await supabase
          .from('signals')
          .select('id')
          .eq('source_url', stableUrl)
          .gte('created_at', twelveHoursAgo)
          .limit(1);
        if (existingStrike && existingStrike.length > 0) continue;

        const signalText = buildLightningSignalText({
          strike, region: zone, clientName: client.name,
          nearHotspot: false,
        });

        const { error } = await supabase.functions.invoke('ingest-signal', {
          body: {
            text: signalText,
            source_url: stableUrl,
            location: zone,
            clientId: client.id,
            skip_relevance_gate: true,
            category: 'lightning_strike',
            severity: 'low',
            entity_tags: ['lightning', 'latent-ignition-risk'],
            raw_json: {
              source_name: 'cwfis_lightning',
              polarity: strike.polarity,
              peak_current_ka: strike.peakCurrentKA,
              stroke_time: strike.strokeTime,
              has_nearby_hotspot: false,
            },
          },
        });

        if (!error) {
          lightningSignals++;
          console.log(`[Wildfires] Lightning (latent): ${zone} ${strike.lat.toFixed(3)}°N ${strike.polarity}`);
        }

        if (lightningSignals >= 5) break; // cap lightning signals per run
      }
    }

    console.log(
      `[Wildfires] Done. Wildfires: ${signalsCreated}, flaring: ${flaringsDetected}, ` +
      `ambiguous-near-facility: ${ambiguousDetected}, lightning-latent: ${lightningSignals}, duplicates: ${duplicatesSuppressed}`
    );

    try {
      await supabase.from('cron_heartbeat').insert({
        job_name: 'monitor-wildfires',
        started_at: heartbeatAt,
        completed_at: new Date().toISOString(),
        status: 'completed',
        duration_ms: Date.now() - heartbeatMs,
        result_summary: {
          hotspots_fetched: hotspots.length,
          perimeters_fetched: perimeters.length,
          lightning_strikes_fetched: lightningStrikes.length,
          firms_static_sources: firmsStaticSources.length,
          signals_created: signalsCreated,
          industrial_flaring_events: flaringsDetected,
          ambiguous_near_facility: ambiguousDetected,
          lightning_latent_signals: lightningSignals,
          duplicates_suppressed: duplicatesSuppressed,
        },
      });
    } catch (_) {}

    return successResponse({
      success: true,
      hotspots_fetched: hotspots.length,
      perimeters_fetched: perimeters.length,
      signals_created: signalsCreated,
      industrial_flaring_events: flaringsDetected,
      ambiguous_near_facility: ambiguousDetected,
      lightning_strikes_fetched: lightningStrikes.length,
      lightning_latent_signals: lightningSignals,
      duplicates_suppressed: duplicatesSuppressed,
      source: 'cwfis',
    });

  } catch (error) {
    console.error('[Wildfires] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
