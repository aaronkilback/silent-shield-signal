import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Hash the API key for comparison
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Check for API key in header
    const apiKey = req.headers.get('x-api-key');
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key required. Include x-api-key header.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate API key
    const keyHash = await hashApiKey(apiKey);
    const { data: validKey, error: keyError } = await supabase
      .from('api_keys')
      .select('id, permissions, is_active')
      .eq('key_hash', keyHash)
      .single();

    if (keyError || !validKey || !validKey.is_active) {
      return new Response(
        JSON.stringify({ error: 'Invalid or inactive API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check permission
    const permissions = validKey.permissions as string[];
    if (!permissions.includes('read:agents') && !permissions.includes('read:*')) {
      return new Response(
        JSON.stringify({ error: 'API key lacks read:agents permission' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update last_used_at
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', validKey.id);

    // Parse query params
    const url = new URL(req.url);
    const activeOnly = url.searchParams.get('active') !== 'false';
    const specialty = url.searchParams.get('specialty');

    // Fetch agents
    let query = supabase
      .from('ai_agents')
      .select(`
        id,
        codename,
        call_sign,
        specialty,
        persona,
        mission_scope,
        interaction_style,
        avatar_color,
        avatar_image,
        header_name,
        is_active,
        is_client_facing,
        input_sources,
        output_types,
        created_at,
        updated_at
      `)
      .order('codename');

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    if (specialty) {
      query = query.ilike('specialty', `%${specialty}%`);
    }

    const { data: agents, error } = await query;

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({
        data: agents,
        meta: {
          count: agents.length,
          timestamp: new Date().toISOString(),
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('API agents error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
