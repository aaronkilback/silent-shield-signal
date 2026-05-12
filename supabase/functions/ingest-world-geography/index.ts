/**
 * ingest-world-geography
 *
 * Refreshes one canvas-substrate layer from its source. Reads the
 * layer's source_config from world_geography_layers (added in
 * migration 20260510000009), fetches features (GeoJSON via WFS for
 * BC GeoBC layers), and upserts into world_geographies via the
 * bulk_upsert RPC.
 *
 * Why this is one function not many:
 *   The WFS pattern is uniform across all BC GeoBC layers. One function
 *   that reads source_config keeps the surface small. Layers from other
 *   sources (RCMP detachments via StatsCan shapefile, US ArcGIS Hub
 *   sources later) get separate functions with the same output contract.
 *
 * Invocation:
 *   POST /functions/v1/ingest-world-geography
 *   body: { layer: 'bc_regional_district', max_features?: number }
 *
 * The max_features cap is for safe first runs against large layers
 * (well sites can be tens of thousands of features). Default = no cap.
 */

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const PAGE_DEFAULT = 500;
const HARD_PAGE_CAP = 5000;

interface LayerRow {
  layer: string;
  display_name: string;
  source: string;
  source_url: string | null;
  source_config: Record<string, any>;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createServiceClient();
  const body = await req.json().catch(() => ({}));
  const layerName: string = body.layer;
  const maxFeatures: number | null = typeof body.max_features === "number" ? body.max_features : null;

  if (!layerName) {
    return errorResponse("layer required", 400);
  }

  const jobName = `ingest-world-geography-${layerName}`;
  const hb = await startHeartbeat(supabase, jobName);

  try {
    // 1. Look up layer config
    const { data: layerRow, error: layerErr } = await supabase
      .from("world_geography_layers")
      .select("layer, display_name, source, source_url, source_config")
      .eq("layer", layerName)
      .maybeSingle();

    if (layerErr || !layerRow) {
      throw new Error(`Layer not found: ${layerName}`);
    }
    const config = ((layerRow as LayerRow).source_config ?? {}) as Record<string, any>;
    const wfsFeatureType = config.wfs_feature_type;
    if (!wfsFeatureType) {
      throw new Error(`Layer ${layerName} has no wfs_feature_type in source_config — needs a custom ingest function (e.g. RCMP detachments).`);
    }

    const nameField = String(config.name_field ?? "");
    const externalIdField = String(config.external_id_field ?? "");
    const pageSize = clamp(Number(config.page_size ?? PAGE_DEFAULT), 1, HARD_PAGE_CAP);
    const srs = String(config.srs ?? "EPSG:4326");
    const wfsBase = (layerRow as LayerRow).source_url || "https://openmaps.gov.bc.ca/geo/pub/wfs";

    let totalUpserted = 0;
    let totalSkipped = 0;
    let totalFetched = 0;
    let startIndex = 0;
    let pageNum = 0;

    // 2. Page through WFS GetFeature
    while (true) {
      pageNum += 1;
      const fetchSize = maxFeatures
        ? Math.min(pageSize, maxFeatures - totalFetched)
        : pageSize;
      if (fetchSize <= 0) break;

      const wfsUrl = new URL(wfsBase);
      wfsUrl.searchParams.set("service", "WFS");
      wfsUrl.searchParams.set("version", "2.0.0");
      wfsUrl.searchParams.set("request", "GetFeature");
      wfsUrl.searchParams.set("typeNames", wfsFeatureType);
      wfsUrl.searchParams.set("outputFormat", "application/json");
      wfsUrl.searchParams.set("srsName", srs);
      wfsUrl.searchParams.set("count", String(fetchSize));
      wfsUrl.searchParams.set("startIndex", String(startIndex));

      console.log(`[${jobName}] Fetching page ${pageNum}: ${wfsUrl.toString()}`);

      const resp = await fetch(wfsUrl.toString(), {
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) {
        throw new Error(`WFS fetch failed: ${resp.status} ${resp.statusText}`);
      }
      const fc = await resp.json();
      const features: any[] = Array.isArray(fc?.features) ? fc.features : [];
      console.log(`[${jobName}] Page ${pageNum}: ${features.length} features`);

      if (features.length === 0) break;

      // 3. Transform features to RPC input shape
      const rpcFeatures = features.map((f) => {
        const props = f?.properties ?? {};
        const externalIdRaw = externalIdField ? props[externalIdField] : null;
        const nameRaw = nameField ? props[nameField] : null;
        return {
          external_id: externalIdRaw != null ? String(externalIdRaw) : null,
          name: nameRaw != null ? String(nameRaw) : null,
          geometry: f.geometry,
          attributes: props,
          source_record_id: externalIdRaw != null ? String(externalIdRaw) : null,
        };
      });

      // 4. Bulk upsert via RPC
      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        "bulk_upsert_world_geographies",
        {
          p_layer: layerName,
          p_source: (layerRow as LayerRow).source,
          p_source_url: (layerRow as LayerRow).source_url ?? "",
          p_features: rpcFeatures as any,
        },
      );
      if (rpcErr) throw new Error(`RPC failed on page ${pageNum}: ${rpcErr.message}`);
      const r = (rpcResult ?? {}) as Record<string, number>;
      totalUpserted += r.upserted ?? 0;
      totalSkipped += r.skipped_invalid_geom ?? 0;
      totalFetched += features.length;

      // Stop if (a) we got fewer than asked → end of dataset, or (b) we
      // hit the per-run cap.
      if (features.length < fetchSize) break;
      if (maxFeatures && totalFetched >= maxFeatures) break;

      startIndex += features.length;
    }

    // 5. Mark layer refreshed
    await supabase.rpc("mark_world_geography_layer_refreshed", {
      p_layer: layerName,
      p_feature_count: totalFetched,
    });

    const summary = {
      layer: layerName,
      pages_fetched: pageNum,
      features_fetched: totalFetched,
      upserted: totalUpserted,
      skipped_invalid_geom: totalSkipped,
    };
    await completeHeartbeat(supabase, hb, summary);
    console.log(`[${jobName}] Done: ${JSON.stringify(summary)}`);
    return successResponse(summary);
  } catch (e) {
    console.error(`[${jobName}] Failed:`, e);
    await failHeartbeat(supabase, hb, e instanceof Error ? e : new Error(String(e)));
    return errorResponse(e instanceof Error ? e.message : String(e), 500);
  }
});

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}
