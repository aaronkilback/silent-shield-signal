import { useEffect, useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, Sphere, Html } from "@react-three/drei";
import * as THREE from "three";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";
import earthTexture from "@/assets/earth-texture.jpg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers, Radio, Shield, AlertTriangle, MapPin, Clock, ChevronRight, Zap } from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

type GlobeDataType = 'entity' | 'signal' | 'incident' | 'cluster' | 'travel';

interface GlobePin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: GlobeDataType;
  riskLevel?: string;
  subtype?: string; // entity type, signal category, etc.
  timestamp?: string;
  narrative?: string;
  signalCount?: number;
  metadata?: Record<string, any>;
}

interface EventCluster {
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

function parseLocationCoords(location: string): { lat: number; lng: number } | null {
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
// 3D HELPERS
// ═══════════════════════════════════════════════════════════════

function latLngToVector3(lat: number, lng: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

const PIN_COLORS: Record<GlobeDataType, { normal: string; emissive: string }> = {
  entity: { normal: "#00ffff", emissive: "#00ffff" },
  signal: { normal: "#ffaa00", emissive: "#ffaa00" },
  incident: { normal: "#ff3333", emissive: "#ff3333" },
  cluster: { normal: "#ff00ff", emissive: "#ff00ff" },
  travel: { normal: "#00ff88", emissive: "#00ff88" },
};

const TYPE_LABELS: Record<GlobeDataType, string> = {
  entity: "Entity",
  signal: "Signal",
  incident: "Incident",
  cluster: "Event Cluster",
  travel: "Travel",
};

// ═══════════════════════════════════════════════════════════════
// 3D COMPONENTS
// ═══════════════════════════════════════════════════════════════

function Starfield() {
  const starsRef = useRef<THREE.Points>(null);
  const starsGeometry = new THREE.BufferGeometry();
  const starCount = 2000;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount * 3; i += 3) {
    const radius = 50 + Math.random() * 50;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    positions[i] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i + 2] = radius * Math.cos(phi);
  }
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return (
    <points ref={starsRef} geometry={starsGeometry}>
      <pointsMaterial size={0.1} color="#ffffff" transparent opacity={0.8} sizeAttenuation />
    </points>
  );
}

function Globe({ children }: { children?: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const texture = useLoader(THREE.TextureLoader, earthTexture);
  useFrame(() => { if (groupRef.current) groupRef.current.rotation.y += 0.0005; });
  return (
    <group ref={groupRef} rotation={[0, -Math.PI / 2, 0]}>
      <Sphere args={[2, 64, 64]}>
        <meshStandardMaterial map={texture} roughness={0.7} metalness={0.1} />
      </Sphere>
      <Sphere args={[2.12, 32, 32]}>
        <meshBasicMaterial color="#88ccff" transparent opacity={0.1} side={THREE.BackSide} />
      </Sphere>
      {children}
    </group>
  );
}

function PulsingRing({ color = "#ef4444", speed = 2 }: { color?: string; speed?: number }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current && ringRef.current.material instanceof THREE.MeshBasicMaterial) {
      const scale = 1 + Math.sin(clock.getElapsedTime() * speed) * 0.5;
      ringRef.current.scale.set(scale, scale, scale);
      ringRef.current.material.opacity = 0.5 - (scale - 1) * 0.5;
    }
  });
  return (
    <Sphere ref={ringRef} args={[0.04, 16, 16]}>
      <meshBasicMaterial color={color} transparent opacity={0.5} />
    </Sphere>
  );
}

function ClusterRing({ radiusKm }: { radiusKm: number }) {
  const ringRef = useRef<THREE.Mesh>(null);
  // Scale ring proportional to cluster radius (cap at visual limit)
  const ringScale = Math.min(0.3, Math.max(0.08, radiusKm / 500));
  useFrame(({ clock }) => {
    if (ringRef.current && ringRef.current.material instanceof THREE.MeshBasicMaterial) {
      const pulse = 1 + Math.sin(clock.getElapsedTime() * 1.5) * 0.15;
      ringRef.current.scale.set(pulse, pulse, pulse);
      ringRef.current.material.opacity = 0.15 + Math.sin(clock.getElapsedTime()) * 0.05;
    }
  });
  return (
    <Sphere ref={ringRef} args={[ringScale, 16, 16]}>
      <meshBasicMaterial color="#ff00ff" transparent opacity={0.2} />
    </Sphere>
  );
}

