import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

/**
 * Geospatial Event Clustering Engine
 * 
 * Clusters geotagged signals into named events with AI-generated narratives.
 * MERIDIAN agent provides regional context and cascading-effects analysis.
 * 
 * Actions:
 *   - cluster: Run spatial/temporal clustering on recent signals
 *   - analyze: MERIDIAN auto-analysis on a specific cluster
 */

// Known location geocoding (shared with ThreatGlobe)
const GEO_MAP: Record<string, { lat: number; lng: number }> = {
  "fort st john": { lat: 56.2463, lng: -120.8533 },
  "fort saint john": { lat: 56.2463, lng: -120.8533 },
  "calgary": { lat: 51.0447, lng: -114.0719 },
  "vancouver": { lat: 49.2827, lng: -123.1207 },
  "toronto": { lat: 43.6532, lng: -79.3832 },
  "edmonton": { lat: 53.5461, lng: -113.4938 },
  "montreal": { lat: 45.5017, lng: -73.5673 },
  "ottawa": { lat: 45.4215, lng: -75.6972 },
  "prince george": { lat: 53.9171, lng: -122.7497 },
  "kitimat": { lat: 54.0523, lng: -128.7137 },
  "dawson creek": { lat: 55.7596, lng: -120.2353 },
  "grande prairie": { lat: 55.1707, lng: -118.7887 },
  "british columbia": { lat: 53.7267, lng: -127.6476 },
  "bc": { lat: 53.7267, lng: -127.6476 },
  "alberta": { lat: 53.9333, lng: -116.5765 },
  "kuala lumpur": { lat: 3.1390, lng: 101.6869 },
  "malaysia": { lat: 4.2105, lng: 101.9758 },
  "singapore": { lat: 1.3521, lng: 103.8198 },
  "london": { lat: 51.5074, lng: -0.1278 },
  "dubai": { lat: 25.2048, lng: 55.2708 },
  "new york": { lat: 40.7128, lng: -74.0060 },
  "houston": { lat: 29.7604, lng: -95.3698 },
  "tokyo": { lat: 35.6762, lng: 139.6503 },
  "beijing": { lat: 39.9042, lng: 116.4074 },
  "hong kong": { lat: 22.3193, lng: 114.1694 },
  "tehran": { lat: 35.6892, lng: 51.3890 },
  "moscow": { lat: 55.7558, lng: 37.6173 },
  "kyiv": { lat: 50.4501, lng: 30.5234 },
  "baghdad": { lat: 33.3152, lng: 44.3661 },
  "riyadh": { lat: 24.7136, lng: 46.6753 },
  "istanbul": { lat: 41.0082, lng: 28.9784 },
  "mumbai": { lat: 19.0760, lng: 72.8777 },
  "lagos": { lat: 6.5244, lng: 3.3792 },
  "nairobi": { lat: -1.2921, lng: 36.8219 },
  "cape town": { lat: -33.9249, lng: 18.4241 },
  "mexico city": { lat: 19.4326, lng: -99.1332 },
  "sao paulo": { lat: -23.5505, lng: -46.6333 },
  "buenos aires": { lat: -34.6037, lng: -58.3816 },
  "sydney": { lat: -33.8688, lng: 151.2093 },
};

function parseCoords(location: string): { lat: number; lng: number } | null {
  if (!location) return null;
  const coordMatch = location.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }
  const normalized = location.toLowerCase().trim();
  for (const [key, coords] of Object.entries(GEO_MAP)) {
    if (normalized.includes(key)) return coords;
  }
  return null;
}

