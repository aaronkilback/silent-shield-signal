import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plane, MapPin, RefreshCw } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeStatus(dep: string, ret: string | null, type: string) {
  const now = new Date();
  const d = new Date(dep);
  if (type === "one_way") return d <= now ? "completed" : "upcoming";
  if (!ret) return d <= now ? "active" : "upcoming";
  const r = new Date(ret);
  if (r < now) return "completed";
  if (d <= now) return "active";
  return "upcoming";
}

// Extended city coords cache — checked before hitting Geocoding API
const CITY_COORDS: Record<string, [number, number]> = {
  "new york": [-74.006, 40.7128], "los angeles": [-118.2437, 34.0522],
  "chicago": [-87.6298, 41.8781], "toronto": [-79.3832, 43.6532],
  "vancouver": [-123.1207, 49.2827], "montreal": [-73.5673, 45.5017],
  "ottawa": [-75.6972, 45.4215], "calgary": [-114.0719, 51.0447],
  "edmonton": [-113.4938, 53.5461], "winnipeg": [-97.1384, 49.8951],
  "mexico city": [-99.1332, 19.4326], "washington": [-77.0369, 38.9072],
  "san francisco": [-122.4194, 37.7749], "miami": [-80.1918, 25.7617],
  "boston": [-71.0589, 42.3601], "seattle": [-122.3321, 47.6062],
  "dallas": [-96.797, 32.7767], "houston": [-95.3698, 29.7604],
  "phoenix": [-112.074, 33.4484], "denver": [-104.9903, 39.7392],
  "atlanta": [-84.388, 33.749], "las vegas": [-115.1398, 36.1699],
  "london": [-0.1276, 51.5074], "paris": [2.3522, 48.8566],
  "berlin": [13.405, 52.52], "rome": [12.4964, 41.9028],
  "madrid": [-3.7038, 40.4168], "amsterdam": [4.9041, 52.3676],
  "barcelona": [2.1734, 41.3851], "vienna": [16.3738, 48.2082],
  "zurich": [8.5417, 47.3769], "brussels": [4.3517, 50.8503],
  "prague": [14.4378, 50.0755], "dublin": [-6.2603, 53.3498],
  "lisbon": [-9.1393, 38.7223], "athens": [23.7275, 37.9838],
  "stockholm": [18.0686, 59.3293], "copenhagen": [12.5683, 55.6761],
  "oslo": [10.7522, 59.9139], "helsinki": [24.9384, 60.1695],
  "warsaw": [21.0122, 52.2297], "budapest": [19.0402, 47.4979],
  "munich": [11.582, 48.1351], "frankfurt": [8.6821, 50.1109],
  "hamburg": [9.9937, 53.5511], "milan": [9.1900, 45.4654],
  "tokyo": [139.6917, 35.6895], "beijing": [116.4074, 39.9042],
  "shanghai": [121.4737, 31.2304], "hong kong": [114.1694, 22.3193],
  "singapore": [103.8198, 1.3521], "dubai": [55.2708, 25.2048],
  "mumbai": [72.8777, 19.076], "delhi": [77.1025, 28.7041],
  "new delhi": [77.1025, 28.6139], "bangalore": [77.5946, 12.9716],
  "bangkok": [100.5018, 13.7563], "seoul": [126.978, 37.5665],
  "taipei": [121.5654, 25.033], "kuala lumpur": [101.6869, 3.139],
  "jakarta": [106.8456, -6.2088], "manila": [120.9842, 14.5995],
  "hanoi": [105.8342, 21.0285], "ho chi minh": [106.6297, 10.8231],
  "sydney": [151.2093, -33.8688], "melbourne": [144.9631, -37.8136],
  "brisbane": [153.0251, -27.4698], "perth": [115.8605, -31.9505],
  "auckland": [174.7633, -36.8485], "wellington": [174.7787, -41.2865],
  "sao paulo": [-46.6333, -23.5505], "rio de janeiro": [-43.1729, -22.9068],
  "buenos aires": [-58.3816, -34.6037], "lima": [-77.0428, -12.0464],
  "santiago": [-70.6693, -33.4489], "bogota": [-74.0721, 4.711],
  "cairo": [31.2357, 30.0444], "johannesburg": [28.0473, -26.2041],
  "lagos": [3.3792, 6.5244], "nairobi": [36.8219, -1.2921],
  "casablanca": [-7.5898, 33.5731], "accra": [-0.187, 5.6037],
  "cape town": [18.4241, -33.9249], "addis ababa": [38.7469, 9.145],
  "istanbul": [28.9784, 41.0082], "moscow": [37.6173, 55.7558],
  "riyadh": [46.6753, 24.6877], "tel aviv": [34.7818, 32.0853],
  "karachi": [67.0099, 24.8608], "lahore": [74.3587, 31.5204],
  "dhaka": [90.3563, 23.8103], "colombo": [79.8612, 6.9271],
};

