// monitor-geo-wildfire — WO-WILDFIRE-GENERALIZE: the small client-agnostic wildfire emitter.
//
// Replaces the 1,533-line monitor-wildfires (fixed OPS_BBOX + hardcoded facilities + location-string
// matching) with ~200 lines off the SHARED SUBSTRATE. Iterates public.client_geo_assets (PECL assets
// AND Kilbacks household points, and any future client), and per asset — within its buffer_km — checks:
//   • BCWS evacuation ORDERS / ALERTS  (findBCWSEvacuationsNear)   ← highest value, mandatory-leave-now
//   • BCWS active fires                (findBCWSActiveFiresNear)
//   • CWFIS thermal hotspots (last 24h, distance to the point)
// Proximity is COMPUTED from coordinates (ST_DWithin / haversine), never inferred from region.
//
// FRAMING BY ASSET TYPE: household (residence/school) = life-safety / evacuation / access routes;
// industrial = operational/reputational exposure. HOUSEHOLD FLARING GATE (item 1): a non-industrial
// asset's CWFIS hotspot is ALWAYS a real fire — never suppressed as industrial. (PECL's industrial
// CWFIS flaring classification stays with the still-running old monitor-wildfires during the parallel
// parity window; it moves here once the old function is retired.)
//
// Runs IN PARALLEL with the old function (tagged signal_origin='monitor-geo-wildfire'); the old cron
// is NOT paused until PECL parity is demonstrated (operator gate).
//
// OUTPUT CONTRACT (operator): a BCWS ORDER/ALERT within a client's radius with nothing emitted = FAILURE.

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { requireInternalCaller } from "../_shared/require-internal-caller.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { findBCWSEvacuationsNear, findBCWSActiveFiresNear } from "../_shared/bcws.ts";

const CWFIS_WFS = "https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs";

// item-1 gate: gas/pipeline/lng/operations/facility/... = industrial; anything else (residence, school) = household.
const isIndustrial = (t?: string | null) =>
  !t ? false : /gas_plant|pipeline|lng|operations|facility|corridor|hq|industrial|refinery|terminal|plant|well|compressor/i.test(t);

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function cwfisNear(lat: number, lng: number, radiusKm: number): Promise<{ count: number; nearest_km: number | null }> {
  const d = radiusKm / 111 + 0.1;
  const url = `${CWFIS_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=public:hotspots_last24hrs&outputFormat=application/json&srsName=EPSG:4326&bbox=${lat - d},${lng - d},${lat + d},${lng + d},urn:ogc:def:crs:EPSG::4326`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { count: 0, nearest_km: null };
    const j = await r.json();
    let count = 0, nearest: number | null = null;
    for (const f of j.features || []) {
      const c = f.geometry?.coordinates; if (!Array.isArray(c)) continue;
      const km = haversineKm({ lat, lng }, { lat: c[1], lng: c[0] });
      if (km <= radiusKm) { count++; if (nearest === null || km < nearest) nearest = Math.round(km * 10) / 10; }
    }
    return { count, nearest_km: nearest };
  } catch { return { count: 0, nearest_km: null }; }
}

