// traveller-journey-status — Traveller Journey Status v1.1 (Fortress safety/journey check-in).
//
// This is NOT airline check-in. A LINKED traveller self-reports a Fortress safety/journey
// status event ("I'm safe / arrived / at pickup / in the vehicle / need assistance") for ONE
// of their OWN itineraries. No booking refs, passports, seat/baggage, or airline data.
//
// verify_jwt=true (default; no config.toml entry). Boundary = travelers.user_id = auth.uid().
// A service-role client is used internally ONLY after the caller is verified, and every write
// is constrained to the caller's own linked traveler + a directly-owned itinerary (v1.1).
// Writes ONLY: a traveller_journey_events row; safety check-in fields on the owned itinerary
// (last_check_in_at / next_check_in_due_at / journey_overdue) for POSITIVE statuses; optional
// own-traveler location; and a travel_record_edits audit row (source='traveller_self').
// Never touches operator notes, risk/intel, raw ground JSON, airline fields, alerts, status,
// ownership, client_id/tenant_id (server-derived), or any other traveller.

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
} from "../_shared/supabase-client.ts";

const EVENT_TYPES = new Set(["safe", "arrived", "at_pickup", "in_vehicle", "need_assistance"]);

function clamp(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  // 1. Caller identity. Require a real user JWT; reject machine/service callers (v1).
  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
  if (caller.kind === "service_role") {
    return errorResponse("SERVICE_ROLE_NOT_ALLOWED: traveller-journey-status is for authenticated traveller users only", 403);
  }
  const userId = caller.userId;

  // 2. Input allow-list. Ownership/scope fields are NEVER taken from the body as authority.
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body", 400); }
  const itineraryId = typeof body.itinerary_id === "string" ? body.itinerary_id.trim() : "";
  const eventType = typeof body.event_type === "string" ? body.event_type.trim() : "";
  const note = clamp(body.note, 500);
  const reportedLocation = clamp(body.current_location, 200);
  const reportedCountry = clamp(body.current_country, 100);

  if (!itineraryId) return errorResponse("ITINERARY_ID_MISSING: itinerary_id is required", 400);
  if (!EVENT_TYPES.has(eventType)) {
    return errorResponse("INVALID_EVENT_TYPE: must be one of safe, arrived, at_pickup, in_vehicle, need_assistance", 400);
  }

  const svc = createServiceClient();

  // 3. Boundary: the caller's linked traveler row(s). NEVER from the body.
  const { data: travelers, error: travErr } = await svc
    .from("travelers").select("id, client_id").eq("user_id", userId);
  if (travErr) { console.error("[traveller-journey-status] traveler lookup failed:", travErr); return errorResponse("lookup failed", 500); }
  if (!travelers || travelers.length === 0) {
    return errorResponse("NOT_LINKED: no traveller profile is linked to this account", 403);
  }
  const linkedIds = travelers.map((t: { id: string }) => t.id);

  // 4. Target itinerary must be DIRECTLY owned by the caller's traveler (v1.1: direct-owned only).
  const { data: itin, error: itinErr } = await svc.from("itineraries")
    .select("id, traveler_id, client_id, check_in_interval_minutes, last_check_in_at, next_check_in_due_at, journey_overdue")
    .eq("id", itineraryId).maybeSingle();
  if (itinErr) { console.error("[traveller-journey-status] itinerary lookup failed:", itinErr); return errorResponse("lookup failed", 500); }
  if (!itin || !linkedIds.includes((itin as { traveler_id: string }).traveler_id)) {
    // Generic — do not reveal whether the itinerary exists or belongs to someone else.
    return errorResponse("ITINERARY_NOT_AVAILABLE: not found or not owned by this traveller", 403);
  }
  const travelerId = (itin as { traveler_id: string }).traveler_id;
  const clientId = (itin as { client_id: string }).client_id; // server-derived, never from body

  const now = new Date();
  const nowIso = now.toISOString();
  const isCheckIn = eventType !== "need_assistance"; // distress must NOT clear the overdue clock

  // 5. Append the journey event (append-only log).
  const { data: ev, error: evErr } = await svc.from("traveller_journey_events").insert({
    traveler_id: travelerId,
    itinerary_id: itineraryId,
    client_id: clientId,
    event_type: eventType,
    note,
    reported_location: reportedLocation,
    reported_country: reportedCountry,
    created_by: userId,
  }).select("id, event_type, created_at").single();
  if (evErr || !ev) { console.error("[traveller-journey-status] event insert failed:", evErr); return errorResponse("event write failed", 500); }

  // 6. Positive statuses = a safety check-in on the OWNED itinerary (double-bound id+traveler_id).
  //    need_assistance is logged only — it does NOT reset the clock or clear journey_overdue.
  const before = {
    last_check_in_at: (itin as Record<string, unknown>).last_check_in_at,
    next_check_in_due_at: (itin as Record<string, unknown>).next_check_in_due_at,
    journey_overdue: (itin as Record<string, unknown>).journey_overdue,
  };
  let after = before;
  if (isCheckIn) {
    const interval = Number((itin as Record<string, unknown>).check_in_interval_minutes) || 60;
    const nextDue = new Date(now.getTime() + interval * 60000).toISOString();
    after = { last_check_in_at: nowIso, next_check_in_due_at: nextDue, journey_overdue: false };
    const { data: updItin } = await svc.from("itineraries").update(after)
      .eq("id", itineraryId).eq("traveler_id", travelerId).select("id").maybeSingle();
    if (!updItin) { console.error("[traveller-journey-status] itinerary check-in changed 0 rows"); return errorResponse("OWNERSHIP_MISMATCH: 0 rows changed", 403); }
  }

  // 7. Optional own-traveler location (only when explicitly provided; useful even for assistance).
  if (reportedLocation || reportedCountry) {
    await svc.from("travelers").update({
      ...(reportedLocation ? { current_location: reportedLocation } : {}),
      ...(reportedCountry ? { current_country: reportedCountry } : {}),
      last_location_update: nowIso,
    }).eq("id", travelerId).eq("user_id", userId);
  }

  // 8. Operator-audit parity row (source='traveller_self').
  await svc.from("travel_record_edits").insert({
    table_name: "itineraries",
    record_id: itineraryId,
    client_id: clientId,
    traveler_id: travelerId,
    itinerary_id: itineraryId,
    actor_user_id: userId,
    actor_role: "traveller",
    source: "traveller_self",
    approval_status: "committed",
    before_values: before,
    after_values: { ...after, journey_event: eventType },
    change_summary: `traveller journey status: ${eventType}`,
  });

  return successResponse({
    success: true,
    event_type: eventType,
    current_journey_status: eventType,
    event_id: ev.id,
    checked_in: isCheckIn,
    last_check_in_at: (after as Record<string, unknown>).last_check_in_at ?? null,
    next_check_in_due_at: (after as Record<string, unknown>).next_check_in_due_at ?? null,
    journey_overdue: (after as Record<string, unknown>).journey_overdue ?? null,
  });
});
