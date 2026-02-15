import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

function generateSecret(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return 'whsec_' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return 'sha256=' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Validate user authentication
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

  // Check if user is admin
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
      // Check if requesting deliveries for a specific webhook
      const webhookIdMatch = url.pathname.match(/\/webhook-management\/([a-f0-9-]+)\/deliveries$/i);
      
      if (webhookIdMatch) {
        const webhookId = webhookIdMatch[1];
        const { data: deliveries, error } = await serviceClient
          .from('webhook_deliveries')
          .select('*')
          .eq('webhook_id', webhookId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;

        return new Response(
          JSON.stringify({ data: deliveries }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // List all webhooks
      const { data: webhooks, error } = await serviceClient
        .from('webhooks')
        .select(`
          id, name, description, url, auth_type,
          trigger_events, filter_conditions, output_format,
          is_active, last_triggered_at, created_at, updated_at
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return new Response(
        JSON.stringify({ data: webhooks }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (req.method === 'POST') {
      // Check if this is a test request
      const testMatch = url.pathname.match(/\/webhook-management\/([a-f0-9-]+)\/test$/i);
      
      if (testMatch) {
        const webhookId = testMatch[1];
        
        const { data: webhook, error: webhookError } = await serviceClient
          .from('webhooks')
          .select('*')
          .eq('id', webhookId)
          .single();

        if (webhookError || !webhook) {
          return new Response(
            JSON.stringify({ error: 'Webhook not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const testPayload = {
          event_type: 'test.ping',
          timestamp: new Date().toISOString(),
          signal: {
            id: 'test-signal-id',
            normalized_text: 'This is a test signal from Fortress AI',
            source: 'test',
            category: 'test',
            severity: 'low',
            status: 'open',
            client_id: null,
            client_name: 'Test Client',
            match_confidence: 1.0,
            detected_at: new Date().toISOString(),
          }
        };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'FortressAI-Webhook/1.0',
          'X-Fortress-Event': 'test.ping',
        };

        if (webhook.secret) {
          headers['X-Fortress-Signature'] = await generateSignature(JSON.stringify(testPayload), webhook.secret);
        }

        if (webhook.auth_type === 'bearer' && webhook.auth_credentials?.token) {
          headers['Authorization'] = `Bearer ${webhook.auth_credentials.token}`;
        }

        try {
          const response = await fetch(webhook.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(testPayload),
          });

          const responseBody = await response.text();

          return new Response(
            JSON.stringify({
              success: response.ok,
              status_code: response.status,
              response_body: responseBody.substring(0, 500),
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (fetchError) {
          return new Response(
            JSON.stringify({
              success: false,
              error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Create new webhook
      const body = await req.json();
      const { name, description, url: webhookUrl, auth_type, auth_credentials, trigger_events, filter_conditions, output_format } = body;

      if (!name || !webhookUrl || !trigger_events?.length) {
        return new Response(
          JSON.stringify({ error: 'Name, URL, and at least one trigger event are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const secret = generateSecret();

      const { data: created, error } = await serviceClient
        .from('webhooks')
        .insert({
          name,
          description,
          url: webhookUrl,
          secret,
          auth_type: auth_type || 'none',
          auth_credentials: auth_credentials || null,
          trigger_events,
          filter_conditions: filter_conditions || null,
          output_format: output_format || 'json',
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Strip sensitive fields from response
      const { secret: _s, auth_credentials: _ac, ...safeCreated } = created;
      return new Response(
        JSON.stringify({ 
          data: { ...safeCreated, secret_preview: created.secret ? created.secret.substring(0, 10) + '...' : null },
          message: 'Webhook created. The signing secret is stored securely and used for payload verification.'
        }),
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (req.method === 'PATCH') {
      const pathMatch = url.pathname.match(/\/webhook-management\/([a-f0-9-]+)$/i);
      const webhookId = pathMatch?.[1];

      if (!webhookId) {
        return new Response(
          JSON.stringify({ error: 'Webhook ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const body = await req.json();
      const updateData: Record<string, any> = {};

      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.url !== undefined) updateData.url = body.url;
      if (body.is_active !== undefined) updateData.is_active = body.is_active;
      if (body.auth_type !== undefined) updateData.auth_type = body.auth_type;
      if (body.auth_credentials !== undefined) updateData.auth_credentials = body.auth_credentials;
      if (body.trigger_events !== undefined) updateData.trigger_events = body.trigger_events;
      if (body.filter_conditions !== undefined) updateData.filter_conditions = body.filter_conditions;
      if (body.output_format !== undefined) updateData.output_format = body.output_format;

      if (body.regenerate_secret) {
        updateData.secret = generateSecret();
      }

      const { data: updated, error } = await serviceClient
        .from('webhooks')
        .update(updateData)
        .eq('id', webhookId)
        .select()
        .single();

      if (error) throw error;

      // Strip sensitive fields from response
      const { secret: _sec, auth_credentials: _creds, ...safeUpdated } = updated;
      return new Response(
        JSON.stringify({ data: safeUpdated }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (req.method === 'DELETE') {
      const pathMatch = url.pathname.match(/\/webhook-management\/([a-f0-9-]+)$/i);
      const webhookId = pathMatch?.[1];

      if (!webhookId) {
        return new Response(
          JSON.stringify({ error: 'Webhook ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await serviceClient
        .from('webhooks')
        .delete()
        .eq('id', webhookId);

      if (error) throw error;

      return new Response(
        JSON.stringify({ message: 'Webhook deleted' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Webhook management error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
