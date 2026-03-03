import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type GlobeDataType = 'entity' | 'signal' | 'incident' | 'cluster' | 'travel';

export interface GodsEyePin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: GlobeDataType;
  riskLevel?: string;
  subtype?: string;
  timestamp?: string;
  narrative?: string;
  signalCount?: number;
  metadata?: Record<string, any>;
}

export interface GodsEyeCluster {
  id: string;
  label: string;
  lat: number;
  lng: number;
  signalCount: number;
  severity: string;
  narrative: string;
  eventType: string;
  radiusKm: number;
  agentAnalysis?: any;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
// GEOCODING
// ═══════════════════════════════════════════════════════════════

const GEO_MAP: Record<string, { lat: number; lng: number }> = {
  "fort st john": { lat: 56.2463, lng: -120.8533 },
  "fort saint john": { lat: 56.2463, lng: -120.8533 },
  "calgary": { lat: 51.0447, lng: -114.0719 },
  "vancouver": { lat: 49.2827, lng: -123.1207 },
  "toronto": { lat: 43.6532, lng: -79.3832 },
  "montreal": { lat: 45.5017, lng: -73.5673 },
  "ottawa": { lat: 45.4215, lng: -75.6972 },
  "edmonton": { lat: 53.5461, lng: -113.4938 },
  "winnipeg": { lat: 49.8951, lng: -97.1384 },
  "victoria": { lat: 48.4284, lng: -123.3656 },
  "prince george": { lat: 53.9171, lng: -122.7497 },
  "kitimat": { lat: 54.0523, lng: -128.7137 },
  "terrace": { lat: 54.5164, lng: -128.5997 },
  "smithers": { lat: 54.7804, lng: -127.1743 },
  "dawson creek": { lat: 55.7596, lng: -120.2353 },
  "grande prairie": { lat: 55.1707, lng: -118.7887 },
  "taylor": { lat: 56.1563, lng: -120.6856 },
  "chetwynd": { lat: 55.6987, lng: -121.6317 },
  "tumbler ridge": { lat: 55.1264, lng: -121.0000 },
  "hudson's hope": { lat: 56.0311, lng: -121.9072 },
  "british columbia": { lat: 53.7267, lng: -127.6476 },
  "bc": { lat: 53.7267, lng: -127.6476 },
  "alberta": { lat: 53.9333, lng: -116.5765 },
  "kuala lumpur": { lat: 3.1390, lng: 101.6869 },
  "malaysia": { lat: 4.2105, lng: 101.9758 },
  "petaling jaya": { lat: 3.1073, lng: 101.6067 },
  "singapore": { lat: 1.3521, lng: 103.8198 },
  "london": { lat: 51.5074, lng: -0.1278 },
  "paris": { lat: 48.8566, lng: 2.3522 },
  "berlin": { lat: 52.5200, lng: 13.4050 },
  "dubai": { lat: 25.2048, lng: 55.2708 },
  "abu dhabi": { lat: 24.4539, lng: 54.3773 },
  "new york": { lat: 40.7128, lng: -74.0060 },
  "los angeles": { lat: 34.0522, lng: -118.2437 },
  "chicago": { lat: 41.8781, lng: -87.6298 },
  "houston": { lat: 29.7604, lng: -95.3698 },
  "san francisco": { lat: 37.7749, lng: -122.4194 },
  "seattle": { lat: 47.6062, lng: -122.3321 },
  "tokyo": { lat: 35.6762, lng: 139.6503 },
  "hong kong": { lat: 22.3193, lng: 114.1694 },
  "beijing": { lat: 39.9042, lng: 116.4074 },
  "shanghai": { lat: 31.2304, lng: 121.4737 },
  "sydney": { lat: -33.8688, lng: 151.2093 },
  "melbourne": { lat: -37.8136, lng: 144.9631 },
  "mumbai": { lat: 19.0760, lng: 72.8777 },
  "bangkok": { lat: 13.7563, lng: 100.5018 },
  "tehran": { lat: 35.6892, lng: 51.3890 },
  "moscow": { lat: 55.7558, lng: 37.6173 },
  "sao paulo": { lat: -23.5505, lng: -46.6333 },
  "buenos aires": { lat: -34.6037, lng: -58.3816 },
  "mexico city": { lat: 19.4326, lng: -99.1332 },
  "istanbul": { lat: 41.0082, lng: 28.9784 },
  "lagos": { lat: 6.5244, lng: 3.3792 },
  "nairobi": { lat: -1.2921, lng: 36.8219 },
  "cape town": { lat: -33.9249, lng: 18.4241 },
  "canada": { lat: 56.1304, lng: -106.3468 },
  "usa": { lat: 37.0902, lng: -95.7129 },
};

export function parseLocationCoords(location: string): { lat: number; lng: number } | null {
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

// ═══════════════════════════════════════════════════════════════
// PIN COLORS & LABELS (shared across components)
// ═══════════════════════════════════════════════════════════════

export const PIN_COLORS: Record<GlobeDataType, { normal: string; emissive: string }> = {
  entity: { normal: "#00ffff", emissive: "#00ffff" },
  signal: { normal: "#ffaa00", emissive: "#ffaa00" },
  incident: { normal: "#ff3333", emissive: "#ff3333" },
  cluster: { normal: "#ff00ff", emissive: "#ff00ff" },
  travel: { normal: "#00ff88", emissive: "#00ff88" },
};

export const TYPE_LABELS: Record<GlobeDataType, string> = {
  entity: "Entity",
  signal: "Signal",
  incident: "Incident",
  cluster: "Event Cluster",
  travel: "Travel",
};

// ═══════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════

export function useGodsEyeData(enabled: boolean) {
  const { selectedClientId } = useClientSelection();

  return useQuery({
    queryKey: ['gods-eye-data', selectedClientId],
    queryFn: async () => {
      const allPins: GodsEyePin[] = [];
      const allClusters: GodsEyeCluster[] = [];

      // 1. Entities
      const { data: entities } = await supabase
        .from("entities")
        .select("id, name, type, current_location, risk_level")
        .not("current_location", "is", null)
        .eq("is_active", true);

      entities?.forEach(entity => {
        const coords = parseLocationCoords(entity.current_location!);
        if (coords) {
          allPins.push({
            id: entity.id, name: entity.name, lat: coords.lat, lng: coords.lng,
            type: 'entity', subtype: entity.type, riskLevel: entity.risk_level,
          });
        }
      });

      // 2. Recent signals
      const signalCutoff = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
      const { data: signals } = await supabase
        .from("signals")
        .select("id, title, location, severity, rule_category, received_at, normalized_text")
        .not("location", "is", null)
        .gt("relevance_score", 0.35)
        .gte("received_at", signalCutoff)
        .order("received_at", { ascending: false })
        .limit(200);

      signals?.forEach(sig => {
        const coords = parseLocationCoords(sig.location!);
        if (coords) {
          allPins.push({
            id: sig.id, name: sig.title || 'Signal', lat: coords.lat, lng: coords.lng,
            type: 'signal', subtype: sig.rule_category || undefined,
            riskLevel: sig.severity, timestamp: sig.received_at,
            narrative: (sig.normalized_text || '').substring(0, 150),
          });
        }
      });

      // 3. Incidents
      const { data: incidents } = await supabase
        .from("incidents")
        .select("id, status, priority, opened_at, signal_id")
        .gte("opened_at", signalCutoff)
        .order("opened_at", { ascending: false })
        .limit(50);

      if (incidents?.length) {
        const signalIds = incidents.map(i => i.signal_id).filter(Boolean) as string[];
        if (signalIds.length > 0) {
          const { data: incidentSignals } = await supabase
            .from("signals")
            .select("id, title, location, normalized_text")
            .in("id", signalIds);

          incidents.forEach(inc => {
            const sig = incidentSignals?.find(s => s.id === inc.signal_id);
            if (sig?.location) {
              const coords = parseLocationCoords(sig.location);
              if (coords) {
                allPins.push({
                  id: inc.id, name: sig.title || `Incident ${inc.priority?.toUpperCase()}`,
                  lat: coords.lat, lng: coords.lng, type: 'incident',
                  riskLevel: inc.priority === 'p1' ? 'critical' : inc.priority === 'p2' ? 'high' : 'medium',
                  timestamp: inc.opened_at,
                  narrative: (sig.normalized_text || '').substring(0, 150),
                  metadata: { status: inc.status, priority: inc.priority },
                });
              }
            }
          });
        }
      }

      // 4. Event clusters
      const { data: clusterData } = await supabase
        .from("signal_clusters")
        .select("*")
        .not("centroid_lat", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);

      clusterData?.forEach(c => {
        if (c.centroid_lat && c.centroid_lng) {
          allPins.push({
            id: c.id, name: c.cluster_label, lat: c.centroid_lat, lng: c.centroid_lng,
            type: 'cluster', riskLevel: c.severity || 'medium',
            narrative: c.narrative || undefined,
            signalCount: c.signal_ids?.length || 0,
            metadata: { radiusKm: c.radius_km, eventType: c.event_type },
          });
          allClusters.push({
            id: c.id, label: c.cluster_label,
            lat: c.centroid_lat, lng: c.centroid_lng,
            signalCount: c.signal_ids?.length || 0,
            severity: c.severity || 'medium',
            narrative: c.narrative || '',
            eventType: c.event_type || 'cluster',
            radiusKm: c.radius_km || 0,
            agentAnalysis: c.agent_analysis ? (typeof c.agent_analysis === 'string' ? JSON.parse(c.agent_analysis as string) : c.agent_analysis) : null,
            createdAt: c.created_at,
          });
        }
      });

      // 5. Travel itineraries
      try {
        const { data: travel } = await supabase
          .from("travel_itineraries" as any)
          .select("id, destination, travel_start, travel_end, risk_level, vip_id")
          .gte("travel_end", new Date().toISOString())
          .order("travel_start", { ascending: true })
          .limit(30);

        (travel as any[])?.forEach((t: any) => {
          if (t.destination) {
            const coords = parseLocationCoords(t.destination);
            if (coords) {
              allPins.push({
                id: t.id, name: `Travel: ${t.destination}`, lat: coords.lat, lng: coords.lng,
                type: 'travel', riskLevel: t.risk_level || 'low',
                timestamp: t.travel_start,
              });
            }
          }
        });
      } catch {
        // Travel table may not exist yet
      }

      return { pins: allPins, clusters: allClusters };
    },
    enabled,
    refetchInterval: 120000, // 2 min refresh
    staleTime: 60000,
  });
}
