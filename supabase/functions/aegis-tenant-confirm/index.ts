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

    // Caller's app session — used both to validate identity AND to run the atomic RPC under
    // auth.uid() (so the consume re-validates the caller server-side, not a passed id).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ status: "unauthorized" }, 401);

    // Reauthorize at confirmation time (defense-in-depth; the RPC re-checks role too).
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r) => r.role as string));
    if (!roleSet.has("super_admin") && !roleSet.has("admin")) {
      console.warn(`[aegis-tenant-confirm] denied (no super_admin/admin) user=${user.id}`);
      return json({ status: "forbidden" }, 403);
    }

    let handle = "", nonce = "";
    try { const b = await req.json(); handle = String(b?.handle ?? "").trim(); nonce = String(b?.nonce ?? "").trim(); } catch { /* ignore */ }
    if (!handle || !nonce) return json({ status: "invalid" }, 400);

    // ATOMIC consume + full re-validation (role, membership, active tenant, expiry, nonce,
    // used_at IS NULL) in ONE UPDATE...RETURNING inside the SECURITY DEFINER RPC, run under
    // the caller's auth.uid(). Zero rows => invalid (concurrent loser / replay / expired /
    // superseded / role-or-membership revoked since resolve). Audited inside the RPC.
    const { data: confirmed, error: rpcErr } = await userClient
      .rpc("aegis_confirm_tenant_candidate", { p_handle: handle, p_nonce: nonce });
    if (rpcErr) { console.error("[aegis-tenant-confirm] rpc error:", rpcErr.message); return json({ status: "error" }, 500); }

    const row = Array.isArray(confirmed) ? confirmed[0] : confirmed;
    if (!row?.tenant_id) {
      console.log(`[aegis-tenant-confirm] not consumed (invalid/expired/revoked) user=${user.id}`);
      return json({ status: "invalid" });
    }

    console.log(`[aegis-tenant-confirm] confirmed for user=${user.id} (name/handle withheld from log)`);
    // tenant_id to the authenticated browser only — establishment via existing TenantProvider mechanism.
    return json({ status: "confirmed", tenant_id: row.tenant_id, display_name: row.display_name });
  } catch (e) {
    console.error("[aegis-tenant-confirm] error:", e instanceof Error ? e.message : String(e));
    return json({ status: "error" }, 500);
  }
});
