/**
 * Huygens-style cell-based fire spread propagation.
 *
 * Given an ignition point and weather/fuel/topography inputs, simulate
 * fire spread on a 2-D grid. Each cell records its fire arrival time
 * (minutes since ignition); spread propagates via Dijkstra-style
 * relaxation, where the edge cost between adjacent cells is
 * (distance / ROS_in_direction). ROS is computed from FBP fuel + ISI
 * and reduced from head ROS via the elliptical polar form for spread
 * in any direction.
 *
 * Phase A: constant weather snapshot, single fuel type, flat terrain
 * (slope=0). Phase B will swap in hourly weather time-stepping +
 * per-cell DEM/fuel.
 *
 * Output: one closed polygon per checkpoint hour (1, 3, 6, 12, 24,
 * 48, 72), built via convex hull of burned cells. Convex hull
 * over-estimates concave edges but is acceptable for elliptical
 * fires; Phase B can replace with marching-squares for true isolines.
 */

import { calculateISI, calculateROS, calculateLB, calculateHFI, rosAtAngle, type FuelParams } from "./fbp-fuel.ts";

export interface HourlyWeatherSlice {
  time?: string;
  tempC: number;
  rhPct: number;
  windKph: number;
  windDir: number;          // wind FROM (degrees, 0=N clockwise)
  precipMm: number;
}

export interface SpreadInputs {
  ignitionLat: number;
  ignitionLng: number;
  ignitionTime: string;
  durationHours: number;
  /**
   * Hourly weather over the simulation horizon. Length must be at
   * least durationHours. In manual mode the same snapshot is repeated
   * every hour so this still works.
   */
  hourlyWeather: HourlyWeatherSlice[];
  /** Daily-constant FWI moisture indices. Held constant across the sim. */
  ffmc: number;
  bui: number;
  fuel: FuelParams;
  /**
   * Optional per-cell slope grid (percent rise/run). Length must be
   * N_CELLS². When omitted, slope is treated as 0 (flat — Phase A).
   */
  slopeGrid?: Float32Array;
  /**
   * Optional metadata flag — caller can pass through 'forecast' or
   * 'manual' so the output metadata reflects which mode was used.
   */
  weatherMode?: "forecast" | "manual";
}

export interface SpreadCheckpoint {
  hour: number;
  /** Closed polygon as [lng, lat] pairs (last == first). */
  polygon: number[][];
  area_ha: number;
  max_intensity_kw_per_m: number;
  perimeter_km: number;
}

export interface SpreadOutput {
  checkpoints: SpreadCheckpoint[];
  metadata: {
    ignition: { lat: number; lng: number; time: string };
    duration_hours: number;
    fuel: string;
    /** ROS / direction at hour 0 (representative — actual values varied per cell visit). */
    head_ros_m_per_min: number;
    head_fire_intensity_kw_per_m: number;
    length_to_breadth: number;
    spread_direction_deg: number;
    cell_size_m: number;
    grid_radius_m: number;
    cells_burned: number;
    weather_mode: "forecast" | "manual";
    weather_summary: {
      hour_0:  { tempC: number; rhPct: number; windKph: number; windDir: number };
      hour_24: { tempC: number; rhPct: number; windKph: number; windDir: number } | null;
      hour_48: { tempC: number; rhPct: number; windKph: number; windDir: number } | null;
    };
    ffmc: number;
    bui: number;
    slope_used: boolean;
    elevation_range_m?: { min: number; max: number };
    model: string;
    generated_at: string;
    limitations: string[];
  };
}

const CELL_SIZE_M = 250;
const GRID_RADIUS_M = 30000; // 30 km half-side

const CHECKPOINT_HOURS = [1, 3, 6, 12, 24, 48, 72];

// ── Min-heap (binary heap) for Dijkstra-style relaxation ─────────────────
class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);
    this.bubbleUp(this.keys.length - 1);
  }

  pop(): { key: number; value: number } | undefined {
    if (this.keys.length === 0) return undefined;
    const result = { key: this.keys[0], value: this.values[0] };
    const lastK = this.keys.pop()!;
    const lastV = this.values.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastK;
      this.values[0] = lastV;
      this.sinkDown(0);
    }
    return result;
  }

  get size(): number {
    return this.keys.length;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.keys[parent] <= this.keys[idx]) break;
      [this.keys[parent], this.keys[idx]] = [this.keys[idx], this.keys[parent]];
      [this.values[parent], this.values[idx]] = [this.values[idx], this.values[parent]];
      idx = parent;
    }
  }

  private sinkDown(idx: number): void {
    const n = this.keys.length;
    while (true) {
      const left = idx * 2 + 1;
      const right = idx * 2 + 2;
      let smallest = idx;
      if (left < n && this.keys[left] < this.keys[smallest]) smallest = left;
      if (right < n && this.keys[right] < this.keys[smallest]) smallest = right;
      if (smallest === idx) break;
      [this.keys[idx], this.keys[smallest]] = [this.keys[smallest], this.keys[idx]];
      [this.values[idx], this.values[smallest]] = [this.values[smallest], this.values[idx]];
      idx = smallest;
    }
  }
}

