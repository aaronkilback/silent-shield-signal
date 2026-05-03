import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Station Registry ────────────────────────────────────────────────────────
// BC Wildfire Service automated weather stations used in Petronas daily report.
// Coordinates are the registered AWS locations used by BCWS fire weather network.
// Station list mirrors Petronas's published Daily Wildfire & Air Quality
// Report exactly — BU label + geographic anchor (e.g. "SBU / South of
// Altares") matches what their field ops use to scope restrictions.
const STATIONS = [
  { id: 'hudson_hope',   name: 'Hudson Hope',   lat: 56.033, lon: -121.900, bu: 'SBU',       region: 'South of Altares' },
  { id: 'graham',        name: 'Graham',        lat: 56.575, lon: -122.537, bu: 'SBU',       region: 'South of Halfway Rd.' },
  { id: 'wonowon',       name: 'Wonowon',       lat: 57.017, lon: -122.491, bu: 'SBU',       region: 'South of Mile 132' },
  { id: 'pink_mountain', name: 'Pink Mountain', lat: 57.058, lon: -122.534, bu: 'SBU & NBU', region: 'North of Mile 132' },
  { id: 'muskwa',        name: 'Muskwa',        lat: 58.772, lon: -122.656, bu: 'NBU',       region: 'North of Mile 132' },
];

// Key Petronas PECL assets for active fire proximity alerts
const KEY_ASSETS = [
  { name: 'Fort St. John Operations Hub', lat: 56.252, lon: -120.847 },
  { name: 'Montney Processing Facilities (North)', lat: 56.800, lon: -121.200 },
  { name: 'LNG Canada Terminal (Kitimat)', lat: 54.048, lon: -128.568 },
  { name: 'Fort Nelson Operations', lat: 58.803, lon: -122.697 },
  { name: 'Dawson Creek Hub', lat: 55.760, lon: -120.237 },
  { name: 'Prince George Logistics', lat: 53.917, lon: -122.769 },
];

// CWFIS WFS base URL for active fire hotspots (same source as monitor-wildfires)
const CWFIS_WFS = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs';

// Operational zone — all Petronas BC/AB assets
const BBOX = '-130,49,-113,60';

// ─── Known industrial facilities (same list as monitor-wildfires) ─────────────
const INDUSTRIAL_FACILITIES = [
  { name: 'McMahon Gas Plant',                   lat: 56.218, lon: -120.821 },
  { name: 'Younger Gas Plant (Spectra)',          lat: 56.312, lon: -121.052 },
  { name: 'Jedney Gas Plant',                    lat: 56.478, lon: -121.641 },
  { name: 'Caribou Gas Plant (Progress Energy)',  lat: 57.201, lon: -122.480 },
  { name: 'Lily Gas Plant',                      lat: 57.489, lon: -122.847 },
  { name: 'Sunrise Gas Plant (Progress Energy)',  lat: 58.103, lon: -122.310 },
  { name: 'Aitken Creek Gas Plant',              lat: 57.680, lon: -122.561 },
  { name: 'Fort Nelson Gas Plant',               lat: 58.752, lon: -122.711 },
  { name: 'LNG Canada Terminal',                 lat: 54.017, lon: -128.630 },
  { name: 'Westcoast Energy Compressor Station',  lat: 55.750, lon: -121.150 },
  { name: 'Taylor Gas Plant Area',               lat: 56.156, lon: -120.689 },
  { name: 'Dawson Creek Area Facilities',        lat: 55.760, lon: -120.235 },
];

// ─── Season Detection ─────────────────────────────────────────────────────────
function getFireSeason() {
  const month = new Date().getMonth() + 1; // 1–12
  if (month >= 5 && month <= 9)   return { isFireSeason: true,  isShoulder: false, label: 'Active Fire Season', note: '' };
  if (month === 4 || month === 10) return { isFireSeason: false, isShoulder: true,  label: 'Shoulder Season',
    note: 'Spring shoulder season — fire weather can rapidly transition as snowpack recedes. Lightning ignitions and latent smoldering are elevated risks.' };
  return { isFireSeason: false, isShoulder: false, label: 'Off-Season',
    note: 'Winter/early spring — Low fire danger ratings are expected and normal. Thermal detections are more likely industrial or prescribed burns. Monitor for late-season lightning events.' };
}

// ─── FWI → Danger Rating ─────────────────────────────────────────────────────
// Canadian Forest Fire Weather Index thresholds per CIFFC/BCWS classification
function fwiToDangerRating(fwi: number): { rating: string; code: string; color: string } {
  if (fwi >= 50) return { rating: 'Extreme',   code: 'E',  color: '#6a1b9a' };
  if (fwi >= 30) return { rating: 'Very High', code: 'VH', color: '#c62828' };
  if (fwi >= 17) return { rating: 'High',      code: 'H',  color: '#e65100' };
  if (fwi >=  8) return { rating: 'Moderate',  code: 'M',  color: '#f9a825' };
  return             { rating: 'Low',       code: 'L',  color: '#2e7d32' };
}

// Simplified FWI from raw weather (fallback when Open-Meteo FWI unavailable)
// Based on the general structure of FFMC → ISI + DMC/DC → BUI → FWI
function estimateFwi(tempC: number, rhPct: number, windKph: number, precipMm: number): number {
  if (tempC == null || rhPct == null) return 0;
  // Drought penalty: dry fuel contributes exponentially
  const droughtFactor = Math.max(0, 1 - rhPct / 80);
  // Wind amplifies spread
  const windFactor = 1 + windKph * 0.03;
  // Temperature drives evaporation/dryness
  const tempFactor = Math.max(0, tempC - 10) * 0.8;
  // Precipitation suppresses
  const precipSuppression = precipMm > 0 ? Math.exp(-precipMm * 0.4) : 1;
  const fwi = tempFactor * droughtFactor * windFactor * precipSuppression;
  return Math.round(Math.min(100, Math.max(0, fwi)));
}

// ─── Haversine Distance ───────────────────────────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Restriction Logic ───────────────────────────────────────────────────────
function getRestrictions(code: string) {
  const allow = '✓ Permitted';
  const restricted = '⚠ Restricted';
  const banned = '✗ Prohibited';

  switch (code) {
    case 'L':
      return { campfire: allow, openBurn: allow, industrial: allow, ohv: allow };
    case 'M':
      return { campfire: allow, openBurn: allow, industrial: allow, ohv: allow };
    case 'H':
      return { campfire: restricted, openBurn: restricted, industrial: allow, ohv: allow };
    case 'VH':
      return { campfire: banned, openBurn: banned, industrial: restricted, ohv: restricted };
    case 'E':
      return { campfire: banned, openBurn: banned, industrial: banned, ohv: banned };
    default:
      return { campfire: '—', openBurn: '—', industrial: '—', ohv: '—' };
  }
}

// ─── Open-Meteo Fetch ────────────────────────────────────────────────────────
interface StationWeather {
  fwi: number;
  tempMax: number;
  rhMin: number;
  windMax: number;
  windDir: number;
  precip: number;
  forecast: Array<{ date: string; fwi: number; tempMax: number; precip: number }>;
}

async function fetchStationWeather(lat: number, lon: number): Promise<StationWeather | null> {
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    // Note: fire_weather_index is not a valid Open-Meteo daily variable.
    // FWI is computed from raw weather via estimateFwi().
    url.searchParams.set('daily', [
      'temperature_2m_max',
      'relative_humidity_2m_min',
      'wind_speed_10m_max',
      'wind_direction_10m_dominant',
      'precipitation_sum',
    ].join(','));
    url.searchParams.set('timezone', 'America/Vancouver');
    url.searchParams.set('forecast_days', '4');

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.daily;
    if (!d) return null;

    // Index 0 = today
    const tempMax = d.temperature_2m_max?.[0] ?? 0;
    const rhMin = d.relative_humidity_2m_min?.[0] ?? 50;
    const windMax = d.wind_speed_10m_max?.[0] ?? 0;
    const windDir = d.wind_direction_10m_dominant?.[0] ?? 0;
    const precip = d.precipitation_sum?.[0] ?? 0;

    const fwi = estimateFwi(tempMax, rhMin, windMax, precip);

    // 3-day forecast (indices 1, 2, 3)
    const forecast = [1, 2, 3].map(i => ({
      date: d.time?.[i] ?? '',
      fwi: estimateFwi(
        d.temperature_2m_max?.[i] ?? 0,
        d.relative_humidity_2m_min?.[i] ?? 50,
        d.wind_speed_10m_max?.[i] ?? 0,
        d.precipitation_sum?.[i] ?? 0
      ),
      tempMax: d.temperature_2m_max?.[i] ?? 0,
      precip: d.precipitation_sum?.[i] ?? 0,
    }));

    return { fwi, tempMax, rhMin, windMax, windDir, precip, forecast };
  } catch {
    return null;
  }
}

// ─── AQHI for Fort St. John ──────────────────────────────────────────────────
interface AqhiData {
  current: number | null;
  category: string;
  health_message: string;
  forecast: Array<{ period: string; aqhi: number | null; category: string }>;
}

