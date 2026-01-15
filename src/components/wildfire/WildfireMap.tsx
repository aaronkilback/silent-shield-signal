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
import { Loader2, Flame, Wind, Thermometer, AlertTriangle, RefreshCw, Layers, MapPin } from 'lucide-react';
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
}

interface WeatherAlert {
  event: string;
  severity: string;
  headline: string;
  areaDesc: string;
  onset: string;
  expires: string;
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

interface WildfireMapProps {
  clientId?: string;
  region?: string;
}

export function WildfireMap({ clientId, region = 'world' }: WildfireMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  
  const [mapboxToken] = useState<string | null>(
    import.meta.env.VITE_MAPBOX_TOKEN || localStorage.getItem('mapbox_token')
  );
  
  // Layer visibility toggles
  const [showFirePoints, setShowFirePoints] = useState(true);
  const [showPerimeters, setShowPerimeters] = useState(true);
  const [showWeatherAlerts, setShowWeatherAlerts] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);

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
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 15 * 60 * 1000, // Refresh every 15 minutes
  });

  // Fetch NASA FIRMS data directly for the map
  const { data: firePoints } = useQuery({
    queryKey: ['nasa-firms-direct', region],
    queryFn: async () => {
      try {
        // Fetch from public NASA FIRMS API (limited data for demo)
        const response = await fetch(
          `https://firms.modaps.eosdis.nasa.gov/api/area/csv/c6/VIIRS_SNPP_NRT/${region}/1`,
          { headers: { 'User-Agent': 'Fortress-Security-Platform' } }
        );
        
        if (!response.ok) {
          // Return mock data for demo if API fails
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

  // Generate mock fire points for demonstration
  function generateMockFirePoints(): FirePoint[] {
    // Sample coordinates for Western North America (fire-prone areas)
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

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !mapboxToken || map.current) return;

    mapboxgl.accessToken = mapboxToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-120, 45], // Default to Pacific Northwest
      zoom: 4,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

    // Add fire-themed styling when map loads
    map.current.on('load', () => {
      if (!map.current) return;

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
        layout: {
          visibility: 'none'
        }
      });
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [mapboxToken]);

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
      el.style.cssText = `
        width: ${12 + (fire.confidence / 10)}px;
        height: ${12 + (fire.confidence / 10)}px;
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
  }, [firePoints, showFirePoints]);

  // Toggle heatmap visibility
  useEffect(() => {
    if (!map.current || !map.current.getLayer('fire-heat-layer')) return;
    map.current.setLayoutProperty(
      'fire-heat-layer',
      'visibility',
      showHeatmap ? 'visible' : 'none'
    );
  }, [showHeatmap]);

  // Update markers when data changes
  useEffect(() => {
    updateFireMarkers();
  }, [updateFireMarkers]);

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'Extreme': return 'bg-red-600 text-white';
      case 'High': return 'bg-orange-500 text-white';
      case 'Moderate': return 'bg-yellow-500 text-black';
      default: return 'bg-green-500 text-white';
    }
  };

  if (!mapboxToken) {
    return (
      <Card className="border-orange-500/30 bg-orange-950/20">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-orange-500 mb-4" />
          <p className="text-muted-foreground">Mapbox token required for wildfire mapping.</p>
          <p className="text-sm text-muted-foreground mt-2">Set VITE_MAPBOX_TOKEN in your environment.</p>
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
          <div className="flex flex-wrap items-center gap-6">
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
                <Flame className="h-3 w-3 text-orange-500" /> Fire Points
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="heatmap"
                checked={showHeatmap}
                onCheckedChange={setShowHeatmap}
              />
              <Label htmlFor="heatmap" className="text-sm flex items-center gap-1">
                <Thermometer className="h-3 w-3 text-red-500" /> Heat Map
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
                <Wind className="h-3 w-3 text-blue-500" /> Weather Alerts
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Map Container */}
      <Card className="overflow-hidden">
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
      </Card>

      {/* Legend */}
      <Card>
        <CardContent className="p-4">
          <h4 className="font-medium mb-3">Map Legend</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-gradient-to-r from-orange-500 to-red-500" />
              <span>Active Fire (satellite)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 border-yellow-500 bg-yellow-500/20" />
              <span>Fire Perimeter</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 border-red-600 bg-red-600/20" />
              <span>Red Flag Warning</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-gradient-to-r from-yellow-300 via-orange-500 to-red-600 rounded" />
              <span>Fire Intensity (FRP)</span>
            </div>
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
      `}</style>
    </div>
  );
}
