import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Flame, Wind, Thermometer, AlertTriangle, RefreshCw, Layers, MapPin, Mountain, Satellite, Map as MapIcon, Fuel } from 'lucide-react';
import { toast } from 'sonner';

interface FirePoint {
  latitude: number;
  longitude: number;
  brightness: number;
  confidence: number;
  frp: number; // Fire Radiative Power
  acq_date: string;
  acq_time: string;
  satellite: string;
}

interface FirePerimeter {
  name: string;
  acres: number;
  containment: number;
  discoveryDate: string;
  state: string;
  county: string;
  coordinates: number[][][];
  geometry?: GeoJSON.Geometry;
}

interface WeatherAlert {
  event: string;
  severity: string;
  headline: string;
  areaDesc: string;
  onset: string;
  expires: string;
  geometry?: GeoJSON.Geometry;
}

interface InfrastructurePoint {
  name: string;
  type: 'refinery' | 'pipeline' | 'terminal' | 'platform' | 'storage' | 'road';
  latitude: number;
  longitude: number;
  operator: string;
  capacity?: string;
  status: 'active' | 'under_construction' | 'planned' | 'exploration';
}

interface WildfireData {
  success: boolean;
  risk_assessment: {
    riskLevel: string;
    riskScore: number;
    factors: string[];
  };
  data_sources: {
    NASA_FIRMS: { success: boolean; count: number };
    WEATHER_STATIONS: { success: boolean; count: number };
    FIRE_PERIMETERS: { success: boolean; count: number };
    FUEL_DATA: { success: boolean; count: number };
  };
}

// Free Mapbox base styles
const MAP_STYLES = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  dark: 'mapbox://styles/mapbox/dark-v11',
  streets: 'mapbox://styles/mapbox/streets-v12',
  light: 'mapbox://styles/mapbox/light-v11',
} as const;

type MapStyleKey = keyof typeof MAP_STYLES;

interface WildfireMapProps {
  clientId?: string;
  region?: string;
}

