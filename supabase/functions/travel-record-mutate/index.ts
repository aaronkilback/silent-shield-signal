// travel-record-mutate — Travel Editing slice, Phase 3.
//
// Single scoped server-side mutation path for authorized OPERATOR edits to travel
// records. verify_jwt=false → self-authenticates via getCallerIdentity. Service-role
// writes happen ONLY after caller→scope→role→ownership checks pass; fail closed
// before any write. Every committed mutation writes a travel_record_edits audit row.
//
// Security model (see project_travel_record_editing / feedback_retrieval_is_the_boundary):
//   caller (user JWT) -> role (analyst/admin/super_admin) -> selectedClientId in
//   accessible clients (unless super_admin) -> per-row ownership == selectedClientId
//   -> allow-listed columns only -> audited write. Model/body client_id cannot widen
//   scope; id-only or no-selectedClientId fails closed. Deletes are status-archive
//   (no hard delete of travelers/itineraries). itinerary_scan_history is never touched.

import {
  createServiceClient,
  corsHeaders,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
  getAccessibleClientIds,
} from "../_shared/supabase-client.ts";

// ── Allow-listed editable columns per action (nothing else may be written) ──
const TRAVELER_FIELDS = new Set([
  "name", "email", "phone", "passport_number", "passport_expiry",
  "emergency_contact_name", "emergency_contact_phone",
  "current_location", "current_country", "last_location_update",
  "map_color", "notes", "status",
]);
const ITINERARY_FIELDS = new Set([
  "trip_name", "trip_type", "departure_date", "return_date",
  "origin_city", "origin_country", "destination_city", "destination_country",
  "flight_numbers", "hotel_name", "hotel_address",
  "accommodation_details", "transportation_details", "meeting_schedule",
  "journey_plan", "notes", "risk_level", "monitoring_enabled",
  "status", "check_in_interval_minutes",
]);
const ITINERARY_TRAVELER_FIELDS = new Set(["role"]);

// Ownership / system columns that may NEVER be set through this function.
const FORBIDDEN_FIELDS = new Set([
  "id", "client_id", "tenant_id", "created_by", "created_at", "updated_at",
  "user_id", "traveler_id", "itinerary_id",
]);

const ARCHIVE_STATUS = "archived";

type Caller = { userId: string; roles: string[]; isSuperAdmin: boolean; actorRole: string };

function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of keys) o[k] = row[k];
  return o;
}

