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
      <pointsMaterial
        size={0.1}
        color="#ffffff"
        transparent
        opacity={0.8}
        sizeAttenuation={true}
      />
    </points>
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
    <group>
      {/* Ocean base - realistic ocean blue */}
      <Sphere ref={meshRef} args={[2, 64, 64]}>
        <meshStandardMaterial
          color="#1a4d7a"
          roughness={0.6}
          metalness={0.4}
        />
      </Sphere>
      
      {/* Land masses - creating continents with overlapping spheres */}
      {/* North America */}
      <Sphere args={[0.5, 32, 32]} position={[-0.8, 0.6, 1.7]}>
        <meshStandardMaterial
          color="#3a7d44"
          roughness={0.9}
        />
      </Sphere>
      
      {/* South America */}
      <Sphere args={[0.4, 32, 32]} position={[-0.5, -0.8, 1.8]}>
        <meshStandardMaterial
          color="#3a7d44"
          roughness={0.9}
        />
      </Sphere>
      
      {/* Europe/Africa */}
      <Sphere args={[0.6, 32, 32]} position={[0.3, 0.3, 1.8]}>
        <meshStandardMaterial
          color="#4a8d54"
          roughness={0.9}
        />
      </Sphere>
      
      {/* Africa lower */}
      <Sphere args={[0.5, 32, 32]} position={[0.4, -0.5, 1.8]}>
        <meshStandardMaterial
          color="#4a8d54"
          roughness={0.9}
        />
      </Sphere>
      
      {/* Asia */}
      <Sphere args={[0.7, 32, 32]} position={[1.2, 0.5, 1.2]}>
        <meshStandardMaterial
          color="#3a7d44"
          roughness={0.9}
        />
      </Sphere>
      
      {/* Australia */}
      <Sphere args={[0.3, 32, 32]} position={[1.3, -0.8, 1.0]}>
        <meshStandardMaterial
          color="#4a8d54"
          roughness={0.9}
        />
      </Sphere>
      
      {/* Atmospheric glow */}
      <Sphere args={[2.15, 32, 32]}>
        <meshBasicMaterial
          color="#4a9eff"
          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </Sphere>
    </group>
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
      {/* Larger, brighter pin */}
      <Sphere args={[0.04, 16, 16]}>
        <meshStandardMaterial
          color={location.incidentCount > 0 ? "#ff3333" : "#00ffff"}
          emissive={location.incidentCount > 0 ? "#ff3333" : "#00ffff"}
          emissiveIntensity={2}
        />
      </Sphere>
      
      {location.incidentCount > 0 && <PulsingRing />}
      
      {/* Only show label on hover */}
      {hovered && (
        <Html distanceFactor={8} center>
          <div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 shadow-xl pointer-events-none whitespace-nowrap">
            <div className="text-sm font-semibold text-foreground">{location.name}</div>
            {location.incidentCount > 0 && (
              <div className="text-xs text-destructive font-medium">
                {location.incidentCount} active incident{location.incidentCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </Html>
      )}
      
      <Sphere
        args={[0.08, 16, 16]}
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
    // Comprehensive geocoding map for common locations
    const geoMap: Record<string, { lat: number; lng: number }> = {
      // North America
      "calgary": { lat: 51.0447, lng: -114.0719 },
      "alberta": { lat: 53.9333, lng: -116.5765 },
      "vancouver": { lat: 49.2827, lng: -123.1207 },
      "toronto": { lat: 43.6532, lng: -79.3832 },
      "montreal": { lat: 45.5017, lng: -73.5673 },
      "ottawa": { lat: 45.4215, lng: -75.6972 },
      "san francisco": { lat: 37.7749, lng: -122.4194 },
      "los angeles": { lat: 34.0522, lng: -118.2437 },
      "new york": { lat: 40.7128, lng: -74.0060 },
      "chicago": { lat: 41.8781, lng: -87.6298 },
      "austin": { lat: 30.2672, lng: -97.7431 },
      "seattle": { lat: 47.6062, lng: -122.3321 },
      "boston": { lat: 42.3601, lng: -71.0589 },
      "miami": { lat: 25.7617, lng: -80.1918 },
      "dallas": { lat: 32.7767, lng: -96.7970 },
      "texas": { lat: 31.9686, lng: -99.9018 },
      "california": { lat: 36.7783, lng: -119.4179 },
      "canada": { lat: 56.1304, lng: -106.3468 },
      "usa": { lat: 37.0902, lng: -95.7129 },
      
      // Asia Pacific
      "kuala lumpur": { lat: 3.1390, lng: 101.6869 },
      "malaysia": { lat: 4.2105, lng: 101.9758 },
      "singapore": { lat: 1.3521, lng: 103.8198 },
      "petaling jaya": { lat: 3.1073, lng: 101.6067 },
      "tokyo": { lat: 35.6762, lng: 139.6503 },
      "hong kong": { lat: 22.3193, lng: 114.1694 },
      "shanghai": { lat: 31.2304, lng: 121.4737 },
      "beijing": { lat: 39.9042, lng: 116.4074 },
      "sydney": { lat: -33.8688, lng: 151.2093 },
      "melbourne": { lat: -37.8136, lng: 144.9631 },
      "bangkok": { lat: 13.7563, lng: 100.5018 },
      "manila": { lat: 14.5995, lng: 120.9842 },
      
      // Europe
      "london": { lat: 51.5074, lng: -0.1278 },
      "paris": { lat: 48.8566, lng: 2.3522 },
      "berlin": { lat: 52.5200, lng: 13.4050 },
      "amsterdam": { lat: 52.3676, lng: 4.9041 },
      "dublin": { lat: 53.3498, lng: -6.2603 },
      "madrid": { lat: 40.4168, lng: -3.7038 },
      "rome": { lat: 41.9028, lng: 12.4964 },
      "zurich": { lat: 47.3769, lng: 8.5417 },
      
      // Middle East
      "dubai": { lat: 25.2048, lng: 55.2708 },
      "abu dhabi": { lat: 24.4539, lng: 54.3773 },
      
      // South America
      "sao paulo": { lat: -23.5505, lng: -46.6333 },
      "buenos aires": { lat: -34.6037, lng: -58.3816 },
    };

    const normalized = location.toLowerCase().trim();
    
    // Check for exact matches or partial matches
    for (const [key, coords] of Object.entries(geoMap)) {
      if (normalized.includes(key)) {
        return coords;
      }
    }

    // If no match found, log for debugging
    console.log(`No coordinates found for location: "${location}"`);
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
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 3, 5]} intensity={1.2} />
        <pointLight position={[-5, -5, -5]} intensity={0.3} color="#4a9eff" />
        
        <Starfield />
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
          autoRotateSpeed={0.3}
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
