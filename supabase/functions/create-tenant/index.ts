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

    // If owner_email is provided, find the user and add them as owner
    if (owner_email && typeof owner_email === "string") {
      // Look up user by email in auth.users (using admin client)
      const { data: authUsers, error: authLookupError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (authLookupError) {
        console.error("[create-tenant] Auth lookup error:", authLookupError);
        // Tenant is created, just log the warning
        console.warn("[create-tenant] Could not assign owner, tenant created without owner");
      } else {
        const ownerUser = authUsers.users.find(u => u.email === owner_email.toLowerCase());
        
        if (ownerUser) {
          // Add user as tenant owner
          const { error: memberError } = await supabaseAdmin
            .from("tenant_users")
            .insert({
              tenant_id: tenant.id,
              user_id: ownerUser.id,
              role: "owner"
            });

          if (memberError) {
            console.error("[create-tenant] Failed to add owner:", memberError);
          } else {
            console.log("[create-tenant] Owner assigned:", ownerUser.id);
          }
        } else {
          console.log("[create-tenant] Owner email not found, skipping owner assignment");
        }
      }
    } else {
      // No owner email provided, add the creating super_admin as owner
      const { error: memberError } = await supabaseAdmin
        .from("tenant_users")
        .insert({
          tenant_id: tenant.id,
          user_id: user.id,
          role: "owner"
        });

      if (memberError) {
        console.error("[create-tenant] Failed to add super_admin as owner:", memberError);
      } else {
        console.log("[create-tenant] Super admin added as owner");
      }
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
