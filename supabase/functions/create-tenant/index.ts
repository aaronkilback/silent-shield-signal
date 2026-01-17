import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Create admin client for privileged operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the user
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("[create-tenant] Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-tenant] User authenticated:", user.id);

    // Check if user is super_admin
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (rolesError) {
      console.error("[create-tenant] Roles query error:", rolesError);
      return new Response(
        JSON.stringify({ error: "Failed to check permissions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isSuperAdmin = roles?.some(r => r.role === "super_admin");
    if (!isSuperAdmin) {
      console.log("[create-tenant] User is not super_admin");
      return new Response(
        JSON.stringify({ error: "Only super admins can create tenants" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = await req.json();
    const { name, owner_email, settings } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Tenant name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-tenant] Creating tenant:", name);

    // Create the tenant
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .insert({
        name: name.trim(),
        status: "active",
        settings: settings || {}
      })
      .select()
      .single();

    if (tenantError) {
      console.error("[create-tenant] Tenant creation error:", tenantError);
      return new Response(
        JSON.stringify({ error: "Failed to create tenant" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-tenant] Tenant created:", tenant.id);

    // Assign an owner membership.
    // IMPORTANT: if an owner email is provided but that user doesn't exist yet,
    // we fall back to making the creating super_admin the owner so the tenant is manageable.
    const normalizedOwnerEmail =
      typeof owner_email === "string" ? owner_email.trim().toLowerCase() : null;

    let ownerUserId: string | null = null;

    if (normalizedOwnerEmail) {
      try {
        const { data: usersPage, error: listUsersError } =
          await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });

        if (listUsersError) {
          console.error("[create-tenant] listUsers error:", listUsersError);
        } else {
          const ownerUser = usersPage.users.find(
            (u) => (u.email ?? "").toLowerCase() === normalizedOwnerEmail
          );
          ownerUserId = ownerUser?.id ?? null;
        }

        if (!ownerUserId) {
          console.warn(
            `[create-tenant] Owner email not found (${normalizedOwnerEmail}); falling back to creator as owner`
          );
        }
      } catch (e) {
        console.error("[create-tenant] Owner lookup unexpected error:", e);
      }
    }

    // Fallback: always ensure the creator has access to manage the tenant
    const effectiveOwnerUserId = ownerUserId ?? user.id;

    const { error: memberError } = await supabaseAdmin
      .from("tenant_users")
      .insert({
        tenant_id: tenant.id,
        user_id: effectiveOwnerUserId,
        role: "owner",
      });

    if (memberError) {
      console.error("[create-tenant] Failed to add owner membership:", memberError);
    } else {
      console.log("[create-tenant] Owner membership created:", effectiveOwnerUserId);
    }

    // Log audit event
    await supabaseAdmin.from("audit_events").insert({
      tenant_id: tenant.id,
      user_id: user.id,
      action: "tenant.created",
      resource: "tenant",
      resource_id: tenant.id,
      metadata: { name: tenant.name }
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[create-tenant] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