// Validate that body.fields only contains allow-listed, non-forbidden keys.
function sanitizeFields(
  fields: unknown,
  allowed: Set<string>,
): { ok: true; obj: Record<string, unknown> } | { ok: false; error: string } {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return { ok: false, error: "fields must be an object" };
  }
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.has(k)) {
      return { ok: false, error: `field '${k}' is not editable (ownership/system column)` };
    }
    if (!allowed.has(k)) {
      return { ok: false, error: `unknown or non-editable field '${k}'` };
    }
    obj[k] = v;
  }
  if (Object.keys(obj).length === 0) return { ok: false, error: "no editable fields supplied" };
  return { ok: true, obj };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const svc = createServiceClient();

  // 1. Caller identity. Phase 3 is operator-driven only — a user JWT is required.
  //    (Service-role / Aegis path is intentionally NOT enabled until Phase 4.)
  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
  if (caller.kind === "service_role") {
    return errorResponse("SERVICE_ROLE_NOT_ENABLED: direct service-role mutation is not enabled (Phase 4)", 403);
  }
  const userId = caller.userId;

  // 2. Parse + basic shape.
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body", 400); }
  const action = typeof body.action === "string" ? body.action : "";
  const selectedClientId = typeof body.selectedClientId === "string" ? body.selectedClientId.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const requestId = typeof body.request_id === "string" ? body.request_id
    : (req.headers.get("x-request-id") ?? null);

  const KNOWN_ACTIONS = new Set([
    "update_traveler", "archive_traveler",
    "update_itinerary", "archive_itinerary",
    "update_itinerary_traveler", "remove_itinerary_traveler",
    "acknowledge_travel_alert",
  ]);
  if (!KNOWN_ACTIONS.has(action)) return errorResponse(`unknown action '${action}'`, 400);
  // No mutation by id alone; no mutation without an authoritative selected client.
  if (!selectedClientId) return errorResponse("CLIENT_CONTEXT_MISSING: selectedClientId is required", 400);
  if (!id) return errorResponse("RECORD_ID_MISSING: id is required", 400);

  // 3. Role gate — operational edits require analyst/admin/super_admin.
  const { data: roleRows } = await svc.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const isSuperAdmin = roles.includes("super_admin");
  const isOperator = isSuperAdmin || roles.includes("admin") || roles.includes("analyst");
  if (!isOperator) {
    return errorResponse("INSUFFICIENT_ROLE: operational travel edits require analyst/admin", 403);
  }
  const actorRole = isSuperAdmin ? "super_admin" : (roles.includes("admin") ? "admin" : "analyst");

  // 4. Scope gate — selectedClientId must be accessible (unless super_admin).
  if (!isSuperAdmin) {
    const accessible = await getAccessibleClientIds(svc, userId);
    if (!accessible.includes(selectedClientId)) {
      return errorResponse("CLIENT_NOT_AUTHORIZED: caller cannot access selectedClientId", 403);
    }
  }

  const ctx: Caller = { userId, roles, isSuperAdmin, actorRole };

  try {
    switch (action) {
      case "update_traveler":
        return await mutateClientOwned(svc, ctx, "travelers", id, selectedClientId, body.fields, TRAVELER_FIELDS, requestId);
      case "archive_traveler":
        return await archiveClientOwned(svc, ctx, "travelers", id, selectedClientId, requestId);
      case "update_itinerary":
        return await mutateClientOwned(svc, ctx, "itineraries", id, selectedClientId, body.fields, ITINERARY_FIELDS, requestId);
      case "archive_itinerary":
        return await archiveClientOwned(svc, ctx, "itineraries", id, selectedClientId, requestId);
      case "update_itinerary_traveler":
        return await mutateClientOwned(svc, ctx, "itinerary_travelers", id, selectedClientId, body.fields, ITINERARY_TRAVELER_FIELDS, requestId);
      case "remove_itinerary_traveler":
        return await removeItineraryTraveler(svc, ctx, id, selectedClientId, requestId);
      case "acknowledge_travel_alert":
        return await acknowledgeAlert(svc, ctx, id, selectedClientId, requestId);
      default:
        return errorResponse(`unhandled action '${action}'`, 400);
    }
  } catch (err) {
    console.error("[travel-record-mutate] error:", err);
    return errorResponse("internal error processing mutation", 500);
  }
});

// ── Audit writer (service-role; the ONLY write path into travel_record_edits) ──
async function writeAudit(
  svc: ReturnType<typeof createServiceClient>,
  row: {
    table_name: string; record_id: string; client_id: string;
    traveler_id?: string | null; itinerary_id?: string | null;
    actor_user_id: string; actor_role: string;
    before_values: Record<string, unknown>; after_values: Record<string, unknown>;
    change_summary: string; request_id: string | null;
  },
): Promise<string | null> {
  const { data, error } = await svc.from("travel_record_edits").insert({
    table_name: row.table_name,
    record_id: row.record_id,
    client_id: row.client_id,
    traveler_id: row.traveler_id ?? null,
    itinerary_id: row.itinerary_id ?? null,
    actor_user_id: row.actor_user_id,
    actor_role: row.actor_role,
    source: "manual",
    approval_status: "committed",
    before_values: row.before_values,
    after_values: row.after_values,
    change_summary: row.change_summary,
    request_id: row.request_id,
  }).select("id").single();
  if (error) { console.error("[travel-record-mutate] audit insert failed:", error); return null; }
  return data?.id ?? null;
}

