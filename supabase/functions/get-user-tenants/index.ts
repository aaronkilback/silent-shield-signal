import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Returns the tenants a caller may select in the UI. Separates tenant membership
// authority (tenant_role) from platform-admin authority (platform_access) so the
// UI can gate tenant-action buttons strictly on membership while still letting a
// super_admin observe / impersonate every active tenant.
//
// Per-tenant shape:
//   tenant_role:      'owner' | 'admin' | 'analyst' | 'viewer' | null
//   role:             back-compat alias of tenant_role (deprecated, still emitted)
//   platform_access:  true iff caller has user_roles.role='super_admin'
//   access_mode:      'tenant_member' | 'platform_admin' | 'tenant_member_plus_platform_admin'
//   can_impersonate:  true iff platform_access (split field reserved for future RBAC)
//
// Non-super_admin callers only see tenants they have a tenant_users row for.
// Super_admin callers see every active tenant; access_mode reflects whether they
// also hold an explicit tenant_users row.

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Authorization required', 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return errorResponse('Invalid authentication', 401);
    }

    const adminClient = createServiceClient();

    // Platform-level super_admin check (user_roles table, NOT tenant_users)
    const { data: superAdminRow } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .maybeSingle();
    const isSuperAdmin = !!superAdminRow;

    // Always load explicit memberships — they drive tenant_role + joined_at
    const { data: memberships, error: membershipsError } = await adminClient
      .from('tenant_users')
      .select('tenant_id, role, created_at')
      .eq('user_id', user.id);

    if (membershipsError) {
      console.error('Memberships fetch error:', membershipsError);
      return errorResponse('Failed to fetch tenants', 500);
    }

    const explicit = new Map<string, { role: string; created_at: string }>();
    for (const m of memberships ?? []) {
      if (m.tenant_id) explicit.set(m.tenant_id, { role: m.role, created_at: m.created_at });
    }

    // Candidate tenants: all active when super_admin, otherwise only the user's memberships
    type TenantRow = { id: string; name: string; status: string; settings: unknown; created_at: string };
    let candidates: TenantRow[] = [];

    if (isSuperAdmin) {
      const { data, error } = await adminClient
        .from('tenants')
        .select('id, name, status, settings, created_at')
        .eq('status', 'active');
      if (error) {
        console.error('Tenants fetch error (super_admin path):', error);
        return errorResponse('Failed to fetch tenants', 500);
      }
      candidates = (data ?? []) as TenantRow[];
    } else if (explicit.size > 0) {
      const { data, error } = await adminClient
        .from('tenants')
        .select('id, name, status, settings, created_at')
        .in('id', [...explicit.keys()])
        .eq('status', 'active');
      if (error) {
        console.error('Tenants fetch error (membership path):', error);
        return errorResponse('Failed to fetch tenants', 500);
      }
      candidates = (data ?? []) as TenantRow[];
    }

    const tenants = candidates.map((t) => {
      const m = explicit.get(t.id);
      const tenant_role = (m?.role ?? null) as 'owner' | 'admin' | 'analyst' | 'viewer' | null;
      const platform_access = isSuperAdmin;
      const access_mode =
        m && platform_access ? 'tenant_member_plus_platform_admin' :
        m                    ? 'tenant_member' :
                                'platform_admin';
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        settings: t.settings,
        tenant_role,
        role: tenant_role, // @deprecated back-compat alias of tenant_role
        platform_access,
        access_mode,
        can_impersonate: platform_access,
        joined_at: m?.created_at ?? t.created_at,
      };
    });

    return successResponse({
      tenants,
      has_tenants: tenants.length > 0
    });

  } catch (error) {
    console.error('Get user tenants error:', error);
    return errorResponse('Internal server error', 500);
  }
});
