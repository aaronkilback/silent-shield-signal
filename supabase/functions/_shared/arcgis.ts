/**
 * ArcGIS REST client.
 *
 * Loads the active client_arcgis_connections row for a given client_id,
 * refreshes the OAuth token if expired, exposes spatial-query helpers
 * tuned for the questions agents ask: "what assets are within X km of
 * this signal?", "what's inside this bounding box?", "what attributes
 * does asset Y have?".
 *
 * Caching strategy: token cached in DB for token_expires_at - 60s to
 * avoid mid-request expiry. Layer aliases looked up per call (cheap;
 * jsonb on the connection row).
 *
 * Auth: prefers OAuth client_credentials (creates a 24h app token). Falls
 * back to api_key_secret_ref appended as `?token=<key>` if no OAuth
 * configured. Both secrets are stored in Supabase secrets and referenced
 * by name from the connection row — never the raw value in the DB.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface ConnectionRow {
  id: string;
  client_id: string;
  portal_url: string;
  oauth_client_id: string | null;
  oauth_client_secret_ref: string | null;
  api_key_secret_ref: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  layer_aliases: Record<string, { url: string; description?: string; geometry_type?: string }>;
}

export interface ArcGISLayerAlias {
  url: string;
  description?: string;
  geometry_type?: string;
}

export interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: Record<string, unknown>;
}

export interface ArcGISClient {
  /** Run a layer query: where + geometry + outFields, returns parsed features. */
  query(layerAlias: string, params: ArcGISQueryParams): Promise<{ features: ArcGISFeature[]; count: number }>;
  /** Find features near a lat/lon (in WGS84). Default radius 5km. */
  findNear(layerAlias: string, lat: number, lon: number, radiusKm?: number, outFields?: string[]): Promise<ArcGISFeature[]>;
  /** Available layer aliases on this connection. */
  layers(): Array<{ alias: string; description: string; geometry_type: string }>;
  /** Connection metadata for display. */
  connection(): { id: string; portal_url: string; client_id: string };
}

export interface ArcGISQueryParams {
  /** SQL where clause, e.g. "STATUS='ACTIVE'". Default "1=1". */
  where?: string;
  /** Geometry filter (point/envelope/polyline) — see ArcGIS REST docs. */
  geometry?: { x: number; y: number; spatialReference?: { wkid: number } } | string;
  geometryType?: 'esriGeometryPoint' | 'esriGeometryEnvelope' | 'esriGeometryPolygon';
  /** Spatial relation, default esriSpatialRelIntersects. */
  spatialRel?: string;
  /** Distance for buffer queries (used with esriSpatialRelWithin etc). */
  distance?: number;
  units?: 'esriSRUnit_Meter' | 'esriSRUnit_Kilometer';
  /** Fields to return. Default ["*"]. */
  outFields?: string[];
  /** Cap result count. Default 25. */
  resultRecordCount?: number;
  /** Whether to include geometry in response. Default true. */
  returnGeometry?: boolean;
}

/** Resolve and instantiate a client for a given client_id. Returns null if
 *  no active connection. Never throws; caller handles null. */
export async function getArcGISClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ArcGISClient | null> {
  const { data: row, error } = await supabase
    .from('client_arcgis_connections')
    .select('id, client_id, portal_url, oauth_client_id, oauth_client_secret_ref, api_key_secret_ref, access_token, token_expires_at, layer_aliases')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !row) return null;
  return buildClient(supabase, row as ConnectionRow);
}

