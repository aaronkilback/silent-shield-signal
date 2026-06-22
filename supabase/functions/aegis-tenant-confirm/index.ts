// Admin Voice Tenant Context — server-authorized CONFIRMATION of a pending tenant candidate.
//
// "Yes" confirms ONLY a previously stored, short-lived, server-held pending candidate by its
// opaque handle — it NEVER re-runs a name search and NEVER trusts raw transcript as an id.
// Re-authorizes server-side (authenticated identity + global super_admin/admin), validates the
// pending candidate belongs to THIS caller and has not expired, marks it confirmed once, and
// returns the canonical tenant id+name to the authenticated browser so it can establish context
// via the existing TenantProvider mechanism (no parallel state). The tenant id is returned only
// AFTER confirmation, to the authenticated caller (their own authorized tenant) — never to the model.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ status: "unauthorized" }, 401);

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // Re-authorize: global super_admin/admin only.
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r) => r.role as string));
    if (!roleSet.has("super_admin") && !roleSet.has("admin")) {
      console.warn(`[aegis-tenant-confirm] denied (no super_admin/admin) user=${user.id}`);
      return json({ status: "forbidden" }, 403);
    }

    let handle = "";
    try { handle = String((await req.json())?.handle ?? "").trim(); } catch { /* ignore */ }
    if (!handle) return json({ status: "invalid" }, 400);

    // Validate the pending candidate: must belong to THIS user, be pending, not expired.
    const { data: pending } = await svc
      .from("aegis_pending_tenant_candidates")
      .select("id, tenant_id, display_name, status, expires_at")
      .eq("handle", handle)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle();

    if (!pending || new Date(pending.expires_at as string).getTime() < Date.now()) {
      if (pending) await svc.from("aegis_pending_tenant_candidates").update({ status: "expired" }).eq("id", pending.id);
      return json({ status: "invalid" }); // expired or not found — fail closed
    }

    // Mark confirmed (once).
    const { error: updErr } = await svc
      .from("aegis_pending_tenant_candidates")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", pending.id).eq("status", "pending");
    if (updErr) { console.error("[aegis-tenant-confirm] confirm update failed:", updErr.message); return json({ status: "error" }, 500); }

    console.log(`[aegis-tenant-confirm] confirmed for user=${user.id} (name withheld from log)`);
    // To the authenticated browser only — establishment happens via existing TenantProvider mechanism.
    return json({ status: "confirmed", tenant_id: pending.tenant_id, display_name: pending.display_name });
  } catch (e) {
    console.error("[aegis-tenant-confirm] error:", e instanceof Error ? e.message : String(e));
    return json({ status: "error" }, 500);
  }
});
