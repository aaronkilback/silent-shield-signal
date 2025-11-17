import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Sphere, Html } from "@react-three/drei";
import * as THREE from "three";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";

interface ClientLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  incidentCount: number;
}

// Convert lat/lng to 3D coordinates on sphere
function latLngToVector3(lat: number, lng: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);

  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function Globe() {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.001;
    }
  });

  return (
    <Sphere ref={meshRef} args={[2, 64, 64]}>
      <meshStandardMaterial
        color="#0a1929"
        emissive="#0a4a6e"
        emissiveIntensity={0.3}
        roughness={0.8}
        metalness={0.2}
      />
    </Sphere>
  );
}

function Atmosphere() {
  return (
    <Sphere args={[2.1, 64, 64]}>
      <meshBasicMaterial
        color="#00d9ff"
        transparent
        opacity={0.1}
        side={THREE.BackSide}
      />
    </Sphere>
  );
}

function LocationPin({ location }: { location: ClientLocation }) {
  const position = latLngToVector3(location.lat, location.lng, 2.05);
  const [hovered, setHovered] = useState(false);

  return (
    <group position={position}>
      <Sphere args={[0.02, 16, 16]}>
        <meshStandardMaterial
          color={location.incidentCount > 0 ? "#ef4444" : "#00d9ff"}
          emissive={location.incidentCount > 0 ? "#ef4444" : "#00d9ff"}
          emissiveIntensity={location.incidentCount > 0 ? 1 : 0.5}
        />
      </Sphere>
      
      {location.incidentCount > 0 && <PulsingRing />}
      
      {hovered && (
        <Html distanceFactor={10}>
          <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg pointer-events-none whitespace-nowrap">
            <div className="text-sm font-semibold text-foreground">{location.name}</div>
            {location.incidentCount > 0 && (
              <div className="text-xs text-destructive">
                {location.incidentCount} active incident{location.incidentCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </Html>
      )}
      
      <Sphere
        args={[0.05, 16, 16]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <meshBasicMaterial transparent opacity={0} />
      </Sphere>
    </group>
  );
}

function PulsingRing() {
  const ringRef = useRef<THREE.Mesh>(null);
  
  useFrame(({ clock }) => {
    if (ringRef.current && ringRef.current.material instanceof THREE.MeshBasicMaterial) {
      const scale = 1 + Math.sin(clock.getElapsedTime() * 2) * 0.5;
      ringRef.current.scale.set(scale, scale, scale);
      ringRef.current.material.opacity = 0.5 - (scale - 1) * 0.5;
    }
  });

  return (
    <Sphere ref={ringRef} args={[0.04, 16, 16]}>
      <meshBasicMaterial
        color="#ef4444"
        transparent
        opacity={0.5}
      />
    </Sphere>
  );
}

export const ThreatGlobe = () => {
  const [locations, setLocations] = useState<ClientLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedClientId } = useClientSelection();

  useEffect(() => {
    loadLocations();
  }, [selectedClientId]);

  const loadLocations = async () => {
    try {
      setLoading(true);

      // Fetch clients with their locations
      let clientsQuery = supabase
        .from("clients")
        .select("id, name, locations")
        .eq("status", "active");

      if (selectedClientId) {
        clientsQuery = clientsQuery.eq("id", selectedClientId);
      }

      const { data: clients, error: clientsError } = await clientsQuery;

      if (clientsError) throw clientsError;

      // Fetch incident counts per client
      const { data: incidents, error: incidentsError } = await supabase
        .from("incidents")
        .select("client_id")
        .in("status", ["open", "acknowledged", "contained"]);

      if (incidentsError) throw incidentsError;

      const incidentCounts = incidents?.reduce((acc, inc) => {
        acc[inc.client_id] = (acc[inc.client_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      // Parse locations and create pins
      const locationPins: ClientLocation[] = [];
      
      clients?.forEach((client) => {
        if (client.locations && Array.isArray(client.locations)) {
          client.locations.forEach((location: string) => {
            // Try to parse coordinates from location strings
            // Expected format: "City, Country (lat,lng)" or just use defaults
            const coords = parseLocationCoords(location);
            if (coords) {
              locationPins.push({
                id: `${client.id}-${location}`,
                name: `${client.name} - ${location}`,
                lat: coords.lat,
                lng: coords.lng,
                incidentCount: incidentCounts[client.id] || 0,
              });
            }
          });
        }
      });

      setLocations(locationPins);
    } catch (error) {
      console.error("Error loading locations:", error);
    } finally {
      setLoading(false);
    }
  };

  const parseLocationCoords = (location: string): { lat: number; lng: number } | null => {
    // Simple geocoding fallback for common locations
    const geoMap: Record<string, { lat: number; lng: number }> = {
      "kuala lumpur": { lat: 3.1390, lng: 101.6869 },
      "malaysia": { lat: 4.2105, lng: 101.9758 },
      "singapore": { lat: 1.3521, lng: 103.8198 },
      "petaling jaya": { lat: 3.1073, lng: 101.6067 },
      "austin": { lat: 30.2672, lng: -97.7431 },
      "texas": { lat: 31.9686, lng: -99.9018 },
      "usa": { lat: 37.0902, lng: -95.7129 },
      "new york": { lat: 40.7128, lng: -74.0060 },
      "london": { lat: 51.5074, lng: -0.1278 },
      "tokyo": { lat: 35.6762, lng: 139.6503 },
    };

    const normalized = location.toLowerCase().trim();
    
    // Check for exact matches or partial matches
    for (const [key, coords] of Object.entries(geoMap)) {
      if (normalized.includes(key)) {
        return coords;
      }
    }

    return null;
  };

  if (loading) {
    return (
      <div className="w-full h-[500px] bg-card rounded-lg border border-border flex items-center justify-center">
        <div className="text-muted-foreground">Loading global threat map...</div>
      </div>
    );
  }

  return (
    <div className="w-full h-[500px] bg-gradient-to-b from-background to-card rounded-lg border border-border overflow-hidden">
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <pointLight position={[-5, -5, -5]} intensity={0.3} color="#00d9ff" />
        
        <Globe />
        <Atmosphere />
        
        {locations.map((location) => (
          <LocationPin key={location.id} location={location} />
        ))}
        
        <OrbitControls
          enableZoom={true}
          enablePan={false}
          minDistance={3}
          maxDistance={10}
          autoRotate
          autoRotateSpeed={0.5}
        />
      </Canvas>
      
      {locations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-card/80 backdrop-blur-sm border border-border rounded-lg px-6 py-4">
            <p className="text-muted-foreground text-sm">
              No client locations configured yet
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
