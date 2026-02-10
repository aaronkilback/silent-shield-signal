import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Haversine formula for distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { latitude, longitude, radius_km, timeframe_hours, client_id } = await req.json();
    console.log('Fusing geospatial intelligence:', { latitude, longitude, radius_km });

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const results: any = {
      location: { latitude, longitude },
      radius_km,
      timeframe_hours,
      nearby_assets: [],
      nearby_entities: [],
      recent_signals: [],
      recent_incidents: [],
      risk_assessment: 'low'
    };

    // Get client assets if client_id provided
    if (client_id) {
      const { data: client } = await supabaseClient
        .from('clients')
        .select('name, high_value_assets, locations, risk_assessment')
        .eq('id', client_id)
        .single();

      if (client?.locations) {
        results.client_name = client.name;
        results.nearby_assets = client.locations.filter((loc: string) => {
          // Simple proximity check (would need geocoding in production)
          return true; // Simplified
        }).map((loc: string) => ({ location: loc, distance_km: 0 }));
      }
    }

    // Get entities near location with active monitoring
    const { data: entities } = await supabaseClient
      .from('entities')
      .select('id, name, type, threat_score, current_location, monitoring_radius_km')
      .eq('active_monitoring_enabled', true)
      .not('current_location', 'is', null);

    if (entities) {
      results.nearby_entities = entities
        .filter(entity => {
          // Simplified check - would need proper geocoding
          return entity.monitoring_radius_km && entity.monitoring_radius_km >= radius_km;
        })
        .map(entity => ({
          id: entity.id,
          name: entity.name,
          type: entity.type,
          threat_score: entity.threat_score,
          distance_km: 0 // Would calculate actual distance
        }));
    }

    // Get recent signals in timeframe
    if (timeframe_hours) {
      const timeframeCutoff = new Date(Date.now() - timeframe_hours * 60 * 60 * 1000).toISOString();
      const { data: signals } = await supabaseClient
        .from('signals')
        .select('id, normalized_text, priority, created_at, source_type')
        .gte('created_at', timeframeCutoff)
        .limit(50);

      results.recent_signals = signals || [];
    }

    // Get recent incidents in timeframe
    if (timeframe_hours) {
      const timeframeCutoff = new Date(Date.now() - timeframe_hours * 60 * 60 * 1000).toISOString();
      const { data: incidents } = await supabaseClient
        .from('incidents')
        .select('id, title, priority, status, opened_at')
        .gte('opened_at', timeframeCutoff)
        .limit(20);

      results.recent_incidents = incidents || [];
    }

    // Calculate risk assessment
    const threatCount = results.nearby_entities.filter((e: any) => e.threat_score > 50).length;
    const highPrioritySignals = results.recent_signals.filter((s: any) => s.priority === 'high' || s.priority === 'critical').length;
    const activeIncidents = results.recent_incidents.filter((i: any) => i.status === 'open' || i.status === 'acknowledged').length;

    if (activeIncidents > 0 || highPrioritySignals > 3 || threatCount > 2) {
      results.risk_assessment = 'high';
    } else if (highPrioritySignals > 0 || threatCount > 0) {
      results.risk_assessment = 'medium';
    }

    console.log('Geospatial fusion complete');

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in fuse-geospatial-intelligence:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
