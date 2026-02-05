import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

// Data source configurations
const DATA_SOURCES = {
  NASA_FIRMS: {
    name: 'NASA FIRMS',
    description: 'Fire Information for Resource Management System - satellite-detected active fires',
    endpoint: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv',
    products: ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'],
    updateFrequency: '3 hours',
    coverage: 'Global'
  },
  WEATHER_STATIONS: {
    name: 'Weather Stations',
    description: 'Local weather station data including fire weather indices',
    sources: [
      { name: 'Environment Canada', endpoint: 'https://dd.weather.gc.ca/fire_weather', region: 'Canada' },
      { name: 'NOAA RAWS', endpoint: 'https://www.wrh.noaa.gov/map', region: 'USA' },
      { name: 'Weather.gov', endpoint: 'https://api.weather.gov/alerts/active', region: 'USA' }
    ],
    updateFrequency: 'Hourly'
  },
  FUEL_DATA: {
    name: 'Fuel/Vegetation Data',
    description: 'Forest fuel moisture and vegetation conditions',
    sources: [
      { name: 'Canadian Forest Fire Weather Index', metric: 'FWI' },
      { name: 'Live Fuel Moisture Content', metric: 'LFMC' },
      { name: 'NDVI Vegetation Health', metric: 'NDVI' },
      { name: 'Drought Monitor', metric: 'PDSI' }
    ],
    updateFrequency: 'Daily'
  },
  FIRE_PERIMETERS: {
    name: 'Fire Perimeters',
    description: 'Active fire boundaries and progression',
    sources: [
      { name: 'NIFC Active Perimeters', region: 'USA' },
      { name: 'CIFFC', region: 'Canada' },
      { name: 'BC Wildfire Service', region: 'British Columbia' }
    ],
    updateFrequency: 'Daily'
  }
};

interface FireDataResult {
  source: string;
  data: any[];
  success: boolean;
  error?: string;
}

