import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function generateApiKey(): string {
  const prefix = 'fai_';
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return prefix + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const { data: roles } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const isAdmin = roles?.some(r => r.role === 'admin' || r.role === 'super_admin');
  if (!isAdmin) {
    return new Response(
      JSON.stringify({ error: 'Admin access required' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      const { data: apiKeys, error } = await serviceClient
        .from('api_keys')
        .select(`
          id, name, description, key_prefix, client_id, 
          permissions, rate_limit_per_minute, is_active,
          last_used_at, expires_at, created_at,
          clients(name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return new Response(
        JSON.stringify({ data: apiKeys }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const { name, description, client_id, permissions, rate_limit_per_minute, expires_at } = body;

      if (!name) {
        return new Response(
          JSON.stringify({ error: 'Name is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const apiKey = generateApiKey();
      const keyHash = await hashApiKey(apiKey);
      const keyPrefix = apiKey.substring(0, 12) + '...';

      const { data: created, error } = await serviceClient
        .from('api_keys')
        .insert({
          name,
          description,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          client_id: client_id || null,
          created_by: user.id,
          permissions: permissions || ['read:signals', 'read:clients'],
          rate_limit_per_minute: rate_limit_per_minute || 60,
          expires_at: expires_at || null,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ 
          data: { ...created, api_key: apiKey },
          message: 'API key created. Save this key securely.'
        }),
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (req.method === 'DELETE') {
      const pathMatch = url.pathname.match(/\/api-key-management\/([a-f0-9-]+)$/i);
      const keyId = pathMatch?.[1];

      if (!keyId) {
        return new Response(
          JSON.stringify({ error: 'API key ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await serviceClient.from('api_keys').delete().eq('id', keyId);
      if (error) throw error;

      return new Response(
        JSON.stringify({ message: 'API key deleted' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (req.method === 'PATCH') {
      const pathMatch = url.pathname.match(/\/api-key-management\/([a-f0-9-]+)$/i);
      const keyId = pathMatch?.[1];

      if (!keyId) {
        return new Response(
          JSON.stringify({ error: 'API key ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const body = await req.json().catch(() => ({}));
      const updateData: Record<string, any> = {};

      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.is_active !== undefined) updateData.is_active = body.is_active;
      if (body.permissions !== undefined) updateData.permissions = body.permissions;
      if (body.rate_limit_per_minute !== undefined) updateData.rate_limit_per_minute = body.rate_limit_per_minute;

      const { data: updated, error } = await serviceClient
        .from('api_keys')
        .update(updateData)
        .eq('id', keyId)
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ data: updated }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[APIKeyManagement] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