function buildClient(supabase: SupabaseClient, conn: ConnectionRow): ArcGISClient {
  const portalBase = conn.portal_url.replace(/\/$/, '');

  async function ensureToken(): Promise<string | null> {
    // OAuth path
    if (conn.oauth_client_id && conn.oauth_client_secret_ref) {
      const cached = conn.access_token;
      const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
      if (cached && exp > Date.now() + 60_000) return cached;

      const secret = Deno.env.get(conn.oauth_client_secret_ref) || '';
      if (!secret) {
        console.warn(`[arcgis] oauth secret '${conn.oauth_client_secret_ref}' not in env`);
        return null;
      }
      const resp = await fetch(`${portalBase}/sharing/rest/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: conn.oauth_client_id,
          client_secret: secret,
          grant_type: 'client_credentials',
          expiration: '1440', // 24h, in minutes
          f: 'json',
        }).toString(),
      });
      if (!resp.ok) {
        console.warn(`[arcgis] oauth token request failed: ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      if (!data?.access_token) {
        console.warn(`[arcgis] oauth response missing access_token: ${JSON.stringify(data).substring(0, 200)}`);
        return null;
      }
      const expiresInSec = data.expires_in || 1440 * 60;
      const newExpiry = new Date(Date.now() + expiresInSec * 1000).toISOString();
      await supabase
        .from('client_arcgis_connections')
        .update({ access_token: data.access_token, token_expires_at: newExpiry })
        .eq('id', conn.id);
      return data.access_token as string;
    }
    // API-key fallback
    if (conn.api_key_secret_ref) {
      const key = Deno.env.get(conn.api_key_secret_ref) || '';
      return key || null;
    }
    return null;
  }

  function resolveLayer(alias: string): ArcGISLayerAlias | null {
    const aliases = conn.layer_aliases || {};
    const direct = (aliases as any)[alias];
    if (direct) return direct as ArcGISLayerAlias;
    return null;
  }

  async function rawQuery(layerUrl: string, params: ArcGISQueryParams): Promise<{ features: ArcGISFeature[]; count: number }> {
    const token = await ensureToken();
    const u = new URL(`${layerUrl.replace(/\/$/, '')}/query`);
    u.searchParams.set('where', params.where ?? '1=1');
    u.searchParams.set('outFields', (params.outFields ?? ['*']).join(','));
    u.searchParams.set('returnGeometry', String(params.returnGeometry ?? true));
    u.searchParams.set('outSR', '4326');
    u.searchParams.set('f', 'json');
    if (params.geometry) {
      u.searchParams.set('geometry', typeof params.geometry === 'string' ? params.geometry : JSON.stringify(params.geometry));
      u.searchParams.set('geometryType', params.geometryType ?? 'esriGeometryPoint');
      u.searchParams.set('spatialRel', params.spatialRel ?? 'esriSpatialRelIntersects');
      u.searchParams.set('inSR', '4326');
    }
    if (params.distance && params.units) {
      u.searchParams.set('distance', String(params.distance));
      u.searchParams.set('units', params.units);
    }
    if (params.resultRecordCount) {
      u.searchParams.set('resultRecordCount', String(params.resultRecordCount));
    }
    if (token) u.searchParams.set('token', token);

    const resp = await fetch(u.toString(), { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`ArcGIS query failed ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    const data = await resp.json();
    if (data.error) {
      throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
    }
    const features: ArcGISFeature[] = (data.features ?? []).map((f: any) => ({
      attributes: f.attributes ?? {},
      geometry: f.geometry ?? undefined,
    }));
    return { features, count: features.length };
  }

  return {
    async query(alias, params) {
      const layer = resolveLayer(alias);
      if (!layer) throw new Error(`Unknown layer alias '${alias}'. Configured: ${Object.keys(conn.layer_aliases || {}).join(', ') || '(none)'}`);
      return rawQuery(layer.url, params);
    },
    async findNear(alias, lat, lon, radiusKm = 5, outFields = ['*']) {
      const layer = resolveLayer(alias);
      if (!layer) throw new Error(`Unknown layer alias '${alias}'`);
      const result = await rawQuery(layer.url, {
        geometry: { x: lon, y: lat, spatialReference: { wkid: 4326 } },
        geometryType: 'esriGeometryPoint',
        spatialRel: 'esriSpatialRelIntersects',
        distance: radiusKm * 1000,
        units: 'esriSRUnit_Meter',
        outFields,
        returnGeometry: true,
        resultRecordCount: 25,
      });
      return result.features;
    },
    layers() {
      const aliases = conn.layer_aliases || {};
      return Object.entries(aliases).map(([alias, meta]) => ({
        alias,
        description: (meta as any).description ?? '',
        geometry_type: (meta as any).geometry_type ?? 'unknown',
      }));
    },
    connection() {
      return { id: conn.id, portal_url: conn.portal_url, client_id: conn.client_id };
    },
  };
}
