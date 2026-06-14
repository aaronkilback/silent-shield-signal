// travel-record-mutate — Travel Editing slice, Phases 3 + 4.
//
// Single scoped server-side mutation path for travel records. verify_jwt=false →
// self-authenticates via getCallerIdentity. Service-role writes happen ONLY after
// caller→scope→role→ownership checks pass; fail closed before any write.
//
// Phase 3 (manual): update/archive traveler+itinerary, update/remove itinerary_traveler,
//   acknowledge travel_alert — committed immediately, source='manual'.
// Phase 4 (Aegis propose→approve→commit):
//   - propose_edit  : stage a PENDING travel_record_edits row (source='aegis_proposed').
//                     NO operational change. May be invoked by an operator user JWT OR by
//                     a service-role Aegis backend (which must supply actor_user_id whose
//                     scope is validated). Proposing requires analyst/admin/super_admin.
//   - approve_edit  : operator (user JWT, analyst/admin/super_admin) commits a pending
//                     proposal — re-validates scope+ownership, CONFLICT-checks before_values
//                     against the live record, applies the change, flips row to 'approved'.
//   - reject_edit   : operator marks a pending proposal 'rejected' (+ rejection_reason).
// Aegis can NEVER commit: service-role callers may ONLY propose; approve/reject are
// operator-user-only. Model/body client_id cannot widen scope; archive = status (no hard
// delete of travelers/itineraries); itinerary_scan_history is never touched.

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
]);
const ITINERARY_TRAVELER_FIELDS = new Set(["role"]);

const FORBIDDEN_FIELDS = new Set([
  "id", "client_id", "tenant_id", "created_by", "created_at", "updated_at",
  "user_id", "traveler_id", "itinerary_id",
]);

const ARCHIVE_STATUS = "archived";

// Action → table + mode + allow-list. Shared by manual commit, propose, and approve.
const SPECS: Record<string, { table: string; mode: "update" | "archive" | "remove" | "ack"; allowed?: Set<string> }> = {
  update_traveler: { table: "travelers", mode: "update", allowed: TRAVELER_FIELDS },
  archive_traveler: { table: "travelers", mode: "archive" },
  update_itinerary: { table: "itineraries", mode: "update", allowed: ITINERARY_FIELDS },
  archive_itinerary: { table: "itineraries", mode: "archive" },
  update_itinerary_traveler: { table: "itinerary_travelers", mode: "update", allowed: ITINERARY_TRAVELER_FIELDS },
  remove_itinerary_traveler: { table: "itinerary_travelers", mode: "remove" },
  acknowledge_travel_alert: { table: "travel_alerts", mode: "ack" },
};
// Which actions Aegis may PROPOSE (no remove; no scan_history).
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

// Load the target row and assert it is owned by selectedClientId.
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

// Compute before/after for a change (does not write).
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

