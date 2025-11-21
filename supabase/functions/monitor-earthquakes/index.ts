import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

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

    // Create monitoring history entry
    const { data: historyEntry, error: historyError } = await supabase
      .from('monitoring_history')
      .insert({
        source_name: 'Earthquake Monitor',
        status: 'running',
        scan_metadata: { source: 'USGS' }
      })
      .select()
      .single();

    if (historyError) {
      console.error('Failed to create monitoring history:', historyError);
    }

    console.log('Starting earthquake monitoring scan...');

    // Get all clients with locations
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, locations')
      .not('locations', 'is', null);

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;

    // USGS Earthquake API - significant earthquakes in last 24 hours
    const usgsResponse = await fetch(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson'
    );

    if (!usgsResponse.ok) {
      console.log(`USGS API error: ${usgsResponse.status}`);
      throw new Error('Failed to fetch earthquake data');
    }

    const earthquakeData = await usgsResponse.json();
    
    console.log(`Found ${earthquakeData.features?.length || 0} significant earthquakes`);

    for (const quake of earthquakeData.features || []) {
      const props = quake.properties;
      const coords = quake.geometry.coordinates;
      const [lon, lat, depth] = coords;
      const magnitude = props.mag;

      // Only process significant earthquakes (magnitude 4.5+)
      if (magnitude < 4.5) continue;

      for (const client of clients || []) {
        try {
          const severity = magnitude >= 7 ? 'critical' : 
                          magnitude >= 6 ? 'high' : 
                          magnitude >= 5 ? 'medium' : 'low';

          const signalText = `Earthquake Alert: Magnitude ${magnitude} earthquake detected at ${props.place}. Depth: ${depth}km. Time: ${new Date(props.time).toISOString()}`;
          
          const { error: signalError } = await supabase
            .from('signals')
            .insert({
              source_key: 'earthquake-monitor',
              event: `M${magnitude} Earthquake`,
              text: signalText,
              location: props.place,
              severity: severity,
              category: 'earthquake',
              normalized_text: signalText,
              entity_tags: ['earthquake', 'seismic', 'natural-disaster', `magnitude-${Math.floor(magnitude)}`],
              confidence: 0.99,
              raw_json: {
                magnitude: magnitude,
                place: props.place,
                time: props.time,
                latitude: lat,
                longitude: lon,
                depth: depth,
                tsunami: props.tsunami,
                url: props.url
              },
              client_id: client.id
            });

          if (!signalError) {
            signalsCreated++;
            console.log(`Created earthquake signal for ${client.name}: M${magnitude} at ${props.place}`);
            
            await correlateSignalEntities({
              supabase,
              signalText,
              clientId: client.id,
              additionalContext: `Location: ${props.place}. Depth: ${depth}km`
            });
          }
        } catch (error) {
          console.error(`Error processing earthquake for ${client.name}:`, error);
        }
      }
    }

    console.log(`Earthquake monitoring complete. Created ${signalsCreated} signals.`);

    // Update monitoring history on success
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: earthquakeData.features?.length || 0,
          signals_created: signalsCreated,
          scan_metadata: { 
            source: 'USGS',
            earthquakes_found: earthquakeData.features?.length || 0,
            clients_scanned: clients?.length || 0
          }
        })
        .eq('id', historyEntry.id);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'earthquake',
        earthquakes_found: earthquakeData.features?.length || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in earthquake monitoring:', error);
    
    // Update monitoring history on error
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    try {
      const { data: failedEntry } = await supabase
        .from('monitoring_history')
        .select('id')
        .eq('source_name', 'Earthquake Monitor')
        .eq('status', 'running')
        .order('scan_started_at', { ascending: false })
        .limit(1)
        .single();

      if (failedEntry) {
        await supabase
          .from('monitoring_history')
          .update({
            status: 'failed',
            scan_completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', failedEntry.id);
      }
    } catch (updateError) {
      console.error('Failed to update monitoring history:', updateError);
    }
    
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
