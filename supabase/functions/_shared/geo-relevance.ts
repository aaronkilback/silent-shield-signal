// Shared geo/proximity relevance scorer.
//
// WHY THIS EXISTS: the text/keyword relevance scorer (scoreSignalRelevance) is structurally BLIND to
// geographic proximity. Every geo-fenced signal — wildfire, satellite hotspot cluster, evacuation
// order, earthquake, entity-proximity — therefore collapses to a near-constant ~0.40 regardless of
// whether it is a 0.01 ha fire 26 km away or an evacuation ORDER 4 km from a protected school. That
// constant, under a relevance floor, silently suppresses life-safety events. This scorer reads what
// actually matters for a geo signal: distance to the protected asset, hazard status, and event size.
//
// SHARED ON PURPOSE: geo/proximity data is NOT wildfire-only. It arrives from monitor-geo-wildfire,
// monitor-wildfires, monitor-naad-alerts (Amber/civil-emergency CAP areas), monitor-earthquakes,
// monitor-entity-proximity, and monitor-emergency-google. The ingest path calls THIS for any signal
// carrying proximity data, so a new geo source inherits correct scoring instead of rediscovering the
// 0.40 bug.

export interface GeoProximity {
  asset?: string;
  radius_km?: number;
  distance_km?: number;
  nearest_km?: number;
  hotspot_count?: number;
}

export interface GeoRelevanceResult {
  score: number;               // 0..1 — replaces the blind text score for geo signals
  isGeo: boolean;              // had usable proximity data
  isLifeSafety: boolean;       // evacuation order/alert, or civil_emergency/natural_disaster, within reach of the asset
  factors: { proximity: number; hazard: number; size: number; distance_km: number | null; radius_km: number; hazard_label: string };
  reason: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** True when the signal carries usable proximity data (so the geo scorer, not the text scorer, should run). */
export function hasGeoData(raw: any): boolean {
  const p = raw?.proximity;
  if (!p || typeof p !== 'object') return false;
  return num(p.distance_km) !== null || num(p.nearest_km) !== null || num(p.hotspot_count) !== null;
}

/** Hazard weight (0..1) + life-safety flag, resolved from evacuation status, then fire status, then category. */
function hazardWeight(raw: any): { w: number; life: boolean; label: string } {
  const evac = String(raw?.highest_status ?? raw?.evac_status ?? '').toLowerCase();
  if (evac.includes('order')) return { w: 1.0, life: true, label: 'evacuation_order' };
  if (evac.includes('alert')) return { w: 0.8, life: true, label: 'evacuation_alert' };

  const fs = String(raw?.fire_status ?? raw?.status ?? raw?.stage_of_control ?? '').toLowerCase();
  if (fs.includes('out of control')) return { w: 0.9, life: false, label: 'out_of_control' };
  if (fs.includes('fire of note')) return { w: 0.8, life: false, label: 'fire_of_note' };
  if (fs.includes('being held')) return { w: 0.45, life: false, label: 'being_held' };
  if (fs.includes('under control') || fs === 'out') return { w: 0.25, life: false, label: 'under_control' };

  const cat = String(raw?.category ?? '').toLowerCase();
  if (cat === 'natural_disaster' || cat === 'civil_emergency') return { w: 0.7, life: true, label: cat };

  if (num(raw?.proximity?.hotspot_count)) return { w: 0.5, life: false, label: 'hotspot_cluster' };
  return { w: 0.5, life: false, label: 'unknown_hazard' };
}

/** Event-size weight (0..1), log-ish buckets on hectares. Unknown size → neutral. */
function sizeWeight(size_ha: number | null): number {
  if (size_ha === null) return 0.4;
  if (size_ha >= 1000) return 1.0;
  if (size_ha >= 100) return 0.75;
  if (size_ha >= 10) return 0.55;
  if (size_ha >= 1) return 0.4;
  return 0.25; // sub-hectare
}

/**
 * Compute a geo relevance score in [0,1] from proximity + hazard status + size.
 * Proximity dominates (0.50), then hazard (0.35), then size (0.15) — for a protected location, how
 * CLOSE a hazard is matters more than how big it is far away. Proximity factor: 1.0 at the asset,
 * 0.5 at the radius edge, decaying to 0 by 2× the radius. Never suppresses on text noise.
 */
export function computeGeoRelevance(raw: any): GeoRelevanceResult {
  const radius = num(raw?.proximity?.radius_km) ?? 50;
  const dist = num(raw?.proximity?.distance_km) ?? num(raw?.proximity?.nearest_km);
  const size = num(raw?.size_ha ?? raw?.hectares ?? raw?.area_ha);
  const { w: hazard, life, label } = hazardWeight(raw);

  let proximity: number;
  if (dist === null) proximity = 0.5;                                   // unknown distance → neutral
  else if (dist <= radius) proximity = 1 - 0.5 * (dist / radius);       // inside: 1.0 → 0.5
  else proximity = Math.max(0, 0.5 - 0.5 * ((dist - radius) / radius)); // beyond: 0.5 → 0 at 2× radius

  const sizeF = sizeWeight(size);
  const score = round2(Math.min(1, Math.max(0, 0.5 * proximity + 0.35 * hazard + 0.15 * sizeF)));
  const isLifeSafety = life && (dist === null || dist <= radius * 1.5);

  return {
    score,
    isGeo: hasGeoData(raw),
    isLifeSafety,
    factors: { proximity: round2(proximity), hazard, size: sizeF, distance_km: dist, radius_km: radius, hazard_label: label },
    reason: `${label} @ ${dist ?? '?'}km of ${radius}km radius, size=${size ?? 'n/a'}ha`,
  };
}
