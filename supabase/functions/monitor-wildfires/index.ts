import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('Starting wildfire monitoring scan...');

    // Get all clients with locations
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, locations')
      .not('locations', 'is', null);

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;

    const firmsKey = Deno.env.get('NASA_FIRMS_MAP_KEY');

    // NASA FIRMS - Active Fire Data (last 24 hours)
    // Requires a free MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/map_key/
    // Set via: supabase secrets set NASA_FIRMS_MAP_KEY=<key>
    if (!firmsKey) {
      console.log('[Wildfires] NASA_FIRMS_MAP_KEY not configured — skipping. Register at https://firms.modaps.eosdis.nasa.gov/api/map_key/');
      return successResponse({ success: true, signals_created: 0, note: 'NASA_FIRMS_MAP_KEY not configured' });
    }

    const firmsResponse = await fetch(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/VIIRS_SNPP_NRT/world/1`,
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

      // Check proximity to clients
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
            
            await correlateSignalEntities({
              supabase,
              signalText,
              clientId: client.id,
              additionalContext: `Location: Lat ${lat}, Lon ${lon}. Brightness: ${brightness}K, FRP: ${frp} MW`
            });
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

    return successResponse({ 
      success: true, 
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated,
      source: 'wildfire'
    });
  } catch (error) {
    console.error('Error in wildfire monitoring:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
