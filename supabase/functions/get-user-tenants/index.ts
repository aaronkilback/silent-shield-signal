import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role client to get tenant memberships
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

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
      return new Response(
        JSON.stringify({ error: 'Failed to fetch tenants' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    return new Response(
      JSON.stringify({
        tenants,
        has_tenants: tenants.length > 0
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Get user tenants error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
