/**
 * BC Wildfire Service (BCWS) — official provincial fire response data.
 *
 * Complementary to CWFIS (federal/satellite, _shared/agent-tools-wildfire.ts):
 *   • CWFIS gives the science: VIIRS/MODIS thermal anomalies, FWI, fuel
 *   • BCWS gives the response actions: official fire registry (FIRE_STATUS,
 *     CURRENT_SIZE, FIRE_OF_NOTE_IND), evacuation orders/alerts (with
 *     polygon footprints + affected-population estimates), perimeter
 *     management.
 *
 * Source: ArcGIS REST FeatureServer at services6.arcgis.com/ubm4tcTYICKBpist
 * Public, no API key required. Endpoints get republished annually so URLs
 * are kept centralised here for one-line updates.
 */

const BCWS_BASE = 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services';
const ACTIVE_FIRES_URL = `${BCWS_BASE}/BCWS_ActiveFires_PublicView/FeatureServer/0/query`;
const EVAC_ORDERS_URL = `${BCWS_BASE}/Evacuation_Orders_and_Alerts/FeatureServer/0/query`;
const FIRE_PERIMETERS_URL = `${BCWS_BASE}/BCWS_FirePerimeters_PublicView/FeatureServer/0/query`;
const DANGER_RATING_URL = `${BCWS_BASE}/British_Columbia_Danger_Rating_-_View/FeatureServer/7/query`;

export interface BCWSActiveFire {
  fire_number: string;
  incident_name: string | null;
  fire_centre: string | null;
  zone: string | null;
  status: string;        // 'Out of Control' | 'Being Held' | 'Under Control' | 'Out'
  size_ha: number | null;
  cause: string | null;
  fire_type: string | null;
  ignition_date: string | null;
  is_fire_of_note: boolean;
  geographic_description: string | null;
  fire_url: string | null;
  lat: number;
  lng: number;
}

export interface BCWSEvacuation {
  sys_id: string;
  event_name: string | null;
  order_alert_name: string | null;
  status: string;        // 'Order' | 'Alert' | 'Rescinded'
  issuing_agency: string | null;
  event_type: string | null;
  population: number | null;
  homes: number | null;
  start_date: string | null;
  date_modified: string | null;
  /** centroid of the affected polygon */
  lat: number;
  lng: number;
}

export interface BCWSDangerRating {
  /** BCWS-published category. Same five-level CIFFC scale Petronas uses. */
  rating: 'Low' | 'Moderate' | 'High' | 'Very High' | 'Extreme' | string;
  /** Code for table rendering: L / M / H / VH / E */
  code: 'L' | 'M' | 'H' | 'VH' | 'E';
  /** Numeric (1=Low ... 5=Extreme) */
  rating_int: number | null;
  /** Last polygon refresh timestamp, ISO. */
  when_created: string | null;
}

export interface BCWSFirePerimeter {
  fire_number: string;
  fire_size_ha: number | null;
  status: string;
  track_date: string | null;
  fire_url: string | null;
  lat: number;        // centroid
  lng: number;        // centroid
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function polygonCentroid(rings: any): { lat: number; lng: number } | null {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const outer = rings[0];
  if (!Array.isArray(outer) || outer.length === 0) return null;
  let sumLat = 0;
  let sumLng = 0;
  let n = 0;
  for (const pt of outer) {
    if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
      sumLng += pt[0];
      sumLat += pt[1];
      n++;
    }
  }
  if (n === 0) return null;
  return { lat: sumLat / n, lng: sumLng / n };
}

