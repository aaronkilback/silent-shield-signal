// travel-record-mutate — Travel Editing slice, Phases 3 + 4 + 5.
//
// Single scoped server-side mutation path for travel records. verify_jwt=false →
// self-authenticates via getCallerIdentity. Service-role writes happen ONLY after
// caller→scope→role→ownership checks pass; fail closed before any write.
//
// Manual (operator user JWT, analyst/admin/super_admin; source='manual', committed):
//   create_traveler, create_itinerary, create_itinerary_traveler,
//   update_traveler, update_itinerary (incl. ground + validated traveler_id change),
//   archive_traveler, archive_itinerary, update_itinerary_traveler,
//   remove_itinerary_traveler, check_in, acknowledge_travel_alert.
// Aegis (Phase 4): propose_edit (PENDING, no commit) / approve_edit / reject_edit.
//   Service-role callers may ONLY propose (must supply scope-validated actor_user_id);
//   approve/reject/manual are operator-user only → Aegis can never commit.
//
// Invariants: client_id is ALWAYS assigned server-side from selectedClientId (never
// trusted from the model/body). Any traveler_id supplied (itinerary create/update,
// journey assignment) is validated to belong to selectedClientId. Archive = status
// (no hard delete of travelers/itineraries). itinerary_scan_history is never touched.

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
  getAccessibleClientIds,
} from "../_shared/supabase-client.ts";

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
  "traveler_id", // validated against selectedClientId before any write
]);
const ITINERARY_TRAVELER_FIELDS = new Set(["role"]);

// Ownership / system columns that may NEVER be set via `fields`. traveler_id is NOT here:
// it is allowed for itineraries (validated) and via explicit journey-assignment params,
// and remains blocked for travelers/itinerary_travelers (absent from their allow-lists).
const FORBIDDEN_FIELDS = new Set([
  "id", "client_id", "tenant_id", "created_by", "created_at", "updated_at",
  "user_id", "itinerary_id",
]);

const ARCHIVE_STATUS = "archived";

const SPECS: Record<string, { table: string; mode: "update" | "archive" | "remove" | "ack"; allowed?: Set<string> }> = {
  update_traveler: { table: "travelers", mode: "update", allowed: TRAVELER_FIELDS },
  archive_traveler: { table: "travelers", mode: "archive" },
  update_itinerary: { table: "itineraries", mode: "update", allowed: ITINERARY_FIELDS },
  archive_itinerary: { table: "itineraries", mode: "archive" },
  update_itinerary_traveler: { table: "itinerary_travelers", mode: "update", allowed: ITINERARY_TRAVELER_FIELDS },
  remove_itinerary_traveler: { table: "itinerary_travelers", mode: "remove" },
  acknowledge_travel_alert: { table: "travel_alerts", mode: "ack" },
};
const CREATE_ACTIONS = new Set(["create_traveler", "create_itinerary", "create_itinerary_traveler"]);
const PROPOSABLE = new Set(["update_traveler", "update_itinerary", "archive_traveler", "archive_itinerary", "acknowledge_travel_alert"]);

type Svc = ReturnType<typeof createServiceClient>;
type Actor = { userId: string | null; roles: string[]; isSuperAdmin: boolean; actorRole: string };

function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of keys) o[k] = row[k];
  return o;
}
function eq(a: unknown, b: unknown): boolean { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

function sanitizeFields(fields: unknown, allowed: Set<string>):
  { ok: true; obj: Record<string, unknown> } | { ok: false; error: string } {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return { ok: false, error: "fields must be an object" };
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.has(k)) return { ok: false, error: `field '${k}' is not editable (ownership/system column)` };
    if (!allowed.has(k)) return { ok: false, error: `unknown or non-editable field '${k}'` };
    obj[k] = v;
  }
  if (Object.keys(obj).length === 0) return { ok: false, error: "no editable fields supplied" };
  return { ok: true, obj };
}

async function rolesFor(svc: Svc, userId: string): Promise<Actor> {
  const { data } = await svc.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  const isSuperAdmin = roles.includes("super_admin");
  const actorRole = isSuperAdmin ? "super_admin" : (roles.includes("admin") ? "admin" : (roles.includes("analyst") ? "analyst" : "viewer"));
  return { userId, roles, isSuperAdmin, actorRole };
}
function isOperator(a: Actor): boolean { return a.isSuperAdmin || a.roles.includes("admin") || a.roles.includes("analyst"); }

