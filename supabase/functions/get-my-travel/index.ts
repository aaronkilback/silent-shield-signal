// get-my-travel — Traveller Self-Scope Read Path (v1).
//
// Read-only surface for a LINKED traveller/family account to see ONLY their own travel
// records. verify_jwt=true (default; no config.toml entry) gates the incoming user JWT.
// The security boundary is travelers.user_id = auth.uid() — NOT tenant RLS and NOT
// tenant_users membership (traveller accounts intentionally have none). A service-role
// client is used internally ONLY after the caller is verified, and EVERY query is
// constrained to the caller's linked traveler id(s). Strict field allow-list: no passports,
// no operator notes, no AI/intel blobs, no client roster, no tenant/client metadata, no L2,
// no audit rows. Read-only — never writes, never calls travel-record-mutate.

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
} from "../_shared/supabase-client.ts";

// Safe column allow-lists (never SELECT *).
const TRAVELER_SELECT = "id, name, status, current_location, current_country, last_location_update, email, phone, emergency_contact_name, emergency_contact_phone";
const ITINERARY_SELECT = "id, trip_name, trip_type, departure_date, return_date, origin_city, origin_country, destination_city, destination_country, status, next_check_in_due_at, last_check_in_at, journey_overdue, hotel_name";
const ALERT_SELECT = "id, itinerary_id, title, severity, alert_type, location, recommended_actions, is_active, acknowledged, created_at";

function uniqById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } }
  return out;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  // 1. Caller identity. v1: require a real user JWT; reject machine/service callers.
  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
  if (caller.kind === "service_role") {
    return errorResponse("SERVICE_ROLE_NOT_ALLOWED: get-my-travel is for authenticated traveller users only", 403);
  }
  const userId = caller.userId;

  // Optional FILTER-ONLY param (applied only within the owned set).
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* body optional */ }
  const filterItineraryId = typeof body.itinerary_id === "string" ? body.itinerary_id.trim() : "";

  const svc = createServiceClient();

  // 2. Boundary: the caller's linked traveler row(s). NEVER from the body.
  const { data: travelers, error: travErr } = await svc
    .from("travelers").select(TRAVELER_SELECT).eq("user_id", userId);
  if (travErr) { console.error("[get-my-travel] traveler lookup failed:", travErr); return errorResponse("lookup failed", 500); }

  // 3. Fail closed when no linked traveler exists — no data, no leak.
  if (!travelers || travelers.length === 0) {
    return successResponse({ linked: false, travelers: [], itineraries: [], alerts: [] });
  }
  const linkedIds = travelers.map((t: { id: string }) => t.id);

  // 4. Owned itineraries: direct (traveler_id) + via party membership (itinerary_travelers).
  const { data: directItins } = await svc.from("itineraries").select(ITINERARY_SELECT).in("traveler_id", linkedIds);
  const { data: partyRows } = await svc.from("itinerary_travelers").select("itinerary_id").in("traveler_id", linkedIds);
  const partyItinIds = [...new Set((partyRows ?? []).map((r: { itinerary_id: string }) => r.itinerary_id).filter(Boolean))];
  let partyItins: Record<string, unknown>[] = [];
  if (partyItinIds.length > 0) {
    const { data } = await svc.from("itineraries").select(ITINERARY_SELECT).in("id", partyItinIds);
    partyItins = data ?? [];
  }
  let itineraries = uniqById([...(directItins ?? []), ...partyItins] as { id: string }[]);
  // Filter-only narrowing AFTER ownership is established.
  if (filterItineraryId) itineraries = itineraries.filter((i) => i.id === filterItineraryId);
  const ownedItinIds = itineraries.map((i) => i.id);

  // 5. Owned alerts: linked traveler OR an owned itinerary.
  const { data: alertsByTraveler } = await svc.from("travel_alerts").select(ALERT_SELECT).in("traveler_id", linkedIds);
  let alertsByItin: Record<string, unknown>[] = [];
  if (ownedItinIds.length > 0) {
    const { data } = await svc.from("travel_alerts").select(ALERT_SELECT).in("itinerary_id", ownedItinIds);
    alertsByItin = data ?? [];
  }
  const alerts = uniqById([...(alertsByTraveler ?? []), ...alertsByItin] as { id: string }[]);

  return successResponse({
    linked: true,
    travelers,      // safe subset only
    itineraries,    // safe subset only
    alerts,         // safe subset only
  });
});
