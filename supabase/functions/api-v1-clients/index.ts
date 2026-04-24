import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface AuthValidation {
  valid: boolean;
  authType: 'api_key' | 'oauth' | null;
  apiKey?: {
    id: string;
    name: string;
    client_id: string | null;
    permissions: string[];
    rate_limit_per_minute: number;
  };
  oauth?: {
    client_id: string;
    scopes: string[];
    scoped_client_id: string | null;
  };
  error?: string;
}

async function validateApiKey(supabase: any, apiKeyHeader: string): Promise<AuthValidation> {
  if (!apiKeyHeader) {
    return { valid: false, authType: null, error: 'Missing X-API-Key header' };
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(apiKeyHeader);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const { data: apiKey, error } = await supabase
    .from('api_keys')
    .select('id, name, client_id, permissions, rate_limit_per_minute, is_active, expires_at')
    .eq('key_hash', keyHash)
    .single();

  if (error || !apiKey) {
    return { valid: false, authType: null, error: 'Invalid API key' };
  }

  if (!apiKey.is_active) {
    return { valid: false, authType: null, error: 'API key is inactive' };
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return { valid: false, authType: null, error: 'API key has expired' };
  }

  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id);

  return {
    valid: true,
    authType: 'api_key',
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      client_id: apiKey.client_id,
      permissions: apiKey.permissions,
      rate_limit_per_minute: apiKey.rate_limit_per_minute,
    }
  };
}

async function validateOAuthToken(supabase: any, authHeader: string): Promise<AuthValidation> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, authType: null, error: 'Invalid Authorization header' };
  }

  const token = authHeader.substring(7);
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, authType: null, error: 'Invalid token format' };
  }

  try {
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(payloadB64));
    
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, authType: null, error: 'Token has expired' };
    }

    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'default-secret';
    const encoder = new TextEncoder();
    const signatureInput = `${parts[0]}.${parts[1]}`;
    const keyData = encoder.encode(secret);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signatureB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const signatureBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      signatureBytes,
      encoder.encode(signatureInput)
    );

    if (!isValid) {
      return { valid: false, authType: null, error: 'Invalid token signature' };
    }

    const { data: oauthClient, error: clientError } = await supabase
      .from('oauth_clients')
      .select('id, client_id, scoped_client_id, is_active')
      .eq('id', payload.sub)
      .single();

    if (clientError || !oauthClient || !oauthClient.is_active) {
      return { valid: false, authType: null, error: 'OAuth client not found or inactive' };
    }

    return {
      valid: true,
      authType: 'oauth',
      oauth: {
        client_id: oauthClient.client_id,
        scopes: payload.scope ? payload.scope.split(' ') : [],
        scoped_client_id: oauthClient.scoped_client_id,
      }
    };
  } catch (e) {
    console.error('OAuth token validation error:', e);
    return { valid: false, authType: null, error: 'Token validation failed' };
  }
}

async function validateAuth(supabase: any, req: Request): Promise<AuthValidation> {
  const apiKeyHeader = req.headers.get('x-api-key');
  const authHeader = req.headers.get('authorization');

  if (apiKeyHeader) {
    return validateApiKey(supabase, apiKeyHeader);
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return validateOAuthToken(supabase, authHeader);
  }

  return { valid: false, authType: null, error: 'Missing authentication. Provide X-API-Key header or Authorization: Bearer token' };
}