// A supplied traveler_id must belong to selectedClientId (blocks cross-client linkage).
async function travelerInClient(svc: Svc, travelerId: unknown, selectedClientId: string): Promise<boolean> {
  if (typeof travelerId !== "string" || !travelerId) return false;
  const { data } = await svc.from("travelers").select("client_id").eq("id", travelerId).maybeSingle();
  return !!data && data.client_id === selectedClientId;
}

async function loadOwned(svc: Svc, table: string, id: string, selectedClientId: string):
  Promise<{ ok: true; row: Record<string, unknown>; traveler_id: string | null; itinerary_id: string | null }
        | { ok: false; error: string; status: number }> {
  if (table === "travel_alerts") {
    const { data: alert } = await svc.from("travel_alerts").select("*").eq("id", id).maybeSingle();
    if (!alert) return { ok: false, error: "record not found", status: 404 };
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
      return { ok: false, error: "OWNERSHIP_MISMATCH: alert is not owned by selectedClientId", status: 403 };
    }
    return { ok: true, row: alert, traveler_id: alert.traveler_id ?? null, itinerary_id: alert.itinerary_id ?? null };
  }
  const { data: row } = await svc.from(table).select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "record not found", status: 404 };
  if (row.client_id !== selectedClientId) return { ok: false, error: "OWNERSHIP_MISMATCH: record is not in selectedClientId", status: 403 };
  const traveler_id = table === "travelers" ? id : (row.traveler_id ?? null);
  const itinerary_id = table === "itineraries" ? id : (row.itinerary_id ?? null);
  return { ok: true, row, traveler_id, itinerary_id };
}

function computeChange(spec: { mode: string; allowed?: Set<string> }, row: Record<string, unknown>, fields: unknown):
  { ok: true; before: Record<string, unknown>; after: Record<string, unknown> } | { ok: false; error: string } {
  if (spec.mode === "update") {
    const san = sanitizeFields(fields, spec.allowed!);
    if (!san.ok) return { ok: false, error: san.error };
    const keys = Object.keys(san.obj);
    return { ok: true, before: pick(row, keys), after: san.obj };
  }
  if (spec.mode === "archive") return { ok: true, before: { status: row.status }, after: { status: ARCHIVE_STATUS } };
  if (spec.mode === "ack") return { ok: true, before: { acknowledged: row.acknowledged, is_active: row.is_active }, after: { acknowledged: true, is_active: false } };
  if (spec.mode === "remove") return { ok: true, before: pick(row, ["role", "itinerary_id", "traveler_id"]), after: { _removed: true } };
  return { ok: false, error: "unsupported mode" };
}

async function applyChange(svc: Svc, spec: { table: string; mode: string }, id: string, selectedClientId: string, after: Record<string, unknown>, approverId: string | null):
  Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const t = spec.table;
  // Validate any traveler_id change against selectedClientId before writing.
  if (t === "itineraries" && Object.prototype.hasOwnProperty.call(after, "traveler_id")) {
    if (!(await travelerInClient(svc, after.traveler_id, selectedClientId))) {
      return { ok: false, error: "CROSS_CLIENT_TRAVELER: traveler_id is not in selectedClientId", status: 403 };
    }
  }
  if (spec.mode === "remove") {
    const { data } = await svc.from(t).delete().eq("id", id).eq("client_id", selectedClientId).select().maybeSingle();
    return data ? { ok: true } : { ok: false, error: "OWNERSHIP_MISMATCH: 0 rows changed", status: 403 };
  }
  let updateObj: Record<string, unknown>;
  if (spec.mode === "ack") {
    updateObj = { acknowledged: true, is_active: false, acknowledged_at: new Date().toISOString(), acknowledged_by: approverId };
  } else {
    updateObj = after;
  }
  let q = svc.from(t).update(updateObj).eq("id", id);
  if (t !== "travel_alerts") q = q.eq("client_id", selectedClientId);
  const { data } = await q.select().maybeSingle();
  return data ? { ok: true } : { ok: false, error: "OWNERSHIP_MISMATCH: 0 rows changed", status: 403 };
}