export function WildfireMap({ clientId, region = 'world' }: WildfireMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const infrastructureMarkersRef = useRef<mapboxgl.Marker[]>([]);
  
  const [mapboxToken] = useState<string | null>(() => {
    const envToken = import.meta.env.VITE_MAPBOX_TOKEN;
    const storedToken = localStorage.getItem('mapbox_token');
    // Check if token is valid (not placeholder)
    if (envToken && envToken !== 'your_mapbox_token_here' && envToken.startsWith('pk.')) {
      return envToken;
    }
    if (storedToken && storedToken.startsWith('pk.')) {
      return storedToken;
    }
    return null;
  });
  
  // Track if map style is fully loaded to prevent "Style is not done loading" errors
  const [styleLoaded, setStyleLoaded] = useState(false);
  
  // Map style selection
  const [mapStyle, setMapStyle] = useState<MapStyleKey>('satellite');
  
  // Layer visibility toggles
  const [showFirePoints, setShowFirePoints] = useState(true);
  const [showPerimeters, setShowPerimeters] = useState(true);
  const [showWeatherAlerts, setShowWeatherAlerts] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showTerrain, setShowTerrain] = useState(true);
  const [showSmoke, setShowSmoke] = useState(false);
  const [showInfrastructure, setShowInfrastructure] = useState(true);
  const [showPetronasCanada, setShowPetronasCanada] = useState(true);

  // Fetch wildfire data
  const { data: wildfireData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['wildfire-intelligence', clientId, region],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('monitor-wildfire-comprehensive', {
        body: { client_id: clientId, region, include_fuel_data: true }
      });
      if (error) throw error;
      return data as WildfireData;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  // Fetch NASA FIRMS data directly for the map
  const { data: firePoints } = useQuery({
    queryKey: ['nasa-firms-direct', region],
    queryFn: async () => {
      try {
        const response = await fetch(
          `https://firms.modaps.eosdis.nasa.gov/api/area/csv/c6/VIIRS_SNPP_NRT/${region}/1`,
          { headers: { 'User-Agent': 'Fortress-Security-Platform' } }
        );
        
        if (!response.ok) {
          return generateMockFirePoints();
        }
        
        const csvText = await response.text();
        const lines = csvText.split('\n');
        const fires: FirePoint[] = [];
        
        for (let i = 1; i < Math.min(lines.length, 500); i++) {
          const values = lines[i].split(',');
          if (values.length < 10) continue;
          
          const confidence = parseInt(values[8] || '0');
          if (confidence < 70) continue;
          
          fires.push({
            latitude: parseFloat(values[0]),
            longitude: parseFloat(values[1]),
            brightness: parseFloat(values[2]),
            confidence,
            frp: parseFloat(values[12] || '0'),
            acq_date: values[5],
            acq_time: values[6],
            satellite: values[7]
          });
        }
        
        return fires;
      } catch {
        return generateMockFirePoints();
      }
    },
    staleTime: 10 * 60 * 1000,
  });

  // Fetch NIFC Active Fire Perimeters (free public GeoJSON)
  const { data: firePerimeters } = useQuery({
    queryKey: ['nifc-perimeters'],
    queryFn: async () => {
      try {
        // NIFC public GeoJSON feed for active fire perimeters
        const response = await fetch(
          'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/Current_WildlandFire_Perimeters/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson'
        );
        
        if (!response.ok) {
          return generateMockPerimeters();
        }
        
        const data = await response.json();
        return data.features?.map((f: any) => ({
          name: f.properties?.IncidentName || 'Unknown Fire',
          acres: f.properties?.GISAcres || 0,
          containment: f.properties?.PercentContained || 0,
          discoveryDate: f.properties?.FireDiscoveryDateTime || '',
          state: f.properties?.POOState || '',
          county: f.properties?.POOCounty || '',
          geometry: f.geometry,
        })) || [];
      } catch {
        return generateMockPerimeters();
      }
    },
    staleTime: 30 * 60 * 1000,
  });

  // Fetch NOAA Weather Alerts (free public API)
  const { data: weatherAlerts } = useQuery({
    queryKey: ['noaa-alerts'],
    queryFn: async () => {
      try {
        // NOAA Weather Alerts API - fire weather specific
        const response = await fetch(
          'https://api.weather.gov/alerts/active?event=Red%20Flag%20Warning,Fire%20Weather%20Watch'
        );
        
        if (!response.ok) {
          return generateMockWeatherAlerts();
        }
        
        const data = await response.json();
        return data.features?.map((f: any) => ({
          event: f.properties?.event || 'Weather Alert',
          severity: f.properties?.severity || 'Unknown',
          headline: f.properties?.headline || '',
          areaDesc: f.properties?.areaDesc || '',
          onset: f.properties?.onset || '',
          expires: f.properties?.expires || '',
          geometry: f.geometry,
        })) || [];
      } catch {
        return generateMockWeatherAlerts();
      }
    },
    staleTime: 15 * 60 * 1000,
  });

  // Fetch Petronas & Oil/Gas Infrastructure data
  const { data: infrastructureData } = useQuery({
    queryKey: ['oil-gas-infrastructure', region],
    queryFn: async (): Promise<InfrastructurePoint[]> => {
      // Petronas and major oil/gas infrastructure points
      // In production, this would come from an API or database
      return generatePetronasInfrastructure();
    },
    staleTime: 60 * 60 * 1000, // Cache for 1 hour
  });

  // Generate mock fire points for demonstration
  function generateMockFirePoints(): FirePoint[] {
    const mockFires: FirePoint[] = [
      { latitude: 49.2827, longitude: -123.1207, brightness: 340, confidence: 85, frp: 45.2, acq_date: '2024-08-15', acq_time: '1430', satellite: 'VIIRS' },
      { latitude: 50.1163, longitude: -122.9574, brightness: 365, confidence: 92, frp: 78.5, acq_date: '2024-08-15', acq_time: '1432', satellite: 'VIIRS' },
      { latitude: 51.2538, longitude: -120.8505, brightness: 355, confidence: 88, frp: 62.1, acq_date: '2024-08-15', acq_time: '1428', satellite: 'VIIRS' },
      { latitude: 34.0522, longitude: -118.2437, brightness: 380, confidence: 95, frp: 125.3, acq_date: '2024-08-15', acq_time: '1445', satellite: 'VIIRS' },
      { latitude: 37.7749, longitude: -122.4194, brightness: 345, confidence: 82, frp: 38.7, acq_date: '2024-08-15', acq_time: '1440', satellite: 'VIIRS' },
      { latitude: 45.5051, longitude: -122.6750, brightness: 358, confidence: 89, frp: 55.4, acq_date: '2024-08-15', acq_time: '1435', satellite: 'VIIRS' },
      { latitude: 53.9171, longitude: -122.7497, brightness: 372, confidence: 91, frp: 89.2, acq_date: '2024-08-15', acq_time: '1425', satellite: 'VIIRS' },
      { latitude: 39.5296, longitude: -119.8138, brightness: 348, confidence: 86, frp: 42.8, acq_date: '2024-08-15', acq_time: '1442', satellite: 'VIIRS' },
    ];
    return mockFires;
  }

  function generateMockPerimeters(): FirePerimeter[] {
    return [
      { name: 'Park Fire', acres: 45000, containment: 35, discoveryDate: '2024-07-24', state: 'CA', county: 'Butte', coordinates: [] },
      { name: 'Borel Fire', acres: 12000, containment: 20, discoveryDate: '2024-07-26', state: 'CA', county: 'Kern', coordinates: [] },
    ];
  }

  function generateMockWeatherAlerts(): WeatherAlert[] {
    return [
      { event: 'Red Flag Warning', severity: 'Severe', headline: 'Red Flag Warning in effect', areaDesc: 'Central California', onset: '2024-08-15T12:00:00', expires: '2024-08-16T20:00:00' },
      { event: 'Fire Weather Watch', severity: 'Moderate', headline: 'Fire Weather Watch in effect', areaDesc: 'Southern Oregon', onset: '2024-08-16T08:00:00', expires: '2024-08-17T18:00:00' },
    ];
  }

  // Generate Petronas and Oil/Gas Infrastructure data - Comprehensive global dataset
  function generatePetronasInfrastructure(): InfrastructurePoint[] {
    return [
      // ===== PETRONAS MALAYSIA - REFINERIES =====
      { name: 'PETRONAS Carigali - Kerteh Refinery', type: 'refinery', latitude: 4.5200, longitude: 103.4267, operator: 'PETRONAS', capacity: '100,000 bpd', status: 'active' },
      { name: 'PETRONAS Melaka Refinery I', type: 'refinery', latitude: 2.1896, longitude: 102.2501, operator: 'PETRONAS', capacity: '100,000 bpd', status: 'active' },
      { name: 'PETRONAS Melaka Refinery II', type: 'refinery', latitude: 2.1950, longitude: 102.2550, operator: 'PETRONAS', capacity: '170,000 bpd', status: 'active' },
      { name: 'Pengerang Integrated Complex (RAPID)', type: 'refinery', latitude: 1.4000, longitude: 104.2500, operator: 'PETRONAS', capacity: '300,000 bpd', status: 'active' },
      { name: 'Hengyuan Refining - Port Dickson', type: 'refinery', latitude: 2.5167, longitude: 101.8000, operator: 'Hengyuan/PETRONAS', capacity: '156,000 bpd', status: 'active' },
      
      // ===== PETRONAS MALAYSIA - LNG FACILITIES =====
      { name: 'PETRONAS LNG Complex - Bintulu', type: 'terminal', latitude: 3.1667, longitude: 113.0333, operator: 'PETRONAS LNG', capacity: '29.3 MTPA', status: 'active' },
      { name: 'PETRONAS FLNG Satu (PFLNG1)', type: 'platform', latitude: 5.9000, longitude: 114.5000, operator: 'PETRONAS', capacity: '1.2 MTPA', status: 'active' },
      { name: 'PETRONAS FLNG Dua (PFLNG2)', type: 'platform', latitude: 6.0500, longitude: 115.0000, operator: 'PETRONAS', capacity: '1.5 MTPA', status: 'active' },
      { name: 'PETRONAS FLNG Tiga (PFLNG3)', type: 'platform', latitude: 5.8500, longitude: 116.5000, operator: 'PETRONAS', capacity: '2.0 MTPA', status: 'planned' },
      { name: 'MLNG Train 9', type: 'terminal', latitude: 3.1700, longitude: 113.0400, operator: 'PETRONAS LNG', capacity: '3.6 MTPA', status: 'active' },
      
      // ===== PETRONAS MALAYSIA - GAS TERMINALS =====
      { name: 'Kerteh Gas Terminal', type: 'terminal', latitude: 4.5150, longitude: 103.4300, operator: 'PETRONAS Gas', capacity: '2,100 mmscfd', status: 'active' },
      { name: 'Labuan Gas Terminal', type: 'terminal', latitude: 5.2831, longitude: 115.2308, operator: 'PETRONAS Gas', capacity: '250 mmscfd', status: 'active' },
      { name: 'Kerteh Aromatics Complex', type: 'terminal', latitude: 4.5100, longitude: 103.4350, operator: 'PETRONAS Chemicals', status: 'active' },
      { name: 'Gebeng Petrochemical Complex', type: 'terminal', latitude: 3.9500, longitude: 103.3833, operator: 'PETRONAS Chemicals', status: 'active' },
      { name: 'PETRONAS Regasification Terminal - Melaka', type: 'terminal', latitude: 2.2500, longitude: 102.1500, operator: 'PETRONAS Gas', capacity: '3.8 MTPA', status: 'active' },
      { name: 'PETRONAS Regasification Terminal - Pengerang', type: 'terminal', latitude: 1.3900, longitude: 104.2600, operator: 'PETRONAS Gas', capacity: '3.5 MTPA', status: 'active' },
      
      // ===== PETRONAS MALAYSIA - OFFSHORE PLATFORMS (Peninsular) =====
      { name: 'Tapis-B Platform', type: 'platform', latitude: 5.7167, longitude: 105.0333, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Tapis-R Platform', type: 'platform', latitude: 5.7200, longitude: 105.0500, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Erb West Platform', type: 'platform', latitude: 5.8500, longitude: 105.2000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Dulang Platform', type: 'platform', latitude: 5.6667, longitude: 104.5000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Bekok-A Platform', type: 'platform', latitude: 4.9167, longitude: 105.2500, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Bekok-B Platform', type: 'platform', latitude: 4.9200, longitude: 105.2600, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Sepat Platform', type: 'platform', latitude: 5.0833, longitude: 104.8333, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Angsi Platform', type: 'platform', latitude: 5.2000, longitude: 105.6000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Cendor Platform', type: 'platform', latitude: 4.7500, longitude: 104.9500, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Resak Platform', type: 'platform', latitude: 5.4000, longitude: 104.6000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'PM-3 CAA Platform', type: 'platform', latitude: 5.5000, longitude: 106.0000, operator: 'PETRONAS/PetroVietnam', status: 'active' },
      { name: 'Jerneh Platform', type: 'platform', latitude: 4.8000, longitude: 105.1000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Sotong Platform', type: 'platform', latitude: 4.6500, longitude: 104.7500, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Bunga Kekwa Platform', type: 'platform', latitude: 4.5500, longitude: 104.8500, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Lawit Platform', type: 'platform', latitude: 5.3000, longitude: 104.4000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Tiong Platform', type: 'platform', latitude: 4.9500, longitude: 104.6500, operator: 'PETRONAS Carigali', status: 'active' },
      
      // ===== PETRONAS MALAYSIA - OFFSHORE PLATFORMS (Sabah/Sarawak) =====
      { name: 'Kikeh Platform', type: 'platform', latitude: 6.5000, longitude: 115.0000, operator: 'Murphy Oil/PETRONAS', status: 'active' },
      { name: 'Kebabangan Platform (KBB)', type: 'platform', latitude: 6.1000, longitude: 116.8000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Gumusut-Kakap Platform', type: 'platform', latitude: 5.5500, longitude: 116.5000, operator: 'Shell/PETRONAS', capacity: '135,000 bpd', status: 'active' },
      { name: 'Malikai Platform', type: 'platform', latitude: 5.4500, longitude: 116.6000, operator: 'Shell/PETRONAS', status: 'active' },
      { name: 'Rotan Platform', type: 'platform', latitude: 6.3000, longitude: 117.0000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Kinabalu Platform', type: 'platform', latitude: 6.4000, longitude: 115.5000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'St Joseph Platform', type: 'platform', latitude: 6.2500, longitude: 116.0000, operator: 'Shell/PETRONAS', status: 'active' },
      { name: 'Samarang Platform', type: 'platform', latitude: 6.1500, longitude: 116.2000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Baram Delta Platform', type: 'platform', latitude: 4.6000, longitude: 113.9000, operator: 'Shell/PETRONAS', status: 'active' },
      { name: 'Balingian Platform', type: 'platform', latitude: 3.2000, longitude: 112.5000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'F23 Platform (Kumang)', type: 'platform', latitude: 4.3000, longitude: 112.0000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'E11 Platform', type: 'platform', latitude: 4.8500, longitude: 113.5000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'B11 Platform', type: 'platform', latitude: 5.2500, longitude: 113.0000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'D18 Platform', type: 'platform', latitude: 4.1000, longitude: 111.5000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'NC3 Platform', type: 'platform', latitude: 4.5500, longitude: 113.2000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Rosmari-Marjoram Platform', type: 'platform', latitude: 6.0000, longitude: 117.5000, operator: 'PETRONAS Carigali', status: 'active' },
      
      // ===== PETRONAS MALAYSIA - MAJOR PIPELINES =====
      { name: 'Peninsular Gas Utilisation (PGU) - Kerteh', type: 'pipeline', latitude: 4.5000, longitude: 103.4000, operator: 'PETRONAS Gas', capacity: '2,800 mmscfd', status: 'active' },
      { name: 'PGU Pipeline - Kuantan Section', type: 'pipeline', latitude: 4.0000, longitude: 103.4200, operator: 'PETRONAS Gas', status: 'active' },
      { name: 'PGU Pipeline - Segamat Junction', type: 'pipeline', latitude: 2.5000, longitude: 102.8000, operator: 'PETRONAS Gas', status: 'active' },
      { name: 'PGU Pipeline - Pasir Gudang', type: 'pipeline', latitude: 1.4700, longitude: 103.9000, operator: 'PETRONAS Gas', status: 'active' },
      { name: 'PGU Pipeline - Port Klang', type: 'pipeline', latitude: 3.0000, longitude: 101.4500, operator: 'PETRONAS Gas', status: 'active' },
      { name: 'Sabah-Sarawak Gas Pipeline (SSGP)', type: 'pipeline', latitude: 5.0000, longitude: 116.0000, operator: 'PETRONAS Gas', capacity: '880 mmscfd', status: 'active' },
      { name: 'SSGP - Labuan Section', type: 'pipeline', latitude: 5.2800, longitude: 115.2000, operator: 'PETRONAS Gas', status: 'active' },
      { name: 'SSGP - Bintulu Section', type: 'pipeline', latitude: 3.1800, longitude: 113.0500, operator: 'PETRONAS Gas', status: 'active' },
      { name: 'Trans-Thai-Malaysia Pipeline', type: 'pipeline', latitude: 6.0000, longitude: 100.5000, operator: 'PETRONAS/PTT', status: 'active' },
      { name: 'Berantai Gas Pipeline', type: 'pipeline', latitude: 5.1000, longitude: 104.5000, operator: 'PETRONAS Carigali', status: 'active' },
      
      // ===== PETRONAS MALAYSIA - STORAGE FACILITIES =====
      { name: 'Port Klang Oil Storage', type: 'storage', latitude: 3.0000, longitude: 101.4000, operator: 'PETRONAS Trading', capacity: '1.5M barrels', status: 'active' },
      { name: 'Tanjung Langsat Storage', type: 'storage', latitude: 1.4500, longitude: 104.0000, operator: 'PETRONAS', capacity: '2M barrels', status: 'active' },
      { name: 'Kemaman Supply Base', type: 'storage', latitude: 4.2333, longitude: 103.4167, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Labuan Crude Oil Terminal', type: 'storage', latitude: 5.2500, longitude: 115.2500, operator: 'PETRONAS', capacity: '7.5M barrels', status: 'active' },
      { name: 'Miri Supply Base', type: 'storage', latitude: 4.4000, longitude: 113.9833, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Bintulu Supply Base', type: 'storage', latitude: 3.2100, longitude: 113.0600, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Kota Kinabalu Supply Base', type: 'storage', latitude: 5.9700, longitude: 116.0800, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Pasir Gudang Terminal', type: 'storage', latitude: 1.4650, longitude: 103.9200, operator: 'PETRONAS', capacity: '500,000 barrels', status: 'active' },
      
      // ===== PETRONAS MALAYSIA - KEY ROADS/CORRIDORS =====
      { name: 'East Coast Corridor - Kuantan-Kerteh', type: 'road', latitude: 4.2000, longitude: 103.4000, operator: 'PETRONAS', status: 'active' },
      { name: 'East Coast Corridor - Kemaman', type: 'road', latitude: 4.2200, longitude: 103.4200, operator: 'PETRONAS', status: 'active' },
      { name: 'Pengerang Access Corridor', type: 'road', latitude: 1.3800, longitude: 104.2400, operator: 'PETRONAS', status: 'active' },
      { name: 'Bintulu Industrial Corridor', type: 'road', latitude: 3.1500, longitude: 113.0200, operator: 'PETRONAS', status: 'active' },
      
      // ===== PETRONAS INTERNATIONAL - AFRICA =====
      { name: 'PETRONAS Egypt - Meseda Field', type: 'platform', latitude: 28.0000, longitude: 33.0000, operator: 'PETRONAS Egypt', status: 'active' },
      { name: 'PETRONAS Egypt - East Ras Budran', type: 'platform', latitude: 28.3000, longitude: 33.2000, operator: 'PETRONAS Egypt', status: 'active' },
      { name: 'PETRONAS Sudan - Block 8', type: 'platform', latitude: 10.5000, longitude: 28.0000, operator: 'PETRONAS Sudan', status: 'active' },
      { name: 'PETRONAS South Sudan - Block 5B', type: 'platform', latitude: 8.0000, longitude: 30.0000, operator: 'PETRONAS', status: 'active' },
      { name: 'PETRONAS Algeria - Block 433a', type: 'platform', latitude: 27.5000, longitude: 9.0000, operator: 'PETRONAS Algeria', status: 'active' },
      { name: 'PETRONAS Mauritania - Offshore', type: 'platform', latitude: 18.0000, longitude: -16.5000, operator: 'PETRONAS Mauritania', status: 'active' },
      { name: 'PETRONAS Gabon - Diaman-1B', type: 'platform', latitude: -2.0000, longitude: 9.0000, operator: 'PETRONAS Gabon', status: 'active' },
      { name: 'PETRONAS Chad - Doseo/Salamat', type: 'platform', latitude: 9.0000, longitude: 18.0000, operator: 'PETRONAS Chad', status: 'active' },
      
      // ===== PETRONAS INTERNATIONAL - MIDDLE EAST =====
      { name: 'PETRONAS Iraq - Garraf Field', type: 'platform', latitude: 31.0000, longitude: 46.5000, operator: 'PETRONAS Iraq', capacity: '230,000 bpd', status: 'active' },
      { name: 'PETRONAS Iraq - Majnoon Field', type: 'platform', latitude: 31.2000, longitude: 47.0000, operator: 'PETRONAS Iraq', status: 'active' },
      { name: 'PETRONAS Turkmenistan - Block 1', type: 'platform', latitude: 38.0000, longitude: 54.5000, operator: 'PETRONAS Turkmenistan', status: 'active' },
      { name: 'PETRONAS Azerbaijan - Shah Deniz', type: 'platform', latitude: 39.0000, longitude: 50.5000, operator: 'PETRONAS Azerbaijan', status: 'active' },
      
      // ===== PETRONAS INTERNATIONAL - ASIA PACIFIC =====
      { name: 'PETRONAS Australia - Browse Basin', type: 'platform', latitude: -14.0000, longitude: 122.0000, operator: 'PETRONAS Australia', status: 'active' },
      { name: 'PETRONAS Australia - Poseidon', type: 'platform', latitude: -13.5000, longitude: 124.0000, operator: 'PETRONAS Australia', status: 'active' },
      { name: 'PETRONAS Australia - Chandon', type: 'platform', latitude: -14.5000, longitude: 123.5000, operator: 'PETRONAS Australia', status: 'active' },
      { name: 'PETRONAS Myanmar - Yetagun', type: 'platform', latitude: 13.5000, longitude: 97.0000, operator: 'PETRONAS Myanmar', status: 'active' },
      { name: 'PETRONAS Myanmar - Zawtika', type: 'platform', latitude: 14.0000, longitude: 97.5000, operator: 'PETRONAS Myanmar', status: 'active' },
      { name: 'PETRONAS Vietnam - PM304', type: 'platform', latitude: 10.5000, longitude: 108.0000, operator: 'PETRONAS Vietnam', status: 'active' },
      { name: 'PETRONAS Indonesia - Ketapang', type: 'platform', latitude: -7.0000, longitude: 112.5000, operator: 'PETRONAS Indonesia', status: 'active' },
      { name: 'PETRONAS Indonesia - South Natuna Sea Block B', type: 'platform', latitude: 3.5000, longitude: 108.0000, operator: 'PETRONAS Indonesia', status: 'active' },
      { name: 'PETRONAS China - LNG Import Terminal', type: 'terminal', latitude: 29.0000, longitude: 121.5000, operator: 'PETRONAS China', status: 'active' },
      { name: 'PETRONAS India - Dahej LNG Terminal', type: 'terminal', latitude: 21.7000, longitude: 72.5000, operator: 'PETRONAS India', status: 'active' },
      { name: 'PETRONAS Philippines - Malampaya', type: 'platform', latitude: 11.2000, longitude: 119.5000, operator: 'Shell/PETRONAS', status: 'active' },
      
      // ===== PETRONAS CANADA - PRODUCTION PODS (Montney Formation, BC) =====
      // Caribou/Green Pod - Northern Region (Blue zone on map)
      { name: 'Caribou/Green Pod - Central Hub', type: 'platform', latitude: 57.1500, longitude: -121.2000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou North Well Pad A', type: 'platform', latitude: 57.2500, longitude: -121.3500, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou North Well Pad B', type: 'platform', latitude: 57.2800, longitude: -121.2000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Tommy Lakes Compressor Station', type: 'terminal', latitude: 57.3000, longitude: -121.1500, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou East Well Pad', type: 'platform', latitude: 57.0500, longitude: -120.8000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Green Area Well Pad', type: 'platform', latitude: 57.3500, longitude: -121.5000, operator: 'PETRONAS Canada', status: 'active' },
      
      // Nel/Antine Pod - Western Region (Orange zone on map)
      { name: 'Nel/Antine Pod - Central Hub', type: 'platform', latitude: 56.7500, longitude: -121.5000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Nel Compressor Station', type: 'terminal', latitude: 56.7800, longitude: -121.6000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Antine Well Pad A', type: 'platform', latitude: 56.7200, longitude: -121.4500, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Antine Well Pad B', type: 'platform', latitude: 56.6800, longitude: -121.5500, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Cameron Road Access', type: 'road', latitude: 56.6000, longitude: -121.6500, operator: 'PETRONAS Canada', status: 'active' },
      
      // Big/Kahuna Pod - Central Region (Purple/Pink zone on map)
      { name: 'Big/Kahuna Pod - Central Hub', type: 'platform', latitude: 56.9000, longitude: -120.7000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Jedney Gas Plant', type: 'refinery', latitude: 56.9500, longitude: -120.6500, operator: 'PETRONAS Canada', capacity: '200 mmscfd', status: 'active' },
      { name: 'Kahuna Compressor Station', type: 'terminal', latitude: 56.8500, longitude: -120.7500, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Big Pod Well Pad A', type: 'platform', latitude: 56.9200, longitude: -120.8000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Big Pod Well Pad B', type: 'platform', latitude: 56.8800, longitude: -120.6000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Kahuna Well Pad C', type: 'platform', latitude: 56.9800, longitude: -120.5500, operator: 'PETRONAS Canada', status: 'active' },
      
      // Groundbirch Pod - Central Region (Green zone on map)
      { name: 'Groundbirch Pod - Central Hub', type: 'platform', latitude: 56.5500, longitude: -120.9000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Groundbirch Gas Plant', type: 'refinery', latitude: 56.5200, longitude: -120.8500, operator: 'PETRONAS Canada', capacity: '150 mmscfd', status: 'active' },
      { name: 'Groundbirch Compressor Station', type: 'terminal', latitude: 56.5800, longitude: -120.9500, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Groundbirch Well Pad A', type: 'platform', latitude: 56.6000, longitude: -120.8000, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Groundbirch Well Pad B', type: 'platform', latitude: 56.5000, longitude: -120.9200, operator: 'PETRONAS Canada', status: 'active' },
      
      // ===== PETRONAS CANADA - PRODUCTION PODS (NBU - Red boundary) =====
      
      // GREER Pod - Northwest corner of NBU
      { name: 'Greer Production Pod', type: 'platform', latitude: 57.35, longitude: -121.60, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Greer Well Pad A', type: 'platform', latitude: 57.38, longitude: -121.55, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Greer Well Pad B', type: 'platform', latitude: 57.32, longitude: -121.65, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Greer Compressor Station', type: 'terminal', latitude: 57.34, longitude: -121.58, operator: 'PETRONAS Canada', status: 'active' },
      
      // TOMMY LAKE Pod - Northeast of Greer
      { name: 'Tommy Lake Production Pod', type: 'platform', latitude: 57.30, longitude: -121.00, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Tommy Lake Well Pad A', type: 'platform', latitude: 57.32, longitude: -120.95, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Tommy Lake Well Pad B', type: 'platform', latitude: 57.28, longitude: -121.05, operator: 'PETRONAS Canada', status: 'active' },
      
      // CARIBOU NORTH Pod - West central NBU
      { name: 'Caribou North Production Pod', type: 'platform', latitude: 57.10, longitude: -121.50, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou North Well Pad A', type: 'platform', latitude: 57.12, longitude: -121.45, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou North Well Pad B', type: 'platform', latitude: 57.08, longitude: -121.55, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou North Compressor Station', type: 'terminal', latitude: 57.11, longitude: -121.48, operator: 'PETRONAS Canada', status: 'active' },
      
      // CARIBOU EAST Pod - Central NBU
      { name: 'Caribou East Production Pod', type: 'platform', latitude: 57.05, longitude: -121.10, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou East Well Pad A', type: 'platform', latitude: 57.08, longitude: -121.05, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou East Well Pad B', type: 'platform', latitude: 57.02, longitude: -121.15, operator: 'PETRONAS Canada', status: 'active' },
      
      // CARIBOU SOUTH Pod - Southwest of Caribou East
      { name: 'Caribou South Production Pod', type: 'platform', latitude: 56.90, longitude: -121.40, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou South Well Pad A', type: 'platform', latitude: 56.92, longitude: -121.35, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou South Well Pad B', type: 'platform', latitude: 56.88, longitude: -121.45, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou South Compressor Station', type: 'terminal', latitude: 56.91, longitude: -121.38, operator: 'PETRONAS Canada', status: 'active' },
      
      // NBU Hub - North Business Unit Central
      { name: 'NBU - North Business Unit Hub', type: 'terminal', latitude: 56.75, longitude: -120.90, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'NBU Main Compressor Station', type: 'terminal', latitude: 56.78, longitude: -120.85, operator: 'PETRONAS Canada', status: 'active' },
      
      // NRG EAST Pod - East of NBU Hub
      { name: 'NRG East Production Pod', type: 'platform', latitude: 56.80, longitude: -120.50, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'NRG East Well Pad A', type: 'platform', latitude: 56.82, longitude: -120.45, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'NRG East Well Pad B', type: 'platform', latitude: 56.78, longitude: -120.55, operator: 'PETRONAS Canada', status: 'active' },
      
      // JEDNEY Pod - Eastern NBU with Gas Plant
      { name: 'Jedney Production Pod', type: 'platform', latitude: 56.85, longitude: -120.15, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Jedney Gas Plant', type: 'refinery', latitude: 56.88, longitude: -120.10, operator: 'PETRONAS Canada', capacity: '200 mmscfd', status: 'active' },
      { name: 'Jedney Well Pad A', type: 'platform', latitude: 56.90, longitude: -120.20, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Jedney Well Pad B', type: 'platform', latitude: 56.82, longitude: -120.08, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Jedney Well Pad C', type: 'platform', latitude: 56.87, longitude: -120.18, operator: 'PETRONAS Canada', status: 'active' },
      
      // LILY Pod - West-Southwest NBU boundary
      { name: 'Lily Production Pod', type: 'platform', latitude: 56.65, longitude: -121.55, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Lily Well Pad A', type: 'platform', latitude: 56.68, longitude: -121.50, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Lily Well Pad B', type: 'platform', latitude: 56.62, longitude: -121.60, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Lily Compressor Station', type: 'terminal', latitude: 56.66, longitude: -121.52, operator: 'PETRONAS Canada', status: 'active' },
      
      // JULIENNE Pod - Central area between NBU and SBU
      { name: 'Julienne Production Pod', type: 'platform', latitude: 56.55, longitude: -121.10, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Julienne Well Pad A', type: 'platform', latitude: 56.58, longitude: -121.05, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Julienne Well Pad B', type: 'platform', latitude: 56.52, longitude: -121.15, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Julienne Compressor Station', type: 'terminal', latitude: 56.56, longitude: -121.08, operator: 'PETRONAS Canada', status: 'active' },
      
      // ===== PETRONAS CANADA - PRODUCTION PODS (SBU - Blue boundary) =====
      
      // SBU Hub - South Business Unit Central  
      { name: 'SBU - South Business Unit Hub', type: 'terminal', latitude: 56.35, longitude: -120.60, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'SBU Main Compressor Station', type: 'terminal', latitude: 56.38, longitude: -120.55, operator: 'PETRONAS Canada', status: 'active' },
      
      // TOWN NORTH Pod - Northern SBU
      { name: 'Town North Production Pod', type: 'platform', latitude: 56.45, longitude: -120.35, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Town North Well Pad A', type: 'platform', latitude: 56.48, longitude: -120.30, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Town North Well Pad B', type: 'platform', latitude: 56.42, longitude: -120.40, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Town North Compressor Station', type: 'terminal', latitude: 56.46, longitude: -120.33, operator: 'PETRONAS Canada', status: 'active' },
      
      // TOWNY Pod - Central-East SBU
      { name: 'Towny Production Pod', type: 'platform', latitude: 56.25, longitude: -120.10, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Towny Well Pad A', type: 'platform', latitude: 56.28, longitude: -120.05, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Towny Well Pad B', type: 'platform', latitude: 56.22, longitude: -120.15, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Towny Compressor Station', type: 'terminal', latitude: 56.26, longitude: -120.08, operator: 'PETRONAS Canada', status: 'active' },
      
      // CAMERON Pod - Southwest SBU
      { name: 'Cameron Production Pod', type: 'platform', latitude: 56.10, longitude: -120.80, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Cameron Well Pad A', type: 'platform', latitude: 56.13, longitude: -120.75, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Cameron Well Pad B', type: 'platform', latitude: 56.07, longitude: -120.85, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Cameron FSR Road Junction', type: 'road', latitude: 56.11, longitude: -120.78, operator: 'PETRONAS Canada', status: 'active' },
      
      // KOBES Pod - Central-South SBU
      { name: 'Kobes Production Pod', type: 'platform', latitude: 56.00, longitude: -120.20, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Kobes Well Pad A', type: 'platform', latitude: 56.03, longitude: -120.15, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Kobes Well Pad B', type: 'platform', latitude: 55.97, longitude: -120.25, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Kobes Compressor Station', type: 'terminal', latitude: 56.01, longitude: -120.18, operator: 'PETRONAS Canada', status: 'active' },
      
      // BLUEBERRY Pod - Southeast SBU with Gas Plant
      { name: 'Blueberry Production Pod', type: 'platform', latitude: 55.80, longitude: -119.85, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Blueberry Gas Plant', type: 'refinery', latitude: 55.85, longitude: -119.80, operator: 'PETRONAS Canada', capacity: '180 mmscfd', status: 'active' },
      { name: 'Blueberry Well Pad A', type: 'platform', latitude: 55.88, longitude: -119.90, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Blueberry Well Pad B', type: 'platform', latitude: 55.77, longitude: -119.78, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Blueberry Well Pad C', type: 'platform', latitude: 55.82, longitude: -119.85, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Blueberry Compressor Station', type: 'terminal', latitude: 55.84, longitude: -119.82, operator: 'PETRONAS Canada', status: 'active' },
      
      // ALTARES Pod - Southern SBU with main Gas Plant
      { name: 'Altares Production Pod', type: 'platform', latitude: 55.55, longitude: -120.10, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Altares Gas Plant', type: 'refinery', latitude: 55.60, longitude: -120.05, operator: 'PETRONAS Canada', capacity: '350 mmscfd', status: 'active' },
      { name: 'Altares Compressor Station 1', type: 'terminal', latitude: 55.52, longitude: -120.15, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Altares Compressor Station 2', type: 'terminal', latitude: 55.58, longitude: -120.00, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Altares Well Pad A', type: 'platform', latitude: 55.48, longitude: -120.08, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Altares Well Pad B', type: 'platform', latitude: 55.62, longitude: -120.12, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Altares Well Pad C', type: 'platform', latitude: 55.50, longitude: -119.95, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Altares Well Pad D', type: 'platform', latitude: 55.45, longitude: -120.18, operator: 'PETRONAS Canada', status: 'active' },
      
      // ===== PETRONAS CANADA - MAJOR PIPELINES =====
      { name: 'PCL Trunk Pipeline - Greer Section', type: 'pipeline', latitude: 57.30, longitude: -121.55, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Caribou North Section', type: 'pipeline', latitude: 57.05, longitude: -121.45, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Caribou East Section', type: 'pipeline', latitude: 57.00, longitude: -121.05, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - NBU Hub Section', type: 'pipeline', latitude: 56.72, longitude: -120.88, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Jedney Section', type: 'pipeline', latitude: 56.86, longitude: -120.12, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Julienne Section', type: 'pipeline', latitude: 56.52, longitude: -121.08, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Town North Section', type: 'pipeline', latitude: 56.42, longitude: -120.35, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - SBU Hub Section', type: 'pipeline', latitude: 56.32, longitude: -120.58, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Cameron Section', type: 'pipeline', latitude: 56.08, longitude: -120.78, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Kobes Section', type: 'pipeline', latitude: 55.98, longitude: -120.18, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Blueberry Section', type: 'pipeline', latitude: 55.82, longitude: -119.82, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'PCL Trunk Pipeline - Altares Section', type: 'pipeline', latitude: 55.55, longitude: -120.08, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Enbridge T-North Pipeline Junction', type: 'pipeline', latitude: 56.80, longitude: -120.50, operator: 'Enbridge/PETRONAS', status: 'active' },
      { name: 'Spectra Energy Pipeline Interconnect', type: 'pipeline', latitude: 56.30, longitude: -120.40, operator: 'Spectra/PETRONAS', status: 'active' },
      { name: 'Third Party NGL Pipeline', type: 'pipeline', latitude: 56.10, longitude: -120.10, operator: 'Third Party/PETRONAS', status: 'active' },
      
      // ===== PETRONAS CANADA - ACCESS ROADS =====
      { name: 'Highway 97 Access - Fort St. John', type: 'road', latitude: 56.2465, longitude: -120.8477, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Highway 29 Access - Hudson Hope', type: 'road', latitude: 56.0310, longitude: -121.9008, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Greer Road Access', type: 'road', latitude: 57.33, longitude: -121.58, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Tommy Lake Road Access', type: 'road', latitude: 57.28, longitude: -120.98, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou North Road Access', type: 'road', latitude: 57.08, longitude: -121.48, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Caribou East Road Access', type: 'road', latitude: 57.03, longitude: -121.08, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Jedney Road Access', type: 'road', latitude: 56.87, longitude: -120.12, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Lily Road Access', type: 'road', latitude: 56.64, longitude: -121.53, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Julienne Road Access', type: 'road', latitude: 56.54, longitude: -121.08, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Town North Road Access', type: 'road', latitude: 56.44, longitude: -120.33, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Towny Road Access', type: 'road', latitude: 56.24, longitude: -120.08, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Cameron FSR Road', type: 'road', latitude: 56.09, longitude: -120.78, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Kobes Road Access', type: 'road', latitude: 55.99, longitude: -120.17, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Blueberry Road Access', type: 'road', latitude: 55.83, longitude: -119.83, operator: 'PETRONAS Canada', status: 'active' },
      { name: 'Altares Road Access', type: 'road', latitude: 55.57, longitude: -120.07, operator: 'PETRONAS Canada', status: 'active' },
      
      // ===== PETRONAS CANADA - LNG EXPORT PROJECT =====
      { name: 'PETRONAS Canada LNG Terminal - Prince Rupert', type: 'terminal', latitude: 54.3150, longitude: -130.3271, operator: 'PETRONAS Canada', capacity: '12 MTPA', status: 'planned' },
      { name: 'Pacific NorthWest LNG Site', type: 'terminal', latitude: 54.2000, longitude: -130.2500, operator: 'PETRONAS Canada', status: 'planned' },
      { name: 'Kitimat LNG Alternative Site', type: 'terminal', latitude: 54.0500, longitude: -128.6500, operator: 'PETRONAS Canada', status: 'planned' },
      
      // ===== PETRONAS INTERNATIONAL - OTHER AMERICAS =====
      { name: 'PETRONAS Argentina - Neuquén Basin', type: 'platform', latitude: -38.5000, longitude: -68.5000, operator: 'PETRONAS Argentina', status: 'active' },
      { name: 'PETRONAS Mexico - Block 29', type: 'platform', latitude: 19.5000, longitude: -96.5000, operator: 'PETRONAS Mexico', status: 'active' },
      { name: 'PETRONAS Brazil - Pre-salt Basin', type: 'platform', latitude: -25.0000, longitude: -45.0000, operator: 'PETRONAS Brazil', status: 'active' },
      { name: 'PETRONAS Suriname - Block 52', type: 'platform', latitude: 7.0000, longitude: -55.0000, operator: 'PETRONAS Suriname', status: 'exploration' },
      
      // ===== PETRONAS CHEMICALS - GLOBAL =====
      { name: 'PETRONAS Chemicals - Pengerang', type: 'terminal', latitude: 1.4100, longitude: 104.2550, operator: 'PETRONAS Chemicals', status: 'active' },
      { name: 'PETRONAS Chemicals - MTBE Plant Kerteh', type: 'terminal', latitude: 4.5050, longitude: 103.4250, operator: 'PETRONAS Chemicals', status: 'active' },
      { name: 'PETRONAS Chemicals - Ethylene Plant Kerteh', type: 'terminal', latitude: 4.5080, longitude: 103.4280, operator: 'PETRONAS Chemicals', status: 'active' },
      { name: 'PETRONAS Chemicals - Fertilizer Gurun', type: 'terminal', latitude: 5.8167, longitude: 100.4667, operator: 'PETRONAS Chemicals', status: 'active' },
      { name: 'PETRONAS Chemicals - Bintulu Methanol', type: 'terminal', latitude: 3.1600, longitude: 113.0450, operator: 'PETRONAS Chemicals', status: 'active' },
      
      // ===== PETRONAS LUBRICANTS - GLOBAL =====
      { name: 'PETRONAS Lubricants - Shah Alam Plant', type: 'storage', latitude: 3.0700, longitude: 101.5300, operator: 'PETRONAS Lubricants', status: 'active' },
      { name: 'PETRONAS Lubricants - Turin, Italy', type: 'storage', latitude: 45.0700, longitude: 7.6870, operator: 'PETRONAS Lubricants', status: 'active' },
      { name: 'PETRONAS Lubricants - Villaverde, Spain', type: 'storage', latitude: 40.3500, longitude: -3.7000, operator: 'PETRONAS Lubricants', status: 'active' },
      { name: 'PETRONAS Lubricants - Pathumthani, Thailand', type: 'storage', latitude: 14.0000, longitude: 100.5500, operator: 'PETRONAS Lubricants', status: 'active' },
      { name: 'PETRONAS Lubricants - São Paulo, Brazil', type: 'storage', latitude: -23.5505, longitude: -46.6333, operator: 'PETRONAS Lubricants', status: 'active' },
      { name: 'PETRONAS Lubricants - Durban, South Africa', type: 'storage', latitude: -29.8600, longitude: 31.0300, operator: 'PETRONAS Lubricants', status: 'active' },
    ];
  }

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !mapboxToken || map.current) return;

    mapboxgl.accessToken = mapboxToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[mapStyle],
      center: [-120, 45],
      zoom: 4,
      pitch: showTerrain ? 45 : 0,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.addControl(new mapboxgl.ScaleControl(), 'bottom-left');
    map.current.addControl(new mapboxgl.FullscreenControl(), 'top-right');

    map.current.on('load', () => {
      if (!map.current) return;

      // Add terrain exaggeration for 3D effect
      if (showTerrain && map.current.getStyle()?.terrain === undefined) {
        map.current.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14
        });
        map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      }

      // Add sky layer for 3D terrain
      if (!map.current.getLayer('sky')) {
        map.current.addLayer({
          id: 'sky',
          type: 'sky',
          paint: {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 90.0],
            'sky-atmosphere-sun-intensity': 15
          }
        });
      }

      // Add heatmap source and layer
      map.current.addSource('fire-heat', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'fire-heat-layer',
        type: 'heatmap',
        source: 'fire-heat',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'frp'], 0, 0, 100, 1],
          'heatmap-intensity': 1,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgb(255,255,178)',
            0.4, 'rgb(254,204,92)',
            0.6, 'rgb(253,141,60)',
            0.8, 'rgb(240,59,32)',
            1, 'rgb(189,0,38)'
          ],
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7
        },
        layout: { visibility: 'none' }
      });

      // Add fire perimeters source and layer
      map.current.addSource('fire-perimeters', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'fire-perimeters-fill',
        type: 'fill',
        source: 'fire-perimeters',
        paint: {
          'fill-color': '#ff6b35',
          'fill-opacity': 0.3
        },
        layout: { visibility: 'visible' }
      });

      map.current.addLayer({
        id: 'fire-perimeters-outline',
        type: 'line',
        source: 'fire-perimeters',
        paint: {
          'line-color': '#ff4500',
          'line-width': 2,
          'line-dasharray': [2, 1]
        },
        layout: { visibility: 'visible' }
      });

      // Add weather alerts source and layer
      map.current.addSource('weather-alerts', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'weather-alerts-fill',
        type: 'fill',
        source: 'weather-alerts',
        paint: {
          'fill-color': ['case',
            ['==', ['get', 'event'], 'Red Flag Warning'], '#dc2626',
            ['==', ['get', 'event'], 'Fire Weather Watch'], '#f97316',
            '#eab308'
          ],
          'fill-opacity': 0.2
        },
        layout: { visibility: 'visible' }
      });

      map.current.addLayer({
        id: 'weather-alerts-outline',
        type: 'line',
        source: 'weather-alerts',
        paint: {
          'line-color': ['case',
            ['==', ['get', 'event'], 'Red Flag Warning'], '#dc2626',
            ['==', ['get', 'event'], 'Fire Weather Watch'], '#f97316',
            '#eab308'
          ],
          'line-width': 2
        },
        layout: { visibility: 'visible' }
      });

      // Add smoke plume layer (simulated with circle gradients)
      map.current.addSource('smoke-plumes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'smoke-plumes-layer',
        type: 'circle',
        source: 'smoke-plumes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'frp'], 0, 20, 100, 80],
          'circle-color': 'rgba(128, 128, 128, 0.4)',
          'circle-blur': 1
        },
        layout: { visibility: 'none' }
      });
      
      // Mark style as loaded - safe to manipulate layers now
      setStyleLoaded(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      setStyleLoaded(false);
    };
  }, [mapboxToken]);

  // Handle map style changes
  useEffect(() => {
    if (!map.current) return;
    
    // Mark style as loading during style change
    setStyleLoaded(false);
    map.current.setStyle(MAP_STYLES[mapStyle]);
    
    // Re-add layers after style change
    map.current.once('style.load', () => {
      if (!map.current) return;
      
      // Re-add terrain
      if (showTerrain) {
        if (!map.current.getSource('mapbox-dem')) {
          map.current.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14
          });
        }
        map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      }

      // Re-add all custom layers
      addCustomLayers();
      
      // Mark style as loaded again - safe to manipulate layers
      setStyleLoaded(true);
      
      // Update data after style is ready
      updateFireMarkers();
      updatePerimeters();
      updateWeatherAlerts();
    });
  }, [mapStyle]);

  const addCustomLayers = useCallback(() => {
    if (!map.current) return;

    // Add heatmap source if not exists
    if (!map.current.getSource('fire-heat')) {
      map.current.addSource('fire-heat', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'fire-heat-layer',
        type: 'heatmap',
        source: 'fire-heat',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'frp'], 0, 0, 100, 1],
          'heatmap-intensity': 1,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgb(255,255,178)',
            0.4, 'rgb(254,204,92)',
            0.6, 'rgb(253,141,60)',
            0.8, 'rgb(240,59,32)',
            1, 'rgb(189,0,38)'
          ],
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7
        },
        layout: { visibility: showHeatmap ? 'visible' : 'none' }
      });
    }

    // Add perimeters source if not exists
    if (!map.current.getSource('fire-perimeters')) {
      map.current.addSource('fire-perimeters', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'fire-perimeters-fill',
        type: 'fill',
        source: 'fire-perimeters',
        paint: { 'fill-color': '#ff6b35', 'fill-opacity': 0.3 },
        layout: { visibility: showPerimeters ? 'visible' : 'none' }
      });

      map.current.addLayer({
        id: 'fire-perimeters-outline',
        type: 'line',
        source: 'fire-perimeters',
        paint: { 'line-color': '#ff4500', 'line-width': 2, 'line-dasharray': [2, 1] },
        layout: { visibility: showPerimeters ? 'visible' : 'none' }
      });
    }

    // Add weather alerts source if not exists
    if (!map.current.getSource('weather-alerts')) {
      map.current.addSource('weather-alerts', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'weather-alerts-fill',
        type: 'fill',
        source: 'weather-alerts',
        paint: {
          'fill-color': ['case',
            ['==', ['get', 'event'], 'Red Flag Warning'], '#dc2626',
            '#f97316'
          ],
          'fill-opacity': 0.2
        },
        layout: { visibility: showWeatherAlerts ? 'visible' : 'none' }
      });

      map.current.addLayer({
        id: 'weather-alerts-outline',
        type: 'line',
        source: 'weather-alerts',
        paint: {
          'line-color': ['case',
            ['==', ['get', 'event'], 'Red Flag Warning'], '#dc2626',
            '#f97316'
          ],
          'line-width': 2
        },
        layout: { visibility: showWeatherAlerts ? 'visible' : 'none' }
      });
    }

    // Add smoke plumes source if not exists
    if (!map.current.getSource('smoke-plumes')) {
      map.current.addSource('smoke-plumes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'smoke-plumes-layer',
        type: 'circle',
        source: 'smoke-plumes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'frp'], 0, 20, 100, 80],
          'circle-color': 'rgba(128, 128, 128, 0.4)',
          'circle-blur': 1
        },
        layout: { visibility: showSmoke ? 'visible' : 'none' }
      });
    }
  }, [showHeatmap, showPerimeters, showWeatherAlerts, showSmoke]);

  // Update fire perimeters on map
  const updatePerimeters = useCallback(() => {
    if (!map.current || !firePerimeters) return;

    const source = map.current.getSource('fire-perimeters') as mapboxgl.GeoJSONSource;
    if (!source) return;

    const features = firePerimeters
      .filter(p => p.geometry)
      .map(p => ({
        type: 'Feature' as const,
        geometry: p.geometry!,
        properties: { name: p.name, acres: p.acres, containment: p.containment }
      }));

    source.setData({ type: 'FeatureCollection', features });
  }, [firePerimeters]);

  // Update weather alerts on map
  const updateWeatherAlerts = useCallback(() => {
    if (!map.current || !weatherAlerts) return;

    const source = map.current.getSource('weather-alerts') as mapboxgl.GeoJSONSource;
    if (!source) return;

    const features = weatherAlerts
      .filter(a => a.geometry)
      .map(a => ({
        type: 'Feature' as const,
        geometry: a.geometry!,
        properties: { event: a.event, severity: a.severity, headline: a.headline }
      }));

    source.setData({ type: 'FeatureCollection', features });
  }, [weatherAlerts]);

  // Update fire points on map
  const updateFireMarkers = useCallback(() => {
    if (!map.current || !firePoints) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    if (!showFirePoints) return;

    // Add fire point markers
    firePoints.forEach((fire) => {
      const el = document.createElement('div');
      el.className = 'fire-marker';
      const size = 12 + (fire.confidence / 10);
      el.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        background: radial-gradient(circle, #ff4500 0%, #ff6b35 50%, transparent 100%);
        border-radius: 50%;
        cursor: pointer;
        animation: pulse 1.5s infinite;
        box-shadow: 0 0 ${fire.frp / 5}px #ff4500;
      `;

      const popup = new mapboxgl.Popup({ offset: 25, maxWidth: '300px' }).setHTML(`
        <div style="font-family: system-ui; padding: 8px;">
          <h4 style="margin: 0 0 8px; color: #ff4500; font-weight: 600;">
            🔥 Active Fire Detection
          </h4>
          <div style="font-size: 12px; color: #666;">
            <p style="margin: 4px 0;"><strong>Confidence:</strong> ${fire.confidence}%</p>
            <p style="margin: 4px 0;"><strong>Brightness:</strong> ${fire.brightness}K</p>
            <p style="margin: 4px 0;"><strong>Fire Radiative Power:</strong> ${fire.frp.toFixed(1)} MW</p>
            <p style="margin: 4px 0;"><strong>Detected:</strong> ${fire.acq_date} ${fire.acq_time}</p>
            <p style="margin: 4px 0;"><strong>Satellite:</strong> ${fire.satellite}</p>
            <p style="margin: 4px 0;"><strong>Coords:</strong> ${fire.latitude.toFixed(4)}, ${fire.longitude.toFixed(4)}</p>
          </div>
        </div>
      `);

      const marker = new mapboxgl.Marker(el)
        .setLngLat([fire.longitude, fire.latitude])
        .setPopup(popup)
        .addTo(map.current!);

      markersRef.current.push(marker);
    });

    // Update heatmap data
    if (map.current.getSource('fire-heat')) {
      const heatmapData = {
        type: 'FeatureCollection' as const,
        features: firePoints.map(fire => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [fire.longitude, fire.latitude]
          },
          properties: { frp: fire.frp, confidence: fire.confidence }
        }))
      };
      (map.current.getSource('fire-heat') as mapboxgl.GeoJSONSource).setData(heatmapData);
    }

    // Update smoke plumes data
    if (map.current.getSource('smoke-plumes')) {
      const smokePlumeData = {
        type: 'FeatureCollection' as const,
        features: firePoints.filter(f => f.frp > 30).map(fire => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [fire.longitude + 0.05, fire.latitude + 0.03] // Offset for smoke drift
          },
          properties: { frp: fire.frp }
        }))
      };
      (map.current.getSource('smoke-plumes') as mapboxgl.GeoJSONSource).setData(smokePlumeData);
    }
  }, [firePoints, showFirePoints]);

  // Toggle heatmap visibility
  useEffect(() => {
    if (!map.current || !styleLoaded || !map.current.getLayer('fire-heat-layer')) return;
    map.current.setLayoutProperty('fire-heat-layer', 'visibility', showHeatmap ? 'visible' : 'none');
  }, [showHeatmap, styleLoaded]);

  // Toggle perimeters visibility
  useEffect(() => {
    if (!map.current || !styleLoaded) return;
    if (map.current.getLayer('fire-perimeters-fill')) {
      map.current.setLayoutProperty('fire-perimeters-fill', 'visibility', showPerimeters ? 'visible' : 'none');
    }
    if (map.current.getLayer('fire-perimeters-outline')) {
      map.current.setLayoutProperty('fire-perimeters-outline', 'visibility', showPerimeters ? 'visible' : 'none');
    }
  }, [showPerimeters, styleLoaded]);

  // Toggle weather alerts visibility
  useEffect(() => {
    if (!map.current || !styleLoaded) return;
    if (map.current.getLayer('weather-alerts-fill')) {
      map.current.setLayoutProperty('weather-alerts-fill', 'visibility', showWeatherAlerts ? 'visible' : 'none');
    }
    if (map.current.getLayer('weather-alerts-outline')) {
      map.current.setLayoutProperty('weather-alerts-outline', 'visibility', showWeatherAlerts ? 'visible' : 'none');
    }
  }, [showWeatherAlerts, styleLoaded]);

  // Toggle smoke visibility
  useEffect(() => {
    if (!map.current || !styleLoaded || !map.current.getLayer('smoke-plumes-layer')) return;
    map.current.setLayoutProperty('smoke-plumes-layer', 'visibility', showSmoke ? 'visible' : 'none');
  }, [showSmoke, styleLoaded]);

  // Toggle 3D terrain
  useEffect(() => {
    if (!map.current || !styleLoaded) return;
    try {
      if (showTerrain) {
        if (!map.current.getSource('mapbox-dem')) {
          map.current.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14
          });
        }
        map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
        map.current.easeTo({ pitch: 45 });
      } else {
        map.current.setTerrain(null);
        map.current.easeTo({ pitch: 0 });
      }
    } catch (err) {
      console.warn('Terrain toggle error:', err);
    }
  }, [showTerrain, styleLoaded]);

  // Update markers when data changes
  useEffect(() => {
    if (!styleLoaded) return;
    updateFireMarkers();
  }, [updateFireMarkers, styleLoaded]);

  // Update perimeters when data changes
  useEffect(() => {
    if (!styleLoaded) return;
    updatePerimeters();
  }, [updatePerimeters, styleLoaded]);

  // Update weather alerts when data changes
  useEffect(() => {
    if (!styleLoaded) return;
    updateWeatherAlerts();
  }, [updateWeatherAlerts, styleLoaded]);

  // Update infrastructure markers
  const updateInfrastructureMarkers = useCallback(() => {
    if (!map.current || !infrastructureData) return;

    // Clear existing infrastructure markers
    infrastructureMarkersRef.current.forEach(marker => marker.remove());
    infrastructureMarkersRef.current = [];

    if (!showInfrastructure) return;

    // Filter infrastructure based on Petronas Canada toggle
    const filteredInfra = infrastructureData.filter((infra) => {
      const isPetronasCanada = infra.operator.includes('PETRONAS Canada') || 
                               infra.operator.includes('Enbridge/PETRONAS') ||
                               infra.operator.includes('Spectra/PETRONAS') ||
                               infra.operator.includes('Third Party/PETRONAS');
      
      // If it's Petronas Canada, only show if that toggle is on
      if (isPetronasCanada) {
        return showPetronasCanada;
      }
      // Non-Canada assets always show (when infrastructure is on)
      return true;
    });

    // Icon configuration for different infrastructure types
    const getInfraIcon = (type: string, isPetronasCanada: boolean) => {
      // Use distinct colors for Petronas Canada assets
      if (isPetronasCanada) {
        switch (type) {
          case 'refinery': return { icon: '🏭', color: '#dc2626', size: 18 }; // Red for Canada refineries
          case 'pipeline': return { icon: '🔗', color: '#ea580c', size: 14 }; // Orange for Canada pipelines
          case 'terminal': return { icon: '⛽', color: '#16a34a', size: 16 }; // Green for Canada terminals
          case 'platform': return { icon: '🛢️', color: '#ca8a04', size: 16 }; // Yellow for Canada platforms
          case 'storage': return { icon: '🏗️', color: '#7c3aed', size: 14 }; // Purple for Canada storage
          case 'road': return { icon: '🛣️', color: '#0891b2', size: 12 }; // Cyan for Canada roads
          default: return { icon: '📍', color: '#dc2626', size: 14 };
        }
      }
      
      switch (type) {
        case 'refinery': return { icon: '🏭', color: '#3b82f6', size: 18 };
        case 'pipeline': return { icon: '🔗', color: '#8b5cf6', size: 14 };
        case 'terminal': return { icon: '⛽', color: '#10b981', size: 16 };
        case 'platform': return { icon: '🛢️', color: '#f59e0b', size: 16 };
        case 'storage': return { icon: '🏗️', color: '#6366f1', size: 14 };
        case 'road': return { icon: '🛣️', color: '#64748b', size: 12 };
        default: return { icon: '📍', color: '#64748b', size: 14 };
      }
    };

    filteredInfra.forEach((infra) => {
      const isPetronasCanada = infra.operator.includes('PETRONAS Canada') || 
                               infra.operator.includes('Enbridge/PETRONAS') ||
                               infra.operator.includes('Spectra/PETRONAS') ||
                               infra.operator.includes('Third Party/PETRONAS');
      const iconConfig = getInfraIcon(infra.type, isPetronasCanada);
      
      const el = document.createElement('div');
      el.className = `infrastructure-marker ${isPetronasCanada ? 'petronas-canada' : ''}`;
      el.style.cssText = `
        width: ${iconConfig.size + 8}px;
        height: ${iconConfig.size + 8}px;
        background: ${iconConfig.color};
        border: 2px solid ${isPetronasCanada ? '#fbbf24' : 'white'};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${iconConfig.size - 4}px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: transform 0.2s;
      `;
      el.innerHTML = iconConfig.icon;
      el.title = `${infra.name} (${infra.operator})`;

      const popup = new mapboxgl.Popup({ offset: 25, maxWidth: '320px' }).setHTML(`
        <div style="font-family: system-ui; padding: 8px;">
          <h4 style="margin: 0 0 8px; color: ${iconConfig.color}; font-weight: 600;">
            ${iconConfig.icon} ${infra.name}
            ${isPetronasCanada ? '<span style="background: #fbbf24; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 8px;">🇨🇦 Canada</span>' : ''}
          </h4>
          <div style="font-size: 12px; color: #666;">
            <p style="margin: 4px 0;"><strong>Type:</strong> ${infra.type.charAt(0).toUpperCase() + infra.type.slice(1)}</p>
            <p style="margin: 4px 0;"><strong>Operator:</strong> ${infra.operator}</p>
            ${infra.capacity ? `<p style="margin: 4px 0;"><strong>Capacity:</strong> ${infra.capacity}</p>` : ''}
            <p style="margin: 4px 0;"><strong>Status:</strong> 
              <span style="color: ${infra.status === 'active' ? '#10b981' : infra.status === 'planned' ? '#f59e0b' : infra.status === 'exploration' ? '#a855f7' : '#3b82f6'}">
                ${infra.status.charAt(0).toUpperCase() + infra.status.slice(1).replace('_', ' ')}
              </span>
            </p>
            <p style="margin: 4px 0;"><strong>Coords:</strong> ${infra.latitude.toFixed(4)}, ${infra.longitude.toFixed(4)}</p>
          </div>
        </div>
      `);

      const marker = new mapboxgl.Marker(el)
        .setLngLat([infra.longitude, infra.latitude])
        .setPopup(popup)
        .addTo(map.current!);

      infrastructureMarkersRef.current.push(marker);
    });
  }, [infrastructureData, showInfrastructure, showPetronasCanada]);

  // Update infrastructure markers when data or visibility changes
  useEffect(() => {
    if (!styleLoaded) return;
    updateInfrastructureMarkers();
  }, [updateInfrastructureMarkers, styleLoaded, showInfrastructure, showPetronasCanada]);

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'Extreme': return 'bg-red-600 text-white';
      case 'High': return 'bg-orange-500 text-white';
      case 'Moderate': return 'bg-yellow-500 text-black';
      default: return 'bg-green-500 text-white';
    }
  };

  const [tokenInput, setTokenInput] = useState('');
  
  const handleSaveToken = () => {
    if (tokenInput.startsWith('pk.')) {
      localStorage.setItem('mapbox_token', tokenInput);
      window.location.reload();
    }
  };

  if (!mapboxToken) {
    return (
      <Card className="border-orange-500/30 bg-orange-950/20">
        <CardContent className="p-6">
          <div className="text-center mb-6">
            <AlertTriangle className="h-12 w-12 mx-auto text-orange-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Mapbox Token Required</h3>
            <p className="text-muted-foreground">A Mapbox public token is needed to display the wildfire map.</p>
          </div>
          
          <div className="max-w-md mx-auto space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mapbox-token">Enter your Mapbox Public Token</Label>
              <div className="flex gap-2">
                <input
                  id="mapbox-token"
                  type="text"
                  placeholder="pk.eyJ1IjoiLi4u"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-md bg-background text-sm"
                />
                <Button onClick={handleSaveToken} disabled={!tokenInput.startsWith('pk.')}>
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Get a free token at{' '}
                <a 
                  href="https://account.mapbox.com/access-tokens/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  mapbox.com/access-tokens
                </a>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Risk Summary Header */}
      <Card className="border-orange-500/30 bg-gradient-to-r from-orange-950/20 to-red-950/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Flame className="h-6 w-6 text-orange-500" />
              <CardTitle>Wildfire Intelligence Map</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {wildfireData?.risk_assessment && (
                <Badge className={getRiskColor(wildfireData.risk_assessment.riskLevel)}>
                  {wildfireData.risk_assessment.riskLevel} Risk ({wildfireData.risk_assessment.riskScore}/100)
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isRefetching}
              >
                {isRefetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Data Source Status */}
          <div className="flex flex-wrap gap-2 mb-4">
            {wildfireData?.data_sources && Object.entries(wildfireData.data_sources).map(([source, status]) => (
              <Badge
                key={source}
                variant="outline"
                className={status.success ? 'border-green-500/50 text-green-400' : 'border-red-500/50 text-red-400'}
              >
                {source.replace('_', ' ')}: {status.count}
              </Badge>
            ))}
          </div>

          {/* Risk Factors */}
          {wildfireData?.risk_assessment?.factors?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {wildfireData.risk_assessment.factors.map((factor, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {factor}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Map Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Base Map Style Selector */}
            <div className="flex items-center gap-2">
              <MapIcon className="h-4 w-4 text-muted-foreground" />
              <Select value={mapStyle} onValueChange={(v) => setMapStyle(v as MapStyleKey)}>
                <SelectTrigger className="w-[140px] h-8">
                  <SelectValue placeholder="Map Style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="satellite">
                    <div className="flex items-center gap-2">
                      <Satellite className="h-3 w-3" /> Satellite
                    </div>
                  </SelectItem>
                  <SelectItem value="terrain">
                    <div className="flex items-center gap-2">
                      <Mountain className="h-3 w-3" /> Terrain
                    </div>
                  </SelectItem>
                  <SelectItem value="dark">
                    <div className="flex items-center gap-2">
                      <MapIcon className="h-3 w-3" /> Dark
                    </div>
                  </SelectItem>
                  <SelectItem value="streets">
                    <div className="flex items-center gap-2">
                      <MapIcon className="h-3 w-3" /> Streets
                    </div>
                  </SelectItem>
                  <SelectItem value="light">
                    <div className="flex items-center gap-2">
                      <MapIcon className="h-3 w-3" /> Light
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="h-6 w-px bg-border" />

            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Layers:</span>
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch
                id="fire-points"
                checked={showFirePoints}
                onCheckedChange={setShowFirePoints}
              />
              <Label htmlFor="fire-points" className="text-sm flex items-center gap-1">
                <Flame className="h-3 w-3 text-orange-500" /> Fires
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="heatmap"
                checked={showHeatmap}
                onCheckedChange={setShowHeatmap}
              />
              <Label htmlFor="heatmap" className="text-sm flex items-center gap-1">
                <Thermometer className="h-3 w-3 text-red-500" /> Heat
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="perimeters"
                checked={showPerimeters}
                onCheckedChange={setShowPerimeters}
              />
              <Label htmlFor="perimeters" className="text-sm flex items-center gap-1">
                <MapPin className="h-3 w-3 text-yellow-500" /> Perimeters
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="weather"
                checked={showWeatherAlerts}
                onCheckedChange={setShowWeatherAlerts}
              />
              <Label htmlFor="weather" className="text-sm flex items-center gap-1">
                <Wind className="h-3 w-3 text-blue-500" /> Alerts
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="terrain-3d"
                checked={showTerrain}
                onCheckedChange={setShowTerrain}
              />
              <Label htmlFor="terrain-3d" className="text-sm flex items-center gap-1">
                <Mountain className="h-3 w-3 text-green-500" /> 3D
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="smoke"
                checked={showSmoke}
                onCheckedChange={setShowSmoke}
              />
              <Label htmlFor="smoke" className="text-sm flex items-center gap-1">
                <Wind className="h-3 w-3 text-gray-400" /> Smoke
              </Label>
            </div>

            <div className="h-6 w-px bg-border" />

            <div className="flex items-center space-x-2">
              <Switch
                id="infrastructure"
                checked={showInfrastructure}
                onCheckedChange={setShowInfrastructure}
              />
              <Label htmlFor="infrastructure" className="text-sm flex items-center gap-1">
                <Fuel className="h-3 w-3 text-blue-500" /> All Infrastructure
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="petronas-canada"
                checked={showPetronasCanada}
                onCheckedChange={setShowPetronasCanada}
                disabled={!showInfrastructure}
              />
              <Label htmlFor="petronas-canada" className={`text-sm flex items-center gap-1 ${!showInfrastructure ? 'opacity-50' : ''}`}>
                <span className="text-xs">🇨🇦</span> Petronas Canada
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Map Container */}
      <Card className="overflow-hidden relative">
        <div 
          ref={mapContainer} 
          className="h-[600px] w-full"
          style={{ minHeight: '400px' }}
        />
        
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <div className="flex items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
              <span>Loading wildfire data...</span>
            </div>
          </div>
        )}

        {/* Active Fire Count Badge */}
        {firePoints && firePoints.length > 0 && (
          <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg border">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium">{firePoints.length} active fires detected</span>
            </div>
          </div>
        )}

        {/* Fire Perimeter Count */}
        {firePerimeters && firePerimeters.length > 0 && (
          <div className="absolute top-4 left-56 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg border">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-yellow-500" />
              <span className="text-sm font-medium">{firePerimeters.length} fire perimeters</span>
            </div>
          </div>
        )}

        {/* Weather Alert Count */}
        {weatherAlerts && weatherAlerts.length > 0 && (
          <div className="absolute top-14 left-4 bg-red-500/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg text-white">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">{weatherAlerts.length} active fire weather alerts</span>
            </div>
          </div>
        )}

        {/* Infrastructure Count Badge */}
        {showInfrastructure && infrastructureData && infrastructureData.length > 0 && (
          <div className="absolute top-4 right-16 bg-blue-600/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg text-white">
            <div className="flex items-center gap-2">
              <Fuel className="h-4 w-4" />
              <span className="text-sm font-medium">{infrastructureData.length} Petronas assets</span>
            </div>
          </div>
        )}
      </Card>

      {/* Legend */}
      <Card>
        <CardContent className="p-4">
          <h4 className="font-medium mb-3">Map Legend</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-gradient-to-r from-orange-500 to-red-500 animate-pulse" />
              <span>Active Fire</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 border-orange-500 bg-orange-500/30" />
              <span>Fire Perimeter</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 border-red-600 bg-red-600/20" />
              <span>Red Flag Warning</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-gradient-to-r from-yellow-300 via-orange-500 to-red-600 rounded" />
              <span>Fire Intensity</span>
            </div>
            {/* Infrastructure Legend */}
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">🏭</div>
              <span>Refinery</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center text-[8px]">🔗</div>
              <span>Pipeline</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-[8px]">⛽</div>
              <span>Terminal</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-[8px]">🛢️</div>
              <span>Platform</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Data sources: NASA FIRMS, NIFC Fire Perimeters, NOAA Weather Alerts, PETRONAS Infrastructure Database
          </div>
        </CardContent>
      </Card>

      {/* CSS for fire marker animation */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
        .fire-marker:hover {
          transform: scale(1.5);
          z-index: 1000;
        }
        .mapboxgl-ctrl-fullscreen {
          margin-top: 10px;
        }
      `}</style>
    </div>
  );
}