Deno.serve(async (req) => {
  const cors = handleCors(req); if (cors) return cors;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, "monitor-geo-wildfire-30min");
  const gate = requireInternalCaller(req);
  if (gate) { await failHeartbeat(supabase, hb, new Error("rejected: internal-caller gate")); return gate; }

  try {
    const { data: points, error } = await supabase.rpc("client_geo_points");
    if (error) throw new Error(`client_geo_points: ${error.message}`);
    if (!points?.length) { await completeHeartbeat(supabase, hb, { note: "no geo points", points: 0 }); return successResponse({ note: "no geo points" }); }

    let ordersInRadius = 0, alertsInRadius = 0, firesInRadius = 0, emitted = 0, emitErrors = 0;
    const findings: any[] = [];
    const emitErrDetails: string[] = [];

    // Direct fetch to ingest-signal (supabase.functions.invoke was returning non-2xx here; a direct
    // service-role POST is the proven path and surfaces the real response body on error).
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const emit = async (body: any): Promise<string | null> => {
      try {
        const r = await fetch(`${SB_URL}/functions/v1/ingest-signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_KEY}`, "apikey": SB_KEY },
          body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) { emitErrors++; if (emitErrDetails.length < 3) emitErrDetails.push(`${r.status}: ${(await r.text()).slice(0, 180)}`); return null; }
        emitted++;
        const j = await r.json().catch(() => ({} as any));
        return j?.signal_id ?? null;
      } catch (e) { emitErrors++; if (emitErrDetails.length < 3) emitErrDetails.push("throw: " + (e instanceof Error ? e.message : String(e)).slice(0, 180)); return null; }
    };
    // A household evacuation ORDER is life-safety and MUST be critical (operator rule) — ingest-signal's
    // classifier downgrades it, so force it directly. Non-negotiable for households in an order area.
    const forceCritical = async (signalId: string | null) => {
      if (signalId) { try { await supabase.from("signals").update({ severity: "critical" }).eq("id", signalId); } catch (_) { /* best-effort */ } }
    };

    for (const p of points) {
      const lat = Number(p.lat), lng = Number(p.lon), radius = Number(p.buffer_km) || 30;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const household = !isIndustrial(p.asset_type);
      const noun = household ? `your ${p.asset_name}` : `${p.asset_name}`;
      const frame = (order: boolean) => household
        ? (order ? "LIFE-SAFETY: prepare to evacuate. Confirm your route and go-bag." : "Be ready to leave on short notice; watch official BCWS/EmergencyInfoBC updates.")
        : "Operational/reputational exposure — assess indirect impact and brief upward.";

      // 1. BCWS evacuations — ORDER vs ALERT must never be ambiguous for a household (life-safety):
      //    a household gets ONE aggregated signal reporting the HIGHEST status within radius, naming
      //    every Order and Alert area with distance. Any Order in radius ⇒ severity critical, Order-led.
      const EVAC_SRC = "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/Evacuation_Orders_and_Alerts/FeatureServer";
      const evacs = await findBCWSEvacuationsNear(lat, lng, radius);
      const orders = evacs.filter((e) => e.status === "Order");
      const alerts = evacs.filter((e) => e.status === "Alert");
      ordersInRadius += orders.length; alertsInRadius += alerts.length;
      const areaLabel = (e: any) => `${e.order_alert_name || e.event_name || "affected area"} (${e.distance_km} km${e.issuing_agency ? ", " + e.issuing_agency : ""})`;

      if (evacs.length > 0) {
        if (household) {
          const hasOrder = orders.length > 0;
          const sev = hasOrder ? "critical" : "high";
          const nearestKm = evacs[0].distance_km;
          const lead = hasOrder
            ? `🚨 EVACUATION ORDER active within ${radius} km of your ${p.asset_name} — if you are in an ORDER area, LEAVE NOW. ORDER: ${orders.map(areaLabel).join("; ")}.${alerts.length ? ` Also under ALERT (prepare to leave): ${alerts.map(areaLabel).join("; ")}.` : ""}`
            : `EVACUATION ALERT within ${radius} km of your ${p.asset_name} — be ready to leave on short notice. ALERT: ${alerts.map(areaLabel).join("; ")}.`;
          findings.push({ kind: "evac_household", highest: hasOrder ? "Order" : "Alert", orders: orders.length, alerts: alerts.length, nearest_km: nearestKm, asset: p.asset_name, client: p.client_name });
          const sid = await emit({
            text: `${lead} Nearest evacuation ${nearestKm} km. Verify + get routes at emergencyinfobc.gov.bc.ca.`,
            client_id: p.client_id, location: `${p.asset_name} (${lat},${lng})`, skip_relevance_gate: true,
            severity: sev, fallback_severity: sev, fallback_category: hasOrder ? "active_threat" : "natural_disaster",
            source_url: EVAC_SRC,
            raw_json: { signal_origin: "monitor-geo-wildfire", source: "BCWS_evacuation", asset_type: p.asset_type,
              proximity: { asset: p.asset_name, nearest_km: nearestKm, radius_km: radius }, highest_status: hasOrder ? "Order" : "Alert",
              orders: orders.map((e) => ({ area: e.order_alert_name || e.event_name, km: e.distance_km, agency: e.issuing_agency, sys_id: e.sys_id })),
              alerts: alerts.map((e) => ({ area: e.order_alert_name || e.event_name, km: e.distance_km, agency: e.issuing_agency, sys_id: e.sys_id })),
              is_threat_relevant: true, severity_hint: sev },
          });
          if (hasOrder) await forceCritical(sid); // household Order = critical, non-negotiable
        } else {
          // Industrial: per-polygon (unchanged during the parallel window; PECL framing).
          for (const e of evacs) {
            findings.push({ kind: "evac", status: e.status, name: e.event_name, km: e.distance_km, asset: p.asset_name, client: p.client_name });
            await emit({
              text: `BCWS Evacuation ${e.status}: ${e.event_name || e.order_alert_name || "affected area"} — ${e.distance_km} km from ${noun}. Agency: ${e.issuing_agency || "n/a"}.${e.homes ? " " + e.homes + " homes." : ""} ${frame(e.status === "Order")}`,
              client_id: p.client_id, location: `${p.asset_name} (${lat},${lng})`, skip_relevance_gate: true,
              severity: e.status === "Order" ? "critical" : "high", fallback_severity: e.status === "Order" ? "critical" : "high",
              fallback_category: e.status === "Order" ? "active_threat" : "natural_disaster", source_url: EVAC_SRC,
              raw_json: { signal_origin: "monitor-geo-wildfire", source: "BCWS_evacuation", asset_type: p.asset_type,
                proximity: { asset: p.asset_name, distance_km: e.distance_km, radius_km: radius }, evac_status: e.status, sys_id: e.sys_id,
                is_threat_relevant: true, severity_hint: e.status === "Order" ? "critical" : "high" },
            });
          }
        }
      }

      // 2. BCWS active fires
      for (const f of await findBCWSActiveFiresNear(lat, lng, radius)) {
        firesInRadius++;
        findings.push({ kind: "fire", status: f.status, fire: f.fire_number, size_ha: f.size_ha, km: f.distance_km, asset: p.asset_name, client: p.client_name });
        await emit({
          text: `BCWS active fire ${f.fire_number}${f.incident_name ? " (" + f.incident_name + ")" : ""}: ${f.status}${f.size_ha ? ", " + f.size_ha + " ha" : ""} — ${f.distance_km} km from ${noun}. ${frame(f.status === "Out of Control")}`,
          client_id: p.client_id, location: `${p.asset_name} (${lat},${lng})`, skip_relevance_gate: true,
          severity: f.status === "Out of Control" ? "high" : "medium", fallback_severity: f.status === "Out of Control" ? "high" : "medium",
          fallback_category: "natural_disaster",
          source_url: f.fire_url || "https://wildfiresituation.nrs.gov.bc.ca/",
          raw_json: { signal_origin: "monitor-geo-wildfire", source: "BCWS_active_fire", asset_type: p.asset_type,
            proximity: { asset: p.asset_name, distance_km: f.distance_km, radius_km: radius }, fire_number: f.fire_number, fire_status: f.status,
            size_ha: f.size_ha, is_threat_relevant: true, severity_hint: f.status === "Out of Control" ? "high" : "medium" },
        });
      }

      // 3. CWFIS hotspots — HOUSEHOLD GATE: a household hotspot is always a real fire (never suppressed).
      //    Industrial CWFIS/flaring stays with the old monitor-wildfires during the parallel window.
      if (household) {
        const hs = await cwfisNear(lat, lng, radius);
        if (hs.count > 0) {
          findings.push({ kind: "cwfis", count: hs.count, nearest_km: hs.nearest_km, asset: p.asset_name, client: p.client_name });
          await emit({
            text: `${hs.count} CWFIS thermal hotspot${hs.count > 1 ? "s" : ""} (satellite, last 24h) within ${radius} km of ${noun}; nearest ${hs.nearest_km} km. Treat as a possible real fire — corroborate with BCWS. ${frame(false)}`,
            client_id: p.client_id, location: `${p.asset_name} (${lat},${lng})`, skip_relevance_gate: true,
            severity: "medium", fallback_severity: "medium", fallback_category: "natural_disaster",
            source_url: `${CWFIS_WFS}?typeName=public:hotspots_last24hrs`,
            raw_json: { signal_origin: "monitor-geo-wildfire", source: "CWFIS_hotspots", asset_type: p.asset_type,
              proximity: { asset: p.asset_name, hotspot_count: hs.count, nearest_km: hs.nearest_km, radius_km: radius }, is_threat_relevant: true },
          });
        }
      }
    }

    const summary = { geo_points: points.length, evac_orders_in_radius: ordersInRadius, evac_alerts_in_radius: alertsInRadius,
      fires_in_radius: firesInRadius, signals_emitted: emitted, emit_errors: emitErrors, emit_err_details: emitErrDetails, findings };

    // OUTPUT CONTRACT: an ORDER or ALERT in radius with nothing emitted = FAILURE.
    if ((ordersInRadius + alertsInRadius) > 0 && emitted === 0) {
      await failHeartbeat(supabase, hb, new Error(`output contract: ${ordersInRadius} order(s)+${alertsInRadius} alert(s) in radius but 0 emitted (errors=${emitErrors}; ${emitErrDetails.join(" | ")})`));
      return errorResponse(`output contract failed`, 500);
    }

    await completeHeartbeat(supabase, hb, summary);
    return successResponse({ success: true, ...summary });
  } catch (err) {
    await failHeartbeat(supabase, hb, err instanceof Error ? err : new Error(String(err)));
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
});
