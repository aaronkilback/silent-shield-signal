// edit-child-safety-guidance — how counsel / a child-safety professional edits or SIGNS the Section 6
// guidance WITHOUT a code change (operator's core reason for records over static content). super_admin
// only; every write bumps version + stamps last_reviewed_at + reviewed_by (safety content is never edited
// or signed anonymously). Actions: upsert (edit content), review (sign-off, no content change), deactivate.
import {
  createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity,
} from "../_shared/supabase-client.ts";

async function isSuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const caller = await getCallerIdentity(req);
    if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
    const supabase = createServiceClient();
    if (caller.kind === "user" && !(await isSuperAdmin(supabase, caller.userId))) {
      return errorResponse("super_admin required to edit child-safety guidance", 403);
    }
    const body = await req.json().catch(() => null);
    const action = body?.action ?? "upsert";
    const section = body?.section, key = body?.key;
    if (!section || !key) return errorResponse("section + key required", 400);
    const reviewedBy = String(body?.reviewed_by ?? "").trim();
    if (reviewedBy.length < 2) return errorResponse("reviewed_by (name/role of the person reviewing or signing) is required — safety content is never edited anonymously", 400);
    if (/^DRAFT/i.test(reviewedBy)) return errorResponse("reviewed_by cannot start with 'DRAFT' — that marker means unreviewed; sign with a real name/role", 400);

    const { data: existing } = await supabase.from("child_safety_guidance").select("id, version, title, content, display_order, is_emergency, review_interval_months").eq("section", section).eq("key", key).maybeSingle();
    const nowIso = new Date().toISOString();

    if (action === "deactivate") {
      if (!existing) return errorResponse("row not found", 404);
      await supabase.from("child_safety_guidance").update({ is_active: false, reviewed_by: reviewedBy, last_reviewed_at: nowIso, version: existing.version + 1, updated_at: nowIso }).eq("id", existing.id);
      return successResponse({ ok: true, section, key, action, version: existing.version + 1 });
    }

    if (action === "review") {   // sign-off without content change (DRAFT → signed)
      if (!existing) return errorResponse("row not found — nothing to review", 404);
      await supabase.from("child_safety_guidance").update({ reviewed_by: reviewedBy, last_reviewed_at: nowIso, version: existing.version + 1, updated_at: nowIso }).eq("id", existing.id);
      return successResponse({ ok: true, section, key, action: "review", reviewed_by: reviewedBy, version: existing.version + 1 });
    }

    // upsert (edit content). Full row on insert; partial-merge on update (unspecified fields kept).
    const title = body?.title ?? existing?.title;
    const content = body?.content ?? existing?.content;
    if (!title || !content) return errorResponse("title + content required (new row)", 400);
    const row = {
      section, key, title, content,
      display_order: body?.display_order ?? existing?.display_order ?? 100,
      is_emergency: body?.is_emergency ?? existing?.is_emergency ?? false,
      review_interval_months: body?.review_interval_months ?? existing?.review_interval_months ?? (section === "escalation" ? 3 : 6),
      reviewed_by: reviewedBy, last_reviewed_at: nowIso, is_active: true, updated_at: nowIso,
      version: (existing?.version ?? 0) + 1,
    };
    if (existing) await supabase.from("child_safety_guidance").update(row).eq("id", existing.id);
    else await supabase.from("child_safety_guidance").insert(row);
    return successResponse({ ok: true, section, key, action: "upsert", version: row.version, reviewed_by: reviewedBy });
  } catch (e) {
    console.error("[edit-child-safety-guidance] error:", e);
    return errorResponse(e instanceof Error ? e.message : "unknown error", 500);
  }
});
