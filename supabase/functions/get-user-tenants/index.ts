import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Authorization required', 401);
    }

    // Extract token and create client
    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // CRITICAL: Must pass token explicitly when verify_jwt=false
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return errorResponse('Invalid authentication', 401);
    }

    // Use service role client to get tenant memberships
    const adminClient = createServiceClient();

    const { data: memberships, error: membershipsError } = await adminClient
      .from('tenant_users')
      .select(`
        id,
        role,
        created_at,
        tenants (
          id,
          name,
          status,
          settings
        )
      `)
      .eq('user_id', user.id);

    if (membershipsError) {
      console.error('Memberships fetch error:', membershipsError);
      return errorResponse('Failed to fetch tenants', 500);
    }

    // Transform the data - tenants is an object (single record from join), cast through unknown
    const tenants = memberships?.map(m => {
      // deno-lint-ignore no-explicit-any
      const tenant = m.tenants as any;
      return {
        id: tenant?.id as string | undefined,
        name: tenant?.name as string | undefined,
        status: tenant?.status as string | undefined,
        settings: tenant?.settings,
        role: m.role,
        joined_at: m.created_at
      };
    }).filter(t => t.id && t.status === 'active') || [];

    return successResponse({
      tenants,
      has_tenants: tenants.length > 0
    });

  } catch (error) {
    console.error('Get user tenants error:', error);
    return errorResponse('Internal server error', 500);
  }
});
