/**
 * Open-Meteo data fetchers — hourly weather forecast + elevation grid.
 *
 * Free, no API key. Used by simulate-fire-spread to wire real
 * forecast + topography into the spread engine (Phase B).
 *
 * Forecast: 72h hourly (extends to 16d on free tier; we cap at 72h
 *           to match the simulator's max horizon).
 * Elevation: Copernicus DEM 30m, sampled at any lat/lng. Batched in
 *            100-point requests to stay under URL length limits.
 */

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

export interface HourlyWeather {
  time: string;           // ISO timestamp (UTC)
  tempC: number;
  rhPct: number;
  windKph: number;
  windDir: number;        // wind FROM, compass degrees (0=N, 90=E)
  precipMm: number;
}

export async function fetchHourlyForecast(
  lat: number,
  lng: number,
  hours = 72,
): Promise<HourlyWeather[]> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set(
    "hourly",
    "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation",
  );
  url.searchParams.set("forecast_days", String(Math.max(1, Math.min(7, Math.ceil(hours / 24)))));
  url.searchParams.set("timezone", "UTC");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
  const j = await res.json();
  const h = j?.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error("Open-Meteo: no hourly data");

  const out: HourlyWeather[] = [];
  const N = Math.min(hours, h.time.length);
  for (let i = 0; i < N; i++) {
    out.push({
      time: String(h.time[i]),
      tempC: Number(h.temperature_2m?.[i] ?? 0),
      rhPct: Number(h.relative_humidity_2m?.[i] ?? 50),
      windKph: Number(h.wind_speed_10m?.[i] ?? 0),
      windDir: Number(h.wind_direction_10m?.[i] ?? 0),
      precipMm: Number(h.precipitation?.[i] ?? 0),
    });
  }
  return out;
}

/**
 * Fetch elevations for an array of (lat, lng) pairs. Batches at 100
 * points/call to avoid URL-length limits.
 */
export async function fetchElevations(
  lats: number[],
  lngs: number[],
): Promise<number[]> {
  if (lats.length !== lngs.length) throw new Error("lats/lngs length mismatch");
  if (lats.length === 0) return [];

  const BATCH = 100;
  const result: number[] = new Array(lats.length).fill(0);
  let batchIdx = 0;
  for (let i = 0; i < lats.length; i += BATCH) {
    if (batchIdx > 0) {
      // Defensive throttle — Open-Meteo rate-limits after ~5 rapid calls.
      // 250ms between batches keeps us well below their burst threshold.
      await new Promise((r) => setTimeout(r, 250));
    }
    const j = Math.min(i + BATCH, lats.length);
    const sl = lats.slice(i, j).map((v) => v.toFixed(5)).join(",");
    const sg = lngs.slice(i, j).map((v) => v.toFixed(5)).join(",");
    const url = `${ELEVATION_URL}?latitude=${sl}&longitude=${sg}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Open-Meteo elevation HTTP ${res.status} (batch ${batchIdx})`);
    const json = await res.json();
    const arr: number[] = Array.isArray(json?.elevation)
      ? json.elevation
      : (json?.elevation != null ? [json.elevation] : []);
    if (arr.length !== j - i) {
      throw new Error(`Open-Meteo elevation: expected ${j - i} values, got ${arr.length}`);
    }
    for (let k = 0; k < arr.length; k++) result[i + k] = Number(arr[k]) || 0;
    batchIdx++;
  }
  return result;
}

/**
 * Bilinearly interpolate a value from a coarse rectangular grid.
 * coarse[i*coarseW + j] is the sample at (i, j). target (x, y) is in
 * the same coordinate system but at finer resolution.
 */
export function bilinearInterp(
  coarse: number[],
  coarseW: number,
  coarseH: number,
  x: number,
  y: number,
): number {
  // Clamp to grid
  const xc = Math.max(0, Math.min(coarseW - 1.0001, x));
  const yc = Math.max(0, Math.min(coarseH - 1.0001, y));
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = xc - x0;
  const fy = yc - y0;
  const v00 = coarse[y0 * coarseW + x0];
  const v10 = coarse[y0 * coarseW + x1];
  const v01 = coarse[y1 * coarseW + x0];
  const v11 = coarse[y1 * coarseW + x1];
  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bot * fy;
}
