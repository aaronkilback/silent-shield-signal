import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

// VIIRS SNPP NRT CSV column indices (confirmed from live data):
// 0:latitude, 1:longitude, 2:bright_ti4, 3:scan, 4:track,
// 5:acq_date, 6:acq_time, 7:satellite, 8:instrument,
// 9:confidence, 10:version, 11:bright_ti5, 12:frp, 13:daynight
//
// confidence values: "h" (high), "n" (nominal), "l" (low)
// satellite values: "N" (Suomi-NPP), "1" (NOAA-20)

// Operational zones — only fires within these areas are relevant to Petronas Canada.
// Alberta fires are only relevant near Calgary (major operations hub) or
// the Montney corridor in NE BC/NW Alberta. Central/Northern Alberta is oil sands
// country, not Petronas territory, and generates massive gas flare noise.
const OPERATIONAL_ZONES = [
  // Northeast BC — Montney formation, Peace Region (core Petronas production area)
  { minLat: 55.0, maxLat: 60.0, minLon: -125.0, maxLon: -119.0, label: 'Northeast BC (Peace/Montney)' },
  // Skeena/Kitimat corridor — LNG Canada terminal, TransMountain route
  { minLat: 53.0, maxLat: 56.0, minLon: -130.0, maxLon: -125.0, label: 'Skeena/Kitimat corridor' },
  // Southern BC — pipeline corridors
  { minLat: 49.0, maxLat: 53.0, minLon: -126.0, maxLon: -120.0, label: 'Southern British Columbia' },
  // Calgary metro area — major operations/corporate hub (user-specified relevance)
  { minLat: 50.5, maxLat: 51.5, minLon: -115.0, maxLon: -113.5, label: 'Calgary region' },
];

// Gas flare heuristic: very high FRP with only moderate brightness is likely
// an industrial flare (oil/gas), not a wildfire. Alberta has thousands of
// active flaring sites. Wildfires in spring/summer typically have bright_ti4 > 330K.
function isLikelyGasFlare(brightTi4: number, frpMW: number, daynight: string): boolean {
  // Night-time detections with very high FRP but moderate brightness = flare
  if (daynight === 'N' && frpMW > 50 && brightTi4 < 340) return true;
  // Extreme FRP with only warm (not hot) brightness = industrial combustion
  if (frpMW > 200 && brightTi4 < 360) return true;
  return false;
}

// Reverse-geocode lat/lon to a human-readable region name
function resolveRegion(lat: number, lon: number): string {
  if (lat >= 55.5 && lat <= 60.0 && lon >= -125.0 && lon <= -120.0) return 'Northeast British Columbia (Peace Region)';
  if (lat >= 53.5 && lat <= 56.0 && lon >= -128.0 && lon <= -122.0) return 'Central British Columbia';
  if (lat >= 53.5 && lat <= 55.5 && lon >= -130.0 && lon <= -126.0) return 'Northwest British Columbia (Skeena/Kitimat corridor)';
  if (lat >= 49.0 && lat <= 53.5 && lon >= -126.0 && lon <= -120.0) return 'Southern British Columbia';
  if (lat >= 56.0 && lat <= 60.0 && lon >= -120.0 && lon <= -110.0) return 'Northern Alberta';
  if (lat >= 51.0 && lat <= 56.0 && lon >= -120.0 && lon <= -110.0) return 'Central Alberta';
  if (lat >= 49.0 && lat <= 51.0 && lon >= -115.0 && lon <= -110.0) return 'Southern Alberta';
  if (lon >= -140.0 && lon <= -110.0 && lat >= 48.0 && lat <= 62.0) return 'Western Canada';
  return `${lat.toFixed(2)}°N ${Math.abs(lon).toFixed(2)}°W`;
}

function getOperationalZone(lat: number, lon: number): string | null {
  for (const zone of OPERATIONAL_ZONES) {
    if (lat >= zone.minLat && lat <= zone.maxLat && lon >= zone.minLon && lon <= zone.maxLon) {
      return zone.label;
    }
  }
  return null; // Not in any operational zone — ignore
}

