/**
 * scan-client-staff
 *
 * Lightweight batch orchestrator that queues entity-deep-scan for every
 * `person` entity attached to a given client.
 *
 * Use this instead of the VIP wizard when you have named individuals
 * stored as entities (e.g. clinic staff) who need OSINT coverage but
 * don't require a full VIP intake dossier (no travel plans, family
 * members, properties, etc.).
 *
 * What it does per entity:
 *   1. entity-deep-scan — HIBP breach check, dark web mentions,
 *      social media footprint, adverse media, AI relationship analysis,
 *      sanctions screening
 *   2. osint-entity-scan — web search + AI relationship discovery,
 *      creates document linkage and entity relationships
 *
 * Request body:
 *   {
 *     client_id: string        (required)
 *     entity_ids?: string[]    (optional — scan only these entities)
 *     skip_osint?: boolean     (default false — set true for deep-scan only)
 *     dry_run?: boolean        (default false — list entities without scanning)
 *   }
 *
 * Returns:
 *   { queued: number, skipped: number, results: [{ entity_id, name, status }] }
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const INTER_SCAN_DELAY_MS = 3000; // stagger calls to avoid rate-limiting downstream

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { client_id, entity_ids, skip_osint = false, dry_run = false } = await req.json();

    if (!client_id) return errorResponse("client_id required", 400);

    const supabase = createServiceClient();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // ── Verify client exists ─────────────────────────────────────────────
    const { data: client } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", client_id)
      .maybeSingle();

    if (!client) return errorResponse("Client not found", 404);

    // ── Fetch person entities for this client ────────────────────────────
    let entityQuery = supabase
      .from("entities")
      .select("id, name, risk_level, attributes")
      .eq("client_id", client_id)
      .eq("type", "person")
      .eq("is_active", true);

    if (entity_ids?.length) {
      entityQuery = entityQuery.in("id", entity_ids);
    }

    const { data: entities, error: entErr } = await entityQuery;
    if (entErr) return errorResponse(`Entity query failed: ${entErr.message}`, 500);
    if (!entities?.length) {
      return successResponse({ queued: 0, skipped: 0, results: [], message: "No person entities found for this client" });
    }

    console.log(`[scan-client-staff] Client: ${client.name} — ${entities.length} person entities found`);

    if (dry_run) {
      return successResponse({
        dry_run: true,
        client: client.name,
        entities: entities.map(e => ({ id: e.id, name: e.name, risk_level: e.risk_level })),
        scans_would_queue: entities.length * (skip_osint ? 1 : 2),
      });
    }

    // ── Queue scans sequentially with delay to avoid rate limiting ───────
    const results: { entity_id: string; name: string; deep_scan: string; osint_scan: string }[] = [];

    const invokeFunction = async (fnName: string, body: Record<string, unknown>): Promise<string> => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000), // 2 min per scan
        });
        if (res.ok) return "queued";
        const errText = await res.text().catch(() => res.statusText);
        return `error:${res.status} ${errText.substring(0, 100)}`;
      } catch (e) {
        return `error:${e instanceof Error ? e.message : String(e)}`;
      }
    };

    for (const entity of entities) {
      console.log(`[scan-client-staff] Scanning ${entity.name} (${entity.id})`);

      const deepStatus = await invokeFunction("entity-deep-scan", { entity_id: entity.id });

      let osintStatus = "skipped";
      if (!skip_osint) {
        await new Promise(r => setTimeout(r, INTER_SCAN_DELAY_MS));
        osintStatus = await invokeFunction("osint-entity-scan", { entity_id: entity.id });
      }

      results.push({
        entity_id: entity.id,
        name: entity.name,
        deep_scan: deepStatus,
        osint_scan: osintStatus,
      });

      // Stagger between entities
      if (entities.indexOf(entity) < entities.length - 1) {
        await new Promise(r => setTimeout(r, INTER_SCAN_DELAY_MS));
      }
    }

    const queued = results.filter(r => r.deep_scan === "queued").length;
    const errored = results.filter(r => r.deep_scan.startsWith("error")).length;

    console.log(`[scan-client-staff] Complete — ${queued} scans queued, ${errored} errors`);

    return successResponse({
      client: client.name,
      queued,
      errored,
      results,
    });

  } catch (err) {
    console.error("[scan-client-staff] Error:", err);
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
