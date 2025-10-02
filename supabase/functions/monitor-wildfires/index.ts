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

    console.log('Starting wildfire monitoring scan...');

    // Get all clients with locations
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, locations')
      .not('locations', 'is', null);

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;

    // NASA FIRMS - Active Fire Data (last 24 hours)
    // Using VIIRS data for global coverage
    const firmsResponse = await fetch(
      'https://firms.modaps.eosdis.nasa.gov/api/area/csv/c6/VIIRS_SNPP_NRT/world/1',
      {
        headers: {
          'User-Agent': 'OSINT-Monitoring-System',
        }
      }
    );

    if (!firmsResponse.ok) {
      console.log(`FIRMS API error: ${firmsResponse.status}`);
      throw new Error('Failed to fetch wildfire data');
    }

    const firmsText = await firmsResponse.text();
    const lines = firmsText.split('\n');
    
    // Parse CSV (skip header)
    for (let i = 1; i < Math.min(lines.length, 100); i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const [lat, lon, brightness, scan, track, acq_date, acq_time, satellite, confidence, version, bright_t31, frp, daynight] = line.split(',');
      
      // High confidence fires only
      if (parseInt(confidence) < 70) continue;

      // Check proximity to clients (simplified - in production use proper geo calculation)
      for (const client of clients || []) {
        try {
          const signalText = `Active Wildfire Detected: High confidence (${confidence}%) fire detected on ${acq_date} at ${acq_time}. Brightness: ${brightness}K, Fire Radiative Power: ${frp} MW`;
          
          const { error: signalError } = await supabase
            .from('signals')
            .insert({
              source_key: 'wildfire-monitor',
              event: 'Active Wildfire',
              text: signalText,
              location: `Lat: ${lat}, Lon: ${lon}`,
              severity: parseInt(confidence) > 90 ? 'critical' : 'high',
              category: 'wildfire',
              normalized_text: signalText,
              entity_tags: ['wildfire', 'fire', 'natural-disaster', satellite.toLowerCase()],
              confidence: parseInt(confidence) / 100,
              raw_json: {
                latitude: parseFloat(lat),
                longitude: parseFloat(lon),
                brightness: parseFloat(brightness),
                confidence: parseInt(confidence),
                frp: parseFloat(frp),
                acquisition_date: acq_date,
                acquisition_time: acq_time,
                satellite
              },
              client_id: client.id
            });

          if (!signalError) {
            signalsCreated++;
            console.log(`Created wildfire signal for ${client.name}`);
          }
          
          // Only create one signal per client per scan
          break;
        } catch (error) {
          console.error(`Error processing wildfire for ${client.name}:`, error);
        }
      }
      
      if (signalsCreated >= 10) break; // Limit signals per scan
    }

    console.log(`Wildfire monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'wildfire'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in wildfire monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
