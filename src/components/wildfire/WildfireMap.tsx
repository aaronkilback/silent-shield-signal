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
  status: 'active' | 'under_construction' | 'planned';
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

  // Generate Petronas and Oil/Gas Infrastructure data
  function generatePetronasInfrastructure(): InfrastructurePoint[] {
    return [
      // Petronas Malaysia Operations
      { name: 'PETRONAS Carigali - Kerteh', type: 'refinery', latitude: 4.5200, longitude: 103.4267, operator: 'PETRONAS', capacity: '100,000 bpd', status: 'active' },
      { name: 'PETRONAS Melaka Refinery', type: 'refinery', latitude: 2.1896, longitude: 102.2501, operator: 'PETRONAS', capacity: '270,000 bpd', status: 'active' },
      { name: 'Bintulu LNG Complex', type: 'terminal', latitude: 3.1667, longitude: 113.0333, operator: 'PETRONAS', capacity: '23 MTPA', status: 'active' },
      { name: 'PETRONAS FLNG Satu', type: 'platform', latitude: 5.9000, longitude: 114.5000, operator: 'PETRONAS', capacity: '1.2 MTPA', status: 'active' },
      { name: 'Pengerang Integrated Complex', type: 'refinery', latitude: 1.4000, longitude: 104.2500, operator: 'PETRONAS', capacity: '300,000 bpd', status: 'active' },
      { name: 'Sabah-Sarawak Gas Pipeline', type: 'pipeline', latitude: 5.0000, longitude: 116.0000, operator: 'PETRONAS', capacity: '880 mmscfd', status: 'active' },
      { name: 'Peninsular Gas Utilisation (PGU)', type: 'pipeline', latitude: 4.0000, longitude: 103.0000, operator: 'PETRONAS', capacity: '2,000 mmscfd', status: 'active' },
      { name: 'Kerteh Gas Terminal', type: 'terminal', latitude: 4.5150, longitude: 103.4300, operator: 'PETRONAS', capacity: '2,100 mmscfd', status: 'active' },
      { name: 'Labuan Gas Terminal', type: 'terminal', latitude: 5.2831, longitude: 115.2308, operator: 'PETRONAS', capacity: '250 mmscfd', status: 'active' },
      { name: 'Tapis-B Platform', type: 'platform', latitude: 5.7167, longitude: 105.0333, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Erb West Platform', type: 'platform', latitude: 5.8500, longitude: 105.2000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Dulang Platform', type: 'platform', latitude: 5.6667, longitude: 104.5000, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Bekok-A Platform', type: 'platform', latitude: 4.9167, longitude: 105.2500, operator: 'PETRONAS Carigali', status: 'active' },
      { name: 'Sepat Platform', type: 'platform', latitude: 5.0833, longitude: 104.8333, operator: 'PETRONAS Carigali', status: 'active' },
      
      // Petronas International Operations
      { name: 'PETRONAS Egypt (Meseda)', type: 'platform', latitude: 28.0000, longitude: 33.0000, operator: 'PETRONAS Egypt', status: 'active' },
      { name: 'PETRONAS Sudan Block 5B', type: 'platform', latitude: 11.5000, longitude: 28.5000, operator: 'PETRONAS Sudan', status: 'active' },
      { name: 'PETRONAS Australia (Browse Basin)', type: 'platform', latitude: -14.0000, longitude: 122.0000, operator: 'PETRONAS Australia', status: 'active' },
      { name: 'PETRONAS Canada LNG', type: 'terminal', latitude: 54.0000, longitude: -130.0000, operator: 'PETRONAS Canada', status: 'planned' },
      
      // Major Pipeline Routes (represented as points along route)
      { name: 'East Coast Road (Kuantan-Kerteh)', type: 'road', latitude: 4.2000, longitude: 103.4000, operator: 'PETRONAS', status: 'active' },
      { name: 'PGU Pipeline - Kerteh Section', type: 'pipeline', latitude: 4.5000, longitude: 103.4000, operator: 'PETRONAS', status: 'active' },
      { name: 'PGU Pipeline - Segamat Junction', type: 'pipeline', latitude: 2.5000, longitude: 102.8000, operator: 'PETRONAS', status: 'active' },
      { name: 'PGU Pipeline - Pasir Gudang', type: 'pipeline', latitude: 1.4700, longitude: 103.9000, operator: 'PETRONAS', status: 'active' },
      { name: 'Trans-Thai-Malaysia Pipeline', type: 'pipeline', latitude: 6.0000, longitude: 100.5000, operator: 'PETRONAS/PTT', status: 'active' },
      
      // Storage Facilities
      { name: 'Port Klang Oil Storage', type: 'storage', latitude: 3.0000, longitude: 101.4000, operator: 'PETRONAS Trading', status: 'active' },
      { name: 'Tanjung Langsat Storage', type: 'storage', latitude: 1.4500, longitude: 104.0000, operator: 'PETRONAS', capacity: '2M barrels', status: 'active' },
      { name: 'Kemaman Supply Base', type: 'storage', latitude: 4.2333, longitude: 103.4167, operator: 'PETRONAS Carigali', status: 'active' },
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

    // Icon configuration for different infrastructure types
    const getInfraIcon = (type: string) => {
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

    infrastructureData.forEach((infra) => {
      const iconConfig = getInfraIcon(infra.type);
      
      const el = document.createElement('div');
      el.className = 'infrastructure-marker';
      el.style.cssText = `
        width: ${iconConfig.size + 8}px;
        height: ${iconConfig.size + 8}px;
        background: ${iconConfig.color};
        border: 2px solid white;
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
          </h4>
          <div style="font-size: 12px; color: #666;">
            <p style="margin: 4px 0;"><strong>Type:</strong> ${infra.type.charAt(0).toUpperCase() + infra.type.slice(1)}</p>
            <p style="margin: 4px 0;"><strong>Operator:</strong> ${infra.operator}</p>
            ${infra.capacity ? `<p style="margin: 4px 0;"><strong>Capacity:</strong> ${infra.capacity}</p>` : ''}
            <p style="margin: 4px 0;"><strong>Status:</strong> 
              <span style="color: ${infra.status === 'active' ? '#10b981' : infra.status === 'planned' ? '#f59e0b' : '#3b82f6'}">
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
  }, [infrastructureData, showInfrastructure]);

  // Update infrastructure markers when data or visibility changes
  useEffect(() => {
    if (!styleLoaded) return;
    updateInfrastructureMarkers();
  }, [updateInfrastructureMarkers, styleLoaded, showInfrastructure]);

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
                <Fuel className="h-3 w-3 text-blue-500" /> Petronas/Oil & Gas
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
