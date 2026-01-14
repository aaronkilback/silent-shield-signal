import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  auth_type: string;
  auth_credentials: any;
  trigger_events: string[];
  filter_conditions: any;
  output_format: string;
  is_active: boolean;
}

interface SignalPayload {
  id: string;
  normalized_text: string;
  source: string;
  category: string;
  severity: string;
  status: string;
  client_id: string | null;
  client_name?: string;
  match_confidence: number | null;
  detected_at: string;
}

// Format payload as CEF (Common Event Format)
function formatAsCEF(signal: SignalPayload, eventType: string): string {
  const severity = signal.severity === 'critical' ? 10 : 
                   signal.severity === 'high' ? 7 : 
                   signal.severity === 'medium' ? 5 : 3;
  
  const cefHeader = `CEF:0|Fortress|FortressAI|1.0|${eventType}|${signal.category || 'Signal'}|${severity}|`;
  const extensions = [
    `externalId=${signal.id}`,
    `msg=${encodeURIComponent(signal.normalized_text?.substring(0, 500) || '')}`,
    `src=${signal.source || 'unknown'}`,
    `cat=${signal.category || 'uncategorized'}`,
    `cs1=${signal.client_id || ''}`,
    `cs1Label=ClientID`,
    `cs2=${signal.client_name || ''}`,
    `cs2Label=ClientName`,
    `cfp1=${signal.match_confidence || 0}`,
    `cfp1Label=MatchConfidence`,
    `rt=${new Date(signal.detected_at).getTime()}`,
  ].join(' ');

  return cefHeader + extensions;
}

// Generate HMAC signature for webhook payload
async function generateSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return 'sha256=' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Calculate exponential backoff delay
function getBackoffDelay(attemptCount: number): number {
  const baseDelay = 60000; // 1 minute
  const maxDelay = 3600000; // 1 hour
  const delay = Math.min(baseDelay * Math.pow(2, attemptCount), maxDelay);
  return delay;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { event_type, signal } = await req.json();

    if (!event_type || !signal) {
      return new Response(
        JSON.stringify({ error: 'Missing event_type or signal' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    const signalPayload: SignalPayload = {
      ...signal,
      client_name: clientName,
    };

    // Find matching webhooks
    const { data: webhooks, error: webhooksError } = await supabase
      .from('webhooks')
      .select('*')
      .eq('is_active', true)
      .contains('trigger_events', [event_type]);

    if (webhooksError) {
      console.error('Error fetching webhooks:', webhooksError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch webhooks' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!webhooks || webhooks.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No matching webhooks found', dispatched: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const deliveryResults = [];

    for (const webhook of webhooks as WebhookConfig[]) {
      // Check filter conditions
      if (webhook.filter_conditions) {
        const filters = webhook.filter_conditions;
        
        if (filters.client_ids && !filters.client_ids.includes(signal.client_id)) {
          continue;
        }
        if (filters.severities && !filters.severities.includes(signal.severity)) {
          continue;
        }
        if (filters.categories && !filters.categories.includes(signal.category)) {
          continue;
        }
      }

      // Format payload based on output format
      let payloadBody: string;
      let contentType: string;

      if (webhook.output_format === 'cef') {
        payloadBody = formatAsCEF(signalPayload, event_type);
        contentType = 'text/plain';
      } else {
        payloadBody = JSON.stringify({
          event_type,
          timestamp: new Date().toISOString(),
          signal: signalPayload,
        });
        contentType = 'application/json';
      }

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'User-Agent': 'FortressAI-Webhook/1.0',
        'X-Fortress-Event': event_type,
        'X-Fortress-Delivery-ID': crypto.randomUUID(),
      };

      // Add signature if secret is configured
      if (webhook.secret) {
        headers['X-Fortress-Signature'] = await generateSignature(payloadBody, webhook.secret);
      }

      // Add authentication headers
      if (webhook.auth_type === 'bearer' && webhook.auth_credentials?.token) {
        headers['Authorization'] = `Bearer ${webhook.auth_credentials.token}`;
      } else if (webhook.auth_type === 'api_key' && webhook.auth_credentials) {
        const headerName = webhook.auth_credentials.header_name || 'X-API-Key';
        headers[headerName] = webhook.auth_credentials.api_key;
      } else if (webhook.auth_type === 'basic' && webhook.auth_credentials) {
        const credentials = btoa(`${webhook.auth_credentials.username}:${webhook.auth_credentials.password}`);
        headers['Authorization'] = `Basic ${credentials}`;
      }

      // Create delivery record
      const { data: delivery, error: deliveryError } = await supabase
        .from('webhook_deliveries')
        .insert({
          webhook_id: webhook.id,
          trigger_event: event_type,
          payload: { signal: signalPayload },
          status: 'pending',
        })
        .select()
        .single();

      if (deliveryError) {
        console.error('Error creating delivery record:', deliveryError);
        continue;
      }

      // Attempt delivery
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: payloadBody,
        });

        const responseBody = await response.text();

        if (response.ok) {
          // Success
          await supabase
            .from('webhook_deliveries')
            .update({
              status: 'delivered',
              attempt_count: 1,
              response_status_code: response.status,
              response_body: responseBody.substring(0, 1000),
              delivered_at: new Date().toISOString(),
            })
            .eq('id', delivery.id);

          await supabase
            .from('webhooks')
            .update({ last_triggered_at: new Date().toISOString() })
            .eq('id', webhook.id);

          deliveryResults.push({ webhook_id: webhook.id, status: 'delivered' });
        } else {
          // Failed - schedule retry
          const nextRetry = new Date(Date.now() + getBackoffDelay(0));
          
          await supabase
            .from('webhook_deliveries')
            .update({
              status: 'retrying',
              attempt_count: 1,
              next_retry_at: nextRetry.toISOString(),
              response_status_code: response.status,
              response_body: responseBody.substring(0, 1000),
              error_message: `HTTP ${response.status}: ${response.statusText}`,
            })
            .eq('id', delivery.id);

          deliveryResults.push({ webhook_id: webhook.id, status: 'retrying', next_retry: nextRetry });
        }
      } catch (fetchError) {
        // Network error - schedule retry
        const nextRetry = new Date(Date.now() + getBackoffDelay(0));
        const errorMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        
        await supabase
          .from('webhook_deliveries')
          .update({
            status: 'retrying',
            attempt_count: 1,
            next_retry_at: nextRetry.toISOString(),
            error_message: errorMsg,
          })
          .eq('id', delivery.id);

        deliveryResults.push({ webhook_id: webhook.id, status: 'retrying', error: errorMsg });
      }
    }

    return new Response(
      JSON.stringify({ 
        message: 'Webhook dispatch completed',
        dispatched: deliveryResults.length,
        results: deliveryResults,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Webhook dispatcher error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
