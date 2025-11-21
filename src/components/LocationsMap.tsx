import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface Location {
  id: string;
  name: string;
  current_location?: string | null;
  description?: string | null;
}

interface LocationsMapProps {
  locations: Location[];
}

export const LocationsMap = ({ locations }: LocationsMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapboxToken, setMapboxToken] = useState<string | null>(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    // Check if it's a placeholder or invalid token
    if (!token || token === 'your_mapbox_token_here') {
      return localStorage.getItem('mapbox_token');
    }
    return token;
  });
  const [tokenInput, setTokenInput] = useState('');

  useEffect(() => {
    if (!locations.length || !mapContainer.current || !mapboxToken) return;

    const locationsWithCoords = locations.filter(loc => loc.current_location);
    if (locationsWithCoords.length === 0) return;

    // Initialize map
    mapboxgl.accessToken = mapboxToken;
    
    // Geocode all locations and initialize map once we have coordinates
    geocodeAllLocations(locationsWithCoords).then((geocodedLocations) => {
      if (!geocodedLocations.length || !mapContainer.current) return;

      // Calculate bounds to fit all markers
      const bounds = new mapboxgl.LngLatBounds();
      geocodedLocations.forEach(loc => {
        bounds.extend([loc.lng, loc.lat]);
      });

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [geocodedLocations[0].lng, geocodedLocations[0].lat],
        zoom: 10,
      });

      // Fit map to show all markers with padding
      if (geocodedLocations.length > 1) {
        map.current.fitBounds(bounds, { padding: 50 });
      }

      // Add markers for each location
      geocodedLocations.forEach((loc) => {
        if (!map.current) return;

        new mapboxgl.Marker({ color: '#ef4444' })
          .setLngLat([loc.lng, loc.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(
              `<div style="padding: 8px; color: #000;">
                <strong>${loc.name}</strong><br/>
                ${loc.current_location || ''}
                ${loc.description ? `<br/><span style="font-size: 11px; color: #666;">${loc.description}</span>` : ''}
              </div>`
            )
          )
          .addTo(map.current);
      });

      // Add navigation controls
      map.current.addControl(
        new mapboxgl.NavigationControl(),
        'top-right'
      );
    });

    // Cleanup
    return () => {
      map.current?.remove();
    };
  }, [locations, mapboxToken]);

  const geocodeAllLocations = async (locs: Location[]): Promise<Array<Location & { lat: number; lng: number }>> => {
    const results = await Promise.all(
      locs.map(async (loc) => {
        if (!loc.current_location) return null;
        
        const coords = await fetchCoordinates(loc.current_location);
        if (!coords) return null;
        
        return { ...loc, ...coords };
      })
    );
    
    return results.filter((r): r is Location & { lat: number; lng: number } => r !== null);
  };

  const fetchCoordinates = async (locationStr: string): Promise<{ lat: number; lng: number } | null> => {
    if (!mapboxToken) {
      console.error('Cannot geocode: Mapbox token is missing');
      return null;
    }
    
    try {
      // Filter out obviously non-geographic terms
      const nonGeoTerms = ['Provincial Jurisdiction', 'Industry News', 'National', 'Federal'];
      if (nonGeoTerms.some(term => locationStr.includes(term))) {
        return null;
      }

      // Add Canada bias for better Canadian location results
      const searchQuery = locationStr.includes('Canada') ? locationStr : `${locationStr}, Canada`;
      
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${mapboxToken}&country=CA&limit=1`
      );
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        return { lat, lng };
      }
      
      return null;
    } catch (error) {
      console.error('Error geocoding location:', error);
      return null;
    }
  };

  const handleSaveToken = () => {
    if (tokenInput.trim()) {
      localStorage.setItem('mapbox_token', tokenInput.trim());
      setMapboxToken(tokenInput.trim());
    }
  };

  if (!mapboxToken) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-6 text-center">
        <MapPin className="w-8 h-8 mx-auto mb-3 opacity-50" />
        <h3 className="font-semibold mb-2">Mapbox Token Required</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Enter your Mapbox public token to display the map.
        </p>
        <div className="flex gap-2 max-w-md mx-auto">
          <Input
            type="text"
            placeholder="pk.eyJ1Ijo..."
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="flex-1"
          />
          <Button onClick={handleSaveToken}>Save</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Get your token at{' '}
          <a href="https://mapbox.com" target="_blank" rel="noopener noreferrer" className="underline">
            mapbox.com
          </a>
        </p>
      </div>
    );
  }

  if (!locations.some(loc => loc.current_location)) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
        <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No mappable locations available</p>
      </div>
    );
  }

  return (
    <div ref={mapContainer} className="w-full h-96 rounded-lg overflow-hidden border border-border" />
  );
};