async function arcgisQuery(url: string, params: Record<string, string>): Promise<any> {
  const search = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    f: 'json',
    resultRecordCount: '500',
    ...params,
  });
  const r = await fetch(`${url}?${search.toString()}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`BCWS HTTP ${r.status}`);
  return await r.json();
}

/**
 * All BCWS active fires (excludes 'Out' by default — those are no longer active).
 */
export async function fetchBCWSActiveFires(opts: { includeOut?: boolean } = {}): Promise<BCWSActiveFire[]> {
  const where = opts.includeOut ? '1=1' : "FIRE_STATUS <> 'Out'";
  const j = await arcgisQuery(ACTIVE_FIRES_URL, { where });
  const features = j?.features ?? [];
  return features
    .map((f: any) => {
      const p = f.attributes || {};
      const lat = Number(p.LATITUDE);
      const lng = Number(p.LONGITUDE);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        fire_number: String(p.FIRE_NUMBER || ''),
        incident_name: p.INCIDENT_NAME || null,
        fire_centre: p.FIRE_CENTRE || null,
        zone: p.ZONE || null,
        status: p.FIRE_STATUS || 'Unknown',
        size_ha: typeof p.CURRENT_SIZE === 'number' ? p.CURRENT_SIZE : null,
        cause: p.FIRE_CAUSE || null,
        fire_type: p.FIRE_TYPE || null,
        ignition_date: p.IGNITION_DATE ? new Date(Number(p.IGNITION_DATE)).toISOString() : null,
        is_fire_of_note: p.FIRE_OF_NOTE_IND === 'Y' || p.FIRE_OF_NOTE_IND === 1 || p.FIRE_OF_NOTE_IND === true,
        geographic_description: p.GEOGRAPHIC_DESCRIPTION || null,
        fire_url: p.FIRE_URL || null,
        lat,
        lng,
      } as BCWSActiveFire;
    })
    .filter(Boolean);
}

/**
 * Active evacuation orders + alerts, with polygon centroid for distance math.
 * 'Rescinded' status is excluded by default — those are historical.
 */
export async function fetchBCWSEvacuations(opts: { includeRescinded?: boolean } = {}): Promise<BCWSEvacuation[]> {
  const where = opts.includeRescinded ? '1=1' : "ORDER_ALERT_STATUS <> 'Rescinded'";
  const j = await arcgisQuery(EVAC_ORDERS_URL, { where, returnGeometry: 'true' });
  const features = j?.features ?? [];
  return features
    .map((f: any) => {
      const p = f.attributes || {};
      const c = polygonCentroid(f.geometry?.rings);
      if (!c) return null;
      return {
        sys_id: String(p.EMRG_OAA_SYSID || p.OBJECTID || ''),
        event_name: p.EVENT_NAME || null,
        order_alert_name: p.ORDER_ALERT_NAME || null,
        status: p.ORDER_ALERT_STATUS || 'Unknown',
        issuing_agency: p.ISSUING_AGENCY || null,
        event_type: p.EVENT_TYPE || null,
        population: typeof p.MULTI_SOURCED_POPULATION === 'number' ? p.MULTI_SOURCED_POPULATION : null,
        homes: typeof p.MULTI_SOURCED_HOMES === 'number' ? p.MULTI_SOURCED_HOMES : null,
        start_date: p.EVENT_START_DATE ? new Date(Number(p.EVENT_START_DATE)).toISOString() : null,
        date_modified: p.DATE_MODIFIED ? new Date(Number(p.DATE_MODIFIED)).toISOString() : null,
        lat: c.lat,
        lng: c.lng,
      } as BCWSEvacuation;
    })
    .filter(Boolean);
}

/**
 * Active fire perimeters (centroid only — full polygons aren't needed for
 * the corroboration use case and they're large).
 */
export async function fetchBCWSFirePerimeters(): Promise<BCWSFirePerimeter[]> {
  const j = await arcgisQuery(FIRE_PERIMETERS_URL, { where: "FIRE_STATUS <> 'Out'", returnGeometry: 'true' });
  const features = j?.features ?? [];
  return features
    .map((f: any) => {
      const p = f.attributes || {};
      const c = polygonCentroid(f.geometry?.rings);
      if (!c) return null;
      return {
        fire_number: String(p.FIRE_NUMBER || ''),
        fire_size_ha: typeof p.FIRE_SIZE_HECTARES === 'number' ? p.FIRE_SIZE_HECTARES : null,
        status: p.FIRE_STATUS || 'Unknown',
        track_date: p.TRACK_DATE ? new Date(Number(p.TRACK_DATE)).toISOString() : null,
        fire_url: p.FIRE_URL || null,
        lat: c.lat,
        lng: c.lng,
      } as BCWSFirePerimeter;
    })
    .filter(Boolean);
}

/**
 * Convenience: active fires within radius_km of a center, sorted by distance.
 * Used by the agent tool and by monitor-wildfires for CWFIS corroboration.
 */
export async function findBCWSActiveFiresNear(
  lat: number,
  lng: number,
  radius_km: number,
): Promise<Array<BCWSActiveFire & { distance_km: number }>> {
  const all = await fetchBCWSActiveFires();
  return all
    .map((f) => ({ ...f, distance_km: Math.round(haversineKm({ lat, lng }, { lat: f.lat, lng: f.lng }) * 10) / 10 }))
    .filter((f) => f.distance_km <= radius_km)
    .sort((a, b) => a.distance_km - b.distance_km);
}

/**
 * Returns the OFFICIAL BCWS danger rating at a point (lat, lng) by spatially
 * querying the daily-updated provincial danger-rating polygon layer. This is
 * the SAME source Petronas's published Daily Wildfire Report reads from —
 * use this rather than the locally-estimated FWI when computing per-station
 * fire danger ratings. Returns null if the point falls outside any polygon
 * (rare — BCWS polygons cover all of BC's responsible-area).
 */
export async function fetchBCWSDangerRatingAtPoint(
  lat: number,
  lng: number,
): Promise<BCWSDangerRating | null> {
  const ratingToCode = (label: string): BCWSDangerRating['code'] => {
    const l = (label || '').toLowerCase();
    if (l === 'extreme') return 'E';
    if (l === 'very high') return 'VH';
    if (l === 'high') return 'H';
    if (l === 'moderate') return 'M';
    return 'L';
  };
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'DANGER_RATING,DANGER_RATING_DESC,WHEN_CREATED',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'false',
    f: 'json',
    resultRecordCount: '1',
  });
  const r = await fetch(`${DANGER_RATING_URL}?${params.toString()}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`BCWS danger rating HTTP ${r.status}`);
  const j = await r.json();
  const a = j?.features?.[0]?.attributes;
  if (!a) return null;
  return {
    rating: a.DANGER_RATING_DESC || 'Unknown',
    code: ratingToCode(a.DANGER_RATING_DESC || ''),
    rating_int: typeof a.DANGER_RATING === 'number' ? a.DANGER_RATING : null,
    when_created: a.WHEN_CREATED ? new Date(Number(a.WHEN_CREATED)).toISOString() : null,
  };
}

export async function findBCWSEvacuationsNear(
  lat: number,
  lng: number,
  radius_km: number,
): Promise<Array<BCWSEvacuation & { distance_km: number }>> {
  const all = await fetchBCWSEvacuations();
  return all
    .map((e) => ({ ...e, distance_km: Math.round(haversineKm({ lat, lng }, { lat: e.lat, lng: e.lng }) * 10) / 10 }))
    .filter((e) => e.distance_km <= radius_km)
    .sort((a, b) => a.distance_km - b.distance_km);
}
