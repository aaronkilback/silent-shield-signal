// Admin Voice Tenant Context — server-authorized tenant CANDIDATE resolver.
//
// Authorization is enforced HERE (server), not by any client flag or the Realtime token:
//   - authenticated identity via the caller's app-session JWT (auth.getUser)
//   - global role gate: ONLY user_roles.role IN ('super_admin','admin')
//   - tenant 'owner' alone is NOT sufficient
// Search is limited to the caller's OWN authorized accessible tenants (their tenant_users
// memberships, active) — no cross-tenant discovery. Spoken text is a SEARCH HINT only,
// never scope. Unauthorized callers get NO tenant-name disclosure. Zero/ambiguous fail
// closed. On a single match a short-lived server-held pending candidate is created and only
// its opaque handle + safe display name are returned (no raw tenant id to the model).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PENDING_TTL_SECONDS = 120; // short-lived

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // 1) Authenticated identity (caller's app session — NOT the Realtime token).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ status: "unauthorized" }, 401);

    // Service-role client for deterministic, RLS-independent authorization + lookup.
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // 2) Global-role gate: ONLY super_admin or admin. (owner/analyst/viewer => denied, no names.)
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r) => r.role as string));
    const authorizedRole = roleSet.has("super_admin") ? "super_admin" : roleSet.has("admin") ? "admin" : null;
    if (!authorizedRole) {
      console.warn(`[aegis-tenant-resolve] denied (no super_admin/admin) user=${user.id}`);
      return json({ status: "forbidden" }, 403); // no tenant-name disclosure
    }

    // 3) Parse the search hint (hint only — never scope).
    let nameHint = "";
    try { nameHint = String((await req.json())?.name_hint ?? "").trim(); } catch { /* ignore */ }
    if (!nameHint || nameHint.length < 2) return json({ status: "none" });

    // 4) Caller's OWN authorized, active tenants (membership-scoped; no cross-tenant discovery).
    const { data: memberships } = await svc.from("tenant_users").select("tenant_id").eq("user_id", user.id);
    const tenantIds = [...new Set((memberships ?? []).map((m) => m.tenant_id as string).filter(Boolean))];
    if (tenantIds.length === 0) return json({ status: "none" });

    const { data: tenants } = await svc
      .from("tenants")
      .select("id, name")
      .in("id", tenantIds)
      .eq("status", "active");

    // 5) Name-hint match within that authorized set.
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const h = norm(nameHint);
    const eligible = (tenants ?? []).filter((t) => typeof t.name === "string" && !t.name.startsWith("_"));
    const exact = eligible.filter((t) => norm(t.name) === h);
    const partial = eligible.filter((t) => norm(t.name).includes(h));
    const matches = exact.length ? exact : partial;

    if (matches.length === 0) return json({ status: "none" });
    if (matches.length > 1) {
      // Ambiguous: safe display names only, require a precise choice. No pending, no handle.
      return json({ status: "ambiguous", candidates: matches.map((t) => t.name) });
    }

    // 6) Exactly one → create short-lived server-held pending candidate; return opaque handle + name.
    const only = matches[0];
    const handle = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString();
    const { error: insErr } = await svc.from("aegis_pending_tenant_candidates").insert({
      handle, user_id: user.id, tenant_id: only.id, display_name: only.name,
      authorized_role: authorizedRole, status: "pending", expires_at: expiresAt,
    });
    if (insErr) { console.error("[aegis-tenant-resolve] pending insert failed:", insErr.message); return json({ status: "error" }, 500); }

    console.log(`[aegis-tenant-resolve] one match for user=${user.id} role=${authorizedRole} (name withheld from log)`);
    // handle goes to the BROWSER tool handler (kept frontend-side); display_name may be spoken.
    return json({ status: "one", display_name: only.name, handle, expires_in: PENDING_TTL_SECONDS });
  } catch (e) {
    console.error("[aegis-tenant-resolve] error:", e instanceof Error ? e.message : String(e));
    return json({ status: "error" }, 500);
  }
});