// ── Convex hull (Andrew's monotone chain) ────────────────────────────────
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length <= 2) return [...points];
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (O: { x: number; y: number }, A: { x: number; y: number }, B: { x: number; y: number }) =>
    (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);

  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function polygonAreaM2(verts: { x: number; y: number }[]): number {
  // Shoelace, in cell units → multiply by CELL_SIZE_M² for m²
  if (verts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    s += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return Math.abs(s) / 2 * CELL_SIZE_M * CELL_SIZE_M;
}

function polygonPerimeterM(verts: { x: number; y: number }[]): number {
  if (verts.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    const dx = (verts[i].x - verts[j].x) * CELL_SIZE_M;
    const dy = (verts[i].y - verts[j].y) * CELL_SIZE_M;
    p += Math.sqrt(dx * dx + dy * dy);
  }
  return p;
}

// Cell (x,y) → [lng, lat] given ignition location at center of grid.
function cellToLngLat(x: number, y: number, center: number, igLat: number, igLng: number): [number, number] {
  const dxM = (x - center) * CELL_SIZE_M;
  const dyM = (center - y) * CELL_SIZE_M; // y axis: 0 = north
  const dLat = dyM / 111320;
  const dLng = dxM / (111320 * Math.cos(igLat * Math.PI / 180));
  return [igLng + dLng, igLat + dLat];
}

// Compass bearing from cell to neighbor in radians (0 = N, increasing
// clockwise). dx is east, dy is south (since y increases southward).
function bearingFromOffset(dx: number, dy: number): number {
  // atan2(east, north) gives bearing from N clockwise
  return Math.atan2(dx, -dy);
}

export function simulateSpread(input: SpreadInputs): SpreadOutput {
  const N_CELLS = Math.ceil(GRID_RADIUS_M * 2 / CELL_SIZE_M);
  const center = N_CELLS >> 1;
  const total = N_CELLS * N_CELLS;
  const arrival = new Float64Array(total).fill(Infinity);
  arrival[center * N_CELLS + center] = 0;

  if (!input.hourlyWeather || input.hourlyWeather.length === 0) {
    throw new Error("simulateSpread requires hourlyWeather (length >= 1)");
  }
  const slopeGrid = input.slopeGrid && input.slopeGrid.length === total ? input.slopeGrid : null;

  // Hour-0 representative values for the metadata block.
  const w0 = input.hourlyWeather[0];
  const isi0 = calculateISI(input.ffmc, w0.windKph);
  const rosHead0 = calculateROS(input.fuel, isi0, input.bui, slopeGrid ? slopeGrid[center * N_CELLS + center] : 0);
  const hfi0 = calculateHFI(rosHead0, input.fuel);
  const lb0 = calculateLB(w0.windKph);
  const headDirDeg0 = (w0.windDir + 180) % 360;

  // Cache per-hour LB + headDirRad + base-ROS-multiplier-from-wind to
  // avoid recomputing in the hot inner loop. Slope is per-cell so it
  // multiplies later.
  const hourlyHeadDir = input.hourlyWeather.map((w) => ((w.windDir + 180) % 360) * Math.PI / 180);
  const hourlyLB = input.hourlyWeather.map((w) => calculateLB(w.windKph));
  // ROS without slope, per hour (slope is per-cell, applied later).
  const hourlyRosBase = input.hourlyWeather.map((w) => {
    const isi = calculateISI(input.ffmc, w.windKph);
    return calculateROS(input.fuel, isi, input.bui, 0);
  });

  // 8-neighbour offsets (ordered NE-clockwise so iteration is intuitive).
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
  const cardinalDist = CELL_SIZE_M;
  const diagonalDist = CELL_SIZE_M * Math.SQRT2;

  const heap = new MinHeap();
  heap.push(0, center * N_CELLS + center);

  const horizonMin = input.durationHours * 60;

  while (heap.size > 0) {
    const item = heap.pop()!;
    const t = item.key;
    const cellIdx = item.value;
    if (t > arrival[cellIdx]) continue;     // stale entry
    if (t > horizonMin) break;              // past the horizon — heap is sorted

    const x = cellIdx % N_CELLS;
    const y = (cellIdx / N_CELLS) | 0;

    // Pick the weather hour for this cell's arrival time. Index clamped
    // so a sim that overruns the forecast still uses the last hour.
    const hourIdx = Math.min(input.hourlyWeather.length - 1, Math.floor(t / 60));
    const headDirRad = hourlyHeadDir[hourIdx];
    const lb = hourlyLB[hourIdx];
    const rosBase = hourlyRosBase[hourIdx];
    // Per-cell slope effect: SF amplifies ROS upslope. We apply it
    // uniformly here (FBP doesn't model downhill differently — still
    // applies the slope factor, slightly conservative for downslope).
    const slopePct = slopeGrid ? slopeGrid[cellIdx] : 0;
    const slopeFactor = slopePct > 0 ? Math.exp(3.533 * Math.pow(slopePct / 100, 1.2)) : 1;
    const rosHead = rosBase * slopeFactor;

    for (let i = 0; i < 8; i++) {
      const nx = x + dx[i];
      const ny = y + dy[i];
      if (nx < 0 || nx >= N_CELLS || ny < 0 || ny >= N_CELLS) continue;

      const dist = (i & 1) === 1 ? diagonalDist : cardinalDist;
      const bearingRad = bearingFromOffset(dx[i], dy[i]);
      const thetaFromHead = bearingRad - headDirRad;
      const ros = rosAtAngle(rosHead, lb, thetaFromHead);
      if (ros <= 0.01) continue;
      const dt = dist / ros;
      const newArrival = t + dt;

      const nIdx = ny * N_CELLS + nx;
      if (newArrival < arrival[nIdx]) {
        arrival[nIdx] = newArrival;
        if (newArrival <= horizonMin) heap.push(newArrival, nIdx);
      }
    }
  }

  // ── Extract checkpoint perimeters ────────────────────────────────────
  const checkpoints: SpreadCheckpoint[] = [];
  let cellsBurned = 0;
  for (const hours of CHECKPOINT_HOURS.filter(h => h <= input.durationHours)) {
    const cutoff = hours * 60;
    const burned: { x: number; y: number }[] = [];
    for (let i = 0; i < total; i++) {
      if (arrival[i] <= cutoff) {
        burned.push({ x: i % N_CELLS, y: (i / N_CELLS) | 0 });
      }
    }
    if (burned.length === 0) continue;
    if (hours === Math.max(...CHECKPOINT_HOURS.filter(h => h <= input.durationHours))) {
      cellsBurned = burned.length;
    }
    const hull = convexHull(burned);
    if (hull.length < 3) continue;
    const polyLngLat = hull.map(p => cellToLngLat(p.x, p.y, center, input.ignitionLat, input.ignitionLng));
    polyLngLat.push(polyLngLat[0]); // close the ring

    checkpoints.push({
      hour: hours,
      polygon: polyLngLat,
      area_ha: polygonAreaM2(hull) / 10000,
      max_intensity_kw_per_m: hfi0,
      perimeter_km: polygonPerimeterM(hull) / 1000,
    });
  }

  // Sample summary weather at hours 0/24/48 for the metadata block.
  const sampleAt = (h: number) => {
    if (h >= input.hourlyWeather.length) return null;
    const w = input.hourlyWeather[h];
    return { tempC: w.tempC, rhPct: w.rhPct, windKph: w.windKph, windDir: w.windDir };
  };

  // Elevation range, if slope grid was supplied. (Slope grid is in
  // percent so we don't have raw elevation, but we keep the field
  // so the caller can populate it from its own elevation grid.)
  const slopeUsed = !!input.slopeGrid && input.slopeGrid.length === total;

  return {
    checkpoints,
    metadata: {
      ignition: {
        lat: input.ignitionLat,
        lng: input.ignitionLng,
        time: input.ignitionTime,
      },
      duration_hours: input.durationHours,
      fuel: `${input.fuel.code} (${input.fuel.description})`,
      head_ros_m_per_min: Math.round(rosHead0 * 100) / 100,
      head_fire_intensity_kw_per_m: Math.round(hfi0),
      length_to_breadth: Math.round(lb0 * 100) / 100,
      spread_direction_deg: Math.round(headDirDeg0 * 10) / 10,
      cell_size_m: CELL_SIZE_M,
      grid_radius_m: GRID_RADIUS_M,
      cells_burned: cellsBurned,
      weather_mode: input.weatherMode ?? "manual",
      weather_summary: {
        hour_0:  sampleAt(0)!,
        hour_24: sampleAt(24),
        hour_48: sampleAt(48),
      },
      ffmc: input.ffmc,
      bui: input.bui,
      slope_used: slopeUsed,
      model: slopeUsed ? "fortress-wildfire-mvp-v1" : "fortress-wildfire-mvp-v0",
      generated_at: new Date().toISOString(),
      limitations: [
        input.weatherMode === "forecast"
          ? "Hourly weather time-stepping enabled (Open-Meteo forecast)"
          : "Manual weather snapshot — no time-stepping",
        slopeUsed
          ? "Per-cell slope from Open-Meteo elevation (90m DEM, bilinearly interpolated)"
          : "Flat terrain — slope = 0 (Phase A behavior)",
        "Single fuel type assumption (default C2 boreal spruce-lichen)",
        "FFMC and BUI held constant — no daily moisture-code drift modelled",
        "No spotting / ember transport",
        "No barriers (fireguards, water bodies, roads) or suppression",
        "No crown-fire vs surface-fire distinction",
        "Convex-hull perimeter — over-estimates concave edges",
        `Grid radius capped at ${GRID_RADIUS_M / 1000}km — fires spreading beyond will be clipped`,
      ],
    },
  };
}