async function fetchFortStJohnAqhi(): Promise<AqhiData> {
  const fallback: AqhiData = {
    current: null,
    category: 'Unavailable',
    health_message: 'AQHI data temporarily unavailable. Check airnow.ca for current conditions.',
    forecast: [],
  };
  // Environment Canada MSC API. Fort St. John's location_id changed from
  // 'BC_FSJ' to a 5-letter alphabetic code (JAGPB). The old `sortby=` syntax
  // was also dropped — current API rejects it as 'bad sort property' (HTTP
  // 400). The MSC API now uses observation_datetime + a `latest=true`
  // filter on the observations endpoint.
  const FSJ_LOCATION_ID = 'JAGPB';
  try {
    const obsUrl = `https://api.weather.gc.ca/collections/aqhi-observations-realtime/items`
      + `?f=json&limit=24&location_id=${FSJ_LOCATION_ID}`;
    const obs = await fetch(obsUrl, { signal: AbortSignal.timeout(6000) });
    if (!obs.ok) {
      console.warn(`[AQHI] obs HTTP ${obs.status} — falling back`);
      return fallback;
    }
    const obsJson = await obs.json();
    // Pick the most recent observation by observation_datetime since the
    // API doesn't honor sortby anymore.
    const obsFeatures = (obsJson?.features ?? []).slice();
    obsFeatures.sort((a: any, b: any) => {
      const ta = new Date(a?.properties?.observation_datetime || 0).getTime();
      const tb = new Date(b?.properties?.observation_datetime || 0).getTime();
      return tb - ta;
    });
    const latestObs = obsFeatures[0]?.properties;
    const currentAqhi = latestObs?.aqhi ?? null;
    const aqhiNum = currentAqhi != null ? Math.round(currentAqhi) : null;

    const fcUrl = `https://api.weather.gc.ca/collections/aqhi-forecasts-realtime/items`
      + `?f=json&limit=24&location_id=${FSJ_LOCATION_ID}`;
    const fcRes = await fetch(fcUrl, { signal: AbortSignal.timeout(6000) });
    const fcJson = fcRes.ok ? await fcRes.json() : null;
    // forecast_period field is null in the new schema — derive a label
    // from forecast_datetime (24h offset = "Tomorrow", same-day = "Today",
    // night-hour = "Tonight"). Sort latest publication first, then take
    // up to 3 distinct periods.
    const now = new Date();
    const fcFeatures = ((fcJson?.features ?? []) as any[]).slice();
    fcFeatures.sort((a: any, b: any) => {
      const ta = new Date(a?.properties?.forecast_datetime || 0).getTime();
      const tb = new Date(b?.properties?.forecast_datetime || 0).getTime();
      return ta - tb;
    });
    const labelFor = (iso: string): string => {
      if (!iso) return '';
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return '';
      const dayDelta = Math.round((d.getTime() - now.getTime()) / (24 * 3600000));
      const hour = d.getUTCHours();
      if (dayDelta <= 0) return hour >= 18 || hour < 6 ? 'Tonight' : 'Today';
      if (dayDelta === 1) return hour >= 18 || hour < 6 ? 'Tomorrow Night' : 'Tomorrow';
      return d.toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' });
    };
    const seenPeriods = new Set<string>();
    const forecast: { period: string; aqhi: number | null; category: string }[] = [];
    for (const feat of fcFeatures) {
      const p = feat?.properties ?? {};
      const period = labelFor(p.forecast_datetime);
      if (!period || seenPeriods.has(period)) continue;
      seenPeriods.add(period);
      const v = p.aqhi != null ? Math.round(p.aqhi) : null;
      forecast.push({ period, aqhi: v, category: aqhiCategory(v) });
      if (forecast.length >= 3) break;
    }

    return {
      current: aqhiNum,
      category: aqhiCategory(aqhiNum),
      health_message: aqhiHealthMessage(aqhiNum),
      forecast,
    };
  } catch (err: any) {
    console.warn(`[AQHI] fetch threw: ${err?.message || err}`);
    return fallback;
  }
}

function aqhiCategory(aqhi: number | null): string {
  if (aqhi == null) return '—';
  if (aqhi <= 3) return 'Low';
  if (aqhi <= 6) return 'Moderate';
  if (aqhi <= 10) return 'High';
  return 'Very High';
}

function aqhiHealthMessage(aqhi: number | null): string {
  if (aqhi == null) return 'Data unavailable.';
  if (aqhi <= 3) return 'Ideal air quality for outdoor activities. No health risk.';
  if (aqhi <= 6) return 'No need to modify usual outdoor activities unless you experience symptoms.';
  if (aqhi <= 10) return 'Reduce or reschedule strenuous outdoor activities. Children and seniors most at risk.';
  return 'Avoid strenuous outdoor activities. Keep windows closed. Wear N95 if outdoors.';
}

// ─── CWFIS Active Fires + Flare Classification ────────────────────────────────
interface ActiveFire {
  lat: number;
  lon: number;
  frp: number;
  hfi: number;
  ros: number;
  fwi: number;
  fuelType: string;
  area: number;
  perimeter: boolean;
  nearestAsset: string;
  distanceKm: number;
  isFlare: boolean;
  isAmbiguous: boolean;
  nearestFacility: string | null;
  facilityDistKm: number | null;
}

interface LightningStrike {
  lat: number;
  lon: number;
  strokeTime: string;
  polarity: string;
  peakCurrentKA: number;
  nearestAsset: string;
  distanceKm: number;
  hasNearbyFire: boolean;
}

function nearestFacilityInfo(lat: number, lon: number) {
  let minDist = Infinity, name: string | null = null;
  for (const f of INDUSTRIAL_FACILITIES) {
    const d = haversineKm(lat, lon, f.lat, f.lon);
    if (d < minDist) { minDist = d; name = f.name; }
  }
  return minDist <= 4 ? { name, distKm: Math.round(minDist * 10) / 10 } : null;
}

function classifyHotspot(lat: number, lon: number, frp: number, hfi: number, fwi: number) {
  const season = getFireSeason();
  const fac = nearestFacilityInfo(lat, lon);
  if (!fac) {
    // No facility in hardcoded list within 4km — but Peace/Montney region has hundreds of
    // oil/gas sites. In off-season, a detection with zero FRP + zero HFI is almost never a
    // real wildfire; treat as likely industrial noise and exclude from fire table.
    if (!season.isFireSeason && frp === 0 && hfi === 0) {
      return { isFlare: true, isAmbiguous: false, facilityName: 'Unknown facility (off-season)', facilityDistKm: null };
    }
    // Strong generic flare signature anywhere
    const isFlare = (frp > 200 && hfi < 500) || (frp > 100 && hfi < 300);
    return { isFlare, isAmbiguous: false, facilityName: null, facilityDistKm: null };
  }

  if (fac.distKm < 0.5) {
    // Very close: flare unless low FRP in fire season
    const isAmbiguous = frp < 40 && season.isFireSeason && fwi > 15;
    return { isFlare: !isAmbiguous, isAmbiguous, facilityName: fac.name, facilityDistKm: fac.distKm };
  }

  // 0.5–4km: use FRP + HFI + season
  // Off-season / shoulder season: null/zero FRP is normal for industrial detections.
  // Default to flare unless HFI > 1000 (actual fire behaviour) or ROS > 5 (spreading).
  if (!season.isFireSeason) {
    const strongFireBehaviour = hfi > 1000;
    return { isFlare: !strongFireBehaviour, isAmbiguous: strongFireBehaviour, facilityName: fac.name, facilityDistKm: fac.distKm };
  }
  const likelyFlare = frp > 120 && hfi < 500 && fwi < 8;
  return { isFlare: likelyFlare, isAmbiguous: !likelyFlare, facilityName: fac.name, facilityDistKm: fac.distKm };
}