// ── Generic update for client_id-owned travel tables ──
async function mutateClientOwned(
  svc: ReturnType<typeof createServiceClient>,
  ctx: Caller, table: string, id: string, selectedClientId: string,
  fields: unknown, allowed: Set<string>, requestId: string | null,
): Promise<Response> {
  const san = sanitizeFields(fields, allowed);
  if (!san.ok) return errorResponse(san.error, 400);

  // Load current row + verify ownership BEFORE any write.
  const { data: current, error: loadErr } = await svc.from(table).select("*").eq("id", id).maybeSingle();
  if (loadErr) return errorResponse("lookup failed", 500);
  if (!current) return errorResponse("record not found", 404);
  if (current.client_id !== selectedClientId) {
    return errorResponse("OWNERSHIP_MISMATCH: record is not in selectedClientId", 403);
  }

  const updateObj = san.obj;
  const keys = Object.keys(updateObj);
  // Ownership is also enforced in the WHERE clause (belt-and-suspenders).
  const { data: updated, error: updErr } = await svc.from(table)
    .update(updateObj).eq("id", id).eq("client_id", selectedClientId).select().maybeSingle();
  if (updErr) return errorResponse("update failed", 500);
  if (!updated) return errorResponse("OWNERSHIP_MISMATCH: 0 rows changed", 403);

  const before = pick(current as Record<string, unknown>, keys);
  const after = pick(updated as Record<string, unknown>, keys);
  const auditId = await writeAudit(svc, {
    table_name: table, record_id: id, client_id: selectedClientId,
    traveler_id: table === "travelers" ? id : (current.traveler_id ?? null),
    itinerary_id: table === "itineraries" ? id : (current.itinerary_id ?? null),
    actor_user_id: ctx.userId, actor_role: ctx.actorRole,
    before_values: before, after_values: after,
    change_summary: `${table} updated: ${keys.join(", ")}`, request_id: requestId,
  });
  return successResponse({
    success: true, action: `update_${table}`, table_name: table, record_id: id,
    audit_id: auditId, changed_fields: keys,
  });
}

// ── Archive (status change) for travelers / itineraries — no hard delete ──
async function archiveClientOwned(
  svc: ReturnType<typeof createServiceClient>,
  ctx: Caller, table: string, id: string, selectedClientId: string, requestId: string | null,
): Promise<Response> {
  const { data: current, error: loadErr } = await svc.from(table).select("*").eq("id", id).maybeSingle();
  if (loadErr) return errorResponse("lookup failed", 500);
  if (!current) return errorResponse("record not found", 404);
  if (current.client_id !== selectedClientId) {
    return errorResponse("OWNERSHIP_MISMATCH: record is not in selectedClientId", 403);
  }
  const { data: updated, error: updErr } = await svc.from(table)
    .update({ status: ARCHIVE_STATUS }).eq("id", id).eq("client_id", selectedClientId).select().maybeSingle();
  if (updErr) return errorResponse("archive failed", 500);
  if (!updated) return errorResponse("OWNERSHIP_MISMATCH: 0 rows changed", 403);

  const auditId = await writeAudit(svc, {
    table_name: table, record_id: id, client_id: selectedClientId,
    traveler_id: table === "travelers" ? id : (current.traveler_id ?? null),
    itinerary_id: table === "itineraries" ? id : null,
    actor_user_id: ctx.userId, actor_role: ctx.actorRole,
    before_values: { status: current.status },
    after_values: { status: ARCHIVE_STATUS },
    change_summary: `${table} archived (status ${current.status} -> ${ARCHIVE_STATUS})`, request_id: requestId,
  });
  return successResponse({
    success: true, action: `archive_${table}`, table_name: table, record_id: id,
    audit_id: auditId, changed_fields: ["status"],
  });
}