// Haversine distance in km
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface GeoSignal {
  id: string;
  title: string;
  normalized_text: string;
  location: string;
  lat: number;
  lng: number;
  severity: string;
  rule_category: string | null;
  detected_at: string;
  entity_tags: string[] | null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { action = 'cluster', cluster_id, lookback_hours = 72, radius_km = 150 } = await req.json();
    const supabase = createServiceClient();

    if (action === 'cluster') {
      console.log(`[GeoCluster] Starting spatial clustering (${lookback_hours}h lookback, ${radius_km}km radius)`);

      // 1. Fetch recent geotagged signals
      const cutoff = new Date(Date.now() - lookback_hours * 3600000).toISOString();
      const { data: signals } = await supabase
        .from('signals')
        .select('id, title, normalized_text, location, severity, rule_category, detected_at, entity_tags')
        .gte('detected_at', cutoff)
        .gt('relevance_score', 0.35)
        .not('location', 'is', null)
        .order('detected_at', { ascending: false })
        .limit(500);

      if (!signals?.length) {
        return successResponse({ clusters: [], message: 'No geotagged signals in timeframe' });
      }

      // 2. Geocode all signals
      const geoSignals: GeoSignal[] = [];
      for (const sig of signals) {
        const coords = parseCoords(sig.location);
        if (coords) {
          geoSignals.push({ ...sig, lat: coords.lat, lng: coords.lng, normalized_text: sig.normalized_text || '' });
        }
      }
      console.log(`[GeoCluster] ${geoSignals.length}/${signals.length} signals geocoded`);

      if (geoSignals.length < 2) {
        return successResponse({ clusters: [], message: 'Insufficient geocoded signals for clustering' });
      }

      // 3. DBSCAN-style spatial + temporal clustering
      const clustered = new Set<string>();
      const rawClusters: GeoSignal[][] = [];

      for (const sig of geoSignals) {
        if (clustered.has(sig.id)) continue;
        const cluster: GeoSignal[] = [sig];
        clustered.add(sig.id);

        for (const other of geoSignals) {
          if (clustered.has(other.id)) continue;
          const dist = haversineKm(sig.lat, sig.lng, other.lat, other.lng);
          const timeDiffH = Math.abs(new Date(sig.detected_at).getTime() - new Date(other.detected_at).getTime()) / 3600000;
          // Spatial proximity AND temporal proximity (within 48h)
          if (dist <= radius_km && timeDiffH <= 48) {
            cluster.push(other);
            clustered.add(other.id);
          }
        }

        if (cluster.length >= 5) {
          rawClusters.push(cluster);
        }
      }

      console.log(`[GeoCluster] ${rawClusters.length} spatial clusters found`);

      // 4. For each cluster: compute centroid, generate AI narrative via MERIDIAN
      const results = [];
      for (const cluster of rawClusters.slice(0, 10)) {
        const centroidLat = cluster.reduce((s, c) => s + c.lat, 0) / cluster.length;
        const centroidLng = cluster.reduce((s, c) => s + c.lng, 0) / cluster.length;
        const maxSeverity = cluster.some(s => s.severity === 'critical') ? 'critical'
          : cluster.some(s => s.severity === 'high') ? 'high'
          : cluster.some(s => s.severity === 'medium') ? 'medium' : 'low';

        // Determine cluster radius
        let maxDist = 0;
        for (const sig of cluster) {
          const d = haversineKm(centroidLat, centroidLng, sig.lat, sig.lng);
          if (d > maxDist) maxDist = d;
        }

        const signalSummaries = cluster.map(s => 
          `[${s.severity}] ${s.title} — ${(s.normalized_text || '').substring(0, 200)} (${s.location}, ${s.detected_at})`
        ).join('\n');

        const categories = [...new Set(cluster.map(s => s.rule_category).filter(Boolean))];
        const entities = [...new Set(cluster.flatMap(s => s.entity_tags || []))];

        // MERIDIAN auto-analysis prompt
        const analysisPrompt = `You are MERIDIAN, a geopolitical intelligence analyst.

${cluster.length} intelligence signals have been detected within ${Math.round(maxDist)}km of each other over the past 48 hours.

SIGNAL CLUSTER:
${signalSummaries}

CATEGORIES: ${categories.join(', ') || 'mixed'}
ENTITIES INVOLVED: ${entities.join(', ') || 'none identified'}
CENTROID: ${centroidLat.toFixed(4)}, ${centroidLng.toFixed(4)}

Provide a concise analysis in this exact JSON format:
{
  "event_name": "Short descriptive name for this event cluster (max 8 words)",
  "event_type": "One of: conflict, natural_disaster, infrastructure, civil_unrest, cyber, crime, terrorism, industrial, political, health, environmental",
  "narrative": "2-3 sentence situation narrative describing what is happening and why these signals are related",
  "regional_context": "1-2 sentences on regional dynamics that explain why this matters",
  "cascading_risks": ["Risk 1", "Risk 2", "Risk 3"],
  "confidence": 0.0-1.0,
  "recommended_actions": ["Action 1", "Action 2"]
}`;

        try {
          const aiResult = await callAiGateway({
            model: 'google/gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are MERIDIAN, a geopolitical intelligence specialist. Respond only with valid JSON.' },
              { role: 'user', content: analysisPrompt }
            ],
            functionName: 'geospatial-event-clustering',
          });

          let analysis: any = {};
          if (aiResult.content) {
            try {
              const cleaned = aiResult.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
              analysis = JSON.parse(cleaned);
            } catch {
              analysis = { event_name: `Cluster near ${cluster[0].location}`, narrative: aiResult.content, event_type: 'cluster', confidence: 0.6 };
            }
          }

          // Upsert into signal_clusters with geospatial data
          const clusterRecord = {
            cluster_label: analysis.event_name || `${cluster.length} signals near ${cluster[0].location}`,
            signal_ids: cluster.map(s => s.id),
            entity_overlap: entities,
            temporal_window_hours: 48,
            cluster_score: analysis.confidence || (cluster.length * 0.15),
            centroid_lat: centroidLat,
            centroid_lng: centroidLng,
            location_name: cluster[0].location,
            narrative: analysis.narrative || '',
            event_type: analysis.event_type || 'cluster',
            agent_analysis: JSON.stringify({
              regional_context: analysis.regional_context,
              cascading_risks: analysis.cascading_risks,
              recommended_actions: analysis.recommended_actions,
              analyzed_by: 'MERIDIAN',
              analyzed_at: new Date().toISOString(),
            }),
            severity: maxSeverity,
            radius_km: maxDist,
          };

          await supabase.from('signal_clusters').insert(clusterRecord);
          results.push(clusterRecord);
        } catch (aiErr) {
          console.error(`[GeoCluster] AI analysis failed for cluster:`, aiErr);
          // Still save cluster without narrative
          const typeBreakdown = Object.entries(
            cluster.reduce((acc: Record<string, number>, s) => {
              const t = s.rule_category || 'unknown';
              acc[t] = (acc[t] || 0) + 1;
              return acc;
            }, {})
          ).map(([t, n]) => `${t}(${n})`).join(', ');
          const fallback = {
            cluster_label: `${cluster.length} signals near ${cluster[0].location} — types: ${typeBreakdown}`,
            signal_ids: cluster.map(s => s.id),
            entity_overlap: entities,
            temporal_window_hours: 48,
            cluster_score: cluster.length * 0.15,
            centroid_lat: centroidLat,
            centroid_lng: centroidLng,
            location_name: cluster[0].location,
            event_type: 'cluster',
            severity: maxSeverity,
            radius_km: maxDist,
          };
          await supabase.from('signal_clusters').insert(fallback);
          results.push(fallback);
        }
      }

      // Also fetch recent incidents with locations for the unified feed
      const { data: incidents } = await supabase
        .from('incidents')
        .select('id, status, priority, opened_at, signal_id, client_id')
        .gte('opened_at', cutoff)
        .order('opened_at', { ascending: false })
        .limit(50);

      console.log(`[GeoCluster] Complete: ${results.length} event clusters created, ${incidents?.length || 0} incidents in timeframe`);

      return successResponse({
        clusters_created: results.length,
        signals_processed: geoSignals.length,
        clusters: results,
      });

    } else if (action === 'analyze' && cluster_id) {
      // On-demand MERIDIAN deep analysis of a specific cluster
      const { data: cluster } = await supabase
        .from('signal_clusters')
        .select('*')
        .eq('id', cluster_id)
        .single();

      if (!cluster) return errorResponse('Cluster not found', 404);

      // Fetch the actual signals
      const { data: signals } = await supabase
        .from('signals')
        .select('id, title, normalized_text, location, severity, rule_category, detected_at')
        .in('id', cluster.signal_ids || []);

      const signalDetail = signals?.map(s =>
        `[${s.severity}] ${s.title}: ${(s.normalized_text || '').substring(0, 300)} (${s.location})`
      ).join('\n\n') || 'No signal details available';

      const deepPrompt = `You are MERIDIAN, a senior geopolitical intelligence analyst conducting a deep assessment.

EVENT CLUSTER: "${cluster.cluster_label}"
LOCATION: ${cluster.location_name} (${cluster.centroid_lat?.toFixed(4)}, ${cluster.centroid_lng?.toFixed(4)})
SEVERITY: ${cluster.severity}
SIGNALS (${cluster.signal_ids?.length || 0}):

${signalDetail}

Provide a comprehensive MERIDIAN assessment covering:
1. SITUATION OVERVIEW: What is happening and its current trajectory
2. REGIONAL DYNAMICS: Political, economic, and security factors
3. THREAT VECTORS: Who benefits, who is at risk, what are the attack surfaces
4. CASCADING EFFECTS: Second and third-order consequences
5. TIMELINE PROJECTION: Near-term (days), medium-term (weeks), long-term (months)
6. RECOMMENDED POSTURE: Defensive measures, monitoring priorities, decision triggers
7. CONFIDENCE ASSESSMENT: Admiralty/NATO rating with rationale

Write as an intelligence officer, not a reporter. Every sentence must add decision value.`;

      const result = await callAiGateway({
        model: 'google/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are MERIDIAN, a senior geopolitical intelligence analyst. Provide actionable strategic foresight.' },
          { role: 'user', content: deepPrompt }
        ],
        functionName: 'geospatial-event-clustering',
      });

      // Update cluster with deep analysis
      await supabase.from('signal_clusters').update({
        agent_analysis: JSON.stringify({
          ...(cluster.agent_analysis ? JSON.parse(cluster.agent_analysis as string) : {}),
          deep_analysis: result.content,
          deep_analyzed_at: new Date().toISOString(),
        }),
      }).eq('id', cluster_id);

      return successResponse({
        cluster_id,
        analysis: result.content,
        analyzed_at: new Date().toISOString(),
      });
    }

    return errorResponse('Invalid action. Use "cluster" or "analyze"', 400);
  } catch (error) {
    console.error('[GeoCluster] Error:', error);
    await logError(error, { functionName: 'geospatial-event-clustering', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
