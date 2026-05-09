import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';

interface Location {
  id: string;
  name: string;
  current_location?: string | null;
  description?: string | null;
}

interface LocationsMapProps {
  locations: Location[];
}

/**
 * Locations map for the investigations page.
 *
 * Switched from Mapbox GL to Leaflet + OpenStreetMap tiles + Nominatim
 * geocoding (May 2026) — Mapbox required a paid token (env had the
 * literal placeholder "your_mapbox_token_here") and operators kept
 * landing on a "Mapbox Token Required" prompt with no easy way to
 * proceed. Leaflet + OSM is free, requires no token, and matches the
 * stack the /wildfire portal already uses, so the bundle and code
 * patterns are consistent across the app.
 *
 * Geocoding via Nominatim:
 *   • free, public, no key
 *   • 1 req/sec rate limit — we serialize requests with a small delay
 *   • 60-day in-localStorage cache so a re-render doesn't re-geocode
 */

let leafletLoadPromise: Promise<void> | null = null;
function loadLeafletOnce(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-investigations-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.setAttribute('data-investigations-leaflet', '1');
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Leaflet failed to load'));
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

const GEOCODE_CACHE_KEY = 'investigations_geocode_cache_v1';
const GEOCODE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

interface CachedGeocode { lat: number; lng: number; cachedAt: number }
function readCache(): Record<string, CachedGeocode> {
  try {
    const raw = localStorage.getItem(GEOCODE_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch { return {}; }
}
function writeCache(cache: Record<string, CachedGeocode>) {
  try { localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
}

function tryParseCoords(s: string): { lat: number; lng: number } | null {
  const plainCoordMatch = s.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (plainCoordMatch) {
    const lat = parseFloat(plainCoordMatch[1]);
    const lng = parseFloat(plainCoordMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  // Google Maps URLs: ...@lat,lng or ?q=lat,lng
  const gMaps = s.match(/[@?q=](-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
  if (gMaps) {
    const lat = parseFloat(gMaps[1]);
    const lng = parseFloat(gMaps[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

async function nominatimGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  // Nominatim rate-limits to ~1 req/sec. Caller serializes via the
  // sequential loop in geocodeAll().
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        // Nominatim TOS asks for an identifying User-Agent. Browsers
        // override the User-Agent header so we use Accept-Language as
        // a soft compliance signal instead — main TOS expectation in
        // a browser context is "don't be high-volume" which we satisfy.
        'Accept-Language': 'en-CA',
      },
    });
    if (!res.ok) return null;
    const data: any[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0];
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  } catch (e) {
    console.warn('[LocationsMap] geocode failed:', query, e);
    return null;
  }
}

export const LocationsMap = ({ locations }: LocationsMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'no-results' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!locations.length || !mapContainer.current) return;
    const mappableLocations = locations.filter((loc) => loc.current_location || loc.name);
    if (mappableLocations.length === 0) {
      setStatus('no-results');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);

    (async () => {
      try {
        await loadLeafletOnce();
        if (cancelled) return;

        // Geocode every location, sequentially, with the cache.
        const cache = readCache();
        const now = Date.now();
        const geocoded: Array<Location & { lat: number; lng: number }> = [];

        for (const loc of mappableLocations) {
          if (cancelled) return;
          const queryRaw = loc.current_location || loc.name;
          if (!queryRaw) continue;

          // 1. Direct coordinate parse — instant, no network.
          const direct = tryParseCoords(queryRaw);
          if (direct) {
            geocoded.push({ ...loc, ...direct });
            continue;
          }

          // 2. Cache lookup.
          const cached = cache[queryRaw];
          if (cached && now - cached.cachedAt < GEOCODE_TTL_MS) {
            geocoded.push({ ...loc, lat: cached.lat, lng: cached.lng });
            continue;
          }

          // 3. Nominatim. Bias toward Canada in the query if missing.
          const queryWithCountry = /canada/i.test(queryRaw) ? queryRaw : `${queryRaw}, Canada`;
          const result = await nominatimGeocode(queryWithCountry);
          if (result) {
            geocoded.push({ ...loc, ...result });
            cache[queryRaw] = { ...result, cachedAt: now };
          }

          // Be polite — 1 req/sec for Nominatim.
          await new Promise((r) => setTimeout(r, 1100));
        }

        if (cancelled) return;
        writeCache(cache);

        if (geocoded.length === 0) {
          setStatus('no-results');
          return;
        }

        const L = (window as any).L;
        if (!L || !mapContainer.current) {
          setStatus('error');
          setErrorMessage('Leaflet failed to initialize');
          return;
        }

        // Tear down any prior map (re-render with new locations array).
        if (map.current) {
          try { map.current.remove(); } catch { /* ignore */ }
          map.current = null;
        }

        const first = geocoded[0];
        map.current = L.map(mapContainer.current, {
          center: [first.lat, first.lng],
          zoom: 10,
          attributionControl: true,
        });

        // Multi-layer basemap — operator can switch between Topo and Satellite.
        const topo = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles © Esri',
            maxZoom: 19,
          },
        );
        const satellite = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles © Esri',
            maxZoom: 19,
          },
        );
        const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{y}/{x}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19,
        });
        topo.addTo(map.current);
        L.control.layers(
          { Topographic: topo, Satellite: satellite, OpenStreetMap: osm },
          {},
          { position: 'topright', collapsed: true },
        ).addTo(map.current);

        const bounds = L.latLngBounds([]);
        for (const loc of geocoded) {
          const popupHtml = `
            <div style="padding:4px 2px; min-width:180px">
              <div style="font-weight:600; margin-bottom:4px">${escapeHtml(loc.name)}</div>
              <div style="font-size:12px">${escapeHtml(loc.current_location || loc.name)}</div>
              ${loc.description ? `<div style="font-size:11px; color:#666; margin-top:4px">${escapeHtml(loc.description)}</div>` : ''}
            </div>
          `;
          L.marker([loc.lat, loc.lng]).addTo(map.current).bindPopup(popupHtml);
          bounds.extend([loc.lat, loc.lng]);
        }
        if (geocoded.length > 1) {
          map.current.fitBounds(bounds, { padding: [40, 40] });
        }

        setStatus('ready');
      } catch (e: any) {
        console.error('[LocationsMap] init failed:', e);
        setStatus('error');
        setErrorMessage(e?.message || 'Map initialization failed');
      }
    })();

    return () => {
      cancelled = true;
      if (map.current) {
        try { map.current.remove(); } catch { /* ignore */ }
        map.current = null;
      }
    };
  }, [locations]);

  if (!locations.some((loc) => loc.current_location || loc.name)) {
    return (
      <div className="bg-muted/50 border border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
        <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No mappable locations available</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={mapContainer} className="w-full h-96 rounded-lg overflow-hidden border border-border" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm rounded-lg">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Geocoding {locations.length} location{locations.length > 1 ? 's' : ''}…</span>
          </div>
        </div>
      )}
      {status === 'no-results' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm rounded-lg p-4 text-center">
          <MapPin className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm font-medium">Couldn't geocode any locations</p>
          <p className="text-xs text-muted-foreground mt-1">
            Use a full address or paste coordinates as <code>lat, lng</code>.
          </p>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm rounded-lg p-4 text-center">
          <MapPin className="w-8 h-8 mb-2 text-red-500/70" />
          <p className="text-sm font-medium">Map failed to load</p>
          {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
        </div>
      )}
    </div>
  );
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