// ── Remove an itinerary_travelers (party) row — allowed hard delete of a join row ──
async function removeItineraryTraveler(
  svc: ReturnType<typeof createServiceClient>,
  ctx: Caller, id: string, selectedClientId: string, requestId: string | null,
): Promise<Response> {
  const { data: current, error: loadErr } = await svc.from("itinerary_travelers").select("*").eq("id", id).maybeSingle();
  if (loadErr) return errorResponse("lookup failed", 500);
  if (!current) return errorResponse("record not found", 404);
  if (current.client_id !== selectedClientId) {
    return errorResponse("OWNERSHIP_MISMATCH: record is not in selectedClientId", 403);
  }
  const { data: deleted, error: delErr } = await svc.from("itinerary_travelers")
    .delete().eq("id", id).eq("client_id", selectedClientId).select().maybeSingle();
  if (delErr) return errorResponse("remove failed", 500);
  if (!deleted) return errorResponse("OWNERSHIP_MISMATCH: 0 rows changed", 403);

  const auditId = await writeAudit(svc, {
    table_name: "itinerary_travelers", record_id: id, client_id: selectedClientId,
    traveler_id: current.traveler_id ?? null, itinerary_id: current.itinerary_id ?? null,
    actor_user_id: ctx.userId, actor_role: ctx.actorRole,
    before_values: pick(current as Record<string, unknown>, ["role", "itinerary_id", "traveler_id"]),
    after_values: { _removed: true },
    change_summary: "itinerary_travelers row removed", request_id: requestId,
  });
  return successResponse({
    success: true, action: "remove_itinerary_traveler", table_name: "itinerary_travelers",
    record_id: id, audit_id: auditId, changed_fields: ["_removed"],
  });
}

// ── Acknowledge a travel_alert — ownership derived via traveler/itinerary -> client ──
async function acknowledgeAlert(
  svc: ReturnType<typeof createServiceClient>,
  ctx: Caller, id: string, selectedClientId: string, requestId: string | null,
): Promise<Response> {
  const { data: alert, error: loadErr } = await svc.from("travel_alerts")
    .select("id, traveler_id, itinerary_id, acknowledged, is_active").eq("id", id).maybeSingle();
  if (loadErr) return errorResponse("lookup failed", 500);
  if (!alert) return errorResponse("record not found", 404);

  // Derive owning client(s) via links. Require at least one link, and ALL present
  // links must resolve to selectedClientId (fail closed on any mismatch/ambiguity).
  const derived: string[] = [];
  if (alert.traveler_id) {
    const { data: t } = await svc.from("travelers").select("client_id").eq("id", alert.traveler_id).maybeSingle();
    if (t?.client_id) derived.push(t.client_id);
  }
  if (alert.itinerary_id) {
    const { data: it } = await svc.from("itineraries").select("client_id").eq("id", alert.itinerary_id).maybeSingle();
    if (it?.client_id) derived.push(it.client_id);
  }
  if (derived.length === 0 || derived.some((c) => c !== selectedClientId)) {
    return errorResponse("OWNERSHIP_MISMATCH: alert is not owned by selectedClientId", 403);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await svc.from("travel_alerts")
    .update({ acknowledged: true, acknowledged_at: nowIso, acknowledged_by: ctx.userId, is_active: false })
    .eq("id", id).select("id, acknowledged, is_active").maybeSingle();
  if (updErr) return errorResponse("acknowledge failed", 500);
  if (!updated) return errorResponse("acknowledge: 0 rows changed", 409);

  const auditId = await writeAudit(svc, {
    table_name: "travel_alerts", record_id: id, client_id: selectedClientId,
    traveler_id: alert.traveler_id ?? null, itinerary_id: alert.itinerary_id ?? null,
    actor_user_id: ctx.userId, actor_role: ctx.actorRole,
    before_values: { acknowledged: alert.acknowledged, is_active: alert.is_active },
    after_values: { acknowledged: true, is_active: false, acknowledged_at: nowIso },
    change_summary: "travel_alert acknowledged", request_id: requestId,
  });
  return successResponse({
    success: true, action: "acknowledge_travel_alert", table_name: "travel_alerts",
    record_id: id, audit_id: auditId, changed_fields: ["acknowledged", "acknowledged_at", "acknowledged_by", "is_active"],
  });
}
