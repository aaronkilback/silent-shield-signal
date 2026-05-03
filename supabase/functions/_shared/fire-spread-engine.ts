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

export interface SpreadInputs {
  ignitionLat: number;
  ignitionLng: number;
  ignitionTime: string;       // ISO timestamp
  durationHours: number;      // total simulated horizon
  weather: {
    tempC: number;
    rhPct: number;
    windKph: number;          // 10m wind speed
    windDir: number;          // wind FROM (degrees, 0=N clockwise)
    ffmc: number;             // Fine Fuel Moisture Code
    bui: number;              // Build Up Index
  };
  fuel: FuelParams;
  // Phase B will add: hourlyWeather[], slopeAtPoint(lat, lng), fuelAtPoint(lat, lng)
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
    head_ros_m_per_min: number;
    head_fire_intensity_kw_per_m: number;
    length_to_breadth: number;
    spread_direction_deg: number;
    cell_size_m: number;
    grid_radius_m: number;
    cells_burned: number;
    weather: SpreadInputs['weather'];
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

  // Precompute fire behaviour from current weather. Phase B will move
  // these inside the loop and update per simulated hour.
  const isi = calculateISI(input.weather.ffmc, input.weather.windKph);
  const rosHead = calculateROS(input.fuel, isi, input.weather.bui, 0);
  const lb = calculateLB(input.weather.windKph);
  const hfi = calculateHFI(rosHead, input.fuel);
  const headDirRad = ((input.weather.windDir + 180) % 360) * Math.PI / 180;

  // 8-neighbour offsets (ordered NE-clockwise so iteration is intuitive).
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
  const cardinalDist = CELL_SIZE_M;
  const diagonalDist = CELL_SIZE_M * Math.SQRT2;

  const heap = new MinHeap();
  heap.push(0, center * N_CELLS + center);

  const horizonMin = input.durationHours * 60;
  let popped = 0;

  while (heap.size > 0) {
    const item = heap.pop()!;
    const t = item.key;
    const cellIdx = item.value;
    if (t > arrival[cellIdx]) continue;     // stale entry
    if (t > horizonMin) break;              // past the horizon — heap is sorted
    popped++;

    const x = cellIdx % N_CELLS;
    const y = (cellIdx / N_CELLS) | 0;

    for (let i = 0; i < 8; i++) {
      const nx = x + dx[i];
      const ny = y + dy[i];
      if (nx < 0 || nx >= N_CELLS || ny < 0 || ny >= N_CELLS) continue;

      const dist = (i & 1) === 1 ? diagonalDist : cardinalDist;
      const bearingRad = bearingFromOffset(dx[i], dy[i]);
      const thetaFromHead = bearingRad - headDirRad;
      const ros = rosAtAngle(rosHead, lb, thetaFromHead); // m/min, can dip near 0 toward back
      if (ros <= 0.01) continue;            // back-spread effectively zero
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
      max_intensity_kw_per_m: hfi,
      perimeter_km: polygonPerimeterM(hull) / 1000,
    });
  }

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
      head_ros_m_per_min: Math.round(rosHead * 100) / 100,
      head_fire_intensity_kw_per_m: Math.round(hfi),
      length_to_breadth: Math.round(lb * 100) / 100,
      spread_direction_deg: Math.round(((input.weather.windDir + 180) % 360) * 10) / 10,
      cell_size_m: CELL_SIZE_M,
      grid_radius_m: GRID_RADIUS_M,
      cells_burned: cellsBurned,
      weather: input.weather,
      model: 'fortress-wildfire-mvp-v0',
      generated_at: new Date().toISOString(),
      limitations: [
        'Phase A: constant weather snapshot — no hourly time-stepping yet',
        'Single fuel type assumption (default C2 boreal spruce-lichen)',
        'Flat terrain — no slope or aspect effect on ROS',
        'No spotting / ember transport',
        'No barriers (fireguards, water bodies, roads) or suppression',
        'No crown-fire vs surface-fire distinction',
        'Convex-hull perimeter — over-estimates concave edges',
        `Grid radius capped at ${GRID_RADIUS_M / 1000}km — fires spreading beyond will be clipped`,
      ],
    },
  };
}
