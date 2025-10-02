import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Auto-orchestrator: Starting automated processing cycle...');

    // 1. Process new signals through AI decision engine
    const { data: newSignals, error: signalsError } = await supabase
      .from('signals')
      .select('id')
      .eq('status', 'new')
      .limit(10);

    if (signalsError) throw signalsError;

    console.log(`Found ${newSignals?.length || 0} new signals to process`);

    let processedSignals = 0;
    for (const signal of newSignals || []) {
      try {
        const response = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-decision-engine`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ signal_id: signal.id })
          }
        );

        if (response.ok) {
          processedSignals++;
          console.log(`Processed signal ${signal.id}`);
        }
      } catch (error) {
        console.error(`Error processing signal ${signal.id}:`, error);
      }
    }

    // 2. Auto-escalate stale incidents
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleIncidents, error: staleError } = await supabase
      .from('incidents')
      .select('*')
      .eq('status', 'open')
      .lt('created_at', twentyFourHoursAgo)
      .is('acknowledged_at', null);

    if (!staleError && staleIncidents) {
      for (const incident of staleIncidents) {
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
      }
    }

    // 3. Run OSINT monitors
    const monitors = [
      'monitor-weather',
      'monitor-wildfires', 
      'monitor-earthquakes',
      'monitor-news',
      'monitor-social',
      'monitor-threat-intel'
    ];

    let monitorsRun = 0;
    for (const monitor of monitors) {
      try {
        const response = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/${monitor}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({})
          }
        );

        if (response.ok) {
          monitorsRun++;
          console.log(`Executed ${monitor}`);
        }
      } catch (error) {
        console.error(`Error running ${monitor}:`, error);
      }
    }

    // 4. Auto-close resolved incidents older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: resolvedIncidents, error: resolvedError } = await supabase
      .from('incidents')
      .select('*')
      .eq('status', 'resolved')
      .lt('resolved_at', sevenDaysAgo);

    if (!resolvedError && resolvedIncidents) {
      for (const incident of resolvedIncidents) {
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
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        summary: {
          signals_processed: processedSignals,
          incidents_escalated: staleIncidents?.length || 0,
          monitors_executed: monitorsRun
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in auto-orchestrator:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
