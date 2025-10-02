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

    console.log('Starting earthquake monitoring scan...');

    // Get all clients with locations
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, location')
      .not('location', 'is', null);

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
          }
        } catch (error) {
          console.error(`Error processing earthquake for ${client.name}:`, error);
        }
      }
    }

    console.log(`Earthquake monitoring complete. Created ${signalsCreated} signals.`);

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
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