// Apply the change to the operational record (service-role; ownership re-enforced in WHERE).
async function applyChange(svc: Svc, spec: { table: string; mode: string }, id: string, selectedClientId: string, after: Record<string, unknown>, approverId: string | null):
  Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const t = spec.table;
  if (spec.mode === "remove") {
    const { data } = await svc.from(t).delete().eq("id", id).eq("client_id", selectedClientId).select().maybeSingle();
    return data ? { ok: true } : { ok: false, error: "OWNERSHIP_MISMATCH: 0 rows changed", status: 403 };
  }
  let updateObj: Record<string, unknown>;
  if (spec.mode === "ack") {
    updateObj = { acknowledged: true, is_active: false, acknowledged_at: new Date().toISOString(), acknowledged_by: approverId };
  } else {
    updateObj = after; // update (allow-listed) or archive ({status})
  }
  let q = svc.from(t).update(updateObj).eq("id", id);
  if (t !== "travel_alerts") q = q.eq("client_id", selectedClientId);
  const { data } = await q.select().maybeSingle();
  return data ? { ok: true } : { ok: false, error: "OWNERSHIP_MISMATCH: 0 rows changed", status: 403 };
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

  const MANUAL = new Set(Object.keys(SPECS));
  const PHASE4 = new Set(["propose_edit", "approve_edit", "reject_edit"]);
  if (!MANUAL.has(action) && !PHASE4.has(action)) return errorResponse(`unknown action '${action}'`, 400);
  if (!selectedClientId) return errorResponse("CLIENT_CONTEXT_MISSING: selectedClientId is required", 400);

  // ── Resolve the acting principal + role. Service-role may ONLY propose, and must
  //    name the operator (actor_user_id) on whose behalf it proposes (scope validated). ──
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

  // Operator role required for any travel mutation/proposal.
  if (!isOperator(actor)) return errorResponse("INSUFFICIENT_ROLE: operational travel edits require analyst/admin", 403);

  // Scope: selectedClientId must be accessible to the acting principal (unless super_admin).
  if (!actor.isSuperAdmin) {
    const accessible = await getAccessibleClientIds(svc, actor.userId!);
    if (!accessible.includes(selectedClientId)) return errorResponse("CLIENT_NOT_AUTHORIZED: principal cannot access selectedClientId", 403);
  }

  try {
    // ── Phase 4: approve / reject operate on a proposal_id ──
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

      // approve_edit — re-validate ownership of the live record, conflict-check, commit.
      const targetAction = typeof prop.change_summary === "string" ? "" : ""; // (proposal stores table_name + record_id)
      void targetAction;
      const spec = Object.values(SPECS).find((s) => s.table === prop.table_name && (
        // pick the mode that matches the proposal's after_values shape
        (s.mode === "archive" && (prop.after_values?.status === ARCHIVE_STATUS)) ||
        (s.mode === "ack" && (prop.after_values?.acknowledged === true)) ||
        (s.mode === "update" && !(prop.after_values?.status === ARCHIVE_STATUS) && !(prop.after_values?.acknowledged === true))
      ));
      if (!spec) return errorResponse("proposal shape not recognized", 422);
      const owned = await loadOwned(svc, prop.table_name, prop.record_id, selectedClientId);
      if (!owned.ok) return errorResponse(owned.error, owned.status);
      // CONFLICT: live record's current values must still match the proposal's before_values.
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
      return successResponse({ success: true, action: "approve_edit", proposal_id: proposalId, approval_status: "approved",
        table_name: prop.table_name, record_id: prop.record_id });
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
        target_action: targetAction, table_name: spec.table, record_id: id,
        before: change.before, after: change.after, approval_status: "pending",
        approve: { action: "approve_edit", proposal_id: inserted?.id },
        reject: { action: "reject_edit", proposal_id: inserted?.id } });
    }

    // ── Phase 3: manual immediate commit ──
    const spec = SPECS[action];
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return errorResponse("RECORD_ID_MISSING: id is required", 400);
    const owned = await loadOwned(svc, spec.table, id, selectedClientId);
    if (!owned.ok) return errorResponse(owned.error, owned.status);
    const change = computeChange(spec, owned.row, body.fields);
    if (!change.ok) return errorResponse(change.error, 400);
    const applied = await applyChange(svc, spec, id, selectedClientId, change.after, actor.userId);
    if (!applied.ok) return errorResponse(applied.error, applied.status);
    const { data: auditRow } = await svc.from("travel_record_edits").insert({
      table_name: spec.table, record_id: id, client_id: selectedClientId,
      traveler_id: owned.traveler_id, itinerary_id: owned.itinerary_id,
      actor_user_id: actor.userId, actor_role: actor.actorRole,
      source: "manual", approval_status: "committed",
      before_values: change.before, after_values: change.after,
      change_summary: `${action}: ${Object.keys(change.after).join(", ")}`, request_id: requestId,
    }).select("id").single();
    return successResponse({ success: true, action, table_name: spec.table, record_id: id,
      audit_id: auditRow?.id ?? null, changed_fields: Object.keys(change.after) });
  } catch (err) {
    console.error("[travel-record-mutate] error:", err);
    return errorResponse("internal error processing mutation", 500);
  }
});
