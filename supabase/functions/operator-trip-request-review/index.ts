// operator-trip-request-review — Trip Intake Slice E2 (operator triage). Lets an OPERATOR mark
// a traveller-submitted pending trip request as needs_clarification or rejected. This stays
// NON-OPERATIONAL: it writes ONLY traveller_trip_requests. It never creates/updates itineraries,
// itinerary_travelers, or travel_alerts; never sets linked_itinerary_id; never sets status=approved.
//
// verify_jwt=true. Operator-only (analyst/admin/super_admin) + selectedClientId must be accessible
// to the caller AND equal the request's client_id (no cross-client). traveler_id/client_id/status/
// linked_itinerary_id are NEVER taken from the body. Only pending_review requests can be triaged.

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
  getAccessibleClientIds,
} from "../_shared/supabase-client.ts";

const OPERATOR_ROLES = new Set(["analyst", "admin", "super_admin"]);

function clampNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, 2000) : null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  // 1. Identity — require a real user JWT; reject machine/service + unauthorized.
  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
  if (caller.kind === "service_role") {
    return errorResponse("SERVICE_ROLE_NOT_ALLOWED: operator-trip-request-review requires an operator user", 403);
  }
  const userId = caller.userId;

  // 2. Inputs (no scope/status fields trusted from body).
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body", 400); }
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
  const selectedClientId = typeof body.selectedClientId === "string" ? body.selectedClientId.trim() : "";
  const reviewNote = clampNote(body.review_note);

  if (action !== "needs_clarification" && action !== "reject") {
    return errorResponse("INVALID_ACTION: must be needs_clarification or reject", 400);
  }
  if (!requestId) return errorResponse("REQUEST_ID_MISSING", 400);
  if (!selectedClientId) return errorResponse("CLIENT_CONTEXT_MISSING: selectedClientId is required", 400);

  const svc = createServiceClient();

  // 3. Operator-role gate (analyst/admin/super_admin). Viewers/travellers rejected.
  const { data: roleRows } = await svc.from("user_roles").select("role").eq("user_id", userId);
  const isOperator = (roleRows ?? []).some((r: { role: string }) => OPERATOR_ROLES.has(r.role));
  if (!isOperator) return errorResponse("INSUFFICIENT_ROLE: operator (analyst/admin/super_admin) required", 403);

  // 4. selectedClientId must be accessible to this operator.
  const accessible = await getAccessibleClientIds(svc, userId);
  if (!accessible.includes(selectedClientId)) {
    return errorResponse("CLIENT_NOT_AUTHORIZED: principal cannot access selectedClientId", 403);
  }

  // 5. Load request; must belong to selectedClientId (no cross-client) and be pending_review.
  const { data: r } = await svc.from("traveller_trip_requests")
    .select("id, client_id, status").eq("id", requestId).maybeSingle();
  if (!r) return errorResponse("REQUEST_NOT_FOUND", 404);
  if ((r as { client_id: string }).client_id !== selectedClientId) {
    return errorResponse("OWNERSHIP_MISMATCH: request is not in selectedClientId", 403);
  }
  if ((r as { status: string }).status !== "pending_review") {
    return errorResponse(`NOT_PENDING: request is ${(r as { status: string }).status}`, 409);
  }

  // 6. Triage write — ONLY traveller_trip_requests; never linked_itinerary_id / approved / other tables.
  const newStatus = action === "reject" ? "rejected" : "needs_clarification";
  const { data: upd } = await svc.from("traveller_trip_requests")
    .update({ status: newStatus, review_note: reviewNote, reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId).eq("client_id", selectedClientId).eq("status", "pending_review")
    .select("id, status, review_note, reviewed_at").maybeSingle();
  if (!upd) return errorResponse("NOT_PENDING: 0 rows changed", 409);

  return successResponse({ success: true, action, request: upd });
});
