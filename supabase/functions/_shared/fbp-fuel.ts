/**
 * Canadian Forest Fire Behaviour Prediction (FBP) System — fuel
 * parameters and rate-of-spread equations. Subset needed for the
 * Fortress wildfire-spread MVP.
 *
 * References:
 *   - Forestry Canada Fire Danger Group 1992. Development and structure
 *     of the Canadian Forest Fire Behaviour Prediction System.
 *   - Wotton et al. 2009. Updated source code for calculating fire
 *     danger indices in the Canadian Forest Fire Weather Index System.
 *
 * Phase A: only C2 (boreal spruce-lichen). Phase B+ will add the rest
 * of the FBP fuel codes once we wire a real fuel raster.
 */

export interface FuelParams {
  /** FBP fuel code (e.g. 'C2'). */
  code: string;
  /** Human-readable description. */
  description: string;
  /** ROS asymptote (m/min) — table A.1 of FBP 1992. */
  a: number;
  /** ROS rate constant. */
  b: number;
  /** ROS shape parameter. */
  c: number;
  /** BUI dampening parameter q. */
  q: number;
  /** Average BUI for the fuel type. */
  bui_0: number;
  /** Crown base height (m) — only used for crown fire calcs (deferred). */
  cbh: number;
  /** Crown fuel load (kg/m²). */
  cfl: number;
  /** Surface fuel consumption coefficient — used for typical TFC estimate. */
  sfc_avg_kg_m2: number;
}

export const FUEL_C2: FuelParams = {
  code: 'C2',
  description: 'Boreal spruce-lichen',
  a: 110, b: 0.0282, c: 1.5,
  q: 0.7, bui_0: 64,
  cbh: 3, cfl: 0.8,
  sfc_avg_kg_m2: 2.0,
};

// Default fuel for MVP — C2 is the dominant boreal cover across Petronas's
// NE BC operational zone. Phase B introduces per-cell fuel via a raster.
export const DEFAULT_FUEL = FUEL_C2;

// ── Fine fuel moisture from FFMC ────────────────────────────────────────
// Van Wagner 1987 — equation 1.
export function fineFuelMoisture(ffmc: number): number {
  return 147.2 * (101 - ffmc) / (59.5 + ffmc);
}

// ── Initial Spread Index (ISI) ──────────────────────────────────────────
// Combines wind effect and fine fuel moisture. ISI is dimensionless,
// typically 0–50; values >10 indicate active fire spread potential.
export function calculateISI(ffmc: number, windSpeedKph: number): number {
  const m = fineFuelMoisture(ffmc);
  const fF = 91.9 * Math.exp(-0.1386 * m) * (1 + Math.pow(m, 5.31) / 4.93e7);
  const fW = Math.exp(0.05039 * windSpeedKph);
  return 0.208 * fW * fF;
}

// ── Head Rate of Spread (m/min) ─────────────────────────────────────────
// FBP equation 26 — per-fuel ROS as a function of ISI. Includes BUI
// dampening (eq. 54) and slope factor (eq. 39).
export function calculateROS(
  fuel: FuelParams,
  isi: number,
  bui: number = fuel.bui_0,
  slopePct: number = 0,
): number {
  // Base ROS from ISI
  let ros = fuel.a * Math.pow(1 - Math.exp(-fuel.b * isi), fuel.c);

  // BUI effect: fBUI = exp(50 * ln(q) * (1/BUI - 1/BUI0))
  const fBui = Math.exp(50 * Math.log(fuel.q) * (1 / Math.max(bui, 1) - 1 / fuel.bui_0));
  ros *= fBui;

  // Slope factor: SF = exp(3.533 * (slope%/100)^1.2). Slope amplifies ROS
  // upslope; for downslope or zero slope, factor is 1.
  if (slopePct > 0) {
    ros *= Math.exp(3.533 * Math.pow(slopePct / 100, 1.2));
  }

  return ros;
}

// ── Length-to-breadth ratio (wind effect on ellipse shape) ──────────────
// Alexander 1985. Returns LB ≥ 1; LB=1 = round fire, LB>>1 = elongated.
export function calculateLB(windSpeedKph: number): number {
  return 1 + 8.729 * Math.pow(1 - Math.exp(-0.030 * windSpeedKph), 2.155);
}

// ── Eccentricity from LB ────────────────────────────────────────────────
// e = sqrt(1 - 1/LB²). Used for elliptical spread polar form.
export function eccentricityFromLB(lb: number): number {
  return Math.sqrt(1 - 1 / (lb * lb));
}

// ── ROS in any direction off the head ───────────────────────────────────
// Polar form of ellipse with origin at one focus (the ignition):
//   r(θ) = a(1-e²) / (1 - e·cos(θ))
// where θ is angle from head direction (0 = head, π = back).
// Returns the fire's spread rate in that direction in m/min.
export function rosAtAngle(rosHead: number, lb: number, thetaFromHeadRad: number): number {
  const e = eccentricityFromLB(lb);
  // Semi-major axis a is set so that r(0) = rosHead.
  // From r(0) = a(1-e²)/(1-e) = a(1+e), we get a = rosHead / (1+e).
  const a = rosHead / (1 + e);
  return a * (1 - e * e) / (1 - e * Math.cos(thetaFromHeadRad));
}

// ── Head Fire Intensity (kW/m) ──────────────────────────────────────────
// HFI = 300 · TFC · ROS, where TFC is total fuel consumed (kg/m²).
// MVP uses fuel.sfc_avg_kg_m2 as a proxy; Phase B can refine with
// crown-fire transition modelling.
export function calculateHFI(rosMperMin: number, fuel: FuelParams): number {
  const rosMperSec = rosMperMin / 60;
  return 300 * fuel.sfc_avg_kg_m2 * rosMperSec * 60; // kW/m, simplified
}

// Convenience descriptor for output metadata.
export function describeFuel(fuel: FuelParams): string {
  return `${fuel.code} (${fuel.description})`;
}