async function fetchActiveFires(): Promise<{ fires: ActiveFire[]; flares: ActiveFire[] }> {
  try {
    const url = `${CWFIS_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
                `&typeName=public:hotspots_last24hrs&outputFormat=application/json` +
                `&BBOX=${BBOX},EPSG:4326&count=150`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { fires: [], flares: [] };
    const json = await res.json();
    const features = json?.features ?? [];

    const fires: ActiveFire[] = [];
    const flares: ActiveFire[] = [];

    for (const f of features) {
      const p = f.properties ?? {};
      const coords = f.geometry?.coordinates ?? [0, 0];
      const lat = coords[1] || p.lat || 0;
      const lon = coords[0] || p.lon || 0;
      if (!lat || !lon) continue;

      let minDist = Infinity, nearestAsset = 'Unknown';
      for (const asset of KEY_ASSETS) {
        const d = haversineKm(lat, lon, asset.lat, asset.lon);
        if (d < minDist) { minDist = d; nearestAsset = asset.name; }
      }

      const frp = p.frp ?? 0;
      const hfi = p.hfi ?? 0;
      const fwi = p.fwi ?? 0;
      const cls = classifyHotspot(lat, lon, frp, hfi, fwi);

      const detection: ActiveFire = {
        lat, lon, frp, hfi,
        ros: p.ros ?? 0,
        fwi,
        fuelType: p.fuel ?? p.fuel_type ?? '—',
        area: p.estarea ?? p.area ?? 0,
        perimeter: !!p.within_perimeter,
        nearestAsset,
        distanceKm: Math.round(minDist),
        isFlare: cls.isFlare,
        isAmbiguous: cls.isAmbiguous,
        nearestFacility: cls.facilityName,
        facilityDistKm: cls.facilityDistKm,
      };

      if (cls.isFlare) flares.push(detection);
      else fires.push(detection);
    }

    fires.sort((a, b) => a.distanceKm - b.distanceKm);
    flares.sort((a, b) => a.distanceKm - b.distanceKm);
    return { fires: fires.slice(0, 20), flares: flares.slice(0, 20) };
  } catch {
    return { fires: [], flares: [] };
  }
}

// ─── CWFIS Lightning Strikes ──────────────────────────────────────────────────
async function fetchLightningStrikes(fires: ActiveFire[]): Promise<LightningStrike[]> {
  try {
    const url = `${CWFIS_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
                `&typeName=public:lightning_obs_24h&outputFormat=application/json` +
                `&BBOX=${BBOX},EPSG:4326&count=200`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();
    const features = json?.features ?? [];

    return features.map((f: any) => {
      const coords = f.geometry?.coordinates;
      const p = f.properties ?? {};
      const lat = coords?.[1] ?? p.lat ?? 0;
      const lon = coords?.[0] ?? p.lon ?? 0;

      let minDist = Infinity, nearestAsset = 'Unknown';
      for (const asset of KEY_ASSETS) {
        const d = haversineKm(lat, lon, asset.lat, asset.lon);
        if (d < minDist) { minDist = d; nearestAsset = asset.name; }
      }

      const hasNearbyFire = fires.some(fire => haversineKm(lat, lon, fire.lat, fire.lon) <= 5);

      return {
        lat, lon,
        strokeTime: p.stroke_time ?? p.time ?? p.obs_time ?? '',
        polarity: p.polarity ?? p.type ?? 'unknown',
        peakCurrentKA: Math.abs(p.peak_current ?? p.amplitude ?? 0),
        nearestAsset,
        distanceKm: Math.round(minDist),
        hasNearbyFire,
      };
    }).filter((s: LightningStrike) => s.lat !== 0 && s.lon !== 0)
      .sort((a: LightningStrike, b: LightningStrike) => a.distanceKm - b.distanceKm)
      .slice(0, 30);
  } catch {
    return [];
  }
}

// ─── Consecutive Days Calculator ─────────────────────────────────────────────
async function getConsecutiveDays(
  supabase: any, stationId: string, rating: string
): Promise<number> {
  // Query last 30 days of ratings for this station
  const { data } = await supabase
    .from('wildfire_station_ratings')
    .select('rating_date, danger_rating')
    .eq('station_id', stationId)
    .order('rating_date', { ascending: false })
    .limit(30);

  if (!data || data.length === 0) return 1;

  let count = 1;
  // Skip today's entry (index 0) and count backwards while rating matches
  for (let i = 1; i < data.length; i++) {
    if (data[i].danger_rating === rating) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ─── Wind Direction to Cardinal ──────────────────────────────────────────────
function windCardinal(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ─── HTML Report Builder ─────────────────────────────────────────────────────

function buildRestrictionCell(text: string): string {
  let cls = '';
  if (text.startsWith('✗')) cls = 'style="background:#fce4e4;color:#b71c1c;font-weight:600"';
  else if (text.startsWith('⚠')) cls = 'style="background:#fff8e1;color:#e65100;font-weight:600"';
  else if (text.startsWith('✓')) cls = 'style="background:#e8f5e9;color:#1b5e20"';
  return `<td ${cls}>${text}</td>`;
}

// Petronas-published high-risk-activity protocol matrix. Returns the
// CURRENTLY-ACTIVE restrictions for a station given its rating and the
// number of consecutive days at that rating. Mirrors the protocol table
// on page 1 of the Petronas Daily Wildfire & Air Quality Report.
//
// Logic:
//   LOW                       → no restrictions
//   MODERATE  days <  3       → continue normal practices
//   MODERATE  days >= 3       → fire watcher 1 hr after work
//   HIGH      always          → fire watcher 2 hrs after work
//   HIGH      days >= 3       → + cease activity 1 pm – sunset
//   EXTREME / VERY HIGH       → cease activity 1 pm – sunset, fire watcher 2 hrs
//   EXTREME   days >= 3       → + CEASE ALL ACTIVITY for the entire day
function petronasProtocol(code: string, daysAtRating: number): string[] {
  const lines: string[] = [];
  switch (code) {
    case 'L':
      lines.push('No work restrictions. Continue normal daily work practices.');
      break;
    case 'M':
      if (daysAtRating >= 3) {
        lines.push('Maintain a fire watcher after work for ≥1 hour (3+ consecutive days at Moderate).');
      } else {
        lines.push('Continue normal practices. Watch for escalation.');
      }
      break;
    case 'H':
      lines.push('Maintain a fire watcher after work for ≥2 hours.');
      if (daysAtRating >= 3) {
        lines.push('Cease activity between 1 pm and sunset each day (3+ consecutive days at High).');
      }
      break;
    case 'VH':
    case 'E':
      lines.push('Cease activity between 1 pm and sunset each day. Fire watcher ≥2 hours after work.');
      if (daysAtRating >= 3) {
        lines.push('⛔ CEASE ALL ACTIVITY for the entire day (3+ consecutive days at Extreme).');
      }
      break;
    default:
      lines.push('Refer to BC Wildfire Service current orders.');
  }
  return lines;
}

function petronasProtocolCell(code: string, daysAtRating: number, color: string): string {
  const lines = petronasProtocol(code, daysAtRating);
  // Highlight the strongest restriction (last line is always the most
  // restrictive when multiple apply).
  const isCeaseAll = lines.some((l) => l.includes('CEASE ALL'));
  const bg = isCeaseAll ? '#fce4e4' : code === 'L' ? '#e8f5e9' : '#fff8e1';
  const fg = isCeaseAll ? '#b71c1c' : '#333';
  return `<td style="background:${bg};color:${fg};font-size:11px;line-height:1.4">${lines.map((l) => `<div style="margin:2px 0">• ${l}</div>`).join('')}</td>`;
}

function buildDangerBadge(rating: string, code: string, color: string): string {
  return `<span style="display:inline-block;padding:4px 12px;border-radius:4px;background:${color};color:${code === 'M' ? '#333' : '#fff'};font-weight:700;font-size:13px;letter-spacing:1px">${code} — ${rating}</span>`;
}

function fwiBar(fwi: number): string {
  const pct = Math.min(100, (fwi / 70) * 100);
  const color = fwi >= 50 ? '#6a1b9a' : fwi >= 30 ? '#c62828' : fwi >= 17 ? '#e65100' : fwi >= 8 ? '#f9a825' : '#2e7d32';
  return `<div style="background:#e0e0e0;border-radius:3px;height:8px;width:120px;display:inline-block;vertical-align:middle">
    <div style="width:${pct}%;background:${color};height:8px;border-radius:3px"></div>
  </div> <span style="font-size:12px;color:#555">${fwi}</span>`;
}

function forecastFwiPill(fwi: number): string {
  const { code, color } = fwiToDangerRating(fwi);
  const textColor = code === 'M' ? '#333' : '#fff';
  return `<span style="background:${color};color:${textColor};padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600">${code}</span> ${fwi}`;
}

interface StationData {
  station: typeof STATIONS[0];
  weather: StationWeather | null;
  fwi: number;
  dangerInfo: { rating: string; code: string; color: string };
  daysAtRating: number;
  restrictions: ReturnType<typeof getRestrictions>;
}

function buildHtmlReport(params: {
  reportDate: string;
  generatedAt: string;
  stationsData: StationData[];
  activeFires: ActiveFire[];
  flares: ActiveFire[];
  lightning: LightningStrike[];
  aqhi: AqhiData;
  dbSignals: any[];
  bcwsFires: any[];
  bcwsEvacs: any[];
}): string {
  const { reportDate, generatedAt, stationsData, activeFires, flares, lightning, aqhi, dbSignals, bcwsFires, bcwsEvacs } = params;
  const season = getFireSeason();
  const isoDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD for NASA Worldview URLs

  // BU-level risk aggregation
  const buRisks: Record<string, { maxCode: string; maxRating: string; maxColor: string; stations: string[] }> = {};
  const codeOrder = { 'L': 0, 'M': 1, 'H': 2, 'VH': 3, 'E': 4 };
  for (const sd of stationsData) {
    const bu = sd.station.bu;
    if (!buRisks[bu]) buRisks[bu] = { maxCode: 'L', maxRating: 'Low', maxColor: '#2e7d32', stations: [] };
    const cur = buRisks[bu];
    if ((codeOrder[sd.dangerInfo.code as keyof typeof codeOrder] ?? 0) >
        (codeOrder[cur.maxCode as keyof typeof codeOrder] ?? 0)) {
      cur.maxCode = sd.dangerInfo.code;
      cur.maxRating = sd.dangerInfo.rating;
      cur.maxColor = sd.dangerInfo.color;
    }
    cur.stations.push(sd.station.name);
  }

  const highestRisk = stationsData.reduce((a, b) =>
    (codeOrder[a.dangerInfo.code as keyof typeof codeOrder] ?? 0) >=
    (codeOrder[b.dangerInfo.code as keyof typeof codeOrder] ?? 0) ? a : b
  );
  const highestCode = highestRisk.dangerInfo.code;

  // Active fire summary
  const nearFires = activeFires.filter(f => f.distanceKm <= 100);
  const significantFires = activeFires.filter(f => f.frp >= 50 || f.hfi >= 4000);
  const ambiguousFires = activeFires.filter(f => f.isAmbiguous);
  const lightningCorrelated = lightning.filter(s => s.hasNearbyFire);
  const lightningLatent = lightning.filter(s => !s.hasNearbyFire && s.distanceKm <= 100);

  // Season badge
  const seasonBadge = season.isFireSeason
    ? `<span style="background:#c62828;color:#fff;padding:2px 10px;border-radius:3px;font-size:11px;font-weight:700;margin-left:12px">🔥 FIRE SEASON</span>`
    : season.isShoulder
      ? `<span style="background:#e65100;color:#fff;padding:2px 10px;border-radius:3px;font-size:11px;font-weight:700;margin-left:12px">⚠ SHOULDER SEASON</span>`
      : `<span style="background:#1565c0;color:#fff;padding:2px 10px;border-radius:3px;font-size:11px;font-weight:700;margin-left:12px">❄ OFF-SEASON</span>`;

  // Operational status banner
  let opStatus = '', opBg = '';
  if (highestCode === 'E') {
    opStatus = 'CRITICAL — TOTAL BURN BAN IN EFFECT. Halt all ignition sources. Emergency protocols active.';
    opBg = '#6a1b9a';
  } else if (highestCode === 'VH') {
    opStatus = 'HIGH ALERT — No campfires or open burning. Industrial ignition restrictions apply. Heightened monitoring required.';
    opBg = '#c62828';
  } else if (highestCode === 'H') {
    opStatus = 'ELEVATED — Campfire and open burning restrictions in effect. Review Hot Work permit requirements.';
    opBg = '#e65100';
  } else if (highestCode === 'M') {
    opStatus = 'ADVISORY — Moderate fire danger. Standard fire prevention protocols apply.';
    opBg = '#f57c00';
  } else {
    opStatus = 'NORMAL — Low fire danger. Standard protocols apply.';
    opBg = '#2e7d32';
  }

  const stationRows = stationsData.map(sd => {
    const r = sd.restrictions;
    const w = sd.weather;
    const { code, color } = sd.dangerInfo;
    const textColor = code === 'M' ? '#333' : '#fff';
    const forecastCells = (w?.forecast ?? []).map(f => {
      const fd = fwiToDangerRating(f.fwi);
      const tc = fd.code === 'M' ? '#333' : '#fff';
      return `<td style="text-align:center;padding:6px 4px">
        <span style="background:${fd.color};color:${tc};padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600">${fd.code}</span>
        <div style="font-size:10px;color:#777;margin-top:2px">${f.date.slice(5)}</div>
      </td>`;
    }).join('');

    return `<tr>
      <td style="font-weight:600;white-space:nowrap">${sd.station.name}</td>
      <td style="text-align:center;font-size:12px">
        <strong>${sd.station.bu}</strong>
        <div style="font-size:10px;color:#777;margin-top:2px">(${sd.station.region})</div>
      </td>
      <td style="text-align:center">
        <span style="display:inline-block;padding:4px 10px;border-radius:4px;background:${color};color:${textColor};font-weight:700;font-size:12px">${code} — ${sd.dangerInfo.rating}</span>
      </td>
      <td style="text-align:center;font-weight:700;font-size:14px">${sd.daysAtRating}</td>
      ${petronasProtocolCell(code, sd.daysAtRating, color)}
      <td style="text-align:center;font-size:11px">${w ? `${w.tempMax}°C / ${w.rhMin}% RH<br>${w.windMax} km/h ${windCardinal(w.windDir ?? 0)}` : '—'}</td>
      ${forecastCells}
    </tr>`;
  }).join('\n');

  // BU summary cards
  const buCards = Object.entries(buRisks).map(([bu, risk]) => {
    const tc = risk.maxCode === 'M' ? '#333' : '#fff';
    return `<div style="flex:1;min-width:140px;border:2px solid ${risk.maxColor};border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${risk.maxColor}">${bu}</div>
      <div style="margin:8px 0">
        <span style="background:${risk.maxColor};color:${tc};padding:5px 14px;border-radius:5px;font-weight:700;font-size:13px">${risk.maxCode} — ${risk.maxRating}</span>
      </div>
      <div style="font-size:11px;color:#666;margin-top:6px">${risk.stations.join('<br>')}</div>
    </div>`;
  }).join('\n');

  // Active fires section
  const fireRows = activeFires.slice(0, 15).map(f => {
    const threat = f.distanceKm <= 25 ? '🔴 CRITICAL' : f.distanceKm <= 50 ? '🟠 HIGH' : f.distanceKm <= 100 ? '🟡 MONITOR' : '⚪ DISTANT';
    const { code, color } = fwiToDangerRating(f.fwi);
    const tc = code === 'M' ? '#333' : '#fff';
    const gMaps = `https://maps.google.com/?q=${f.lat.toFixed(4)},${f.lon.toFixed(4)}&t=k`;
    const worldview = `https://worldview.earthdata.nasa.gov/?v=${(f.lon - 0.4).toFixed(3)},${(f.lat - 0.4).toFixed(3)},${(f.lon + 0.4).toFixed(3)},${(f.lat + 0.4).toFixed(3)}&t=${isoDate}&l=VIIRS_SNPP_Fires_375m_Day,VIIRS_SNPP_Fires_375m_Night,Coastlines_15m,OSM_Land_Water_Map`;
    return `<tr>
      <td style="font-family:monospace;font-size:11px">
        ${f.lat.toFixed(4)}°N ${Math.abs(f.lon).toFixed(4)}°W<br>
        <span style="font-size:10px">
          <a href="${gMaps}" target="_blank" style="color:#1565c0">Satellite</a> ·
          <a href="${worldview}" target="_blank" style="color:#1565c0">VIIRS</a>
        </span>
      </td>
      <td style="text-align:center">${f.frp > 0 ? f.frp.toFixed(0) : '—'} MW</td>
      <td style="text-align:center">${f.hfi > 0 ? f.hfi.toFixed(0) : '—'} kW/m</td>
      <td style="text-align:center">${f.ros > 0 ? f.ros.toFixed(1) : '—'} m/min</td>
      <td style="text-align:center">${f.fuelType}</td>
      <td style="font-size:11px">${f.nearestAsset}</td>
      <td style="text-align:center;font-weight:700">${f.distanceKm} km</td>
      <td style="text-align:center">${threat}</td>
    </tr>`;
  }).join('\n');

  // DB-sourced wildfire signals (processed by monitor-wildfires)
  const signalRows = dbSignals.slice(0, 8).map(s => {
    const rj = s.raw_json ?? {};
    const spread = rj.spread_projection;
    const hasSpread = spread?.projections?.length > 0;
    return `<tr>
      <td style="font-size:12px">${new Date(s.created_at).toLocaleString('en-CA', {timeZone:'America/Vancouver', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</td>
      <td style="font-size:12px">${s.title ?? '—'}</td>
      <td style="text-align:center;font-size:12px">${rj.severity ?? s.severity ?? '—'}</td>
      <td style="font-size:11px;color:#555">${hasSpread ? `6h: ${spread.projections[0]?.distanceM ? (spread.projections[0].distanceM/1000).toFixed(1)+'km' : '—'}` : '—'}</td>
    </tr>`;
  }).join('\n');

  // AQHI section
  const aqhiColor = aqhi.current == null ? '#888'
    : aqhi.current <= 3 ? '#2e7d32'
    : aqhi.current <= 6 ? '#f9a825'
    : aqhi.current <= 10 ? '#c62828' : '#6a1b9a';

  const aqhiFC = aqhi.forecast.map(f => `
    <td style="text-align:center;padding:8px">
      <div style="font-size:11px;color:#666;margin-bottom:4px">${f.period}</div>
      <div style="font-weight:700;font-size:18px;color:${aqhiColor}">${f.aqhi ?? '—'}</div>
      <div style="font-size:11px;color:#888">${f.category}</div>
    </td>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Petronas PECL — Daily Wildfire & Air Quality Report — ${reportDate}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #f5f5f5; }
  .page { max-width: 1100px; margin: 0 auto; background: #fff; padding: 0 0 40px; }
  .header { background: linear-gradient(135deg, #003366 0%, #005599 100%); color: #fff; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
  .header-logo { font-size: 11px; opacity: 0.8; letter-spacing: 2px; text-transform: uppercase; }
  .header-title { font-size: 20px; font-weight: 700; }
  .header-sub { font-size: 12px; opacity: 0.85; margin-top: 4px; }
  .header-meta { text-align: right; font-size: 11px; opacity: 0.85; }
  .status-banner { padding: 14px 32px; font-weight: 700; font-size: 14px; color: #fff; letter-spacing: 0.3px; }
  section { padding: 24px 32px; border-bottom: 1px solid #e0e0e0; }
  section:last-child { border-bottom: none; }
  h2 { font-size: 15px; font-weight: 700; color: #003366; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px; border-left: 4px solid #003366; padding-left: 10px; }
  h3 { font-size: 13px; font-weight: 600; color: #333; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f0f4f8; color: #003366; font-weight: 700; padding: 9px 8px; text-align: left; border: 1px solid #ddd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  td { padding: 8px; border: 1px solid #e0e0e0; vertical-align: middle; }
  tr:hover td { background: #fafafa; }
  .bu-cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .info-box { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 18px; }
  .aqhi-current { text-align: center; }
  .aqhi-num { font-size: 56px; font-weight: 800; line-height: 1; }
  .aqhi-label { font-size: 14px; font-weight: 600; margin-top: 4px; }
  .note { font-size: 11px; color: #888; font-style: italic; margin-top: 8px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .no-data { color: #aaa; font-style: italic; font-size: 12px; }
  .rec-list { list-style: none; }
  .rec-list li { padding: 7px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
  .rec-list li:last-child { border-bottom: none; }
  .rec-list li::before { content: '→ '; color: #003366; font-weight: bold; }
  @media print {
    body { background: #fff; font-size: 11px; }
    .page { max-width: 100%; padding: 0; }
    .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .status-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    section { padding: 16px 24px; page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">

<!-- ─── Header ─────────────────────────────────────────────────────────────── -->
<div class="header">
  <div>
    <div class="header-logo">Petronas Canada (PECL) — HSE Operations Intelligence</div>
    <div class="header-title">Daily Wildfire & Air Quality Report</div>
    <div class="header-sub">BC Wildfire Service Fire Weather Monitoring — Petronas Operational Zones</div>
  </div>
  <div class="header-meta">
    <div><strong>${reportDate}</strong> ${seasonBadge}</div>
    <div style="margin-top:4px">Generated: ${generatedAt}</div>
    <div style="margin-top:4px">Zones: Peace/Montney · Skeena/Kitimat · Fort Nelson</div>
    <div style="margin-top:4px; opacity:0.7">Source: CWFIS/NRCan · Open-Meteo · AQHI/EC · BCLDN</div>
  </div>
</div>

<!-- ─── Operational Status Banner ──────────────────────────────────────────── -->
<div class="status-banner" style="background:${opBg}">
  OPERATIONAL STATUS: ${opStatus}
</div>

<!-- ─── Season Context ───────────────────────────────────────────────────────── -->
${!season.isFireSeason ? `
<div style="background:${season.isShoulder ? '#fff3e0' : '#e8f4fd'};border-bottom:2px solid ${season.isShoulder ? '#e65100' : '#1565c0'};padding:10px 32px;font-size:12px;color:${season.isShoulder ? '#bf360c' : '#0d47a1'}">
  <strong>${season.label}:</strong> ${season.note}
  ${!season.isFireSeason && !season.isShoulder ? ' Low danger ratings are expected and normal for this time of year — they do not indicate data absence or system error.' : ''}
</div>` : ''}

<!-- ─── Section 1: Business Unit Summary ───────────────────────────────────── -->
<section>
  <h2>Business Unit Risk Summary</h2>
  <div class="bu-cards">
    ${buCards}
  </div>
  <p class="note">Risk level reflects the highest danger rating among all monitoring stations within each Business Unit. Active fire data may further elevate operational response.</p>
</section>

<!-- ─── Station & Asset Map ──────────────────────────────────────────────────── -->
<section>
  <h2>Monitoring Station &amp; Asset Overview Map</h2>
  <p style="font-size:12px;color:#555;margin-bottom:10px">
    BCWS automated weather stations (coloured by Business Unit) and key Petronas PECL assets.
    Click any marker for details. Fire detections from CWFIS are shown as red circles.
  </p>
  <div id="station-map" style="height:420px;border-radius:8px;border:1px solid #ddd;overflow:hidden"></div>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
  (function() {
    var map = L.map('station-map', { zoomControl: true }).setView([57.0, -122.0], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 13,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    var buColors = { SBU: '#2e7d32', EBU: '#1565c0', WBU: '#6a1b9a' };
    var stations = ${JSON.stringify(STATIONS.map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, bu: s.bu, region: s.region })))};
    stations.forEach(function(s) {
      var col = buColors[s.bu] || '#333';
      var icon = L.divIcon({
        html: '<div style="background:' + col + ';color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)">' + s.bu + '</div>',
        iconSize: [32,32], iconAnchor: [16,16], className: ''
      });
      L.marker([s.lat, s.lon], {icon: icon}).addTo(map)
        .bindPopup('<strong>' + s.name + '</strong><br>' + s.bu + ' — ' + s.region + '<br><small>' + s.lat.toFixed(3) + '°N ' + Math.abs(s.lon).toFixed(3) + '°W</small>');
    });

    var assets = ${JSON.stringify(KEY_ASSETS.map(a => ({ name: a.name, lat: a.lat, lon: a.lon })))};
    assets.forEach(function(a) {
      var icon = L.divIcon({
        html: '<div style="background:#e65100;color:#fff;border-radius:3px;padding:2px 4px;font-size:9px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4)">⬛</div>',
        iconSize: [14,14], iconAnchor: [7,7], className: ''
      });
      L.marker([a.lat, a.lon], {icon: icon}).addTo(map)
        .bindPopup('<strong>' + a.name + '</strong><br><small>' + a.lat.toFixed(3) + '°N ' + Math.abs(a.lon).toFixed(3) + '°W</small>');
    });

    var fires = ${JSON.stringify(activeFires.slice(0, 20).map(f => ({ lat: f.lat, lon: f.lon, frp: f.frp, hfi: f.hfi, asset: f.nearestAsset, dist: f.distanceKm, ambiguous: f.isAmbiguous })))};
    fires.forEach(function(f) {
      var col = f.ambiguous ? '#f9a825' : '#c62828';
      var r = Math.max(6, Math.min(20, (f.frp || 5) / 8));
      L.circleMarker([f.lat, f.lon], { radius: r, color: col, fillColor: col, fillOpacity: 0.6, weight: 1.5 }).addTo(map)
        .bindPopup((f.ambiguous ? '⚠ Near facility — verify source<br>' : '🔥 Fire Detection<br>') +
          'FRP: ' + (f.frp > 0 ? f.frp.toFixed(0) + ' MW' : '—') +
          ' · HFI: ' + (f.hfi > 0 ? f.hfi.toFixed(0) + ' kW/m' : '—') +
          '<br>Nearest asset: ' + f.asset + ' (' + f.dist + ' km)');
    });

    var flareList = ${JSON.stringify(flares.slice(0, 15).map(f => ({ lat: f.lat, lon: f.lon, frp: f.frp, facility: f.nearestFacility, dist: f.facilityDistKm })))};
    flareList.forEach(function(f) {
      L.circleMarker([f.lat, f.lon], { radius: 5, color: '#ff8f00', fillColor: '#ff8f00', fillOpacity: 0.5, weight: 1, dashArray: '4 2' }).addTo(map)
        .bindPopup('🏭 Industrial Flare<br>FRP: ' + (f.frp > 0 ? f.frp.toFixed(0) + ' MW' : '—') +
          '<br>Facility: ' + (f.facility || '—') + ' (' + (f.dist != null ? f.dist.toFixed(1) + ' km' : '—') + ')');
    });

    // Map legend
    var legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      var d = L.DomUtil.create('div');
      d.style.cssText = 'background:#fff;padding:8px 12px;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,.2);font-size:11px;line-height:1.8';
      d.innerHTML =
        '<div style="font-weight:700;margin-bottom:4px">Legend</div>' +
        '<div><span style="display:inline-block;width:14px;height:14px;background:#2e7d32;border-radius:50%;vertical-align:middle;margin-right:4px"></span>SBU Station</div>' +
        '<div><span style="display:inline-block;width:14px;height:14px;background:#1565c0;border-radius:50%;vertical-align:middle;margin-right:4px"></span>EBU Station</div>' +
        '<div><span style="display:inline-block;width:14px;height:14px;background:#6a1b9a;border-radius:50%;vertical-align:middle;margin-right:4px"></span>WBU Station</div>' +
        '<div><span style="display:inline-block;width:14px;height:14px;background:#e65100;border-radius:3px;vertical-align:middle;margin-right:4px"></span>Petronas Asset</div>' +
        '<div><span style="display:inline-block;width:14px;height:14px;background:#c62828;border-radius:50%;vertical-align:middle;margin-right:4px"></span>Fire Detection</div>' +
        '<div><span style="display:inline-block;width:14px;height:14px;background:#ff8f00;border-radius:50%;vertical-align:middle;margin-right:4px"></span>Industrial Flare</div>' +
        '<div><span style="display:inline-block;width:14px;height:14px;background:#f9a825;border-radius:50%;vertical-align:middle;margin-right:4px"></span>⚠ Ambiguous</div>';
      return d;
    };
    legend.addTo(map);
  })();
  </script>
</section>

<!-- ─── Section 2: Station Danger Ratings ──────────────────────────────────── -->
<section>
  <h2>Fire Danger Ratings — Monitoring Stations</h2>
  <table>
    <thead>
      <tr>
        <th style="width:130px">Weather Station</th>
        <th style="width:130px;text-align:center">Business Unit</th>
        <th style="width:120px;text-align:center">Current Fire<br>Danger Rating</th>
        <th style="width:60px;text-align:center"># Days at<br>Current Rating</th>
        <th style="min-width:240px">Current Restrictions</th>
        <th style="width:100px">Weather (Today)</th>
        <th style="text-align:center" colspan="3">3-Day FWI Forecast</th>
      </tr>
    </thead>
    <tbody>
      ${stationRows}
    </tbody>
  </table>
  <p class="note" style="margin-top:8px">FWI = Fire Weather Index. Danger ratings follow CIFFC/BCWS classification thresholds (L &lt;8 · M 8–16 · H 17–29 · VH 30–49 · E ≥50). Current Restrictions reflect Petronas operational protocol — confirm with the Site Supervisor and current BC Wildfire Service orders at bcwildfire.ca before high-risk activity.</p>
</section>

<!-- ─── Section 3: High Risk Activity Restrictions Matrix ──────────────────── -->
<!-- Mirrors the Petronas-published protocol matrix exactly (page 1 of the
     Daily Wildfire & Air Quality Report). The wording and triggers are
     load-bearing — these are the rules field ops apply, not advisory text. -->
<section>
  <h2>High Risk Activity Restrictions</h2>
  <p style="font-size:12px;color:#555;margin-bottom:8px">
    Three-step decision: <strong>(1)</strong> determine whether the proposed activity is a high risk activity (see definitions below); <strong>(2)</strong> find the danger rating at the operational location; <strong>(3)</strong> apply the matching restriction below.
  </p>
  <table>
    <thead>
      <tr>
        <th style="width:140px">Fire Danger Rating</th>
        <th>Restriction</th>
        <th style="width:280px">Duration</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><span style="background:#2e7d32;color:#fff;padding:4px 12px;border-radius:4px;font-weight:700;font-size:12px">LOW</span></td>
        <td>No work restrictions. Continue normal daily work practices.</td>
        <td>Until Moderate danger rating is established.</td>
      </tr>
      <tr>
        <td><span style="background:#f9a825;color:#333;padding:4px 12px;border-radius:4px;font-weight:700;font-size:12px">MODERATE</span></td>
        <td>After 3 consecutive days, maintain a fire watcher after work for a minimum of 1 hour.</td>
        <td>Until the danger rating falls down to Low.</td>
      </tr>
      <tr>
        <td rowspan="2"><span style="background:#e65100;color:#fff;padding:4px 12px;border-radius:4px;font-weight:700;font-size:12px">HIGH</span></td>
        <td>Maintain a fire watcher after work for a minimum of 2 hours.</td>
        <td>Until the danger rating falls down to Moderate.</td>
      </tr>
      <tr>
        <td>After 3 consecutive days, cease activity between 1 pm and sunset each day.</td>
        <td>Until the danger rating falls down to Moderate for 2 consecutive days.</td>
      </tr>
      <tr>
        <td rowspan="2"><span style="background:#c62828;color:#fff;padding:4px 12px;border-radius:4px;font-weight:700;font-size:12px">EXTREME</span></td>
        <td>Cease activity between 1 pm and sunset each day and maintain a fire watcher after work for a minimum of 2 hours.</td>
        <td>Until the danger rating falls down to High for 2 consecutive days.</td>
      </tr>
      <tr>
        <td>After 3 consecutive days, cease all activity for the entire day.</td>
        <td>Until the danger rating falls down to High for 3 or more consecutive days.</td>
      </tr>
    </tbody>
  </table>
  <p class="note" style="margin-top:8px">Verify with Site Supervisor and current BC Wildfire Service orders at bcwildfire.ca before commencing high-risk activity. The "Current Restrictions" column in the station table above already pre-computes the active rule using each station's days-at-rating count.</p>
</section>

<!-- ─── Section 3b: High Risk Activity Definitions (statutory list) ──────── -->
<section>
  <h2>High Risk Activity Definitions</h2>
  <p style="font-size:12px;color:#555;margin-bottom:8px">
    Per BC Wildfire Act / Wildfire Regulation, the following are <strong>high risk activities</strong> subject to the restrictions table above when conducted in or within 300 metres of forest land or grass land:
  </p>
  <ol style="font-size:12px;color:#333;line-height:1.7;padding-left:20px;margin:0">
    <li>mechanical brushing;</li>
    <li>disk trenching;</li>
    <li>preparation or use of explosives;</li>
    <li>using fire- or spark-producing tools, including cutting tools;</li>
    <li>using or preparing fireworks or pyrotechnics;</li>
    <li>grinding, including rail grinding;</li>
    <li>mechanical land clearing (heavy equipment clearing existing vegetation such as trees, grasses, or shrubbery);</li>
    <li>clearing and maintaining rights of way, including grass mowing;</li>
    <li>any of the following activities carried out in a cutblock excluding a road, landing, roadside work area or log sort area in the cutblock:
      <ol style="list-style-type:lower-roman;padding-left:24px;margin-top:4px">
        <li>operating a power saw;</li>
        <li>mechanical tree felling, woody debris piling or tree processing, including de-limbing;</li>
        <li>welding;</li>
        <li>portable wood chipping, milling, processing or manufacturing;</li>
        <li>skidding logs or log forwarding unless it is improbable that the skidding or forwarding will result in the equipment contacting rock;</li>
        <li>yarding logs using cable systems.</li>
      </ol>
    </li>
  </ol>
</section>

<!-- Section 4 (CWFIS Active Fire Detections) removed: low operational
     value vs the BCWS Official Active Fire Registry below. CWFIS
     hotspots that ALSO appear in the BCWS registry are duplicate work;
     hotspots that DON'T appear are mostly false positives or industrial
     flares (which have their own section). The BCWS registry is the
     authoritative source for what's an actual managed fire — that's
     what made the cut. CWFIS is still pulled by monitor-wildfires for
     real-time signal generation and is available to chat agents via
     get_wildfire_hotspots_near; we just don't surface it as a report
     section anymore. -->

<!-- ─── Section 4a-bis: Active Evacuation Orders & Alerts (BCWS) ──────────── -->
<!-- Operationally most urgent — surfaces here ahead of detection sections.
     Order = mandatory leave-now; Alert = be ready to leave on short notice. -->
${(() => {
  const orders = bcwsEvacs.filter(e => e.status === 'Order');
  const alerts = bcwsEvacs.filter(e => e.status === 'Alert');
  if (orders.length === 0 && alerts.length === 0) {
    return `<section>
      <h2>Active Evacuation Orders &amp; Alerts (BCWS)</h2>
      <p class="no-data">No active BCWS evacuation orders or alerts within the report's coverage area.</p>
    </section>`;
  }
  const renderRow = (e: any, isOrder: boolean) => {
    const colour = isOrder ? '#b71c1c' : '#e65100';
    const label = isOrder ? '🚨 ORDER' : '⚠ ALERT';
    const pop = e.population != null ? e.population.toLocaleString() : '—';
    const homes = e.homes != null ? e.homes.toLocaleString() : '—';
    const issued = e.start_date ? new Date(e.start_date).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    const gMaps = `https://maps.google.com/?q=${e.lat.toFixed(4)},${e.lng.toFixed(4)}&t=k`;
    return `<tr>
      <td style="text-align:center;font-weight:700;color:${colour}">${label}</td>
      <td>${(e.event_name || e.order_alert_name || '—')}</td>
      <td style="font-size:12px">${e.event_type || 'wildfire'}</td>
      <td style="text-align:right">${pop}</td>
      <td style="text-align:right">${homes}</td>
      <td style="font-size:12px">${e.issuing_agency || '—'}</td>
      <td style="font-size:11px">${issued}</td>
      <td style="font-family:monospace;font-size:11px">
        ${e.lat.toFixed(3)}°N ${Math.abs(e.lng).toFixed(3)}°W<br>
        <a href="${gMaps}" target="_blank" style="color:#1565c0;font-size:10px">Map</a>
      </td>
    </tr>`;
  };
  return `<section>
    <h2>Active Evacuation Orders &amp; Alerts (BCWS)</h2>
    <p style="font-size:12px;color:#555;margin-bottom:12px">
      Official British Columbia evacuation directives. <strong>Orders</strong> mandate immediate departure; <strong>Alerts</strong> direct residents to be ready to leave on short notice. Population and homes counts are BCWS-published estimates.
    </p>
    <div class="info-row" style="display:flex;gap:12px;margin-bottom:12px">
      <div class="info-box" style="flex:1;min-width:120px;border-left:4px solid #b71c1c">
        <div style="font-size:24px;font-weight:800;color:#b71c1c">${orders.length}</div>
        <div style="font-size:12px;color:#555">Active Orders</div>
      </div>
      <div class="info-box" style="flex:1;min-width:120px;border-left:4px solid #e65100">
        <div style="font-size:24px;font-weight:800;color:#e65100">${alerts.length}</div>
        <div style="font-size:12px;color:#555">Active Alerts</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Event</th>
          <th>Type</th>
          <th style="text-align:right">Population</th>
          <th style="text-align:right">Homes</th>
          <th>Agency</th>
          <th>Issued</th>
          <th>Centroid</th>
        </tr>
      </thead>
      <tbody>
        ${orders.slice(0, 15).map(e => renderRow(e, true)).join('')}
        ${alerts.slice(0, 15).map(e => renderRow(e, false)).join('')}
      </tbody>
    </table>
  </section>`;
})()}

<!-- ─── Section 4a-bis2: BCWS Official Active Fire Registry ───────────────── -->
<!-- Distinct from CWFIS (satellite). BCWS = official provincial fire response.
     Used for corroboration: a CWFIS hotspot WITH a nearby BCWS fire is a
     confirmed wildfire, not flaring/false-positive. Sorted by size. -->
${(() => {
  if (bcwsFires.length === 0) {
    return `<section>
      <h2>BCWS Official Active Fire Registry</h2>
      <p class="no-data">No active BCWS-registered fires within the report's coverage area.</p>
    </section>`;
  }
  const sorted = [...bcwsFires].sort((a, b) => (b.size_ha ?? 0) - (a.size_ha ?? 0));
  const ofNoteCount = sorted.filter(f => f.is_fire_of_note).length;
  const oocCount = sorted.filter(f => f.status === 'Out of Control').length;
  const statusColor = (s: string) =>
    s === 'Out of Control' ? '#b71c1c' :
    s === 'Being Held' ? '#e65100' :
    s === 'Under Control' ? '#2e7d32' : '#555';
  return `<section>
    <h2>BCWS Official Active Fire Registry</h2>
    <p style="font-size:12px;color:#555;margin-bottom:12px">
      Official BC Wildfire Service registry — distinct from CWFIS satellite hotspots above.
      A fire here means BCWS has formally identified, numbered, and is actively responding.
      Use this section to <strong>corroborate</strong> CWFIS detections: a CWFIS hotspot with a BCWS match within ~10 km is a confirmed wildfire.
    </p>
    <div class="info-row" style="display:flex;gap:12px;margin-bottom:12px">
      <div class="info-box" style="flex:1;min-width:120px;border-left:4px solid #1565c0">
        <div style="font-size:24px;font-weight:800;color:#1565c0">${sorted.length}</div>
        <div style="font-size:12px;color:#555">Active in coverage area</div>
      </div>
      <div class="info-box" style="flex:1;min-width:120px;border-left:4px solid #b71c1c">
        <div style="font-size:24px;font-weight:800;color:#b71c1c">${oocCount}</div>
        <div style="font-size:12px;color:#555">Out of Control</div>
      </div>
      <div class="info-box" style="flex:1;min-width:120px;border-left:4px solid #6a1b9a">
        <div style="font-size:24px;font-weight:800;color:#6a1b9a">${ofNoteCount}</div>
        <div style="font-size:12px;color:#555">Wildfires of Note</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Fire #</th>
          <th>Incident</th>
          <th>Status</th>
          <th style="text-align:right">Size (ha)</th>
          <th>Cause</th>
          <th>Centre / Zone</th>
          <th>Coordinates</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.slice(0, 20).map(f => {
          const sc = statusColor(f.status);
          const note = f.is_fire_of_note ? ' ⭐' : '';
          const gMaps = `https://maps.google.com/?q=${f.lat.toFixed(4)},${f.lng.toFixed(4)}&t=k`;
          const fireUrl = f.fire_url ? `<a href="${f.fire_url}" target="_blank" style="color:#1565c0;font-size:10px">Details</a>` : '';
          return `<tr>
            <td style="font-family:monospace;font-size:11px">${f.fire_number}${note}</td>
            <td style="font-size:12px">${f.incident_name || f.geographic_description || '—'}</td>
            <td style="color:${sc};font-weight:600;font-size:12px">${f.status}</td>
            <td style="text-align:right">${f.size_ha != null ? f.size_ha.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</td>
            <td style="font-size:12px">${f.cause || '—'}</td>
            <td style="font-size:11px">${f.fire_centre || '—'}${f.zone ? ` / ${f.zone}` : ''}</td>
            <td style="font-family:monospace;font-size:11px">
              ${f.lat.toFixed(3)}°N ${Math.abs(f.lng).toFixed(3)}°W<br>
              <a href="${gMaps}" target="_blank" style="color:#1565c0;font-size:10px">Map</a>${fireUrl ? ' · ' + fireUrl : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <p class="note" style="margin-top:8px">⭐ = Wildfire of Note (BCWS priority public-attention fire). Status: Out of Control 🔴 · Being Held 🟠 · Under Control 🟢.</p>
  </section>`;
})()}

<!-- Section 4b (Industrial Thermal Events / Flares) removed: operator
     decision. Flares aren't actionable security events for clients —
     blowdowns, planned burns, equipment anomalies — and
     monitor-wildfires already classifies them as 'industrial_flaring'
     so they don't enter the signal feed. Recording the per-flare
     table in the daily report added noise without operational value.
     The map still renders flare circles for situational awareness;
     this just removes the table section. -->

<!-- ─── Section 4c: Lightning Activity ─────────────────────────────────────── -->
<section>
  <h2>Lightning Activity — Last 24 Hours (BCLDN/CWFIS)</h2>
  <p style="font-size:12px;color:#555;margin-bottom:12px">
    Lightning is the primary cause of remote wildfire ignitions in BC. Positive cloud-to-ground strokes carry 4–5× higher ignition probability.
    Latent ignitions can smolder for 24–72 hours before becoming visible fires — strikes with no corresponding hotspot are high-priority monitoring targets.
  </p>
  ${lightning.length > 0 ? `
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px">
      <div class="info-box" style="flex:1;min-width:120px;border-left:4px solid #f9a825">
        <div style="font-size:24px;font-weight:800;color:#f9a825">${lightning.length}</div>
        <div style="font-size:12px;color:#555">Strikes in operational zone</div>
      </div>
      <div class="info-box" style="flex:1;min-width:120px;border-left:4px solid #c62828">
        <div style="font-size:24px;font-weight:800;color:#c62828">${lightningCorrelated.length}</div>
        <div style="font-size:12px;color:#555">Correlated with active hotspot</div>
      </div>
      <div class="info-box" style="flex:1;min-width:120px;border-left:4px solid #6a1b9a">
        <div style="font-size:24px;font-weight:800;color:#6a1b9a">${lightningLatent.length}</div>
        <div style="font-size:12px;color:#555">Latent risk (no hotspot yet)</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Coordinates</th>
          <th style="text-align:center">Polarity</th>
          <th style="text-align:center">Peak Current</th>
          <th>Nearest Asset</th>
          <th style="text-align:center">Distance</th>
          <th style="text-align:center">Status</th>
        </tr>
      </thead>
      <tbody>
        ${lightning.slice(0, 20).map((s) => {
          const statusColor = s.hasNearbyFire ? '#c62828' : '#6a1b9a';
          const statusLabel = s.hasNearbyFire ? '🔥 Fire detected' : '⚡ Monitor — no hotspot';
          const polColor = s.polarity === 'positive' ? '#c62828' : '#555';
          const gMaps = `https://maps.google.com/?q=${s.lat.toFixed(4)},${s.lon.toFixed(4)}&t=k`;
          const worldview = `https://worldview.earthdata.nasa.gov/?v=${(s.lon - 0.4).toFixed(3)},${(s.lat - 0.4).toFixed(3)},${(s.lon + 0.4).toFixed(3)},${(s.lat + 0.4).toFixed(3)}&t=${isoDate}&l=VIIRS_SNPP_Fires_375m_Day,VIIRS_SNPP_Fires_375m_Night,Coastlines_15m,OSM_Land_Water_Map`;
          return `<tr>
            <td style="font-family:monospace;font-size:11px">
              ${s.lat.toFixed(4)}°N ${Math.abs(s.lon).toFixed(4)}°W<br>
              <span style="font-size:10px">
                <a href="${gMaps}" target="_blank" style="color:#1565c0">Satellite</a> ·
                <a href="${worldview}" target="_blank" style="color:#1565c0">VIIRS</a>
              </span>
            </td>
            <td style="text-align:center;color:${polColor};font-weight:600">${s.polarity}</td>
            <td style="text-align:center">${s.peakCurrentKA > 0 ? s.peakCurrentKA.toFixed(0) + ' kA' : '—'}</td>
            <td style="font-size:11px">${s.nearestAsset}</td>
            <td style="text-align:center;font-weight:700">${s.distanceKm} km</td>
            <td style="text-align:center;color:${statusColor};font-weight:600;font-size:11px">${statusLabel}</td>
          </tr>`;
        }).join('\n')}
      </tbody>
    </table>
    <p class="note" style="margin-top:8px">Positive strokes = red. Monitor latent strikes daily for 72h — if a hotspot appears at the same location, classify as lightning-caused ignition.</p>
  ` : `<p class="no-data">No lightning activity detected in operational zone during the last 24 hours. ${!season.isFireSeason ? '(Off-season — low lightning frequency is expected.)' : ''}</p>`}
</section>

<!-- Section 5 (Platform Fire Intelligence Signals) removed: duplicate
     of the BCWS Official Active Fire Registry and Active Evacuations
     sections above. The platform's own wildfire-category signals are
     CWFIS-derived; with the dedicated CWFIS section already removed
     this section was repeating the same data through a different lens.
     Signals remain available in the AEGIS feed and via chat agents. -->

<!-- ─── Section 6: AQHI — Fort St. John (Current + Tomorrow side-by-side) ── -->
<section>
  <h2>Air Quality Health Index — Fort St. John</h2>
  ${(() => {
    // Tomorrow's AQHI is the first non-current forecast period.
    const fcTomorrow = (aqhi.forecast || []).find((f: any) => f && f.aqhi != null) ?? null;
    const tomColor = fcTomorrow
      ? (fcTomorrow.aqhi >= 10 ? '#6a1b9a' : fcTomorrow.aqhi >= 7 ? '#c62828' : fcTomorrow.aqhi >= 4 ? '#f9a825' : '#2e7d32')
      : '#888';
    return `
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px;border:2px solid ${aqhiColor};border-radius:8px;padding:16px;text-align:center;background:#fafafa">
        <div style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.6px">Current AQHI (Fort St. John)</div>
        <div style="font-size:48px;font-weight:800;color:${aqhiColor};margin:8px 0 4px">${aqhi.current ?? '—'}</div>
        <div style="font-size:14px;font-weight:700;color:${aqhiColor}">${aqhi.category}</div>
      </div>
      <div style="flex:1;min-width:240px;border:2px solid ${tomColor};border-radius:8px;padding:16px;text-align:center;background:#fafafa">
        <div style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.6px">Forecast Tomorrow (Fort St. John)</div>
        <div style="font-size:48px;font-weight:800;color:${tomColor};margin:8px 0 4px">${fcTomorrow?.aqhi ?? '—'}</div>
        <div style="font-size:14px;font-weight:700;color:${tomColor}">${fcTomorrow?.category ?? '—'}</div>
      </div>
    </div>
    <div class="info-box" style="margin-top:14px;border-left:4px solid ${aqhiColor}">
      <strong style="font-size:12px">Health Message:</strong>
      <p style="margin-top:4px;font-size:12px;color:#444">${aqhi.health_message}</p>
    </div>`;
  })()}
  <div style="margin-top:14px">
    <table>
      <thead>
        <tr><th style="width:120px">Health Risk</th><th style="width:90px;text-align:center">AQHI Index</th><th>At Risk Population¹</th><th>General Population</th></tr>
      </thead>
      <tbody>
        <tr>
          <td style="background:#2e7d32;color:#fff;font-weight:700;text-align:center">Low</td>
          <td style="text-align:center">1 – 3</td>
          <td>Enjoy your usual outdoor activities.</td>
          <td>Ideal air quality for outdoor activities.</td>
        </tr>
        <tr>
          <td style="background:#f9a825;color:#333;font-weight:700;text-align:center">Moderate</td>
          <td style="text-align:center">4 – 6</td>
          <td>Consider reducing or rescheduling strenuous activities outdoors if you are experiencing symptoms.</td>
          <td>No need to modify your usual outdoor activities unless you experience symptoms such as coughing and throat irritation.</td>
        </tr>
        <tr>
          <td style="background:#c62828;color:#fff;font-weight:700;text-align:center">High</td>
          <td style="text-align:center">7 – 10</td>
          <td>Reduce or reschedule strenuous activities outdoors. Children and the elderly should also take it easy.</td>
          <td>Consider reducing or rescheduling strenuous activities outdoors if you experience symptoms such as coughing and throat irritation.</td>
        </tr>
        <tr>
          <td style="background:#6a1b9a;color:#fff;font-weight:700;text-align:center">Very High</td>
          <td style="text-align:center">Above 10</td>
          <td>Avoid strenuous activities outdoors. Children and the elderly should also avoid outdoor physical exertion.</td>
          <td>Reduce or reschedule strenuous activities outdoors, especially if you experience symptoms such as coughing and throat irritation.</td>
        </tr>
      </tbody>
    </table>
    <p class="note" style="margin-top:6px;font-size:11px">¹ People with heart or breathing problems are at greater risk. Follow your doctor's usual advice about exercising and managing your condition. If the AQHI index has increased to 7 (high health risk), it is usually because of high concentrations of smoke particles (PM2.5) in this community.</p>
    <p class="note" style="margin-top:4px;font-size:11px">AQHI data from Environment Canada MSC (api.weather.gc.ca). During active wildfire smoke events, AQHI may change rapidly — monitor hourly updates.</p>
  </div>
</section>

<!-- ─── Section 7: 3-Day Fire Weather Forecast ──────────────────────────────── -->
<section>
  <h2>3-Day Fire Weather Outlook by Station</h2>
  <table>
    <thead>
      <tr>
        <th>Station</th>
        <th style="text-align:center">BU</th>
        ${stationsData[0]?.weather?.forecast?.map(f =>
          `<th style="text-align:center">${f.date}</th>`
        ).join('') ?? ''}
      </tr>
    </thead>
    <tbody>
      ${stationsData.map(sd => `<tr>
        <td>${sd.station.name}</td>
        <td style="text-align:center">${sd.station.bu}</td>
        ${(sd.weather?.forecast ?? []).map(f => {
          const fd = fwiToDangerRating(f.fwi);
          const tc = fd.code === 'M' ? '#333' : '#fff';
          return `<td style="text-align:center">
            <span style="background:${fd.color};color:${tc};padding:3px 8px;border-radius:3px;font-size:11px;font-weight:600">${fd.code}</span>
            <div style="font-size:10px;color:#666;margin-top:2px">FWI ${f.fwi}</div>
            <div style="font-size:10px;color:#888">${f.tempMax}°C · ${f.precip > 0 ? f.precip.toFixed(1)+'mm' : 'No rain'}</div>
          </td>`;
        }).join('')}
      </tr>`).join('\n')}
    </tbody>
  </table>
  <p class="note" style="margin-top:8px">Forecast from Open-Meteo. FWI thresholds: L &lt;8 · M 8–16 · H 17–29 · VH 30–49 · E ≥50.</p>
</section>

<!-- ─── Section 8: Recommendations ─────────────────────────────────────────── -->
<section>
  <h2>Operational Recommendations</h2>
  <ul class="rec-list">
    ${highestCode === 'E' ? `
    <li>IMMEDIATE: Issue total burn ban across all Petronas PECL operational sites. No exceptions without VP approval.</li>
    <li>IMMEDIATE: Activate fire emergency response pre-positioning at ${highestRisk.station.name} area.</li>
    <li>IMMEDIATE: Restrict all chainsaw, grinder, and hot work operations site-wide.</li>
    <li>IMMEDIATE: Brief all field personnel on evacuation routes and emergency assembly points.</li>
    <li>Monitor CWFIS active fire map every 30 minutes during extreme conditions.</li>
    ` : highestCode === 'VH' ? `
    <li>Enforce campfire prohibition and Category 2 burn ban at all sites in VH rating zones.</li>
    <li>All Hot Work permits require additional sign-off; standby firefighting equipment mandatory.</li>
    <li>Review OHV operation hours — restrict to early morning before 10:00 MST when practical.</li>
    <li>Pre-position water tenders and firefighting equipment at high-risk locations.</li>
    <li>Confirm evacuation routes and emergency contacts are current for all field crews.</li>
    ` : highestCode === 'H' ? `
    <li>Campfire restrictions in effect — communicate to all field personnel and contractors.</li>
    <li>Review pending Hot Work permits; ensure firewatch and extinguisher requirements are met.</li>
    <li>Inspect all equipment for fuel leaks and spark arrestors before deployment.</li>
    <li>Ensure fire extinguishers, shovels, and water cans are on all field vehicles.</li>
    ` : highestCode === 'M' ? `
    <li>Standard fire prevention protocols apply. Conduct daily equipment inspection.</li>
    <li>Brief field crews on campfire regulations and fire reporting procedures.</li>
    <li>Ensure all vehicles carry fire suppression equipment (extinguisher, water, shovel).</li>
    ` : `
    <li>Low fire danger — standard protocols apply. Continue routine monitoring.</li>
    <li>Ensure fire suppression equipment is inspected and ready for rapid transition if ratings increase.</li>
    `}
    <li>Report any smoke or fire observations immediately to BC Wildfire Service: 1-800-663-5555.</li>
    <li>Next report scheduled for tomorrow morning. Monitor bcwildfire.ca for real-time orders.</li>
  </ul>
</section>

<!-- ─── Footer ──────────────────────────────────────────────────────────────── -->
<div style="background:#f0f4f8;padding:16px 32px;font-size:11px;color:#666;display:flex;justify-content: space-between">
  <div>Petronas Canada (PECL) · HSE Operations Intelligence · AEGIS Platform</div>
  <div>Generated ${generatedAt} · Sources: CWFIS/NRCan, Open-Meteo, AQHI/Environment Canada</div>
  <div>CONFIDENTIAL — INTERNAL USE ONLY</div>
</div>

</div>
</body>
</html>`;
}

