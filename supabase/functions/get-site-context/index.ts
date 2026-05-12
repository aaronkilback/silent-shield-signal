/**
 * get-site-context
 *
 * Thin AEGIS-facing wrapper around the get_site_context PostGIS RPC.
 * Given a lat/lng point + optional radius, returns the canvas
 * substrate context for that location: containing jurisdictions
 * (regional district, fire centre, health authority, etc.) plus
 * nearby point/line features (hospitals, pipelines, well sites)
 * within the radius.
 *
 * Used by AEGIS to add real geographic context to any signal or
 * incident with a known location. Replaces the entity-tag-string
 * heuristic that the snapshot's WHERE field used as a placeholder.
 *
 * Invocation:
 *   POST /functions/v1/get-site-context
 *   body: { lat: number, lng: number, radius_km?: number }
 *
 * Returns:
 *   { lat, lng, radius_km,
 *     jurisdictions: [{ layer, name, sector, ... }],
 *     nearby: [{ layer, name, distance_km, ... }],
 *     summary_text: "Peace River Regional District · Prince George Fire Centre",
 *     jurisdiction_count, nearby_count }
 *
 * Why a wrapper rather than letting AEGIS hit the RPC directly:
 *   1. AEGIS-facing tools have a uniform contract (POST → JSON).
 *   2. Wrapper can add caching, rate-limiting, or per-client
 *      access-control later without touching the RPC.
 *   3. Heartbeat instrumentation lives at the edge layer, not in
 *      Postgres.
 */

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json().catch(() => ({}));
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const radiusKm = body.radius_km != null ? Number(body.radius_km) : 25;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return errorResponse("lat and lng required (numeric)", 400);
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return errorResponse(`lat/lng out of valid range (${lat}, ${lng})`, 400);
    }
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500) {
      return errorResponse("radius_km must be 0 < r <= 500", 400);
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("get_site_context", {
      p_lat: lat,
      p_lng: lng,
      p_radius_km: radiusKm,
    });

    if (error) {
      console.error("[get-site-context] RPC error:", error);
      return errorResponse(error.message, 500);
    }

    return successResponse(data ?? {});
  } catch (e) {
    console.error("[get-site-context] Fatal:", e);
    return errorResponse(e instanceof Error ? e.message : String(e), 500);
  }
});