const geocodeCache: Record<string, [number, number] | null> = {};

async function geocodeCity(city: string, country: string, token: string): Promise<[number, number] | null> {
  const key = (city + "," + country).toLowerCase().trim();
  const cached = geocodeCache[key];
  if (cached !== undefined) return cached;

  // Check static cache first
  const staticKey = city.toLowerCase().trim();
  if (CITY_COORDS[staticKey]) {
    geocodeCache[key] = CITY_COORDS[staticKey];
    return CITY_COORDS[staticKey];
  }

  try {
    const query = encodeURIComponent(`${city}${country ? ", " + country : ""}`);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?types=place,locality,region&limit=1&access_token=${token}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.features?.length > 0) {
      const [lng, lat] = json.features[0].center;
      geocodeCache[key] = [lng, lat];
      return [lng, lat];
    }
  } catch (e) {
    console.warn("[TravelersMap] Geocode failed for", city, e);
  }
  geocodeCache[key] = null;
  return null;
}

function parseCoordString(location: string): [number, number] | null {
  const m = location.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
  if (m) return [parseFloat(m[2]), parseFloat(m[1])]; // lng, lat
  return null;
}

// Draw a curved arc between two points as a GeoJSON LineString
function buildArcGeoJSON(from: [number, number], to: [number, number], id: string) {
  const steps = 50;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lng = from[0] + (to[0] - from[0]) * t;
    const lat = from[1] + (to[1] - from[1]) * t;
    // Slight arc: lift midpoint
    const arc = Math.sin(Math.PI * t) * 8;
    coords.push([lng, lat + arc]);
  }
  return { type: "Feature" as const, id, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TravelersMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const arcsAddedRef = useRef(false);

  const getValidToken = (): string | null => {
    const stored = localStorage.getItem("mapbox_token");
    if (stored && stored !== "your_mapbox_token_here") return stored;
    const env = import.meta.env.VITE_MAPBOX_TOKEN;
    if (env && env !== "your_mapbox_token_here") return env;
    return null;
  };

  const [mapboxToken, setMapboxToken] = useState<string | null>(getValidToken);
  const [showTokenInput, setShowTokenInput] = useState(!getValidToken());
  const [tokenInput, setTokenInput] = useState("");
  const [mapReady, setMapReady] = useState(false);

  const { data: travelers, refetch: refetchTravelers } = useQuery({
    queryKey: ["travelers-with-location"],
    queryFn: async () => {
      const { data, error } = await supabase.from("travelers").select("*");
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000,
  });

  const { data: allItineraries, refetch: refetchItineraries } = useQuery({
    queryKey: ["itineraries-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("itineraries")
        .select(`*, travelers:traveler_id (*)`)
        .order("departure_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000,
  });

  // Filter to active/current trips client-side (more reliable than DB date filter with stale status)
  const activeItineraries = allItineraries?.filter(
    (it) => computeStatus(it.departure_date, it.return_date, it.trip_type) === "active"
  );

  const handleSaveToken = () => {
    const tok = tokenInput.trim();
    if (tok?.startsWith("pk.")) {
      localStorage.setItem("mapbox_token", tok);
      setMapboxToken(tok);
      setShowTokenInput(false);
    } else if (tok) {
      alert("Please enter a valid Mapbox public token (starts with pk.)");
    }
  };

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || !mapboxToken || map.current) return;
    mapboxgl.accessToken = mapboxToken;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [0, 20],
      zoom: 1.5,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.current.on("load", () => setMapReady(true));
    return () => {
      if (map.current) {
        try { map.current.remove(); } catch {}
        map.current = null;
        arcsAddedRef.current = false;
        setMapReady(false);
      }
    };
  }, [mapboxToken]);

  // ── Draw markers + arcs whenever data changes ──────────────────────────────
  useEffect(() => {
    if (!mapReady || !map.current || !mapboxToken) return;

    const draw = async () => {
      // Clear old markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      // Clear old arc layers/sources
      try {
        const style = map.current!.getStyle();
        (style?.layers || []).forEach((l) => {
          if (l.id.startsWith("arc-")) map.current!.removeLayer(l.id);
        });
        Object.keys(style?.sources || {}).forEach((s) => {
          if (s.startsWith("arc-")) map.current!.removeSource(s);
        });
      } catch {}

      const bounds = new mapboxgl.LngLatBounds();
      let hasMarkers = false;

      // ── Traveler current location markers ───────────────────────────────
      for (const traveler of travelers || []) {
        if (!traveler.current_location) continue;
        let coords: [number, number] | null =
          parseCoordString(traveler.current_location) ||
          (await geocodeCity(traveler.current_location.split(",")[0].trim(), "", mapboxToken));
        if (!coords) continue;

        const el = document.createElement("div");
        el.className = "flex items-center justify-center w-9 h-9 rounded-full border-3 border-white shadow-lg cursor-pointer transition-transform hover:scale-110";
        el.style.backgroundColor = traveler.map_color || "#3b82f6";
        el.title = traveler.name;
        el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

        const popup = new mapboxgl.Popup({ offset: 25, className: "fortress-popup" }).setHTML(`
          <div style="font-family:system-ui;padding:8px 12px;min-width:160px">
            <div style="font-weight:600;font-size:14px;margin-bottom:4px">📍 ${traveler.name}</div>
            <div style="font-size:12px;color:#aaa">${traveler.current_location}</div>
            ${traveler.current_country ? `<div style="font-size:12px;color:#aaa">${traveler.current_country}</div>` : ""}
            ${traveler.last_location_update ? `<div style="font-size:11px;color:#666;margin-top:4px">Updated ${new Date(traveler.last_location_update).toLocaleString()}</div>` : ""}
          </div>
        `);

        const marker = new mapboxgl.Marker(el).setLngLat(coords).setPopup(popup).addTo(map.current!);
        markersRef.current.push(marker);
        bounds.extend(coords);
        hasMarkers = true;
      }

      // ── Active itinerary markers + arcs ─────────────────────────────────
      for (const itinerary of activeItineraries || []) {
        const originCoords = await geocodeCity(
          itinerary.origin_city,
          itinerary.origin_country,
          mapboxToken
        );
        const destCoords = await geocodeCity(
          itinerary.destination_city,
          itinerary.destination_country,
          mapboxToken
        );

        const travelerColor = (itinerary.travelers as any)?.map_color || "#3b82f6";
        const travelerName = (itinerary.travelers as any)?.name || "Traveler";
        const daysRemaining = itinerary.return_date
          ? Math.ceil((new Date(itinerary.return_date).getTime() - Date.now()) / 86400000)
          : null;

        const riskBg =
          itinerary.risk_level === "high" || itinerary.risk_level === "critical"
            ? "#dc2626"
            : itinerary.risk_level === "medium"
            ? "#d97706"
            : "#16a34a";

        const popupBody = `
          <div style="font-family:system-ui;padding:8px 12px;min-width:200px">
            <div style="font-weight:600;font-size:14px;margin-bottom:2px">✈ ${itinerary.trip_name}</div>
            <div style="font-size:12px;color:#aaa;margin-bottom:6px">${travelerName}</div>
            <div style="font-size:12px;margin-bottom:2px"><strong>Route:</strong> ${itinerary.origin_city} → ${itinerary.destination_city}</div>
            ${daysRemaining !== null ? `<div style="font-size:12px;color:#6ee7b7">${daysRemaining}d remaining</div>` : ""}
            ${itinerary.flight_numbers?.length ? `<div style="font-size:12px;margin-top:4px">Flights: ${itinerary.flight_numbers.join(", ")}</div>` : ""}
            ${itinerary.risk_level ? `<div style="margin-top:6px"><span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${riskBg}20;color:${riskBg};border:1px solid ${riskBg}40">${itinerary.risk_level.toUpperCase()} RISK</span></div>` : ""}
          </div>
        `;

        // Origin marker (home pin)
        if (originCoords) {
          const origEl = document.createElement("div");
          origEl.className = "w-4 h-4 rounded-full border-2 border-white shadow cursor-pointer";
          origEl.style.backgroundColor = travelerColor;
          origEl.style.opacity = "0.7";
          const origPopup = new mapboxgl.Popup({ offset: 18 }).setHTML(`
            <div style="font-family:system-ui;padding:6px 10px;font-size:12px">
              <strong>Origin:</strong> ${itinerary.origin_city}, ${itinerary.origin_country}
            </div>
          `);
          markersRef.current.push(
            new mapboxgl.Marker(origEl).setLngLat(originCoords).setPopup(origPopup).addTo(map.current!)
          );
          bounds.extend(originCoords);
          hasMarkers = true;
        }

        // Destination marker (plane icon)
        if (destCoords) {
          const destEl = document.createElement("div");
          destEl.style.cssText = `width:38px;height:38px;border-radius:50%;background:${travelerColor};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;display:flex;align-items:center;justify-content:center;`;
          destEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19 2c-2-2-4-2-5.5-.5L10 5 1.8 3.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 1 1h2l.5 2 1 .5.5-.5V17l3-2 7.2 7.2c.4.4.9.5 1.3.3l.5-.3c.4-.2.6-.6.5-1.1z"/></svg>`;
          const destPopup = new mapboxgl.Popup({ offset: 25 }).setHTML(popupBody);
          markersRef.current.push(
            new mapboxgl.Marker(destEl).setLngLat(destCoords).setPopup(destPopup).addTo(map.current!)
          );
          bounds.extend(destCoords);
          hasMarkers = true;

          // Arc from origin to destination
          if (originCoords) {
            const arcId = `arc-${itinerary.id}`;
            try {
              const arc = buildArcGeoJSON(originCoords, destCoords, arcId);
              map.current!.addSource(arcId, { type: "geojson", data: { type: "FeatureCollection", features: [arc] } });
              map.current!.addLayer({
                id: arcId,
                type: "line",
                source: arcId,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                  "line-color": travelerColor,
                  "line-width": 1.5,
                  "line-opacity": 0.5,
                  "line-dasharray": [2, 3],
                },
              });
            } catch {}
          }
        }
      }

      if (hasMarkers) {
        try { map.current!.fitBounds(bounds, { padding: 80, maxZoom: 8, duration: 800 }); } catch {}
      }
    };

    draw();
  }, [mapReady, travelers, activeItineraries, mapboxToken]);

  if (showTokenInput) {
    return (
      <Card className="p-6 max-w-md mx-auto">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Mapbox Token Required</h3>
            <p className="text-sm text-muted-foreground">
              Enter your Mapbox public token to display the travelers map.{" "}
              <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" className="underline text-blue-400">
                Get a free token
              </a>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mapbox-token">Mapbox Token</Label>
            <Input id="mapbox-token" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="pk.eyJ1..." />
          </div>
          <Button onClick={handleSaveToken} className="w-full">Save Token</Button>
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
            Current traveler locations · Active trip routes · Origin-to-destination arcs
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {activeItineraries && activeItineraries.length > 0 && (
            <Badge variant="default" className="gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {activeItineraries.length} active trip{activeItineraries.length !== 1 ? "s" : ""}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => { refetchTravelers(); refetchItineraries(); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowTokenInput(true)}>
            Change Token
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div ref={mapContainer} className="w-full h-[600px]" />
      </Card>

      {/* Legend */}
      <div className="flex gap-6 justify-center text-sm text-muted-foreground flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-white" />
          </div>
          <span>Traveler Current Location</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow opacity-70" />
          <span>Trip Origin</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow flex items-center justify-center">
            <Plane className="h-2.5 w-2.5 text-white" />
          </div>
          <span>Active Trip Destination</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-0.5 border-t-2 border-dashed border-blue-400 opacity-70" />
          <span>Flight Arc</span>
        </div>
      </div>

      {travelers?.length === 0 && (!activeItineraries || activeItineraries.length === 0) && (
        <Card className="p-6 text-center text-muted-foreground">
          No active travelers or itineraries to display. Add travelers with current locations or create an active itinerary.
        </Card>
      )}
    </div>
  );
}