// Stable dedup key: round to 0.25-degree grid + acquisition date.
// Prevents the same fire being re-ingested on every 15-min cron run.
function fireDedupeKey(lat: number, lon: number, acqDate: string): string {
  const gridLat = Math.round(lat * 4) / 4;
  const gridLon = Math.round(lon * 4) / 4;
  return `wildfire:${gridLat}:${gridLon}:${acqDate}`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const heartbeatAt = new Date().toISOString();
    const heartbeatMs = Date.now();

    console.log('Starting wildfire monitoring scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, locations')
      .not('locations', 'is', null);

    if (clientsError) throw clientsError;

    let signalsCreated = 0;
    let flaresSuppressed = 0;
    let duplicatesSuppressed = 0;

    const firmsKey = Deno.env.get('NASA_FIRMS_MAP_KEY');
    if (!firmsKey) {
      console.log('[Wildfires] NASA_FIRMS_MAP_KEY not configured — skipping.');
      return successResponse({ success: true, signals_created: 0, note: 'NASA_FIRMS_MAP_KEY not configured' });
    }

    const firmsResponse = await fetch(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/VIIRS_SNPP_NRT/world/1`,
      { headers: { 'User-Agent': 'FortressAI/1.0' } }
    );

    if (!firmsResponse.ok) {
      console.log(`FIRMS API error: ${firmsResponse.status}`);
      throw new Error('Failed to fetch wildfire data');
    }

    const firmsText = await firmsResponse.text();
    const lines = firmsText.split('\n');

    // Track dedup keys seen this run to avoid processing the same fire twice
    const seenThisRun = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length < 13) continue;

      const lat = parseFloat(parts[0]);
      const lon = parseFloat(parts[1]);
      const brightTi4 = parseFloat(parts[2]);
      const acq_date = parts[5];
      const satellite = parts[7];        // "N" = Suomi-NPP, "1" = NOAA-20
      const confidence = parts[9];       // "h", "n", or "l"
      const frp = parseFloat(parts[12]); // Fire Radiative Power in MW
      const daynight = parts[13] || 'D';

      if (isNaN(lat) || isNaN(lon) || isNaN(brightTi4) || isNaN(frp)) continue;

      // Only high/nominal confidence — skip low confidence
      if (confidence === 'l') continue;

      const zone = getOperationalZone(lat, lon);
      if (!zone) continue;

      // Filter gas flares — very common in Alberta oil/gas fields
      if (isLikelyGasFlare(brightTi4, frp, daynight)) {
        flaresSuppressed++;
        continue;
      }

      // Deduplicate: same fire location + date = skip
      const dedupeKey = fireDedupeKey(lat, lon, acq_date);
      if (seenThisRun.has(dedupeKey)) {
        duplicatesSuppressed++;
        continue;
      }
      seenThisRun.add(dedupeKey);

      // Check DB-level dedup: has this fire already been ingested today?
      const stableUrl = `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lon.toFixed(2)},${lat.toFixed(2)},10z`;
      const { data: existing } = await supabase
        .from('ingested_documents')
        .select('id')
        .eq('metadata->>url', stableUrl)
        .limit(1);

      if (existing && existing.length > 0) {
        duplicatesSuppressed++;
        continue;
      }

      const region = zone;
      const satelliteName = satellite === 'N' ? 'Suomi-NPP VIIRS' : satellite === '1' ? 'NOAA-20 VIIRS' : 'VIIRS';
      const confLabel = confidence === 'h' ? 'high' : 'nominal';
      const severity = confidence === 'h' ? 'high' : 'medium';

      for (const client of clients || []) {
        try {
          const signalText = [
            `Active wildfire detected near ${region}.`,
            `${satelliteName} satellite detected a ${confLabel}-confidence fire on ${acq_date}.`,
            `Fire Radiative Power: ${frp.toFixed(1)} MW. Brightness temperature: ${brightTi4.toFixed(1)}K.`,
            `Location: ${lat.toFixed(3)}°N, ${Math.abs(lon).toFixed(3)}°W (${daynight === 'N' ? 'night' : 'day'} detection).`,
            `This fire is within the operational area of ${client.name}'s pipeline infrastructure, gas facilities, and right-of-way corridors in ${region}.`,
            `Wildfires in this corridor pose direct risk to above-ground pipeline assets, compressor stations, and access roads.`,
          ].join(' ');

          const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
            body: {
              text: signalText,
              source_url: stableUrl,
              location: region,
              clientId: client.id,
              skip_relevance_gate: true,
            },
          });

          if (!ingestError) {
            signalsCreated++;
            console.log(`[Wildfires] Signal: ${client.name} — ${region} (conf=${confLabel}, FRP=${frp.toFixed(1)}MW, bright=${brightTi4.toFixed(1)}K)`);
          }

          break; // One signal per fire location per scan
        } catch (error) {
          console.error(`Error processing wildfire for ${client.name}:`, error);
        }
      }

      if (signalsCreated >= 10) break;
    }

    console.log(`Wildfire scan complete. Signals: ${signalsCreated}, flares suppressed: ${flaresSuppressed}, duplicates suppressed: ${duplicatesSuppressed}`);

    try {
      await supabase.from('cron_heartbeat').insert({
        job_name: 'monitor-wildfires',
        started_at: heartbeatAt,
        completed_at: new Date().toISOString(),
        status: 'completed',
        duration_ms: Date.now() - heartbeatMs,
        result_summary: { signals_created: signalsCreated, flares_suppressed: flaresSuppressed, duplicates_suppressed: duplicatesSuppressed },
      });
    } catch (_) {}

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated,
      flares_suppressed: flaresSuppressed,
      duplicates_suppressed: duplicatesSuppressed,
      source: 'wildfire',
    });
  } catch (error) {
    console.error('Error in wildfire monitoring:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
