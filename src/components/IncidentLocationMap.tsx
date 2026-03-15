import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface IncidentLocationMapProps {
  location: string | null;
}

export const IncidentLocationMap = ({ location }: IncidentLocationMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapboxToken, setMapboxToken] = useState<string>('');
  const [showTokenInput, setShowTokenInput] = useState(false);

  useEffect(() => {
    const rawStored = localStorage.getItem('mapbox_token');
  const savedToken = (rawStored && rawStored !== 'your_mapbox_token_here') ? rawStored : null;
    if (savedToken) {
      setMapboxToken(savedToken);
    } else {
      setShowTokenInput(true);
    }
  }, []);

  const handleSaveToken = () => {
    if (mapboxToken.trim()) {
      localStorage.setItem('mapbox_token', mapboxToken.trim());
      setShowTokenInput(false);
    }
  };

  useEffect(() => {
    if (!location || !mapContainer.current || !mapboxToken) return;

    // Initialize map
    mapboxgl.accessToken = mapboxToken;
    
    console.log('Fetching coordinates for location:', location);
    
    // Parse location string to get coordinates or city name
    // Try to geocode the location
    fetchCoordinates(location).then((coords) => {
      if (!coords || !mapContainer.current) return;

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        zoom: 10,
        center: [coords.lng, coords.lat],
      });

      // Add marker
      new mapboxgl.Marker({ color: '#ef4444' })
        .setLngLat([coords.lng, coords.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(
            `<div style="padding: 8px; color: #000;"><strong>Location:</strong><br/>${location}</div>`
          )
        )
        .addTo(map.current);

      // Add navigation controls
      map.current.addControl(
        new mapboxgl.NavigationControl(),
        'top-right'
      );
    });

    // Cleanup
    return () => {
      if (map.current) {
        try {
          map.current.remove();
        } catch (e) {
          // Ignore cleanup errors from map already being removed
          console.debug('Map cleanup completed');
        }
        map.current = null;
      }
    };
  }, [location, mapboxToken]);

  const fetchCoordinates = async (locationStr: string): Promise<{ lat: number; lng: number } | null> => {
    if (!mapboxToken) {
      console.error('Cannot geocode: Mapbox token is missing');
      return null;
    }
    
    try {
      // Filter out obviously non-geographic terms
      const nonGeoTerms = ['Provincial Jurisdiction', 'Industry News', 'National', 'Federal'];
      if (nonGeoTerms.some(term => locationStr.includes(term))) {
        console.warn('Location too vague to geocode:', locationStr);
        return null;
      }

      // Add Canada bias for better Canadian location results
      const searchQuery = locationStr.includes('Canada') ? locationStr : `${locationStr}, Canada`;
      
      // Use Mapbox Geocoding API to convert location string to coordinates
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${mapboxToken}&country=CA&limit=1`
      );
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const placeName = data.features[0].place_name;
        console.log(`Geocoded "${locationStr}" to "${placeName}":`, { lat, lng });
        return { lat, lng };
      }
      
      console.warn('No coordinates found for location:', locationStr);
      return null;
    } catch (error) {
      console.error('Error geocoding location:', error);
      return null;
    }
  };

  if (showTokenInput) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MapPin className="w-4 h-4" />
          <span>Configure Mapbox</span>
        </div>
        <p className="text-sm text-muted-foreground">
          To display maps, enter your Mapbox public token. Get one at{' '}
          <a 
            href="https://account.mapbox.com/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            mapbox.com
          </a>
        </p>
        <div className="space-y-2">
          <Label htmlFor="mapbox-token">Mapbox Public Token</Label>
          <Input
            id="mapbox-token"
            type="text"
            placeholder="pk.eyJ1..."
            value={mapboxToken}
            onChange={(e) => setMapboxToken(e.target.value)}
          />
        </div>
        <Button onClick={handleSaveToken} disabled={!mapboxToken.trim()}>
          Save Token
        </Button>
      </div>
    );
  }

  if (!location) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-4 text-center text-muted-foreground">
        <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No location data available</p>
      </div>
    );
  }

  // Check if location is too vague to map
  const nonGeoTerms = ['Provincial Jurisdiction', 'Industry News', 'National', 'Federal'];
  const isTooVague = nonGeoTerms.some(term => location.includes(term));

  if (isTooVague) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-4 text-center">
        <MapPin className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">Location: {location}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Location information is too general to display on map
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm font-medium">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          <span>Location: {location}</span>
        </div>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => {
            localStorage.removeItem('mapbox_token');
            setMapboxToken('');
            setShowTokenInput(true);
          }}
        >
          Change Token
        </Button>
      </div>
      <div ref={mapContainer} className="w-full h-64 rounded-lg overflow-hidden border border-border" />
    </div>
  );
};
