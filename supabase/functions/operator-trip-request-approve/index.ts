// operator-trip-request-approve — Trip Intake Slice E3a (the operational boundary). An OPERATOR
// approves a pending traveller trip request into ONE operational itinerary, atomically, via the
// SECURITY DEFINER RPC approve_traveller_trip_request (insert itinerary + insert itinerary_travelers
// link + flip request to approved/linked_itinerary_id + audit, in one transaction).
//
// verify_jwt=true. Operator-only (analyst/admin/super_admin). selectedClientId must be accessible
// AND === request.client_id (no cross-client). traveler_id/client_id are SERVER-derived (request +
// selectedClientId); body client_id/traveler_id/status/linked_itinerary_id are NEVER trusted.
// Required operational fields (origin/destination city+country, dates, trip_name) must be supplied/
// confirmed by the operator — else MISSING_REQUIRED_FIELDS, no partial itinerary. Idempotent:
// already-approved returns the existing itinerary id. Segments are retained as intake context;
// no per-segment operational records, no alerts.

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
  getAccessibleClientIds,
} from "../_shared/supabase-client.ts";

const OPERATOR_ROLES = new Set(["analyst", "admin", "super_admin"]);

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
  if (caller.kind === "service_role") {
    return errorResponse("SERVICE_ROLE_NOT_ALLOWED: operator-trip-request-approve requires an operator user", 403);
  }
  const userId = caller.userId;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body", 400); }
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
  const selectedClientId = typeof body.selectedClientId === "string" ? body.selectedClientId.trim() : "";
  // Operator-reviewed operational fields (the ONLY itinerary inputs accepted from the body).
  const reviewed = {
    trip_name: clampStr(body.trip_name, 200),
    departure_date: clampStr(body.departure_date, 40),
    return_date: clampStr(body.return_date, 40),
    origin_city: clampStr(body.origin_city, 200),
    origin_country: clampStr(body.origin_country, 200),
    destination_city: clampStr(body.destination_city, 200),
    destination_country: clampStr(body.destination_country, 200),
    trip_type: clampStr(body.trip_type, 50),
  };

  if (!requestId) return errorResponse("REQUEST_ID_MISSING", 400);
  if (!selectedClientId) return errorResponse("CLIENT_CONTEXT_MISSING: selectedClientId is required", 400);

  const svc = createServiceClient();

  // Operator-role gate.
  const { data: roleRows } = await svc.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.some((r) => OPERATOR_ROLES.has(r))) {
    return errorResponse("INSUFFICIENT_ROLE: operator (analyst/admin/super_admin) required", 403);
  }
  const actorRole = roles.includes("super_admin") ? "super_admin" : roles.includes("admin") ? "admin" : "analyst";

  // selectedClientId must be accessible.
  const accessible = await getAccessibleClientIds(svc, userId);
  if (!accessible.includes(selectedClientId)) {
    return errorResponse("CLIENT_NOT_AUTHORIZED: principal cannot access selectedClientId", 403);
  }

  // Load request (server source of traveler_id/client_id/status).
  const { data: r } = await svc.from("traveller_trip_requests")
    .select("id, client_id, traveler_id, status, linked_itinerary_id, trip_name, start_date, end_date")
    .eq("id", requestId).maybeSingle();
  if (!r) return errorResponse("REQUEST_NOT_FOUND", 404);
  const reqRow = r as Record<string, unknown>;
  if (reqRow.client_id !== selectedClientId) return errorResponse("OWNERSHIP_MISMATCH: request is not in selectedClientId", 403);

  // Idempotency: already approved → return existing link, create nothing.
  if (reqRow.status === "approved" && reqRow.linked_itinerary_id) {
    return successResponse({ success: true, itinerary_id: reqRow.linked_itinerary_id, status: "approved", idempotent: true });
  }
  if (reqRow.status !== "pending_review") return errorResponse(`NOT_PENDING: request is ${reqRow.status}`, 409);

  const travelerId = reqRow.traveler_id as string;
  // Traveler must belong to selectedClientId.
  const { data: trav } = await svc.from("travelers").select("id, client_id").eq("id", travelerId).maybeSingle();
  if (!trav || (trav as { client_id: string }).client_id !== selectedClientId) {
    return errorResponse("CROSS_CLIENT_TRAVELER: request traveler is not in selectedClientId", 403);
  }

  // Assemble required operational fields: operator-reviewed values, prefilled from the request.
  const trip_name = reviewed.trip_name ?? (reqRow.trip_name as string | null);
  const departure_date = reviewed.departure_date ?? (reqRow.start_date as string | null);
  const return_date = reviewed.return_date ?? (reqRow.end_date as string | null);
  const fields: Record<string, string | null> = {
    trip_name, departure_date, return_date,
    origin_city: reviewed.origin_city, origin_country: reviewed.origin_country,
    destination_city: reviewed.destination_city, destination_country: reviewed.destination_country,
  };
  const missing = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    return errorResponse(`MISSING_REQUIRED_FIELDS: ${missing.join(", ")}`, 400);
  }

  // Atomic approval via SECURITY DEFINER RPC (insert itinerary + link + flip request + audit).
  const { data: itinId, error: rpcErr } = await svc.rpc("approve_traveller_trip_request", {
    p_request_id: requestId,
    p_client_id: selectedClientId,     // server-derived
    p_traveler_id: travelerId,         // server-derived from request
    p_actor: userId,
    p_actor_role: actorRole,
    p_trip_name: trip_name,
    p_departure_date: departure_date,
    p_return_date: return_date,
    p_origin_city: fields.origin_city,
    p_origin_country: fields.origin_country,
    p_destination_city: fields.destination_city,
    p_destination_country: fields.destination_country,
    p_trip_type: reviewed.trip_type ?? "",
  });
  if (rpcErr) {
    console.error("[operator-trip-request-approve] rpc error:", rpcErr);
    return errorResponse(`APPROVAL_FAILED: ${rpcErr.message ?? "unknown"}`, 409);
  }

  return successResponse({ success: true, itinerary_id: itinId, status: "approved" });
});
