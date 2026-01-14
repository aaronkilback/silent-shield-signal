import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface ApiKeyValidation {
  valid: boolean;
  apiKey?: {
    id: string;
    name: string;
    client_id: string | null;
    permissions: string[];
    rate_limit_per_minute: number;
  };
  error?: string;
}

async function validateApiKey(supabase: any, apiKeyHeader: string): Promise<ApiKeyValidation> {
  if (!apiKeyHeader) {
    return { valid: false, error: 'Missing X-API-Key header' };
  }

  // Hash the provided key to compare with stored hash
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
    return { valid: false, error: 'Invalid API key' };
  }

  if (!apiKey.is_active) {
    return { valid: false, error: 'API key is inactive' };
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return { valid: false, error: 'API key has expired' };
  }

  // Update last_used_at
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id);

  return {
    valid: true,
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      client_id: apiKey.client_id,
      permissions: apiKey.permissions,
      rate_limit_per_minute: apiKey.rate_limit_per_minute,
    }
  };
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

serve(async (req) => {
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

  const apiKeyHeader = req.headers.get('x-api-key');
  const authValidation = await validateApiKey(supabase, apiKeyHeader || '');

  if (!authValidation.valid) {
    const responseTime = Date.now() - startTime;
    await logApiUsage(supabase, null, '/api/v1/signals', req.method, 401, responseTime, null, ipAddress, userAgent, authValidation.error || null);
    return new Response(
      JSON.stringify({ error: authValidation.error, code: 'UNAUTHORIZED' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Check permissions
  if (!authValidation.apiKey!.permissions.includes('read:signals')) {
    const responseTime = Date.now() - startTime;
    await logApiUsage(supabase, authValidation.apiKey!.id, '/api/v1/signals', req.method, 403, responseTime, null, ipAddress, userAgent, 'Insufficient permissions');
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions', code: 'FORBIDDEN' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Parse path to check if it's a specific signal request
    const pathMatch = url.pathname.match(/\/api-v1-signals\/?([a-f0-9-]*)?(?:\/matches)?$/i);
    const signalId = pathMatch?.[1];
    const isMatchesEndpoint = url.pathname.endsWith('/matches');

    // Parse query parameters
    const params: Record<string, any> = {};
    const clientId = url.searchParams.get('client_id');
    const sourceId = url.searchParams.get('source_id');
    const severity = url.searchParams.get('severity');
    const category = url.searchParams.get('category');
    const status = url.searchParams.get('status');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');
    const keyword = url.searchParams.get('keyword_search');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    if (clientId) params.client_id = clientId;
    if (sourceId) params.source_id = sourceId;
    if (severity) params.severity = severity;
    if (category) params.category = category;
    if (status) params.status = status;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (keyword) params.keyword_search = keyword;

    // If API key is scoped to a client, enforce it
    const scopedClientId = authValidation.apiKey!.client_id || clientId;

    if (signalId && isMatchesEndpoint) {
      // GET /api/v1/signals/{signal_id}/matches
      const { data: signal, error } = await supabase
        .from('signals')
        .select('id, client_id, match_confidence, match_timestamp')
        .eq('id', signalId)
        .single();

      if (error || !signal) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(supabase, authValidation.apiKey!.id, `/api/v1/signals/${signalId}/matches`, req.method, 404, responseTime, params, ipAddress, userAgent, 'Signal not found');
        return new Response(
          JSON.stringify({ error: 'Signal not found', code: 'NOT_FOUND' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get client name if client_id exists
      let clientName = null;
      if (signal.client_id) {
        const { data: client } = await supabase
          .from('clients')
          .select('name')
          .eq('id', signal.client_id)
          .single();
        clientName = client?.name;
      }

      const responseTime = Date.now() - startTime;
      await logApiUsage(supabase, authValidation.apiKey!.id, `/api/v1/signals/${signalId}/matches`, req.method, 200, responseTime, params, ipAddress, userAgent, null);

      return new Response(
        JSON.stringify({
          signal_id: signal.id,
          client_id: signal.client_id,
          client_name: clientName,
          match_confidence: signal.match_confidence,
          match_timestamp: signal.match_timestamp,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (signalId) {
      // GET /api/v1/signals/{signal_id}
      const { data: signal, error } = await supabase
        .from('signals')
        .select(`
          id, normalized_text, raw_text, source, category, severity, status,
          client_id, match_confidence, match_timestamp, is_false_positive,
          detected_at, created_at, updated_at, metadata
        `)
        .eq('id', signalId)
        .single();

      if (error || !signal) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(supabase, authValidation.apiKey!.id, `/api/v1/signals/${signalId}`, req.method, 404, responseTime, params, ipAddress, userAgent, 'Signal not found');
        return new Response(
          JSON.stringify({ error: 'Signal not found', code: 'NOT_FOUND' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check client scope
      if (scopedClientId && signal.client_id !== scopedClientId) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(supabase, authValidation.apiKey!.id, `/api/v1/signals/${signalId}`, req.method, 403, responseTime, params, ipAddress, userAgent, 'Access denied to this signal');
        return new Response(
          JSON.stringify({ error: 'Access denied', code: 'FORBIDDEN' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const responseTime = Date.now() - startTime;
      await logApiUsage(supabase, authValidation.apiKey!.id, `/api/v1/signals/${signalId}`, req.method, 200, responseTime, params, ipAddress, userAgent, null);

      return new Response(
        JSON.stringify({ data: signal }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      // GET /api/v1/signals - List signals
      let query = supabase
        .from('signals')
        .select(`
          id, normalized_text, source, category, severity, status,
          client_id, match_confidence, detected_at, created_at
        `, { count: 'exact' });

      if (scopedClientId) query = query.eq('client_id', scopedClientId);
      if (sourceId) query = query.eq('source', sourceId);
      if (severity) query = query.eq('severity', severity);
      if (category) query = query.eq('category', category);
      if (status) query = query.eq('status', status);
      if (startDate) query = query.gte('detected_at', startDate);
      if (endDate) query = query.lte('detected_at', endDate);
      if (keyword) query = query.ilike('normalized_text', `%${keyword}%`);

      query = query.order('detected_at', { ascending: false }).range(offset, offset + limit - 1);

      const { data: signals, error, count } = await query;

      if (error) {
        const responseTime = Date.now() - startTime;
        await logApiUsage(supabase, authValidation.apiKey!.id, '/api/v1/signals', req.method, 500, responseTime, params, ipAddress, userAgent, error.message);
        return new Response(
          JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const responseTime = Date.now() - startTime;
      await logApiUsage(supabase, authValidation.apiKey!.id, '/api/v1/signals', req.method, 200, responseTime, params, ipAddress, userAgent, null);

      return new Response(
        JSON.stringify({
          data: signals,
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
    await logApiUsage(supabase, authValidation.apiKey?.id || null, '/api/v1/signals', req.method, 500, responseTime, null, ipAddress, userAgent, error instanceof Error ? error.message : 'Unknown error');
    return new Response(
      JSON.stringify({ error: 'Internal server error', code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
