import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin } from 'lucide-react';

interface IncidentLocationMapProps {
  location: string | null;
}

export const IncidentLocationMap = ({ location }: IncidentLocationMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!location || !mapContainer.current) return;

    const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
    
    if (!mapboxToken) {
      console.error('Mapbox token is not configured. Please add VITE_MAPBOX_TOKEN to your environment variables.');
      return;
    }

    // Initialize map
    mapboxgl.accessToken = mapboxToken;
    
    console.log('Fetching coordinates for location:', location);
    
    // Parse location string to get coordinates or city name
    // Try to geocode the location
    fetchCoordinates(location).then((coords) => {
      if (!coords || !mapContainer.current) return;

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
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
      map.current?.remove();
    };
  }, [location]);

  const fetchCoordinates = async (locationStr: string): Promise<{ lat: number; lng: number } | null> => {
    const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
    
    if (!mapboxToken) {
      console.error('Cannot geocode: Mapbox token is missing');
      return null;
    }
    
    try {
      console.log('Geocoding location:', locationStr);
      // Use Mapbox Geocoding API to convert location string to coordinates
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationStr)}.json?access_token=${mapboxToken}&limit=1`
      );
      
      if (!response.ok) {
        console.error('Geocoding API error:', response.status, response.statusText);
        return null;
      }
      
      const data = await response.json();
      console.log('Geocoding response:', data);
      
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        console.log('Found coordinates:', { lat, lng });
        return { lat, lng };
      }
      console.warn('No coordinates found for location:', locationStr);
      return null;
    } catch (error) {
      console.error('Error geocoding location:', error);
      return null;
    }
  };

  if (!location) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-4 text-center text-muted-foreground">
        <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No location data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MapPin className="w-4 h-4" />
        <span>Location: {location}</span>
      </div>
      <div ref={mapContainer} className="w-full h-64 rounded-lg overflow-hidden border border-border" />
    </div>
  );
};
