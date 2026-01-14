import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Generate a random string for tokens
function generateToken(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Create JWT-like access token
async function createAccessToken(
  clientId: string,
  scopes: string[],
  expiresInSeconds: number
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: 'fortress-ai',
    sub: clientId,
    aud: 'fortress-api',
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    iat: Math.floor(Date.now() / 1000),
    scope: scopes.join(' '),
    jti: crypto.randomUUID(),
  };

  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'default-secret';
  const encoder = new TextEncoder();
  
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const signatureInput = `${headerB64}.${payloadB64}`;
  const keyData = encoder.encode(secret);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signatureInput));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed', error_description: 'Only POST is allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse request body (support both JSON and form-urlencoded)
    const contentType = req.headers.get('content-type') || '';
    let body: Record<string, string> = {};

    if (contentType.includes('application/json')) {
      body = await req.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.text();
      const params = new URLSearchParams(formData);
      for (const [key, value] of params.entries()) {
        body[key] = value;
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Unsupported content type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { grant_type, client_id, client_secret, scope } = body;

    // Validate grant type
    if (grant_type !== 'client_credentials') {
      return new Response(
        JSON.stringify({ error: 'unsupported_grant_type', error_description: 'Only client_credentials grant is supported' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields
    if (!client_id || !client_secret) {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'client_id and client_secret are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Hash the client secret to compare
    const encoder = new TextEncoder();
    const secretData = encoder.encode(client_secret);
    const hashBuffer = await crypto.subtle.digest('SHA-256', secretData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const secretHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Find and validate OAuth client
    const { data: oauthClient, error: clientError } = await supabase
      .from('oauth_clients')
      .select('*')
      .eq('client_id', client_id)
      .eq('client_secret_hash', secretHash)
      .single();

    if (clientError || !oauthClient) {
      return new Response(
        JSON.stringify({ error: 'invalid_client', error_description: 'Invalid client credentials' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!oauthClient.is_active) {
      return new Response(
        JSON.stringify({ error: 'invalid_client', error_description: 'Client is inactive' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate requested scopes against allowed scopes
    const requestedScopes = scope ? scope.split(' ') : oauthClient.allowed_scopes || [];
    const allowedScopes = oauthClient.allowed_scopes || [];
    const grantedScopes = requestedScopes.filter((s: string) => allowedScopes.includes(s));

    if (requestedScopes.length > 0 && grantedScopes.length === 0) {
      return new Response(
        JSON.stringify({ error: 'invalid_scope', error_description: 'Requested scopes are not allowed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate access token
    const expiresIn = 3600; // 1 hour
    const accessToken = await createAccessToken(oauthClient.id, grantedScopes, expiresIn);
    const tokenId = crypto.randomUUID();

    // Store the access token
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    
    const { error: tokenError } = await supabase
      .from('oauth_access_tokens')
      .insert({
        id: tokenId,
        oauth_client_id: oauthClient.id,
        token_hash: await hashToken(accessToken),
        scopes: grantedScopes,
        expires_at: expiresAt.toISOString(),
      });

    if (tokenError) {
      console.error('Error storing token:', tokenError);
      return new Response(
        JSON.stringify({ error: 'server_error', error_description: 'Failed to issue token' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update last_used_at on the OAuth client
    await supabase
      .from('oauth_clients')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', oauthClient.id);

    // Return OAuth 2.0 compliant response
    return new Response(
      JSON.stringify({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope: grantedScopes.join(' '),
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Pragma': 'no-cache',
        } 
      }
    );

  } catch (error) {
    console.error('OAuth token error:', error);
    return new Response(
      JSON.stringify({ error: 'server_error', error_description: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
