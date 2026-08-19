// subject-exposure — the authorized READER for Module #1 output (subject_exposure_items/_locations).
// Those tables are RLS deny-by-default (PII; the prod anon key ships in the apex bundle), so the frontend
// cannot read them directly. This function reads via service-role WITH an explicit caller-authorization
// check (userCanAccessClient on the entity's owning client) + explicit entity filter — the tenant-isolation
// checklist, not RLS-only. Three actions: read (list items+locations), set_awareness (delivery metric),
// rescan (fire a fresh 7-category deep scan async — the explicit action, never a silent re-scan on view).
import {
  createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity, userCanAccessClient,
} from "../_shared/supabase-client.ts";
import { retrieveSubject, startScanRun } from "../_shared/subject-retrieval.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const ALL7 = ["legal", "financial", "professional", "media", "social", "corporate", "property"];

async function isSuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  return !!data;
}
// service-role callers are trusted internal; a user must be able to access the owning client (or super_admin).
async function authorize(supabase: any, caller: any, clientId: string | null): Promise<boolean> {
  if (caller.kind !== "user") return true;
  if (clientId && await userCanAccessClient(supabase, caller.userId, clientId)) return true;
  return isSuperAdmin(supabase, caller.userId);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const caller = await getCallerIdentity(req);
    if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
    const body = await req.json().catch(() => null);
    const action = body?.action ?? "read";
    const supabase = createServiceClient();

    // ── set_awareness — the delivery metric (known|unknown|disputed) per item ──
    if (action === "set_awareness") {
      const { itemId, awareness } = body ?? {};
      if (!itemId || !["known", "unknown", "disputed"].includes(awareness)) {
        return errorResponse("itemId + awareness (known|unknown|disputed) required", 400);
      }
      const { data: item } = await supabase.from("subject_exposure_items").select("id, client_id").eq("id", itemId).maybeSingle();
      if (!item) return errorResponse("item not found", 404);
      if (!(await authorize(supabase, caller, item.client_id))) return errorResponse("NOT_AUTHORIZED", 403);
      const { error } = await supabase.from("subject_exposure_items").update({ subject_awareness: awareness, updated_at: new Date().toISOString() }).eq("id", itemId);
      if (error) return errorResponse(error.message, 500);
      return successResponse({ ok: true, itemId, awareness });
    }

    const entityId = body?.entityId;
    if (!entityId) return errorResponse("entityId required", 400);
    const { data: entity } = await supabase.from("entities").select("id, name, client_id").eq("id", entityId).maybeSingle();
    if (!entity) return errorResponse("entity not found", 404);
    if (!(await authorize(supabase, caller, entity.client_id))) return errorResponse("NOT_AUTHORIZED", 403);

    // ── rescan — the EXPLICIT fresh-scan action (fire-and-persist; never on view) ──
    if (action === "rescan") {
      const scanId = crypto.randomUUID();
      const owner = { clientId: entity.client_id ?? undefined, entityId };
      const createdBy = caller.kind === "user" ? caller.userId : undefined;
      const subject = { name: entity.name, entityId };
      const scope = { categories: ALL7, depth: "deep" as const, phase2: true };
      await startScanRun(supabase, scanId, subject, scope, { persist: true, owner, createdBy });
      const run = retrieveSubject(supabase, subject, scope, { persist: true, owner, createdBy, scanId })
        .catch((e) => console.error(`[subject-exposure rescan ${scanId}] failed:`, e));
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(run);
      return successResponse({ scanId, status: "started", message: `Fresh 7-category deep scan ${scanId} started for "${entity.name}". Results will refresh here when it completes (~1 min); status tracked in subject_scan_runs.` });
    }

    // ── read — list existing items + their N locations (NO scan) ──
    const { data: items } = await supabase.from("subject_exposure_items")
      .select("id, category, title, summary, severity, source_class, fingerprint, subject_awareness, scan_id, updated_at")
      .eq("subject_entity_id", entityId);
    const ids = (items ?? []).map((i: any) => i.id);
    let locs: any[] = [];
    if (ids.length) {
      const { data } = await supabase.from("subject_exposure_locations")
        .select("exposure_item_id, url, domain, platform, title, found_by_query, found_at_rank, date_captured, phase")
        .in("exposure_item_id", ids);
      locs = data ?? [];
    }
    const byItem = new Map<string, any[]>();
    for (const l of locs) { if (!byItem.has(l.exposure_item_id)) byItem.set(l.exposure_item_id, []); byItem.get(l.exposure_item_id)!.push(l); }
    // obscurity_rank = shallowest rank the item appears at anywhere; MORE buried (higher) = higher value.
    const enriched = (items ?? []).map((i: any) => {
      const ls = (byItem.get(i.id) ?? []).sort((a, b) => (a.found_at_rank ?? 999) - (b.found_at_rank ?? 999));
      return { ...i, locations: ls, location_count: ls.length, obscurity_rank: ls.length ? Math.min(...ls.map((l) => l.found_at_rank ?? 999)) : 999 };
    });
    const byObscurity = (a: any, b: any) => b.obscurity_rank - a.obscurity_rank;   // buried-first
    const thirdParty = enriched.filter((i: any) => i.source_class !== "self_published").sort(byObscurity);
    const selfPublished = enriched.filter((i: any) => i.source_class === "self_published").sort(byObscurity);
    const { data: lastScan } = await supabase.from("subject_scan_runs")
      .select("id, status, started_at, finished_at, counts").eq("subject_entity_id", entityId)
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    return successResponse({
      thirdParty, selfPublished, lastScan,
      counts: { third_party_items: thirdParty.length, self_published_items: selfPublished.length },
    });
  } catch (e) {
    console.error("[subject-exposure] error:", e);
    return errorResponse(e instanceof Error ? e.message : "unknown error", 500);
  }
});
