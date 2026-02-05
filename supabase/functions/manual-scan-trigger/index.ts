import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

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
        
        const { data, error } = await supabase.functions.invoke(monitor, {
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

    return successResponse({
      success: true,
      message: `Triggered ${monitors.length} monitors`,
      summary: {
        total: monitors.length,
        successful: successCount,
        failed: errorCount
      },
      results
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in manual-scan-trigger:', error);
    return errorResponse(errorMessage, 500);
  }
});
