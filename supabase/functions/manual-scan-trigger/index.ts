import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('[ManualScan] Initiating manual scan trigger');

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
      'monitor-social-unified',
      'monitor-entity-proximity',
      'monitor-naad-alerts',
      'monitor-emergency-google',
    ];

    const results = [];

    // Trigger each monitor
    for (const monitor of monitors) {
      try {
        console.log(`[ManualScan] Triggering ${monitor}...`);
        
        const { data, error } = await supabase.functions.invoke(monitor, {
          body: { 
            manual_trigger: true,
            triggered_at: new Date().toISOString()
          }
        });

        results.push({
          monitor,
          status: error ? 'error' : 'success',
          error: error?.message,
          data: data ? { message: data.message || 'Completed' } : null
        });

        console.log(`[ManualScan] ${monitor}: ${error ? 'failed' : 'completed'}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[ManualScan] Error invoking ${monitor}:`, err);
        results.push({
          monitor,
          status: 'error',
          error: errorMessage
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    // Log to audit
    try {
      await supabase.from('audit_events').insert({
        action: 'manual_scan_triggered',
        resource: 'monitors',
        metadata: {
          monitors_count: monitors.length,
          success_count: successCount,
          error_count: errorCount,
          triggered_at: new Date().toISOString()
        }
      });
    } catch (logError) {
      console.error('[ManualScan] Failed to log audit event:', logError);
    }

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
    console.error('[ManualScan] Error:', error);
    return errorResponse(errorMessage, 500);
  }
});