async function writeAudit(svc: Svc, row: {
  table_name: string; record_id: string; client_id: string;
  traveler_id: string | null; itinerary_id: string | null;
  actor_user_id: string | null; actor_role: string;
  before: Record<string, unknown>; after: Record<string, unknown>;
  summary: string; request_id: string | null;
}): Promise<string | null> {
  const { data } = await svc.from("travel_record_edits").insert({
    table_name: row.table_name, record_id: row.record_id, client_id: row.client_id,
    traveler_id: row.traveler_id, itinerary_id: row.itinerary_id,
    actor_user_id: row.actor_user_id, actor_role: row.actor_role,
    source: "manual", approval_status: "committed",
    before_values: row.before, after_values: row.after,
    change_summary: row.summary, request_id: row.request_id,
  }).select("id").single();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const svc = createServiceClient();
  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body", 400); }
  const action = typeof body.action === "string" ? body.action : "";
  const selectedClientId = typeof body.selectedClientId === "string" ? body.selectedClientId.trim() : "";
  const requestId = typeof body.request_id === "string" ? body.request_id : (req.headers.get("x-request-id") ?? null);

  const KNOWN = new Set([...Object.keys(SPECS), ...CREATE_ACTIONS, "check_in", "propose_edit", "approve_edit", "reject_edit"]);
  if (!KNOWN.has(action)) return errorResponse(`unknown action '${action}'`, 400);
  if (!selectedClientId) return errorResponse("CLIENT_CONTEXT_MISSING: selectedClientId is required", 400);

  // Acting principal. Service-role may ONLY propose (names a scope-validated operator).
  let actor: Actor;
  if (caller.kind === "service_role") {
    if (action !== "propose_edit") {
      return errorResponse("SERVICE_ROLE_FORBIDDEN: service-role may only propose_edit; approve/reject/commit are operator-only", 403);
    }
    const actorUserId = typeof body.actor_user_id === "string" ? body.actor_user_id.trim() : "";
    if (!actorUserId) return errorResponse("ACTOR_REQUIRED: actor_user_id is required for service-role proposals", 400);
    actor = await rolesFor(svc, actorUserId);
  } else {
    actor = await rolesFor(svc, caller.userId);
  }
  if (!isOperator(actor)) return errorResponse("INSUFFICIENT_ROLE: operational travel edits require analyst/admin", 403);
  if (!actor.isSuperAdmin) {
    const accessible = await getAccessibleClientIds(svc, actor.userId!);
    if (!accessible.includes(selectedClientId)) return errorResponse("CLIENT_NOT_AUTHORIZED: principal cannot access selectedClientId", 403);
  }

  try {
    // ── Phase 5: CREATE actions (client_id assigned server-side) ──
    if (action === "create_traveler") {
      const san = sanitizeFields(body.fields, TRAVELER_FIELDS);
      if (!san.ok) return errorResponse(san.error, 400);
      const { data: created, error } = await svc.from("travelers")
        .insert({ ...san.obj, client_id: selectedClientId, created_by: actor.userId }).select().single();
      if (error || !created) return errorResponse("create_traveler failed: " + (error?.message ?? "unknown"), 400);
      const auditId = await writeAudit(svc, { table_name: "travelers", record_id: created.id, client_id: selectedClientId, traveler_id: created.id, itinerary_id: null, actor_user_id: actor.userId, actor_role: actor.actorRole, before: {}, after: san.obj, summary: "create_traveler", request_id: requestId });
      return successResponse({ success: true, action, table_name: "travelers", record_id: created.id, audit_id: auditId, changed_fields: Object.keys(san.obj) });
    }
    if (action === "create_itinerary") {
      const san = sanitizeFields(body.fields, ITINERARY_FIELDS);
      if (!san.ok) return errorResponse(san.error, 400);
      if (Object.prototype.hasOwnProperty.call(san.obj, "traveler_id") && !(await travelerInClient(svc, san.obj.traveler_id, selectedClientId))) {
        return errorResponse("CROSS_CLIENT_TRAVELER: traveler_id is not in selectedClientId", 403);
      }
      const { data: created, error } = await svc.from("itineraries")
        .insert({ ...san.obj, client_id: selectedClientId, created_by: actor.userId }).select().single();
      if (error || !created) return errorResponse("create_itinerary failed: " + (error?.message ?? "unknown"), 400);
      const auditId = await writeAudit(svc, { table_name: "itineraries", record_id: created.id, client_id: selectedClientId, traveler_id: (san.obj.traveler_id as string) ?? null, itinerary_id: created.id, actor_user_id: actor.userId, actor_role: actor.actorRole, before: {}, after: san.obj, summary: "create_itinerary", request_id: requestId });
      return successResponse({ success: true, action, table_name: "itineraries", record_id: created.id, audit_id: auditId, changed_fields: Object.keys(san.obj) });
    }
    if (action === "create_itinerary_traveler") {
      const itineraryId = typeof body.itinerary_id === "string" ? body.itinerary_id.trim() : "";
      const travelerId = typeof body.traveler_id === "string" ? body.traveler_id.trim() : "";
      const role = typeof body.role === "string" && body.role ? body.role : "passenger";
      if (!itineraryId || !travelerId) return errorResponse("itinerary_id and traveler_id are required", 400);
      const itin = await loadOwned(svc, "itineraries", itineraryId, selectedClientId);
      if (!itin.ok) return errorResponse(itin.error, itin.status);
      if (!(await travelerInClient(svc, travelerId, selectedClientId))) return errorResponse("CROSS_CLIENT_TRAVELER: traveler_id is not in selectedClientId", 403);
      const { data: created, error } = await svc.from("itinerary_travelers")
        .insert({ itinerary_id: itineraryId, traveler_id: travelerId, role, client_id: selectedClientId }).select().single();
      if (error || !created) return errorResponse("create_itinerary_traveler failed: " + (error?.message ?? "unknown"), 400);
      const auditId = await writeAudit(svc, { table_name: "itinerary_travelers", record_id: created.id, client_id: selectedClientId, traveler_id: travelerId, itinerary_id: itineraryId, actor_user_id: actor.userId, actor_role: actor.actorRole, before: {}, after: { itinerary_id: itineraryId, traveler_id: travelerId, role }, summary: "create_itinerary_traveler", request_id: requestId });
      return successResponse({ success: true, action, table_name: "itinerary_travelers", record_id: created.id, audit_id: auditId, changed_fields: ["itinerary_id", "traveler_id", "role"] });
    }

    // ── Phase 5: check_in (server-computed; no arbitrary system-field writes) ──
    if (action === "check_in") {
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!id) return errorResponse("RECORD_ID_MISSING: id is required", 400);
      const owned = await loadOwned(svc, "itineraries", id, selectedClientId);
      if (!owned.ok) return errorResponse(owned.error, owned.status);
      const interval = Number((owned.row as Record<string, unknown>).check_in_interval_minutes) || 60;
      const now = new Date();
      const next = new Date(now.getTime() + interval * 60000).toISOString();
      const before = pick(owned.row as Record<string, unknown>, ["last_check_in_at", "next_check_in_due_at", "journey_overdue"]);
      const after = { last_check_in_at: now.toISOString(), next_check_in_due_at: next, journey_overdue: false };
      const { data: updated } = await svc.from("itineraries").update(after).eq("id", id).eq("client_id", selectedClientId).select().maybeSingle();
      if (!updated) return errorResponse("OWNERSHIP_MISMATCH: 0 rows changed", 403);
      const auditId = await writeAudit(svc, { table_name: "itineraries", record_id: id, client_id: selectedClientId, traveler_id: (owned.row as Record<string, unknown>).traveler_id as string ?? null, itinerary_id: id, actor_user_id: actor.userId, actor_role: actor.actorRole, before, after, summary: "check_in", request_id: requestId });
      return successResponse({ success: true, action, table_name: "itineraries", record_id: id, audit_id: auditId, changed_fields: Object.keys(after) });
    }

    // ── Phase 4: approve / reject ──
    if (action === "approve_edit" || action === "reject_edit") {
      const proposalId = typeof body.proposal_id === "string" ? body.proposal_id.trim() : "";
      if (!proposalId) return errorResponse("PROPOSAL_ID_MISSING: proposal_id is required", 400);
      const { data: prop } = await svc.from("travel_record_edits").select("*").eq("id", proposalId).maybeSingle();
      if (!prop) return errorResponse("proposal not found", 404);
      if (prop.source !== "aegis_proposed" || prop.approval_status !== "pending") {
        return errorResponse("PROPOSAL_NOT_PENDING: proposal is not in a pending aegis_proposed state", 409);
      }
      if (prop.client_id !== selectedClientId) return errorResponse("OWNERSHIP_MISMATCH: proposal is not in selectedClientId", 403);

      if (action === "reject_edit") {
        const reason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : "";
        if (!reason) return errorResponse("REJECTION_REASON_REQUIRED", 400);
        await svc.from("travel_record_edits").update({ approval_status: "rejected", rejection_reason: reason, approved_by: actor.userId, approved_at: new Date().toISOString() }).eq("id", proposalId);
        return successResponse({ success: true, action: "reject_edit", proposal_id: proposalId, approval_status: "rejected", record_id: prop.record_id });
      }
      const spec = Object.values(SPECS).find((s) => s.table === prop.table_name && (
        (s.mode === "archive" && (prop.after_values?.status === ARCHIVE_STATUS)) ||
        (s.mode === "ack" && (prop.after_values?.acknowledged === true)) ||
        (s.mode === "update" && !(prop.after_values?.status === ARCHIVE_STATUS) && !(prop.after_values?.acknowledged === true))
      ));
      if (!spec) return errorResponse("proposal shape not recognized", 422);
      const owned = await loadOwned(svc, prop.table_name, prop.record_id, selectedClientId);
      if (!owned.ok) return errorResponse(owned.error, owned.status);
      const beforeKeys = Object.keys(prop.before_values ?? {});
      const conflict = beforeKeys.some((k) => !eq((owned.row as Record<string, unknown>)[k], (prop.before_values as Record<string, unknown>)[k]));
      if (conflict) {
        return successResponse({ success: false, action: "approve_edit", proposal_id: proposalId, status: "conflict",
          message: "The record changed since this proposal was created. Regenerate or edit manually.",
          record_id: prop.record_id, table_name: prop.table_name }, 409);
      }
      const applied = await applyChange(svc, spec, prop.record_id, selectedClientId, prop.after_values as Record<string, unknown>, actor.userId);
      if (!applied.ok) return errorResponse(applied.error, applied.status);
      await svc.from("travel_record_edits").update({ approval_status: "approved", approved_by: actor.userId, approved_at: new Date().toISOString() }).eq("id", proposalId);
      return successResponse({ success: true, action: "approve_edit", proposal_id: proposalId, approval_status: "approved", table_name: prop.table_name, record_id: prop.record_id });
    }

    // ── Phase 4: propose_edit (stage pending; NO operational change) ──
    if (action === "propose_edit") {
      const targetAction = typeof body.target_action === "string" ? body.target_action : "";
      if (!PROPOSABLE.has(targetAction)) return errorResponse(`target_action '${targetAction}' is not proposable`, 400);
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!id) return errorResponse("RECORD_ID_MISSING: id is required", 400);
      const spec = SPECS[targetAction];
      const owned = await loadOwned(svc, spec.table, id, selectedClientId);
      if (!owned.ok) return errorResponse(owned.error, owned.status);
      const change = computeChange(spec, owned.row, body.fields);
      if (!change.ok) return errorResponse(change.error, 400);
      if (spec.table === "itineraries" && Object.prototype.hasOwnProperty.call(change.after, "traveler_id") && !(await travelerInClient(svc, change.after.traveler_id, selectedClientId))) {
        return errorResponse("CROSS_CLIENT_TRAVELER: traveler_id is not in selectedClientId", 403);
      }
      const { data: inserted, error: insErr } = await svc.from("travel_record_edits").insert({
        table_name: spec.table, record_id: id, client_id: selectedClientId,
        traveler_id: owned.traveler_id, itinerary_id: owned.itinerary_id,
        actor_user_id: actor.userId, actor_role: `${actor.actorRole}/aegis`,
        source: "aegis_proposed", approval_status: "pending",
        before_values: change.before, after_values: change.after,
        change_summary: `Aegis proposed ${targetAction}: ${Object.keys(change.after).join(", ")}`,
        request_id: requestId,
      }).select("id").single();
      if (insErr) { console.error("[travel-record-mutate] propose insert failed:", insErr); return errorResponse("failed to stage proposal", 500); }
      return successResponse({ success: true, action: "propose_edit", proposal_id: inserted?.id,
        target_action: targetAction, table_name: spec.table, record_id: id, before: change.before, after: change.after,
        approval_status: "pending", approve: { action: "approve_edit", proposal_id: inserted?.id }, reject: { action: "reject_edit", proposal_id: inserted?.id } });
    }

    // ── Phase 3: manual immediate commit (update/archive/ack/remove) ──
    const spec = SPECS[action];
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return errorResponse("RECORD_ID_MISSING: id is required", 400);
    const owned = await loadOwned(svc, spec.table, id, selectedClientId);
    if (!owned.ok) return errorResponse(owned.error, owned.status);
    const change = computeChange(spec, owned.row, body.fields);
    if (!change.ok) return errorResponse(change.error, 400);
    const applied = await applyChange(svc, spec, id, selectedClientId, change.after, actor.userId);
    if (!applied.ok) return errorResponse(applied.error, applied.status);
    const auditId = await writeAudit(svc, { table_name: spec.table, record_id: id, client_id: selectedClientId, traveler_id: owned.traveler_id, itinerary_id: owned.itinerary_id, actor_user_id: actor.userId, actor_role: actor.actorRole, before: change.before, after: change.after, summary: `${action}: ${Object.keys(change.after).join(", ")}`, request_id: requestId });
    return successResponse({ success: true, action, table_name: spec.table, record_id: id, audit_id: auditId, changed_fields: Object.keys(change.after) });
  } catch (err) {
    console.error("[travel-record-mutate] error:", err);
    return errorResponse("internal error processing mutation", 500);
  }
});
