import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Manual scan trigger initiated');

    // List of available monitors
    const monitors = [
      'monitor-canadian-sources',
      'monitor-rss-sources',
      'monitor-news',
      'monitor-social',
      'monitor-threat-intel',
      'monitor-darkweb',
      'monitor-domains',
      'monitor-weather',
      'monitor-wildfires',
      'monitor-earthquakes',
      'monitor-github',
      'monitor-linkedin',
      'monitor-facebook',
      'monitor-instagram',
      'monitor-entity-proximity',
    ];

    const results = [];

    // Trigger each monitor
    for (const monitor of monitors) {
      try {
        console.log(`Triggering ${monitor}...`);
        
        const { data, error } = await supabaseClient.functions.invoke(monitor, {
          body: { 
            manual_trigger: true
          }
        });

        results.push({
          monitor,
          status: error ? 'error' : 'success',
          error: error?.message,
          data
        });

        console.log(`${monitor}: ${error ? 'failed' : 'completed'}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Error invoking ${monitor}:`, err);
        results.push({
          monitor,
          status: 'error',
          error: errorMessage
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Triggered ${monitors.length} monitors`,
        summary: {
          total: monitors.length,
          successful: successCount,
          failed: errorCount
        },
        results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in manual-scan-trigger:', error);
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        success: false
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
