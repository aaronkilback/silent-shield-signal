import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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

  const handleSaveToken = () => {
    if (tokenInput.trim()) {
      localStorage.setItem("mapbox_token", tokenInput.trim());
      setMapboxToken(tokenInput.trim());
      setShowTokenInput(false);
    }
  };

  useEffect(() => {
    if (!mapContainer.current || !mapboxToken || !travelers) return;

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

    // Add markers for each traveler
    const bounds = new mapboxgl.LngLatBounds();

    travelers.forEach((traveler) => {
      if (!traveler.current_location) return;

      // Parse location string to coordinates
      const coords = parseLocation(traveler.current_location);
      if (!coords) return;

      // Create custom marker
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
    });

    if (travelers.length > 0) {
      map.current.fitBounds(bounds, { padding: 100 });
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [mapboxToken, travelers]);

  const parseLocation = (location: string): [number, number] | null => {
    // Try to parse coordinates from various formats
    const coordMatch = location.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
    if (coordMatch) {
      return [parseFloat(coordMatch[2]), parseFloat(coordMatch[1])];
    }
    return null;
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
        <h2 className="text-xl font-semibold">Live Traveler Locations</h2>
        <Button variant="outline" size="sm" onClick={() => setShowTokenInput(true)}>
          Change Token
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div ref={mapContainer} className="w-full h-[600px]" />
      </Card>

      {travelers && travelers.length === 0 && (
        <Card className="p-6 text-center text-muted-foreground">
          No travelers with active locations to display on the map.
        </Card>
      )}
    </div>
  );
}
