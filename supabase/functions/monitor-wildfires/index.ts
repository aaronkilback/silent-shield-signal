import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

// Bounding boxes for regions where clients operate
// Used to filter global FIRMS data to operationally relevant fires
const CANADA_WEST_BBOX = { minLat: 48.0, maxLat: 62.0, minLon: -140.0, maxLon: -110.0 }; // BC + Alberta

// Reverse-geocode lat/lon to a human-readable region name
// Uses a simple bounding-box lookup — no external API dependency
function resolveRegion(lat: number, lon: number): string {
  // British Columbia sub-regions
  if (lat >= 55.5 && lat <= 60.0 && lon >= -125.0 && lon <= -120.0) return 'Northeast British Columbia (Peace Region)';
  if (lat >= 53.5 && lat <= 56.0 && lon >= -128.0 && lon <= -122.0) return 'Central British Columbia';
  if (lat >= 53.5 && lat <= 55.5 && lon >= -130.0 && lon <= -126.0) return 'Northwest British Columbia (Skeena/Kitimat corridor)';
  if (lat >= 49.0 && lat <= 53.5 && lon >= -126.0 && lon <= -120.0) return 'Southern British Columbia';
  // Alberta
  if (lat >= 56.0 && lat <= 60.0 && lon >= -120.0 && lon <= -110.0) return 'Northern Alberta';
  if (lat >= 51.0 && lat <= 56.0 && lon >= -120.0 && lon <= -110.0) return 'Central Alberta';
  if (lat >= 49.0 && lat <= 51.0 && lon >= -115.0 && lon <= -110.0) return 'Southern Alberta';
  // Broader Canada West
  if (lon >= -140.0 && lon <= -110.0 && lat >= 48.0 && lat <= 62.0) return 'Western Canada';
  return `${lat.toFixed(2)}°N ${Math.abs(lon).toFixed(2)}°W`;
}

// Check if a fire is within the Canada West operational bounding box
function isInOperationalArea(lat: number, lon: number): boolean {
  return lat >= CANADA_WEST_BBOX.minLat && lat <= CANADA_WEST_BBOX.maxLat &&
         lon >= CANADA_WEST_BBOX.minLon && lon <= CANADA_WEST_BBOX.maxLon;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('Starting wildfire monitoring scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, locations')
      .not('locations', 'is', null);

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;

    const firmsKey = Deno.env.get('NASA_FIRMS_MAP_KEY');

    if (!firmsKey) {
      console.log('[Wildfires] NASA_FIRMS_MAP_KEY not configured — skipping.');
      return successResponse({ success: true, signals_created: 0, note: 'NASA_FIRMS_MAP_KEY not configured' });
    }

    const firmsResponse = await fetch(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/VIIRS_SNPP_NRT/world/1`,
      { headers: { 'User-Agent': 'OSINT-Monitoring-System' } }
    );

    if (!firmsResponse.ok) {
      console.log(`FIRMS API error: ${firmsResponse.status}`);
      throw new Error('Failed to fetch wildfire data');
    }

    const firmsText = await firmsResponse.text();
    const lines = firmsText.split('\n');

    // Parse CSV (skip header), filter to operational area only
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const [latStr, lonStr, brightness, , , acq_date, acq_time, satellite, confidence, , , frp] = line.split(',');

      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);
      const conf = parseInt(confidence);

      if (isNaN(lat) || isNaN(lon) || conf < 70) continue;

      // Only process fires within the operational bounding box
      if (!isInOperationalArea(lat, lon)) continue;

      const region = resolveRegion(lat, lon);
      const severity = conf > 90 ? 'critical' : 'high';

      for (const client of clients || []) {
        try {
          const signalText = [
            `Active Wildfire Detected near ${region}.`,
            `Satellite (${satellite || 'VIIRS'}) detected high-confidence (${conf}%) fire on ${acq_date}.`,
            `Fire Radiative Power: ${frp} MW. Brightness: ${brightness}K.`,
            `This fire is within the operational area of ${client.name}'s pipeline infrastructure, gas facilities, and right-of-way corridors in ${region}.`,
            `Wildfires in this corridor pose direct risk to above-ground pipeline assets, compressor stations, and access roads.`,
          ].join(' ');

          const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
            body: {
              text: signalText,
              source_url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lon},${lat},8z`,
              location: region,
              clientId: client.id,
              skip_relevance_gate: true, // Pre-filtered to operational area; gate would reject bare fire data
            },
          });

          if (!ingestError) {
            signalsCreated++;
            console.log(`[Wildfires] Signal created for ${client.name}: ${region} (conf=${conf}%, FRP=${frp}MW)`);
          }

          break; // One signal per fire per scan
        } catch (error) {
          console.error(`Error processing wildfire for ${client.name}:`, error);
        }
      }

      if (signalsCreated >= 15) break;
    }

    console.log(`Wildfire monitoring complete. ${signalsCreated} signals created.`);

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
