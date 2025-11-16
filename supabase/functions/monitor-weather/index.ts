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

    console.log('Starting weather monitoring scan...');

    // Get all clients with locations
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, locations')
      .not('locations', 'is', null);

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;

    for (const client of clients || []) {
      try {
        // Use Weather.gov API (free, US-focused) with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const weatherResponse = await fetch(
          'https://api.weather.gov/alerts/active',
          {
            headers: {
              'User-Agent': '(Fortress-AI-Security-Platform, security@fortressai.com)',
              'Accept': 'application/geo+json',
            },
            signal: controller.signal
          }
        ).finally(() => clearTimeout(timeout));

        if (!weatherResponse.ok) {
          console.log(`Weather API error for ${client.name}: ${weatherResponse.status} - ${await weatherResponse.text().catch(() => 'no details')}`);
          continue;
        }

        const weatherData = await weatherResponse.json();
        
        if (weatherData.features && weatherData.features.length > 0) {
          for (const alert of weatherData.features.slice(0, 3)) {
            const properties = alert.properties;
            
            // Check if alert affects client locations or is high severity
            const clientLocations = (client.locations || []) as string[];
            const isHighSeverity = properties.severity === 'Extreme' || properties.severity === 'Severe';
            const affectsClientLocation = clientLocations.length === 0 || 
              clientLocations.some(loc => properties.areaDesc?.toLowerCase().includes(loc.toLowerCase()));
            
            if (affectsClientLocation && isHighSeverity) {
              const signalText = `Weather Alert: ${properties.event} - ${properties.headline}`;
              
              const { error: signalError } = await supabase
                .from('signals')
                .insert({
                  source_key: 'weather-monitor',
                  event: properties.event,
                  text: signalText,
                  location: properties.areaDesc,
                  severity: properties.severity === 'Extreme' ? 'critical' : 
                           properties.severity === 'Severe' ? 'high' : 'medium',
                  category: 'weather',
                  normalized_text: `${properties.event}: ${properties.description}`,
                  entity_tags: ['weather', 'alert', properties.event.toLowerCase()],
                  confidence: 0.95,
                  raw_json: alert,
                  client_id: client.id
                });

              if (!signalError) {
                signalsCreated++;
                console.log(`Created weather signal for ${client.name}: ${properties.event}`);
              }
            }
          }
        }
      } catch (error) {
        // Handle timeout and network errors gracefully
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            console.log(`Weather API timeout for ${client.name}`);
          } else {
            console.error(`Error processing weather for ${client.name}:`, error.message);
          }
        }
      }
    }

    console.log(`Weather monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'weather'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in weather monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