function LocationPin({ pin, onSelect }: { pin: GlobePin; onSelect: (pin: GlobePin) => void }) {
  const position = latLngToVector3(pin.lat, pin.lng, 2.05);
  const [hovered, setHovered] = useState(false);
  const colors = PIN_COLORS[pin.type] || PIN_COLORS.entity;
  const isHighRisk = pin.riskLevel === 'critical' || pin.riskLevel === 'high';
  const pinSize = pin.type === 'cluster' ? 0.06 : 0.035;

  return (
    <group position={position}>
      <Sphere args={[pinSize, 16, 16]}>
        <meshStandardMaterial
          color={isHighRisk ? "#ff3333" : colors.normal}
          emissive={isHighRisk ? "#ff3333" : colors.emissive}
          emissiveIntensity={pin.type === 'cluster' ? 3 : 2}
        />
      </Sphere>
      {(isHighRisk || pin.type === 'incident') && <PulsingRing color={pin.type === 'incident' ? '#ff3333' : '#ef4444'} />}
      {pin.type === 'cluster' && <ClusterRing radiusKm={pin.metadata?.radiusKm || 50} />}

      {hovered && (
        <Html distanceFactor={8} center>
          <div
            className="bg-card/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 shadow-xl cursor-pointer whitespace-nowrap max-w-[280px]"
            onClick={() => onSelect(pin)}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.normal }} />
              <span className="text-xs font-medium text-muted-foreground">{TYPE_LABELS[pin.type]}</span>
              {pin.signalCount && <span className="text-xs text-muted-foreground">({pin.signalCount} signals)</span>}
            </div>
            <div className="text-sm font-semibold text-foreground truncate">{pin.name}</div>
            {pin.narrative && <div className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-normal">{pin.narrative}</div>}
            {pin.riskLevel && (
              <div className={`text-xs font-medium mt-1 ${isHighRisk ? 'text-destructive' : 'text-primary'}`}>
                Risk: {pin.riskLevel}
              </div>
            )}
          </div>
        </Html>
      )}

      <Sphere
        args={[0.1, 16, 16]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={() => onSelect(pin)}
      >
        <meshBasicMaterial transparent opacity={0} />
      </Sphere>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export const ThreatGlobe = () => {
  const [pins, setPins] = useState<GlobePin[]>([]);
  const [clusters, setClusters] = useState<EventCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPin, setSelectedPin] = useState<GlobePin | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<GlobeDataType>>(new Set(['entity', 'signal', 'incident', 'cluster']));
  const { selectedClientId } = useClientSelection();

  const toggleFilter = useCallback((type: GlobeDataType) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  useEffect(() => {
    loadAllData();
  }, [selectedClientId]);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const allPins: GlobePin[] = [];

      // 1. Entities (existing behavior)
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

      // 2. Recent signals with locations
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

      // 3. Recent incidents (via their linked signals' locations)
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

      // 4. Event clusters (from signal_clusters with geo data)
      const { data: clusterData } = await supabase
        .from("signal_clusters")
        .select("*")
        .not("centroid_lat", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);

      const loadedClusters: EventCluster[] = [];
      clusterData?.forEach(c => {
        if (c.centroid_lat && c.centroid_lng) {
          allPins.push({
            id: c.id, name: c.cluster_label, lat: c.centroid_lat, lng: c.centroid_lng,
            type: 'cluster', riskLevel: c.severity || 'medium',
            narrative: c.narrative || undefined,
            signalCount: c.signal_ids?.length || 0,
            metadata: { radiusKm: c.radius_km, eventType: c.event_type },
          });
          loadedClusters.push({
            id: c.id, label: c.cluster_label,
            lat: c.centroid_lat, lng: c.centroid_lng,
            signalCount: c.signal_ids?.length || 0,
            severity: c.severity || 'medium',
            narrative: c.narrative || '',
            eventType: c.event_type || 'cluster',
            radiusKm: c.radius_km || 0,
            agentAnalysis: c.agent_analysis ? (typeof c.agent_analysis === 'string' ? JSON.parse(c.agent_analysis) : c.agent_analysis) : null,
            createdAt: c.created_at,
          });
        }
      });

      // 5. Travel itineraries (if table exists)
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

      setPins(allPins);
      setClusters(loadedClusters);
    } catch (error) {
      console.error("Error loading globe data:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredPins = pins.filter(p => activeFilters.has(p.type));

  const filterCounts = {
    entity: pins.filter(p => p.type === 'entity').length,
    signal: pins.filter(p => p.type === 'signal').length,
    incident: pins.filter(p => p.type === 'incident').length,
    cluster: pins.filter(p => p.type === 'cluster').length,
    travel: pins.filter(p => p.type === 'travel').length,
  };

  const severityColor = (level?: string) => {
    switch (level) {
      case 'critical': return 'text-red-400';
      case 'high': return 'text-orange-400';
      case 'medium': return 'text-yellow-400';
      default: return 'text-green-400';
    }
  };

  if (loading) {
    return (
      <div className="w-full h-[600px] bg-card rounded-lg border border-border flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Radio className="h-5 w-5 animate-pulse" />
          <span>Loading God's Eye View...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[600px] bg-gradient-to-b from-background to-card rounded-lg border border-border overflow-hidden relative">
      {/* Layer filter controls */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        {([
          { type: 'entity' as GlobeDataType, icon: Shield, label: 'Entities' },
          { type: 'signal' as GlobeDataType, icon: Radio, label: 'Signals' },
          { type: 'incident' as GlobeDataType, icon: AlertTriangle, label: 'Incidents' },
          { type: 'cluster' as GlobeDataType, icon: Zap, label: 'Events' },
          { type: 'travel' as GlobeDataType, icon: MapPin, label: 'Travel' },
        ]).map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            onClick={() => toggleFilter(type)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all
              ${activeFilters.has(type)
                ? 'bg-card/90 border border-border text-foreground shadow-sm'
                : 'bg-card/40 border border-transparent text-muted-foreground/50 hover:text-muted-foreground'
              }`}
          >
            <div className="w-2 h-2 rounded-full" style={{
              backgroundColor: activeFilters.has(type) ? PIN_COLORS[type].normal : '#555',
            }} />
            <Icon className="h-3 w-3" />
            <span>{label}</span>
            <span className="ml-auto text-muted-foreground">{filterCounts[type]}</span>
          </button>
        ))}
      </div>

      {/* Stats badge */}
      <div className="absolute top-3 right-3 z-10">
        <div className="bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-foreground font-semibold mb-1">
            <Layers className="h-3.5 w-3.5 text-primary" />
            God's Eye View
          </div>
          <div className="text-muted-foreground">
            {filteredPins.length} markers • {clusters.length} event clusters
          </div>
        </div>
      </div>

      {/* Event cluster sidebar */}
      {clusters.length > 0 && (
        <div className="absolute bottom-3 right-3 z-10 w-[260px]">
          <div className="bg-card/90 backdrop-blur-sm border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-purple-400" />
              <span className="text-xs font-semibold text-foreground">MERIDIAN Event Clusters</span>
            </div>
            <ScrollArea className="max-h-[200px]">
              {clusters.slice(0, 5).map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedPin(pins.find(p => p.id === c.id) || null)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b border-border/50 last:border-0 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      c.severity === 'critical' ? 'bg-red-500' : c.severity === 'high' ? 'bg-orange-500' : 'bg-yellow-500'
                    }`} />
                    <span className="text-xs font-medium text-foreground truncate flex-1">{c.label}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1 pl-3.5">
                    {c.signalCount} signals • {c.eventType}
                  </div>
                </button>
              ))}
            </ScrollArea>
          </div>
        </div>
      )}

      {/* Detail panel for selected pin */}
      {selectedPin && (
        <div className="absolute bottom-3 left-3 z-10 w-[300px] bg-card/95 backdrop-blur-sm border border-border rounded-lg overflow-hidden shadow-2xl">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIN_COLORS[selectedPin.type].normal }} />
              <span className="text-xs font-medium text-muted-foreground">{TYPE_LABELS[selectedPin.type]}</span>
              <Badge variant="outline" className={`text-[10px] ${severityColor(selectedPin.riskLevel)}`}>
                {selectedPin.riskLevel || 'low'}
              </Badge>
            </div>
            <button onClick={() => setSelectedPin(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          <div className="px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground mb-1">{selectedPin.name}</h3>
            {selectedPin.signalCount && (
              <div className="text-xs text-muted-foreground mb-2">{selectedPin.signalCount} correlated signals</div>
            )}
            {selectedPin.narrative && (
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">{selectedPin.narrative}</p>
            )}
            {selectedPin.timestamp && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {new Date(selectedPin.timestamp).toLocaleString()}
              </div>
            )}
            {/* Show MERIDIAN analysis for clusters */}
            {selectedPin.type === 'cluster' && (() => {
              const cluster = clusters.find(c => c.id === selectedPin.id);
              if (!cluster?.agentAnalysis) return null;
              const analysis = cluster.agentAnalysis;
              return (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-2 h-2 rounded-full bg-purple-400" />
                    <span className="text-[10px] font-semibold text-purple-400">MERIDIAN ANALYSIS</span>
                  </div>
                  {analysis.regional_context && (
                    <p className="text-xs text-muted-foreground mb-2">{analysis.regional_context}</p>
                  )}
                  {analysis.cascading_risks?.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-medium text-foreground">Cascading Risks:</span>
                      {analysis.cascading_risks.map((r: string, i: number) => (
                        <div key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                          <span className="text-orange-400 mt-0.5">▸</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 3, 5]} intensity={1.2} />
        <pointLight position={[-5, -5, -5]} intensity={0.3} color="#4a9eff" />
        <Starfield />
        <Globe>
          {filteredPins.map(pin => (
            <LocationPin key={pin.id} pin={pin} onSelect={setSelectedPin} />
          ))}
        </Globe>
        <OrbitControls
          enableZoom
          enablePan={false}
          minDistance={3}
          maxDistance={10}
          autoRotate
          autoRotateSpeed={0.2}
        />
      </Canvas>

      {filteredPins.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-card/80 backdrop-blur-sm border border-border rounded-lg px-6 py-4">
            <p className="text-muted-foreground text-sm">No intelligence markers for current filters</p>
          </div>
        </div>
      )}
    </div>
  );
};