async function logApiUsage(
  supabase: any,
  apiKeyId: string | null,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTimeMs: number,
  requestParams: any,
  ipAddress: string | null,
  userAgent: string | null,
  errorMessage: string | null
) {
  await supabase.from('api_usage_logs').insert({
    api_key_id: apiKeyId,
    endpoint,
    method,
    status_code: statusCode,
    response_time_ms: responseTimeMs,
    request_params: requestParams,
    ip_address: ipAddress,
    user_agent: userAgent,
    error_message: errorMessage,
  });
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const url = new URL(req.url);
  const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip');
  const userAgent = req.headers.get('user-agent');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const authValidation = await validateAuth(supabase, req);

  if (!authValidation.valid) {
    const responseTime = Date.now() - startTime;
    await logApiUsage(supabase, null, '/api/v1/clients', req.method, 401, responseTime, null, ipAddress, userAgent, authValidation.error || null);
    return new Response(
      JSON.stringify({ error: authValidation.error, code: 'UNAUTHORIZED' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const hasPermission = authValidation.authType === 'api_key'
    ? authValidation.apiKey!.permissions.includes('read:clients')
    : authValidation.oauth!.scopes.includes('read:clients');

  if (!hasPermission) {
    const responseTime = Date.now() - startTime;
    const authId = authValidation.authType === 'api_key' ? authValidation.apiKey!.id : null;
    await logApiUsage(supabase, authId, '/api/v1/clients', req.method, 403, responseTime, null, ipAddress, userAgent, 'Insufficient permissions');
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions', code: 'FORBIDDEN' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authId = authValidation.authType === 'api_key' ? authValidation.apiKey!.id : null;

  try {
    const pathMatch = url.pathname.match(/\/api-v1-clients\/?([a-f0-9-]*)?$/i);
    const clientId = pathMatch?.[1];
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const industry = url.searchParams.get('industry');
    const status = url.searchParams.get('status');

    const scopedClientId = authValidation.authType === 'api_key' 
      ? authValidation.apiKey!.client_id
      : authValidation.oauth!.scoped_client_id;

    if (clientId) {
      if (scopedClientId && clientId !== scopedClientId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(supabase, authId, `/api/v1/clients/${clientId}`, req.method, 403, responseTime, null, ipAddress, userAgent, 'Access denied');
        return new Response(
          JSON.stringify({ error: 'Access denied', code: 'FORBIDDEN' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: client, error } = await supabase
        .from('clients')
        .select(`
          id, name, industry, status, organization,
          locations, monitoring_keywords, high_value_assets,
          contact_email, contact_phone, employee_count,
          created_at, updated_at
        `)
        .eq('id', clientId)
        .single();

      if (error || !client) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(supabase, authId, `/api/v1/clients/${clientId}`, req.method, 404, responseTime, null, ipAddress, userAgent, 'Client not found');
        return new Response(
          JSON.stringify({ error: 'Client not found', code: 'NOT_FOUND' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const responseTime = Date.now() - startTime;
      await logApiUsage(supabase, authId, `/api/v1/clients/${clientId}`, req.method, 200, responseTime, null, ipAddress, userAgent, null);

      return new Response(
        JSON.stringify({ data: client }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      let query = supabase
        .from('clients')
        .select(`
          id, name, industry, status, organization,
          locations, contact_email, employee_count,
          created_at, updated_at
        `, { count: 'exact' });

      if (scopedClientId) {
        query = query.eq('id', scopedClientId);
      }
      if (industry) query = query.eq('industry', industry);
      if (status) query = query.eq('status', status);

      query = query.order('name', { ascending: true }).range(offset, offset + limit - 1);

      const { data: clients, error, count } = await query;

      if (error) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(supabase, authId, '/api/v1/clients', req.method, 500, responseTime, { industry, status }, ipAddress, userAgent, error.message);
        return new Response(
          JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const responseTime = Date.now() - startTime;
      await logApiUsage(supabase, authId, '/api/v1/clients', req.method, 200, responseTime, { industry, status, limit, offset }, ipAddress, userAgent, null);

      return new Response(
        JSON.stringify({
          data: clients,
          pagination: {
            total: count,
            limit,
            offset,
            has_more: (offset + limit) < (count || 0),
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('API Error:', error);
    const responseTime = Date.now() - startTime;
    await logApiUsage(supabase, authId, '/api/v1/clients', req.method, 500, responseTime, null, ipAddress, userAgent, error instanceof Error ? error.message : 'Unknown error');
    return new Response(
      JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