// ─── Main Handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date();
    const reportDate = now.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: 'long', day: 'numeric' });
    const generatedAt = now.toLocaleString('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hour12: false }) + ' MST';

    // ── 1. Fetch weather + FWI for all stations in parallel ──────────────────
    const weatherResults = await Promise.all(
      STATIONS.map(s => fetchStationWeather(s.lat, s.lon))
    );

    // ── 2. Build station data and update DB ───────────────────────────────────
    const today = now.toISOString().split('T')[0];
    const stationsData: StationData[] = [];

    // Fetch the OFFICIAL BCWS danger rating for each station's coordinates
    // in parallel. This is the same source Petronas's published Daily
    // Wildfire Report reads from — replaces our local estimateFwi proxy
    // for the rating column. We still keep the Open-Meteo FWI as a
    // fallback (used only when the BCWS spatial query returns null) and
    // for the 3-day forecast cells (BCWS doesn't publish forecast
    // ratings, only today's).
    const { fetchBCWSDangerRatingAtPoint } = await import("../_shared/bcws.ts");
    const officialRatings = await Promise.all(
      STATIONS.map((s) =>
        fetchBCWSDangerRatingAtPoint(s.lat, s.lon).catch((e: any) => {
          console.warn(`[wildfire-report] BCWS rating fetch failed for ${s.name}: ${e?.message || e}`);
          return null;
        })
      )
    );

    for (let i = 0; i < STATIONS.length; i++) {
      const station = STATIONS[i];
      const weather = weatherResults[i];
      const fwi = weather?.fwi ?? 0;
      const officialRating = officialRatings[i];

      // Prefer the BCWS official rating; fall back to our FWI estimate
      // only when the spatial query came back empty.
      const dangerInfo = officialRating
        ? {
            rating: officialRating.rating,
            code: officialRating.code,
            color:
              officialRating.code === 'E'  ? '#6a1b9a'
            : officialRating.code === 'VH' ? '#c62828'
            : officialRating.code === 'H'  ? '#e65100'
            : officialRating.code === 'M'  ? '#f9a825'
                                           : '#2e7d32',
          }
        : fwiToDangerRating(fwi);
      const ratingSource = officialRating ? 'bcws_official' : 'estimated_fwi';

      // Upsert today's rating — store the OFFICIAL rating when available
      // so getConsecutiveDays counts the right transitions.
      console.log(`[wildfire-report] ${station.name}: ${dangerInfo.code} (${dangerInfo.rating}) — source=${ratingSource}`);
      await supabase
        .from('wildfire_station_ratings')
        .upsert({
          station_id: station.id,
          station_name: station.name,
          rating_date: today,
          danger_rating: dangerInfo.rating,
          danger_code: dangerInfo.code,
          fwi,
          temp_max_c: weather?.tempMax ?? null,
          rh_min_pct: weather?.rhMin ?? null,
          wind_max_kph: weather?.windMax ?? null,
          wind_dir_deg: weather?.windDir ?? null,
          precip_mm: weather?.precip ?? null,
        }, { onConflict: 'station_id,rating_date' });

      // Get consecutive days at this rating
      const daysAtRating = await getConsecutiveDays(supabase, station.id, dangerInfo.rating);

      // Update the consecutive day count in the upserted row
      await supabase
        .from('wildfire_station_ratings')
        .update({ days_at_current_rating: daysAtRating })
        .eq('station_id', station.id)
        .eq('rating_date', today);

      stationsData.push({
        station,
        weather,
        fwi,
        dangerInfo,
        daysAtRating,
        restrictions: getRestrictions(dangerInfo.code),
      });
    }

    // ── 3. Fetch active fires + flares from CWFIS ────────────────────────────
    const { fires: activeFires, flares } = await fetchActiveFires();

    // ── 4. Fetch lightning + AQHI + BCWS in parallel ─────────────────────────
    // BCWS is the official provincial fire response data — separate
    // from CWFIS satellite hotspots. Used here for (1) corroboration of
    // CWFIS detections in the active-fires section, (2) two new report
    // sections: BCWS official fires + Evacuation Orders/Alerts.
    const { fetchBCWSActiveFires, fetchBCWSEvacuations } = await import("../_shared/bcws.ts");
    const [lightning, aqhi, bcwsFiresRaw, bcwsEvacsRaw] = await Promise.all([
      fetchLightningStrikes(activeFires),
      fetchFortStJohnAqhi(),
      fetchBCWSActiveFires().catch((e: any) => { console.warn(`BCWS fires fetch failed: ${e?.message}`); return []; }),
      fetchBCWSEvacuations().catch((e: any) => { console.warn(`BCWS evacs fetch failed: ${e?.message}`); return []; }),
    ]);

    // Filter BCWS data to PETRONAS OPERATIONAL ZONES, not the whole
    // province. Earlier the filter was a southern-BC BBOX that pulled
    // in Sumas, Lytton, Lions Bay, Cariboo events that have nothing
    // to do with Petronas. Tighter zones below mirror monitor-wildfires
    // OPERATIONAL_ZONES exactly so the report and the cron monitor
    // agree on what 'in scope' means.
    const PETRONAS_ZONES = [
      // Northeast BC (Peace / Montney) — the bulk of Petronas operations
      { minLat: 55.0, maxLat: 60.0, minLon: -125.0, maxLon: -119.0 },
      // Skeena / Kitimat corridor — LNG Canada terminal
      { minLat: 53.0, maxLat: 56.0, minLon: -130.0, maxLon: -125.0 },
      // Calgary region — corporate / staging
      { minLat: 50.5, maxLat: 51.5, minLon: -115.0, maxLon: -113.5 },
    ];
    const inOperationalZone = (lat: number, lng: number): boolean =>
      PETRONAS_ZONES.some((z) => lat >= z.minLat && lat <= z.maxLat && lng >= z.minLon && lng <= z.maxLon);

    // Drop evacuations issued >12 months ago. BCWS sometimes leaves
    // legacy entries in the registry without rescinding them properly
    // (e.g. a 2021 Shackan flood order surfacing as 'active' in 2026).
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const isRecent = (iso: string | null): boolean => {
      if (!iso) return true; // null start_date = keep, can't tell
      const t = new Date(iso).getTime();
      return Number.isFinite(t) && t >= oneYearAgo;
    };

    const bcwsFires = bcwsFiresRaw.filter((f: any) => inOperationalZone(f.lat, f.lng));
    const bcwsEvacs = bcwsEvacsRaw.filter((e: any) => inOperationalZone(e.lat, e.lng) && isRecent(e.start_date));

    // ── 5. Query recent wildfire signals from DB ──────────────────────────────
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: dbSignals } = await supabase
      .from('signals')
      .select('id, title, severity, created_at, raw_json')
      .in('category', ['wildfire', 'industrial_flaring'])
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(10);

    // ── 6. Build HTML report ──────────────────────────────────────────────────
    const html = buildHtmlReport({
      reportDate,
      generatedAt,
      stationsData,
      activeFires,
      flares,
      lightning,
      aqhi,
      dbSignals: dbSignals ?? [],
      bcwsFires,
      bcwsEvacs,
    });

    return new Response(
      JSON.stringify({
        success: true,
        html,
        metadata: {
          report_date: today,
          generated_at: now.toISOString(),
          station_count: stationsData.length,
          active_fire_count: activeFires.length,
          flare_count: flares.length,
          lightning_count: lightning.length,
          lightning_latent_count: lightning.filter(s => !s.hasNearbyFire).length,
          db_signal_count: (dbSignals ?? []).length,
          bcws_active_fires: bcwsFires.length,
          bcws_evacuation_orders: bcwsEvacs.filter((e: any) => e.status === 'Order').length,
          bcws_evacuation_alerts: bcwsEvacs.filter((e: any) => e.status === 'Alert').length,
          highest_rating: stationsData.reduce((a, b) => {
            const order = { L: 0, M: 1, H: 2, VH: 3, E: 4 };
            return (order[a.dangerInfo.code as keyof typeof order] ?? 0) >=
                   (order[b.dangerInfo.code as keyof typeof order] ?? 0) ? a : b;
          }).dangerInfo.rating,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('generate-wildfire-daily-report error:', err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
