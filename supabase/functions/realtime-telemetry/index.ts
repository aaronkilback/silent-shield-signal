const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const ua = req.headers.get('user-agent') || '';
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // ignore
    }

    // Keep logs compact and safe
    const eventType = body?.eventType || body?.type || 'unknown';
    const status = body?.status;
    const phase = body?.phase;
    const details = body?.details;

    console.log('[realtime-telemetry]', {
      ts: body?.ts || new Date().toISOString(),
      phase,
      eventType,
      status,
      details,
      ua: ua.slice(0, 120),
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[realtime-telemetry] error', error);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