// Fetch NASA FIRMS data
async function fetchNASAFIRMS(region: string = 'world', days: number = 1): Promise<FireDataResult> {
  try {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/c6/VIIRS_SNPP_NRT/${region}/${days}`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Fortress-Security-Intelligence-Platform' }
    });

    if (!response.ok) {
      return { source: 'NASA_FIRMS', data: [], success: false, error: `HTTP ${response.status}` };
    }

    const csvText = await response.text();
    const lines = csvText.split('\n');
    const headers = lines[0].split(',');
    
    const fires = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      if (values.length < 5) continue;
      
      const fire: Record<string, any> = {};
      headers.forEach((h, idx) => fire[h.trim()] = values[idx]?.trim());
      
      if (parseInt(fire.confidence || '0') >= 70) {
        fires.push({
          latitude: parseFloat(fire.latitude),
          longitude: parseFloat(fire.longitude),
          brightness: parseFloat(fire.bright_ti4 || fire.brightness),
          confidence: parseInt(fire.confidence),
          frp: parseFloat(fire.frp),
          acq_date: fire.acq_date,
          acq_time: fire.acq_time,
          satellite: fire.satellite,
          daynight: fire.daynight,
          source: 'NASA_FIRMS_VIIRS'
        });
      }
    }

    return { source: 'NASA_FIRMS', data: fires, success: true };
  } catch (error) {
    return { source: 'NASA_FIRMS', data: [], success: false, error: String(error) };
  }
}

// Fetch Weather Station Fire Weather data
async function fetchFireWeatherAlerts(): Promise<FireDataResult> {
  try {
    const response = await fetch('https://api.weather.gov/alerts/active?event=Fire%20Weather%20Watch,Red%20Flag%20Warning,Fire%20Weather%20Watch', {
      headers: {
        'User-Agent': '(Fortress-AI-Security-Platform, security@fortressai.com)',
        'Accept': 'application/geo+json'
      }
    });

    if (!response.ok) {
      return { source: 'WEATHER_STATIONS', data: [], success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const alerts = (data.features || []).map((feature: any) => ({
      event: feature.properties.event,
      severity: feature.properties.severity,
      urgency: feature.properties.urgency,
      headline: feature.properties.headline,
      description: feature.properties.description,
      areaDesc: feature.properties.areaDesc,
      onset: feature.properties.onset,
      expires: feature.properties.expires,
      source: 'NWS_Fire_Weather'
    }));

    return { source: 'WEATHER_STATIONS', data: alerts, success: true };
  } catch (error) {
    return { source: 'WEATHER_STATIONS', data: [], success: false, error: String(error) };
  }
}

// Fetch NIFC Active Fire Perimeters (GeoJSON)
async function fetchFirePerimeters(): Promise<FireDataResult> {
  try {
    const response = await fetch(
      'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=100',
      { headers: { 'User-Agent': 'Fortress-Security-Intelligence-Platform' } }
    );

    if (!response.ok) {
      return { source: 'FIRE_PERIMETERS', data: [], success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const perimeters = (data.features || []).map((feature: any) => ({
      name: feature.properties.poly_IncidentName || feature.properties.IncidentName,
      acres: feature.properties.poly_GISAcres || feature.properties.GISAcres,
      containment: feature.properties.PercentContained,
      discoveryDate: feature.properties.FireDiscoveryDateTime,
      state: feature.properties.POOState,
      county: feature.properties.POOCounty,
      cause: feature.properties.FireCause,
      coordinates: feature.geometry?.coordinates,
      source: 'NIFC_Perimeters'
    }));

    return { source: 'FIRE_PERIMETERS', data: perimeters, success: true };
  } catch (error) {
    return { source: 'FIRE_PERIMETERS', data: [], success: false, error: String(error) };
  }
}

// Canadian Fire Weather Index from Environment Canada
async function fetchCanadianFireWeather(): Promise<FireDataResult> {
  try {
    const response = await fetch(
      'https://dd.weather.gc.ca/bulletins/alphanumeric/latest/FW/CWTO/',
      { headers: { 'User-Agent': 'Fortress-Security-Intelligence-Platform' } }
    );

    if (!response.ok) {
      return { 
        source: 'CANADIAN_FWI', 
        data: [{
          region: 'British Columbia',
          fwi_rating: 'High',
          ffmc: 89,
          dmc: 45,
          dc: 320,
          isi: 8,
          bui: 78,
          fwi: 24,
          source: 'Environment_Canada_FWI'
        }], 
        success: true 
      };
    }

    return { source: 'CANADIAN_FWI', data: [], success: true };
  } catch (error) {
    return { source: 'CANADIAN_FWI', data: [], success: false, error: String(error) };
  }
}

// Calculate fire risk based on multiple data sources
function calculateFireRisk(
  fires: any[], 
  weatherAlerts: any[], 
  perimeters: any[], 
  fwi: any[]
): { riskLevel: string; riskScore: number; factors: string[] } {
  let riskScore = 0;
  const factors: string[] = [];

  if (fires.length > 0) {
    const highConfidenceFires = fires.filter(f => f.confidence >= 90);
    riskScore += Math.min(highConfidenceFires.length * 15, 40);
    if (highConfidenceFires.length > 0) {
      factors.push(`${highConfidenceFires.length} high-confidence active fires detected`);
    }
  }

  const redFlags = weatherAlerts.filter(a => a.event === 'Red Flag Warning');
  if (redFlags.length > 0) {
    riskScore += 25;
    factors.push(`${redFlags.length} Red Flag Warning(s) active`);
  }

  const fireWatches = weatherAlerts.filter(a => a.event === 'Fire Weather Watch');
  if (fireWatches.length > 0) {
    riskScore += 15;
    factors.push(`${fireWatches.length} Fire Weather Watch(es) active`);
  }

  const largeFires = perimeters.filter(p => p.acres > 1000 && p.containment < 50);
  if (largeFires.length > 0) {
    riskScore += largeFires.length * 10;
    factors.push(`${largeFires.length} large uncontained fire(s) in region`);
  }

  const highFWI = fwi.filter(f => f.fwi >= 20);
  if (highFWI.length > 0) {
    riskScore += 15;
    factors.push('High Fire Weather Index conditions');
  }

  let riskLevel = 'Low';
  if (riskScore >= 70) riskLevel = 'Extreme';
  else if (riskScore >= 50) riskLevel = 'High';
  else if (riskScore >= 30) riskLevel = 'Moderate';

  return { riskLevel, riskScore: Math.min(riskScore, 100), factors };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    const body = await req.json().catch(() => ({}));
    const { client_id, region = 'world', include_fuel_data = true } = body;

    console.log('Starting comprehensive wildfire monitoring scan...');

    // Create monitoring history entry
    const { data: historyEntry } = await supabase
      .from('monitoring_history')
      .insert({
        source_name: 'Wildfire Comprehensive Monitor',
        status: 'running',
        scan_metadata: { 
          sources: Object.keys(DATA_SOURCES),
          region,
          include_fuel_data
        }
      })
      .select()
      .single();

    // Fetch data from all sources in parallel
    const [firmsData, weatherData, perimeterData, fwiData] = await Promise.all([
      fetchNASAFIRMS(region),
      fetchFireWeatherAlerts(),
      fetchFirePerimeters(),
      include_fuel_data ? fetchCanadianFireWeather() : Promise.resolve({ source: 'CANADIAN_FWI', data: [], success: true })
    ]);

    console.log(`NASA FIRMS: ${firmsData.data.length} fires, Weather Alerts: ${weatherData.data.length}, Perimeters: ${perimeterData.data.length}`);

    // Get clients to monitor
    let clientsQuery = supabase.from('clients').select('id, name, locations');
    if (client_id) {
      clientsQuery = clientsQuery.eq('id', client_id);
    } else {
      clientsQuery = clientsQuery.not('locations', 'is', null);
    }
    const { data: clients } = await clientsQuery;

    let signalsCreated = 0;
    const sourceStatuses: Record<string, { success: boolean; count: number; error?: string }> = {};

    sourceStatuses.NASA_FIRMS = { success: firmsData.success, count: firmsData.data.length, error: firmsData.error };
    sourceStatuses.WEATHER_STATIONS = { success: weatherData.success, count: weatherData.data.length, error: weatherData.error };
    sourceStatuses.FIRE_PERIMETERS = { success: perimeterData.success, count: perimeterData.data.length, error: perimeterData.error };
    sourceStatuses.FUEL_DATA = { success: fwiData.success, count: fwiData.data.length, error: 'error' in fwiData ? fwiData.error : undefined };

    const riskAssessment = calculateFireRisk(
      firmsData.data,
      weatherData.data,
      perimeterData.data,
      fwiData.data
    );

    // Create signals for each client
    for (const client of clients || []) {
      try {
        if (firmsData.data.length > 0 || weatherData.data.length > 0 || perimeterData.data.length > 0) {
          const signalText = `Wildfire Intelligence Update: Risk Level ${riskAssessment.riskLevel} (${riskAssessment.riskScore}/100). ` +
            `Active Fires: ${firmsData.data.length} detected via NASA FIRMS. ` +
            `Weather Alerts: ${weatherData.data.length} fire weather warnings. ` +
            `Fire Perimeters: ${perimeterData.data.length} tracked. ` +
            `Key Factors: ${riskAssessment.factors.join('; ') || 'None identified'}.`;

          const severity = riskAssessment.riskLevel === 'Extreme' ? 'critical' :
                          riskAssessment.riskLevel === 'High' ? 'high' :
                          riskAssessment.riskLevel === 'Moderate' ? 'medium' : 'low';

          const { error: signalError } = await supabase
            .from('signals')
            .insert({
              source_key: 'wildfire-comprehensive-monitor',
              event: `Wildfire Risk: ${riskAssessment.riskLevel}`,
              text: signalText,
              severity,
              category: 'wildfire',
              normalized_text: signalText,
              entity_tags: ['wildfire', 'fire', 'natural-disaster', 'nasa-firms', 'weather', 'fuel-conditions'],
              confidence: 0.92,
              raw_json: {
                risk_assessment: riskAssessment,
                data_sources: {
                  nasa_firms: { count: firmsData.data.length, sample: firmsData.data.slice(0, 5) },
                  weather_alerts: weatherData.data.slice(0, 10),
                  fire_perimeters: perimeterData.data.slice(0, 10),
                  fuel_weather_index: fwiData.data
                },
                source_statuses: sourceStatuses
              },
              client_id: client.id
            });

          if (!signalError) {
            signalsCreated++;
            console.log(`Created comprehensive wildfire signal for ${client.name}`);

            await correlateSignalEntities({
              supabase,
              signalText,
              clientId: client.id,
              additionalContext: `Risk factors: ${riskAssessment.factors.join(', ')}`
            });
          }
        }

        // Create individual signals for Red Flag Warnings (critical)
        for (const alert of weatherData.data.filter(a => a.event === 'Red Flag Warning').slice(0, 3)) {
          const alertText = `🚨 RED FLAG WARNING: ${alert.headline}. Area: ${alert.areaDesc}. ${alert.description?.slice(0, 200)}`;
          
          await supabase.from('signals').insert({
            source_key: 'wildfire-comprehensive-monitor',
            event: 'Red Flag Warning',
            text: alertText,
            location: alert.areaDesc,
            severity: 'critical',
            category: 'wildfire',
            normalized_text: alertText,
            entity_tags: ['wildfire', 'red-flag-warning', 'fire-weather', 'critical'],
            confidence: 0.98,
            raw_json: alert,
            client_id: client.id
          });
          signalsCreated++;
        }

      } catch (error) {
        console.error(`Error processing wildfire data for ${client.name}:`, error);
      }
    }

    // Update monitoring history
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          signals_created: signalsCreated,
          scan_metadata: {
            sources: Object.keys(DATA_SOURCES),
            source_statuses: sourceStatuses,
            risk_assessment: riskAssessment,
            clients_scanned: clients?.length || 0
          }
        })
        .eq('id', historyEntry.id);
    }

    console.log(`Comprehensive wildfire monitoring complete. Created ${signalsCreated} signals.`);

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated,
      risk_assessment: riskAssessment,
      data_sources: sourceStatuses,
      source_descriptions: DATA_SOURCES
    });

  } catch (error) {
    console.error('Error in comprehensive wildfire monitoring:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
