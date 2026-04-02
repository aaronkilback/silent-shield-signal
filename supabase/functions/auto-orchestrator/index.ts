import { createClient } from "npm:@supabase/supabase-js@2";
import { logError } from "../_shared/error-logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Batch processing configuration
const BATCH_SIZE = 10; // Process 10 items at a time
const MAX_CONCURRENT_OSINT = 3; // Run max 3 OSINT monitors concurrently

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Auto-orchestrator: Starting batch processing cycle...');

    // Start background tasks without blocking response
    const backgroundTasks = [
      processSignalsInBackground(supabase),
      escalateIncidentsInBackground(supabase),
      autoCloseIncidentsInBackground(supabase),
      runOSINTMonitorsInBackground(supabase),
      cleanupQueueInBackground(supabase),
      detectThreatPatternsInBackground(supabase),
    ];

    // Use EdgeRuntime.waitUntil to run tasks without blocking
    // @ts-ignore - EdgeRuntime is available in Deno Deploy
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(Promise.allSettled(backgroundTasks));
    } else {
      // Fallback for local development
      Promise.allSettled(backgroundTasks).catch(console.error);
    }

    // Return immediate response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Background processing initiated',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in auto-orchestrator:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Background task: Process signals from queue in batches
async function processSignalsInBackground(supabase: any) {
  try {
    console.log('Starting signal processing...');
    
    // Get next batch of pending signal processing tasks
    const { data: queueItems, error: queueError } = await supabase
      .from('processing_queue')
      .select('*')
      .eq('task_type', 'signal_processing')
      .eq('status', 'pending')
      .order('priority', { ascending: true })
      .order('scheduled_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (queueError) {
      console.error('Error fetching queue items:', queueError);
      return;
    }

    console.log(`Found ${queueItems?.length || 0} signals in queue to process`);

    let processedSignals = 0;
    let aiProcessed = 0;
    let ruleBasedProcessed = 0;

    for (const queueItem of queueItems || []) {
      try {
        // Mark as processing
        await supabase
          .from('processing_queue')
          .update({ 
            status: 'processing',
            started_at: new Date().toISOString()
          })
          .eq('id', queueItem.id);

        // Process the signal via intelligence-engine domain service
        const response = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/intelligence-engine`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ action: 'decision-engine', signal_id: queueItem.entity_id })
          }
        );

        if (response.ok) {
          processedSignals++;
          const result = await response.json();
          
          if (result.processing_method === 'ai') {
            aiProcessed++;
          } else {
            ruleBasedProcessed++;
          }

          // Mark as completed
          await supabase
            .from('processing_queue')
            .update({ 
              status: 'completed',
              completed_at: new Date().toISOString()
            })
            .eq('id', queueItem.id);

          console.log(`Processed signal ${queueItem.entity_id} via ${result.processing_method}`);
        } else if (response.status === 402) {
          // AI credits exhausted - requeue for later
          await supabase
            .from('processing_queue')
            .update({ 
              status: 'pending',
              retry_count: queueItem.retry_count + 1,
              error_message: 'AI credits exhausted',
              scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // Retry in 1 hour
            })
            .eq('id', queueItem.id);
          
          console.log('AI credits exhausted, requeued signal for later');
          break; // Stop processing batch
        } else {
          throw new Error(`Failed to process signal: ${response.statusText}`);
        }
      } catch (error) {
        console.error(`Error processing queue item ${queueItem.id}:`, error);
        
        // Update queue item with error
        const shouldRetry = queueItem.retry_count < queueItem.max_retries;
        await supabase
          .from('processing_queue')
          .update({ 
            status: shouldRetry ? 'pending' : 'failed',
            retry_count: queueItem.retry_count + 1,
            error_message: error instanceof Error ? error.message : 'Unknown error',
            scheduled_at: shouldRetry 
              ? new Date(Date.now() + 5 * 60 * 1000).toISOString() // Retry in 5 minutes
              : undefined,
            completed_at: shouldRetry ? undefined : new Date().toISOString()
          })
          .eq('id', queueItem.id);
      }
    }

    // Update metrics
    await updateMetrics(supabase, {
      signals_processed: processedSignals
    });

    console.log(`Signal processing complete: ${processedSignals} processed (AI: ${aiProcessed}, Rules: ${ruleBasedProcessed})`);
  } catch (error) {
    console.error('Error in signal processing background task:', error);
  }
}

// Background task: Auto-escalate stale incidents in batches
async function escalateIncidentsInBackground(supabase: any) {
  try {
    console.log('Starting incident escalation...');
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleIncidents, error: staleError } = await supabase
      .from('incidents')
      .select('*')
      .eq('status', 'open')
      .lt('created_at', twentyFourHoursAgo)
      .is('acknowledged_at', null)
      .limit(BATCH_SIZE); // Process in batches

    if (staleError) {
      console.error('Error fetching stale incidents:', staleError);
      return;
    }

    console.log(`Found ${staleIncidents?.length || 0} stale incidents to escalate`);

    for (const incident of staleIncidents || []) {
      try {
        // Auto-escalate priority
        const newPriority = incident.priority === 'p4' ? 'p3' : 
                           incident.priority === 'p3' ? 'p2' : 'p1';

        await supabase
          .from('incidents')
          .update({
            priority: newPriority,
            timeline_json: [
              ...(incident.timeline_json || []),
              {
                timestamp: new Date().toISOString(),
                event: 'Auto-escalated due to no response',
                details: `Priority escalated from ${incident.priority} to ${newPriority}`,
                actor: 'Auto-Orchestrator'
              }
            ]
          })
          .eq('id', incident.id);

        console.log(`Auto-escalated incident ${incident.id} to ${newPriority}`);
      } catch (error) {
        console.error(`Error escalating incident ${incident.id}:`, error);
      }
    }

    // Update metrics
    await updateMetrics(supabase, {
      incidents_auto_escalated: staleIncidents?.length || 0
    });

    console.log(`Incident escalation complete: ${staleIncidents?.length || 0} escalated`);
  } catch (error) {
    console.error('Error in incident escalation background task:', error);
  }
}

// Background task: Auto-close resolved incidents
async function autoCloseIncidentsInBackground(supabase: any) {
  try {
    console.log('Starting auto-close of resolved incidents...');
    
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: resolvedIncidents, error: resolvedError } = await supabase
      .from('incidents')
      .select('*')
      .eq('status', 'resolved')
      .lt('resolved_at', sevenDaysAgo)
      .limit(BATCH_SIZE);

    if (resolvedError) {
      console.error('Error fetching resolved incidents:', resolvedError);
      return;
    }

    console.log(`Found ${resolvedIncidents?.length || 0} resolved incidents to close`);

    for (const incident of resolvedIncidents || []) {
      try {
        await supabase
          .from('incidents')
          .update({
            status: 'closed',
            timeline_json: [
              ...(incident.timeline_json || []),
              {
                timestamp: new Date().toISOString(),
                event: 'Auto-closed',
                details: 'Automatically closed after 7 days of resolution',
                actor: 'Auto-Orchestrator'
              }
            ]
          })
          .eq('id', incident.id);

        console.log(`Auto-closed incident ${incident.id}`);
      } catch (error) {
        console.error(`Error closing incident ${incident.id}:`, error);
      }
    }

    console.log(`Auto-close complete: ${resolvedIncidents?.length || 0} closed`);
  } catch (error) {
    console.error('Error in auto-close background task:', error);
  }
}

// Background task: Run OSINT monitors with concurrency control and circuit breaker
async function runOSINTMonitorsInBackground(supabase: any) {
  try {
    console.log('Starting OSINT monitors...');
    
    // OSINT actions routed through osint-collector domain service
    const monitorActions = [
      'monitor-weather',
      'monitor-wildfires', 
      'monitor-earthquakes',
      'monitor-news',
      'monitor-social',
      'monitor-github',
      // 'monitor-pastebin',   // Disabled: consistently returns 0 results — saves ~2 function invocations/cycle
      'monitor-linkedin',
      // 'monitor-darkweb',    // Disabled: consistently returns 0 results — saves ~2 function invocations/cycle
      'monitor-domains',
      'monitor-social-unified',
      'monitor-community',
    ];

    // ═══ CIRCUIT BREAKER ═══
    // Check recent failures per monitor — skip those with 3+ failures in last 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentErrors } = await supabase
      .from('edge_function_errors')
      .select('error_message')
      .eq('function_name', 'auto-orchestrator')
      .gte('created_at', twoHoursAgo)
      .is('resolved_at', null);

    // Count failures per monitor from error messages
    const failureCounts: Record<string, number> = {};
    for (const err of recentErrors || []) {
      const match = err.error_message?.match(/Monitor ([\w-]+) failed/);
      if (match) {
        failureCounts[match[1]] = (failureCounts[match[1]] || 0) + 1;
      }
    }

    const CIRCUIT_BREAKER_THRESHOLD = 3;
    const activeMonitorActions = monitorActions.filter(m => {
      const failures = failureCounts[m] || 0;
      if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
        console.log(`⚡ Circuit breaker OPEN for ${m} (${failures} recent failures) — skipping`);
        return false;
      }
      return true;
    });

    console.log(`Running ${activeMonitorActions.length}/${monitorActions.length} monitors (${monitorActions.length - activeMonitorActions.length} circuit-broken)`);

    let monitorsRun = 0;

    // Run monitors via osint-collector domain service in batches
    for (let i = 0; i < activeMonitorActions.length; i += MAX_CONCURRENT_OSINT) {
      const batch = activeMonitorActions.slice(i, i + MAX_CONCURRENT_OSINT);
      
      const promises = batch.map(async (monitorAction) => {
        try {
          // 60-second timeout per monitor to prevent gateway timeouts
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000);
          
          const response = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/osint-collector`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({ action: monitorAction }),
              signal: controller.signal
            }
          ).finally(() => clearTimeout(timeout));

          if (response.ok) {
            monitorsRun++;
            console.log(`Executed ${monitorAction} via osint-collector`);
          } else {
            const status = response.status;
            if (status === 429) {
              console.log(`${monitorAction}: rate limited (expected), skipping`);
            } else {
              console.error(`Failed to execute ${monitorAction}: ${response.statusText}`);
              await logError(new Error(`Monitor ${monitorAction} failed: ${response.statusText}`), {
                functionName: 'auto-orchestrator',
                severity: 'warning',
                requestContext: { monitor: monitorAction, status },
              });
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            console.log(`${monitorAction}: timed out after 60s, skipping`);
            await logError(new Error(`Monitor ${monitorAction} failed: Timeout after 60s`), {
              functionName: 'auto-orchestrator',
              severity: 'warning',
              requestContext: { monitor: monitorAction },
            });
          } else {
            console.error(`Error running ${monitorAction}:`, error);
            await logError(error, {
              functionName: 'auto-orchestrator',
              severity: 'error',
              requestContext: { monitor: monitorAction },
            });
          }
        }
      });

      await Promise.allSettled(promises);
      
      if (i + MAX_CONCURRENT_OSINT < activeMonitorActions.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // After all monitors, run signal consolidation via signal-processor domain service
    try {
      const consolidateResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/signal-processor`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({ action: 'consolidate', hours_back: 24 })
        }
      );
      if (consolidateResponse.ok) {
        const result = await consolidateResponse.json();
        console.log(`Signal consolidation: merged ${result.signals_merged || 0} duplicates`);
      }
    } catch (error) {
      console.error('Error running signal consolidation:', error);
    }

    // Update metrics
    await updateMetrics(supabase, {
      osint_scans_completed: monitorsRun
    });

    console.log(`OSINT monitors complete: ${monitorsRun} executed`);
  } catch (error) {
    console.error('Error in OSINT monitors background task:', error);
  }
}

// Background task: Detect threat patterns (entity escalation, geo clusters, frequency spikes, type clusters)
async function detectThreatPatternsInBackground(supabase: any) {
  try {
    console.log('Starting threat pattern detection...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/detect-threat-patterns`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      }
    ).finally(() => clearTimeout(timeout));

    if (response.ok) {
      const result = await response.json();
      console.log(`Threat pattern detection complete: ${result.patterns_detected || 0} patterns detected`);
    } else {
      console.error(`Threat pattern detection failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('Threat pattern detection timed out after 90s');
    } else {
      console.error('Error in threat pattern detection:', error);
    }
  }
}

// Background task: Clean up old queue items
async function cleanupQueueInBackground(supabase: any) {
  try {
    console.log('Starting queue cleanup...');
    
    const result = await supabase.rpc('cleanup_processing_queue');
    
    if (result.error) {
      console.error('Error cleaning up queue:', result.error);
    } else {
      console.log(`Queue cleanup complete: ${result.data || 0} items removed`);
    }
  } catch (error) {
    console.error('Error in queue cleanup background task:', error);
  }
}

// Helper function to update metrics
async function updateMetrics(supabase: any, updates: {
  signals_processed?: number;
  incidents_auto_escalated?: number;
  osint_scans_completed?: number;
}) {
  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`Updating metrics for ${today}:`, updates);
    
    const { data: existingMetrics, error: selectError } = await supabase
      .from('automation_metrics')
      .select('*')
      .eq('metric_date', today)
      .maybeSingle();

    if (selectError) {
      console.error('Error fetching existing metrics:', selectError);
      throw selectError;
    }

    if (existingMetrics) {
      const updateData: any = {};
      if (updates.signals_processed !== undefined) {
        updateData.signals_processed = (existingMetrics.signals_processed || 0) + updates.signals_processed;
      }
      if (updates.incidents_auto_escalated !== undefined) {
        updateData.incidents_auto_escalated = (existingMetrics.incidents_auto_escalated || 0) + updates.incidents_auto_escalated;
      }
      if (updates.osint_scans_completed !== undefined) {
        updateData.osint_scans_completed = (existingMetrics.osint_scans_completed || 0) + updates.osint_scans_completed;
      }

      console.log(`Updating existing metrics with:`, updateData);
      const { error: updateError } = await supabase
        .from('automation_metrics')
        .update(updateData)
        .eq('id', existingMetrics.id);

      if (updateError) {
        console.error('Error updating metrics:', updateError);
        throw updateError;
      }
      console.log('Metrics updated successfully');
    } else {
      const insertData: any = {
        metric_date: today,
        signals_processed: updates.signals_processed || 0,
        incidents_auto_escalated: updates.incidents_auto_escalated || 0,
        osint_scans_completed: updates.osint_scans_completed || 0
      };
      
      console.log(`Inserting new metrics:`, insertData);
      const { error: insertError } = await supabase
        .from('automation_metrics')
        .insert(insertData);

      if (insertError) {
        console.error('Error inserting metrics:', insertError);
        throw insertError;
      }
      console.log('New metrics record created successfully');
    }
  } catch (error) {
    console.error('Error in updateMetrics function:', error);
  }
}

// Handle shutdown gracefully
addEventListener('beforeunload', (ev: any) => {
  console.log('Auto-orchestrator shutting down:', ev.detail?.reason);
});
