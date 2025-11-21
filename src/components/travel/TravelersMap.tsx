import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plane } from "lucide-react";
import { renderToString } from "react-dom/server";

export function TravelersMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapboxToken, setMapboxToken] = useState<string | null>(
    localStorage.getItem("mapbox_token") || import.meta.env.VITE_MAPBOX_TOKEN || null
  );
  const [showTokenInput, setShowTokenInput] = useState(!mapboxToken);
  const [tokenInput, setTokenInput] = useState("");

  const { data: travelers } = useQuery({
    queryKey: ["travelers-with-location"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("travelers")
        .select("*")
        .not("current_location", "is", null)
        .neq("current_location", "");
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: activeItineraries } = useQuery({
    queryKey: ["active-itineraries"],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("itineraries")
        .select(`
          *,
          travelers:traveler_id (*)
        `)
        .lte("departure_date", now)
        .gte("return_date", now)
        .eq("status", "active");
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000,
  });

  const handleSaveToken = () => {
    if (tokenInput.trim()) {
      localStorage.setItem("mapbox_token", tokenInput.trim());
      setMapboxToken(tokenInput.trim());
      setShowTokenInput(false);
    }
  };

  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;

    if (!map.current) {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [0, 20],
        zoom: 2,
      });

      map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    }

    // Clear existing markers
    const markers = document.querySelectorAll(".mapboxgl-marker");
    markers.forEach((marker) => marker.remove());

    const bounds = new mapboxgl.LngLatBounds();
    let hasMarkers = false;

    // Add markers for each traveler
    if (travelers) {
      travelers.forEach((traveler) => {
        if (!traveler.current_location) return;

        const coords = parseLocation(traveler.current_location);
        if (!coords) return;

        const el = document.createElement("div");
        el.className = "w-8 h-8 rounded-full border-4 border-white shadow-lg cursor-pointer";
        el.style.backgroundColor = traveler.map_color;

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div class="p-2">
            <h3 class="font-semibold">${traveler.name}</h3>
            <p class="text-sm text-muted-foreground">${traveler.current_location}</p>
            ${traveler.current_country ? `<p class="text-sm">${traveler.current_country}</p>` : ""}
            ${
              traveler.last_location_update
                ? `<p class="text-xs text-muted-foreground mt-1">
                    Updated: ${new Date(traveler.last_location_update).toLocaleString()}
                  </p>`
                : ""
            }
          </div>
        `);

        new mapboxgl.Marker(el)
          .setLngLat(coords)
          .setPopup(popup)
          .addTo(map.current!);

        bounds.extend(coords);
        hasMarkers = true;
      });
    }

    // Add markers for active itineraries
    if (activeItineraries) {
      activeItineraries.forEach((itinerary) => {
        const destinationCoords = getCityCoordinates(
          itinerary.destination_city,
          itinerary.destination_country
        );
        if (!destinationCoords) return;

        // Create plane icon marker
        const el = document.createElement("div");
        el.className = "w-10 h-10 rounded-full bg-blue-500 border-4 border-white shadow-lg cursor-pointer flex items-center justify-center";
        el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"></path></svg>`;

        const travelerName = itinerary.travelers?.name || "Traveler";
        const daysRemaining = Math.ceil(
          (new Date(itinerary.return_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div class="p-2">
            <div class="flex items-center gap-2 mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"></path></svg>
              <h3 class="font-semibold">${itinerary.trip_name}</h3>
            </div>
            <p class="text-sm font-medium">${travelerName}</p>
            <p class="text-sm text-muted-foreground">${itinerary.destination_city}, ${itinerary.destination_country}</p>
            <p class="text-xs text-muted-foreground mt-1">
              ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining
            </p>
            ${itinerary.risk_level ? `<p class="text-xs mt-1"><span class="px-2 py-0.5 rounded text-xs font-medium ${
              itinerary.risk_level === "high" || itinerary.risk_level === "critical"
                ? "bg-red-100 text-red-800"
                : itinerary.risk_level === "medium"
                ? "bg-yellow-100 text-yellow-800"
                : "bg-green-100 text-green-800"
            }">${itinerary.risk_level.toUpperCase()} RISK</span></p>` : ""}
          </div>
        `);

        new mapboxgl.Marker(el)
          .setLngLat(destinationCoords)
          .setPopup(popup)
          .addTo(map.current!);

        bounds.extend(destinationCoords);
        hasMarkers = true;
      });
    }

    if (hasMarkers) {
      map.current.fitBounds(bounds, { padding: 100 });
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [mapboxToken, travelers, activeItineraries]);

  const parseLocation = (location: string): [number, number] | null => {
    // Try to parse coordinates from various formats
    const coordMatch = location.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
    if (coordMatch) {
      return [parseFloat(coordMatch[2]), parseFloat(coordMatch[1])];
    }
    return null;
  };

  const getCityCoordinates = (city: string, country: string): [number, number] | null => {
    // Major city coordinates database
    const cityCoords: Record<string, [number, number]> = {
      // North America
      "new york": [-74.006, 40.7128],
      "los angeles": [-118.2437, 34.0522],
      "chicago": [-87.6298, 41.8781],
      "toronto": [-79.3832, 43.6532],
      "vancouver": [-123.1207, 49.2827],
      "mexico city": [-99.1332, 19.4326],
      
      // Europe
      "london": [-0.1276, 51.5074],
      "paris": [2.3522, 48.8566],
      "berlin": [13.4050, 52.5200],
      "rome": [12.4964, 41.9028],
      "madrid": [-3.7038, 40.4168],
      "amsterdam": [4.9041, 52.3676],
      "barcelona": [2.1734, 41.3851],
      "vienna": [16.3738, 48.2082],
      "zurich": [8.5417, 47.3769],
      
      // Asia
      "tokyo": [139.6917, 35.6895],
      "beijing": [116.4074, 39.9042],
      "shanghai": [121.4737, 31.2304],
      "hong kong": [114.1694, 22.3193],
      "singapore": [103.8198, 1.3521],
      "dubai": [55.2708, 25.2048],
      "mumbai": [72.8777, 19.0760],
      "delhi": [77.1025, 28.7041],
      "bangkok": [100.5018, 13.7563],
      "seoul": [126.9780, 37.5665],
      
      // Australia/Oceania
      "sydney": [151.2093, -33.8688],
      "melbourne": [144.9631, -37.8136],
      "auckland": [174.7633, -36.8485],
      
      // South America
      "são paulo": [-46.6333, -23.5505],
      "rio de janeiro": [-43.1729, -22.9068],
      "buenos aires": [-58.3816, -34.6037],
      "lima": [-77.0428, -12.0464],
      
      // Africa
      "cairo": [31.2357, 30.0444],
      "johannesburg": [28.0473, -26.2041],
      "lagos": [3.3792, 6.5244],
      "nairobi": [36.8219, -1.2921],
    };

    const cityKey = city.toLowerCase();
    return cityCoords[cityKey] || null;
  };

  if (showTokenInput) {
    return (
      <Card className="p-6 max-w-md mx-auto">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Mapbox Token Required</h3>
            <p className="text-sm text-muted-foreground">
              Enter your Mapbox public token to display the travelers map.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mapbox-token">Mapbox Token</Label>
            <Input
              id="mapbox-token"
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="pk.eyJ1..."
            />
          </div>
          <Button onClick={handleSaveToken} className="w-full">
            Save Token
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Live Travel Map</h2>
          <p className="text-sm text-muted-foreground">
            Traveler locations and active itineraries
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowTokenInput(true)}>
          Change Token
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div ref={mapContainer} className="w-full h-[600px]" />
      </Card>

      {travelers && travelers.length === 0 && activeItineraries && activeItineraries.length === 0 && (
        <Card className="p-6 text-center text-muted-foreground">
          No active travelers or itineraries to display on the map.
        </Card>
      )}
      
      <div className="flex gap-4 justify-center text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-white shadow-lg bg-blue-500" />
          <span>Traveler Location</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-white shadow-lg bg-blue-500 flex items-center justify-center">
            <Plane className="h-3 w-3 text-white" />
          </div>
          <span>Active Trip Destination</span>
        </div>
      </div>
    </div>
  );
}
