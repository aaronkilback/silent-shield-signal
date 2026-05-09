/**
 * Public Wildfire Portal — fortress.silentshieldsecurity.com/wildfire
 *
 * Standalone page outside the main Fortress AppLayout. No nav, no
 * Aegis floating button, no auth gate. Visitors see today's BCWS-
 * sourced wildfire daily report and can chat with the WILDFIRE agent.
 *
 * Telemetry: page_view + report_view logged on mount, chat events
 * logged server-side by wildfire-portal-chat.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, RefreshCw, Shield, Flame, AlertTriangle, Paperclip, X as XIcon, Camera, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
  // Optional inline photo attached to a user message (data URL).
  // Held in browser memory only; cleared on page refresh.
  imageDataUrl?: string;
}

// Resize a chosen image file to a JPEG data URL with a max edge length.
// Keeps payload bounded for the chat endpoint (vision API is happy with
// 1024px and a single still photo carries plenty of detail at that size).
async function resizeImageToDataUrl(
  file: File,
  maxEdge = 1024,
  quality = 0.85,
): Promise<{ dataUrl: string; bytes: number }> {
  const reader = new FileReader();
  const sourceDataUrl: string = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = sourceDataUrl;
  });
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > maxEdge || h > maxEdge) {
    const scale = maxEdge / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  // Approximate byte count from base64 length.
  const base64Part = dataUrl.split(",")[1] ?? "";
  const bytes = Math.floor((base64Part.length * 3) / 4);
  return { dataUrl, bytes };
}

// Stable per-browser session id stored in localStorage so usage telemetry
// can group a visitor's events together without auth.
function getSessionId(): string {
  const KEY = "wildfire_portal_session_id";
  let sid = localStorage.getItem(KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem(KEY, sid);
  }
  return sid;
}

async function logUsage(eventType: string, payload: Record<string, unknown> = {}): Promise<void> {
  // Fire-and-forget — failures shouldn't block the UI. Routes through
  // a tiny server-side endpoint so anon visitors don't hit RLS errors.
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/wildfire-portal-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({
        event_type: eventType,
        session_id: getSessionId(),
        referrer: document.referrer || null,
        payload,
      }),
    });
  } catch { /* swallow */ }
}

// MapLibre GL — loaded on demand (only when the operator switches to
// 3D view). Keeps the bundle small for the common case.
let maplibreLoadPromise: Promise<void> | null = null;
function loadMapLibreOnce(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).maplibregl) return Promise.resolve();
  if (maplibreLoadPromise) return maplibreLoadPromise;
  maplibreLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-wildfire-maplibre]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
      link.setAttribute("data-wildfire-maplibre", "1");
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("MapLibre GL failed to load"));
    document.head.appendChild(script);
  });
  return maplibreLoadPromise;
}

// React's dangerouslySetInnerHTML inserts <script> tags as INERT — the
// browser parses them but doesn't execute. The wildfire report embeds
// Leaflet for the station map via inline scripts, which then never run.
// Workaround: load Leaflet once via the document head (so the global L
// is defined), then iterate the injected scripts in the report HTML and
// recreate them as real script elements so the browser executes them.
let leafletLoadPromise: Promise<void> | null = null;
function loadLeafletOnce(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-wildfire-leaflet]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.setAttribute("data-wildfire-leaflet", "1");
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Leaflet failed to load"));
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

function executeInjectedScripts(container: HTMLElement) {
  const scripts = Array.from(container.querySelectorAll("script"));
  for (const old of scripts) {
    // Skip the leaflet external script — we already loaded it once at
    // the document level, and re-loading it would clobber the global.
    if (old.src && old.src.includes("leaflet")) continue;
    const replacement = document.createElement("script");
    for (const attr of Array.from(old.attributes)) {
      replacement.setAttribute(attr.name, attr.value);
    }
    replacement.text = old.textContent || "";
    old.parentNode?.replaceChild(replacement, old);
  }
}

export default function WildfirePortal() {
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportTs, setReportTs] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const reportContainerRef = useRef<HTMLDivElement>(null);

  // Inline photo attached to the next outgoing chat message. Held only
  // until send (or cleared by the user). Backend caps at 8MB; we resize
  // to 1024px / JPEG 0.85 client-side which lands well under that.
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; bytes: number } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  async function handleImagePick(file: File | null | undefined) {
    setImageError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Please pick an image file.");
      return;
    }
    try {
      const out = await resizeImageToDataUrl(file, 1024, 0.85);
      setPendingImage(out);
    } catch (e: any) {
      setImageError(e?.message || "Couldn't load that image.");
    }
  }

  // ── Spread Simulator (Phase C: time-slider + click-to-pin + BCWS prefill) ──
  const [simLat, setSimLat] = useState("56.0");
  const [simLng, setSimLng] = useState("-121.0");
  const [simDuration, setSimDuration] = useState("48");
  const [simWeatherMode, setSimWeatherMode] = useState<"forecast" | "manual">("forecast");
  const [simWindKph, setSimWindKph] = useState("20");
  const [simWindDir, setSimWindDir] = useState("270");
  const [simFfmc, setSimFfmc] = useState("90");
  const [simBui, setSimBui] = useState("60");
  const [simBusy, setSimBusy] = useState(false);
  const [simResult, setSimResult] = useState<any | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [simActiveHour, setSimActiveHour] = useState<number | null>(null);
  const simMapRef = useRef<HTMLDivElement>(null);
  const simMapInstanceRef = useRef<any>(null);
  const simLayersRef = useRef<Record<number, any>>({});
  const simIgnitionMarkerRef = useRef<any>(null);
  const simResultLayerGroupRef = useRef<any>(null);

  // ── Phase D: 3D terrain view (MapLibre GL + AWS Terrain Tiles) ──────
  const [simViewMode, setSimViewMode] = useState<"2d" | "3d">("2d");
  const sim3dMapRef = useRef<HTMLDivElement>(null);
  const sim3dMapInstanceRef = useRef<any>(null);
  // Track simLat/simLng in a ref so the map's click handler reads the
  // latest value without needing to be re-bound on every state change.
  const simIgnitionRef = useRef({ lat: 56.0, lng: -121.0 });
  useEffect(() => {
    const lat = Number(simLat);
    const lng = Number(simLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      simIgnitionRef.current = { lat, lng };
      // If the map is already initialised, move the ignition marker.
      const L = (window as any).L;
      if (L && simIgnitionMarkerRef.current) {
        simIgnitionMarkerRef.current.setLatLng([lat, lng]);
      }
    }
  }, [simLat, simLng]);

  // BCWS active fires for "Quick start" prefill dropdown.
  interface BcwsPick {
    fire_number: string;
    name: string;
    status: string;
    size_ha: number | null;
    lat: number;
    lng: number;
  }
  const [bcwsFires, setBcwsFires] = useState<BcwsPick[]>([]);
  const [bcwsPickValue, setBcwsPickValue] = useState<string>("");

  // Optional starting perimeter for the simulator. Populated when the
  // operator picks a BCWS fire that has a published perimeter polygon.
  // When set, the simulation seeds every cell inside this ring as
  // already-burning at t=0 and projects forward — much more realistic
  // than treating an existing 5,000 ha fire as a single ignition cell.
  // Null = point ignition (default behavior).
  interface SimPerimeter {
    /** GeoJSON-style outer ring as [lng, lat] pairs. */
    ring: Array<[number, number]>;
    /** Display label e.g. "G70123 — 5,432 ha · 312 vertices". */
    label: string;
    /** Source fire number for clarity in the UI. */
    fire_number: string;
    /** Reported size from BCWS (ha) when available. */
    size_ha: number | null;
  }
  const [simPerimeter, setSimPerimeter] = useState<SimPerimeter | null>(null);
  const [simPerimeterLoading, setSimPerimeterLoading] = useState(false);
  const [simPerimeterError, setSimPerimeterError] = useState<string | null>(null);

  // Pull BCWS active fires once on mount, filter to Petronas operational
  // zones (NE BC / Skeena-Kitimat / Calgary). Same canonical bbox set
  // monitor-wildfires uses, so the portal and the cron monitor agree on
  // what counts as 'in scope'. Without this the dropdown surfaces every
  // active fire in BC — overwhelming and mostly irrelevant to NE BC ops.
  const PETRONAS_ZONES = [
    { minLat: 55.0, maxLat: 60.0, minLon: -125.0, maxLon: -119.0 }, // NE BC (Peace/Montney)
    { minLat: 53.0, maxLat: 56.0, minLon: -130.0, maxLon: -125.0 }, // Skeena / Kitimat corridor
    { minLat: 50.5, maxLat: 51.5, minLon: -115.0, maxLon: -113.5 }, // Calgary region
  ];
  const inOperationalZone = (lat: number, lng: number) =>
    PETRONAS_ZONES.some((z) => lat >= z.minLat && lat <= z.maxLat && lng >= z.minLon && lng <= z.maxLon);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_ActiveFires_PublicView/FeatureServer/0/query"
          + "?where=" + encodeURIComponent("FIRE_STATUS <> 'Out'")
          + "&outFields=" + encodeURIComponent("FIRE_NUMBER,INCIDENT_NAME,FIRE_STATUS,CURRENT_SIZE,LATITUDE,LONGITUDE,GEOGRAPHIC_DESCRIPTION,FIRE_OF_NOTE_IND")
          + "&outSR=4326&f=json&resultRecordCount=400";
        const res = await fetch(url);
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        const features = (j?.features as any[]) || [];
        const picks: BcwsPick[] = features
          .map((f: any) => {
            const p = f.attributes || {};
            const lat = Number(p.LATITUDE);
            const lng = Number(p.LONGITUDE);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            if (!inOperationalZone(lat, lng)) return null; // Petronas-zone filter
            return {
              fire_number: String(p.FIRE_NUMBER || ""),
              name: p.INCIDENT_NAME || p.GEOGRAPHIC_DESCRIPTION || p.FIRE_NUMBER || "Unnamed",
              status: p.FIRE_STATUS || "Unknown",
              size_ha: typeof p.CURRENT_SIZE === "number" ? p.CURRENT_SIZE : null,
              lat,
              lng,
            };
          })
          .filter(Boolean) as BcwsPick[];
        // Sort: out-of-control first, then by size desc.
        picks.sort((a, b) => {
          const oa = a.status === "Out of Control" ? 0 : 1;
          const ob = b.status === "Out of Control" ? 0 : 1;
          if (oa !== ob) return oa - ob;
          return (b.size_ha ?? 0) - (a.size_ha ?? 0);
        });
        setBcwsFires(picks);
      } catch (_) { /* swallow — prefill is optional */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleBcwsPick(value: string) {
    setBcwsPickValue(value);
    setSimPerimeterError(null);
    setSimPerimeter(null);
    if (!value) return;
    const pick = bcwsFires.find((f) => f.fire_number === value);
    if (!pick) return;
    setSimLat(pick.lat.toFixed(4));
    setSimLng(pick.lng.toFixed(4));
    // Recenter the map on the picked ignition.
    const L = (window as any).L;
    if (L && simMapInstanceRef.current) {
      simMapInstanceRef.current.setView([pick.lat, pick.lng], 9);
    }

    // Try to fetch this fire's published perimeter polygon. BCWS only
    // publishes perimeters for fires large enough to map (typically
    // >10 ha or fires-of-note); smaller fires return no geometry, in
    // which case we fall back to point ignition silently. Network or
    // schema errors are non-fatal — the operator can still run with
    // the centroid as a point.
    setSimPerimeterLoading(true);
    try {
      const url = "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_FirePerimeters_PublicView/FeatureServer/0/query"
        + "?where=" + encodeURIComponent(`FIRE_NUMBER='${pick.fire_number.replace(/'/g, "''")}'`)
        + "&returnGeometry=true&outSR=4326&outFields=FIRE_NUMBER,FEATURE_AREA_SQM&f=json";
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const features = (json?.features as any[]) || [];
      // Pick the largest ring across all returned features (BCWS
      // sometimes returns multiple polygons for a single fire — outer
      // perimeter + island unburned-pockets — and we want the outer
      // one for "current footprint" purposes).
      let bestRing: Array<[number, number]> | null = null;
      let bestArea = 0;
      for (const f of features) {
        const rings = f?.geometry?.rings;
        if (!Array.isArray(rings)) continue;
        for (const ring of rings) {
          if (!Array.isArray(ring) || ring.length < 3) continue;
          // Crude shoelace area in deg² to pick the dominant ring.
          let s = 0;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
          }
          const a = Math.abs(s);
          if (a > bestArea) {
            bestArea = a;
            bestRing = ring.map((pt: any) => [Number(pt[0]), Number(pt[1])] as [number, number]);
          }
        }
      }
      if (bestRing) {
        setSimPerimeter({
          ring: bestRing,
          label: `${pick.fire_number} — ${pick.size_ha != null ? pick.size_ha.toLocaleString() + " ha · " : ""}${bestRing.length} vertices`,
          fire_number: pick.fire_number,
          size_ha: pick.size_ha,
        });
      } else {
        // No published perimeter — silent fallback to point ignition.
        // Common for fires < 10 ha or fires that BCWS hasn't yet mapped.
        console.log(`[WildfirePortal] No BCWS perimeter for ${pick.fire_number} — using point ignition`);
      }
    } catch (e: any) {
      setSimPerimeterError(e?.message || "Perimeter fetch failed");
      console.warn(`[WildfirePortal] perimeter fetch failed for ${pick.fire_number}:`, e);
    } finally {
      setSimPerimeterLoading(false);
    }
  }

  function clearSimPerimeter() {
    setSimPerimeter(null);
    setSimPerimeterError(null);
  }

  // Page view + report load on mount.
  useEffect(() => {
    logUsage("page_view");
    void loadReport();
  }, []);

  // After the report HTML mounts, load Leaflet (once) and re-execute
  // the inline <script> tags so the station map renders.
  useEffect(() => {
    if (!reportHtml || !reportContainerRef.current) return;
    const container = reportContainerRef.current;
    let cancelled = false;
    loadLeafletOnce()
      .then(() => {
        if (cancelled) return;
        executeInjectedScripts(container);
      })
      .catch((e) => console.warn("[WildfirePortal] map init failed:", e));
    return () => {
      cancelled = true;
    };
  }, [reportHtml]);

  // Print-to-PDF handler. The browser's "Save as PDF" destination is
  // the cleanest path for the wildfire report — preserves the live
  // Leaflet station map, handles pagination natively, and operators
  // already know the dialog. We tag the body with a class while
  // printing so the @media print CSS in the page <style> block can
  // hide everything except the report card. Cleanup runs on the
  // afterprint event so the class is removed whether the user prints
  // or cancels the dialog.
  //
  // Filename: browsers default the print dialog's "Save As" filename
  // to document.title. Temporarily swap the title to a dated, sortable
  // string ("Daily Wildfire Report — 2026-05-04 15-30") so the saved
  // PDF lands with a meaningful name instead of "fortress.silentshieldsecurity.com.pdf".
  // Avoid `:` and `/` in the filename — Windows + macOS Finder treat
  // them as path separators and either reject or rewrite them.
  function handlePrintReport() {
    if (!reportHtml) return;
    const originalTitle = document.title;
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const printTitle = `Daily Wildfire Report — ${yyyy}-${mm}-${dd} ${hh}-${mi}`;

    document.title = printTitle;
    document.body.classList.add("printing-report");
    const cleanup = () => {
      document.body.classList.remove("printing-report");
      document.title = originalTitle;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // requestAnimationFrame so the class application paints before
    // the print dialog snapshots the page layout.
    requestAnimationFrame(() => window.print());
  }

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, chatBusy]);

  async function runSimulation() {
    setSimBusy(true);
    setSimError(null);
    setSimResult(null);
    setSimActiveHour(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/simulate-fire-spread`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        // In forecast mode, omit FFMC/BUI so the backend back-derives
        // them from the BCWS official danger rating + recent precip
        // for this point (see _shared/fwi-estimator.ts). Sending the
        // form values would override the live derivation. In manual
        // mode the operator deliberately wants their own snapshot, so
        // pass everything through.
        body: JSON.stringify({
          lat: Number(simLat),
          lng: Number(simLng),
          duration_hours: Number(simDuration),
          weather_mode: simWeatherMode,
          weather: simWeatherMode === "manual"
            ? {
                tempC: 22, rhPct: 35,
                windKph: Number(simWindKph),
                windDir: Number(simWindDir),
                ffmc: Number(simFfmc),
                bui: Number(simBui),
              }
            : {
                // Wind in forecast mode comes from the hourly forecast,
                // not these inputs — but we still pass tempC/rhPct as
                // harmless placeholders the backend ignores.
                tempC: 22, rhPct: 35,
                windKph: Number(simWindKph),
                windDir: Number(simWindDir),
              },
          // Perimeter ignition — only sent when the operator picked a
          // BCWS fire that has a published perimeter. Backend seeds
          // every cell inside the polygon as already-burning and
          // propagates outward. When omitted the backend defaults to
          // single-cell point ignition (existing behavior).
          ignition_perimeter: simPerimeter
            ? { type: "Polygon", coordinates: [simPerimeter.ring] }
            : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setSimResult(json);
      // Default to the latest checkpoint hour
      const hours = (json.features || []).map((f: any) => f.properties?.hour).filter((h: any) => typeof h === "number");
      if (hours.length > 0) setSimActiveHour(Math.max(...hours));
    } catch (e: any) {
      setSimError(e?.message || "Simulation failed");
    } finally {
      setSimBusy(false);
    }
  }

  // Initialise the simulator map ONCE on mount so users can click-to-pin
  // an ignition before they've ever run a simulation. Result perimeters
  // get added/removed via a separate useEffect when simResult changes.
  useEffect(() => {
    if (!simMapRef.current) return;
    let cancelled = false;
    loadLeafletOnce()
      .then(() => {
        if (cancelled || !simMapRef.current) return;
        const L = (window as any).L;
        if (!L || simMapInstanceRef.current) return; // already initialised

        const ig = simIgnitionRef.current;
        const map = L.map(simMapRef.current, { zoomControl: true }).setView([ig.lat, ig.lng], 8);
        const baseLayers = {
          "Topographic": L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
            { maxZoom: 18, attribution: 'Topo: <a href="https://www.esri.com">Esri</a>, USGS, NOAA' },
          ),
          "Satellite": L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            { maxZoom: 18, attribution: 'Imagery: <a href="https://www.esri.com">Esri</a>, Maxar' },
          ),
          "OpenTopoMap": L.tileLayer(
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            { maxZoom: 17, attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' },
          ),
          "OSM Standard": L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>' },
          ),
        };
        baseLayers["Topographic"].addTo(map);
        L.control.layers(baseLayers, undefined, { position: "topright" }).addTo(map);
        simMapInstanceRef.current = map;

        // Custom red-pin ignition marker. Draggable so users can either
        // click-to-pin or click-and-drag to fine-tune.
        const pinIcon = L.divIcon({
          className: "",
          html: '<div style="background:#dc2626;color:white;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);font-size:12px;font-weight:700">×</div>',
          iconSize: [22, 22], iconAnchor: [11, 11],
        });
        const marker = L.marker([ig.lat, ig.lng], { icon: pinIcon, draggable: true })
          .addTo(map)
          .bindPopup("Drag to reposition ignition, or click anywhere on the map.");
        marker.on("dragend", () => {
          const ll = marker.getLatLng();
          setSimLat(ll.lat.toFixed(4));
          setSimLng(ll.lng.toFixed(4));
        });
        simIgnitionMarkerRef.current = marker;

        // Click anywhere on the map to drop the ignition pin there.
        map.on("click", (e: any) => {
          const lat = e.latlng.lat;
          const lng = e.latlng.lng;
          marker.setLatLng([lat, lng]);
          setSimLat(lat.toFixed(4));
          setSimLng(lng.toFixed(4));
        });

        // Layer group for result perimeters — separate from the marker
        // so we can clear/redraw without disturbing the pin.
        simResultLayerGroupRef.current = L.layerGroup().addTo(map);
      })
      .catch((e) => console.warn("[WildfirePortal] sim map init failed:", e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a sim result arrives, render its perimeters into the result
  // layer group. Clears any previous run's layers first.
  useEffect(() => {
    if (!simResult) return;
    const L = (window as any).L;
    const group = simResultLayerGroupRef.current;
    if (!L || !group) return;
    group.clearLayers();
    simLayersRef.current = {};

    const colorFor = (h: number): string => {
      if (h <= 1) return "#fde047";
      if (h <= 3) return "#fb923c";
      if (h <= 6) return "#f97316";
      if (h <= 12) return "#ef4444";
      if (h <= 24) return "#dc2626";
      return "#7f1d1d";
    };

    const features = ((simResult.features || []) as any[])
      .slice()
      .sort((a, b) => (b.properties?.hour ?? 0) - (a.properties?.hour ?? 0));

    const allBounds: any[] = [];
    for (const feat of features) {
      const hour = feat.properties?.hour as number;
      const layer = L.geoJSON(feat, {
        style: () => ({
          color: colorFor(hour),
          fillColor: colorFor(hour),
          fillOpacity: 0.18,
          weight: 2,
        }),
        onEachFeature: (f: any, lyr: any) => {
          lyr.bindPopup(
            `<strong>${hour}h checkpoint</strong><br>` +
            `Area: ${f.properties.area_ha?.toLocaleString()} ha<br>` +
            `Perimeter: ${f.properties.perimeter_km} km<br>` +
            `Max intensity: ${f.properties.max_intensity_kw_per_m?.toLocaleString()} kW/m`,
          );
        },
      });
      group.addLayer(layer);
      simLayersRef.current[hour] = layer;
      allBounds.push(layer.getBounds());
    }

    if (allBounds.length > 0 && simMapInstanceRef.current) {
      const merged = allBounds.reduce((acc: any, b: any) => (acc ? acc.extend(b) : b), null);
      if (merged) simMapInstanceRef.current.fitBounds(merged, { padding: [20, 20] });
    }
  }, [simResult]);

  // ── 3D map (MapLibre GL): init when user switches to 3D, render
  //    perimeters draped on terrain. Re-runs when simResult or
  //    simActiveHour change (so the active hour gets emphasis).
  useEffect(() => {
    if (simViewMode !== "3d" || !sim3dMapRef.current) return;
    let cancelled = false;
    loadMapLibreOnce()
      .then(() => {
        if (cancelled || !sim3dMapRef.current) return;
        const maplibregl = (window as any).maplibregl;
        if (!maplibregl) return;

        const ig = simIgnitionRef.current;

        // Build (or reuse) the map instance.
        let map = sim3dMapInstanceRef.current;
        if (!map) {
          map = new maplibregl.Map({
            container: sim3dMapRef.current,
            // Inline style — Esri World Topo as the surface, AWS
            // Terrain Tiles as the elevation source. AWS terrain
            // tiles use the Terrarium encoding (free, no key).
            style: {
              version: 8,
              sources: {
                "esri-topo": {
                  type: "raster",
                  tiles: [
                    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
                  ],
                  tileSize: 256,
                  maxzoom: 18,
                  attribution: 'Topo: Esri, USGS, NOAA',
                },
                "esri-imagery": {
                  type: "raster",
                  tiles: [
                    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                  ],
                  tileSize: 256,
                  maxzoom: 18,
                  attribution: 'Imagery: Esri, Maxar',
                },
                "terrain-dem": {
                  type: "raster-dem",
                  tiles: [
                    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                  ],
                  encoding: "terrarium",
                  tileSize: 256,
                  maxzoom: 15,
                  attribution: 'DEM: AWS Terrain Tiles',
                },
              },
              layers: [
                { id: "topo-base", type: "raster", source: "esri-topo" },
              ],
              terrain: { source: "terrain-dem", exaggeration: 1.5 },
              sky: {
                "sky-color": "#a4cfe8",
                "horizon-color": "#dbe9f4",
                "sky-horizon-blend": 0.5,
              } as any,
            } as any,
            center: [ig.lng, ig.lat],
            zoom: 9,
            pitch: 55,
            bearing: 0,
          });
          map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
          sim3dMapInstanceRef.current = map;
        }

        const renderResult = () => {
          // Clear previous perimeter source/layers if any.
          for (const id of ["sim-perim-line", "sim-perim-fill", "sim-perim-active"]) {
            if (map.getLayer(id)) map.removeLayer(id);
          }
          if (map.getSource("sim-perimeters")) map.removeSource("sim-perimeters");

          // Ignition marker — drop or update.
          if (sim3dMapInstanceRef.current.__ignitionMarker) {
            sim3dMapInstanceRef.current.__ignitionMarker.setLngLat([ig.lng, ig.lat]);
          } else {
            const el = document.createElement("div");
            el.style.cssText =
              "background:#dc2626;color:white;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);font-size:12px;font-weight:700";
            el.textContent = "×";
            sim3dMapInstanceRef.current.__ignitionMarker = new maplibregl.Marker({ element: el })
              .setLngLat([ig.lng, ig.lat])
              .addTo(map);
          }

          if (!simResult || !simResult.features || simResult.features.length === 0) return;

          // Add the GeoJSON FeatureCollection as a single source.
          // Each feature already has 'hour' and 'area_ha' properties.
          map.addSource("sim-perimeters", {
            type: "geojson",
            data: simResult as any,
          });

          // Filled fill matching the 2D color palette.
          map.addLayer({
            id: "sim-perim-fill",
            type: "fill",
            source: "sim-perimeters",
            paint: {
              "fill-color": [
                "step",
                ["get", "hour"],
                "#fde047", 1,
                "#fb923c", 4,
                "#f97316", 7,
                "#ef4444", 13,
                "#dc2626", 25,
                "#7f1d1d",
              ],
              "fill-opacity": 0.18,
            },
          });
          map.addLayer({
            id: "sim-perim-line",
            type: "line",
            source: "sim-perimeters",
            paint: {
              "line-color": [
                "step",
                ["get", "hour"],
                "#fde047", 1,
                "#fb923c", 4,
                "#f97316", 7,
                "#ef4444", 13,
                "#dc2626", 25,
                "#7f1d1d",
              ],
              "line-width": 2,
              "line-opacity": 0.7,
            },
          });
          // Active hour — drawn on top with stronger fill.
          map.addLayer({
            id: "sim-perim-active",
            type: "fill",
            source: "sim-perimeters",
            filter: ["==", ["get", "hour"], simActiveHour ?? -1],
            paint: {
              "fill-color": [
                "step",
                ["get", "hour"],
                "#fde047", 1,
                "#fb923c", 4,
                "#f97316", 7,
                "#ef4444", 13,
                "#dc2626", 25,
                "#7f1d1d",
              ],
              "fill-opacity": 0.45,
            },
          });

          // Fit camera to the largest perimeter so the whole picture
          // lands in view, with a comfortable pitch.
          const allCoords: number[][] = [];
          for (const f of simResult.features as any[]) {
            const ring = f.geometry?.coordinates?.[0];
            if (Array.isArray(ring)) allCoords.push(...ring);
          }
          if (allCoords.length > 0) {
            const bbox = allCoords.reduce(
              (acc, [lng, lat]) => [
                Math.min(acc[0], lng),
                Math.min(acc[1], lat),
                Math.max(acc[2], lng),
                Math.max(acc[3], lat),
              ],
              [Infinity, Infinity, -Infinity, -Infinity],
            );
            map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
              padding: 60,
              pitch: 55,
              duration: 800,
            });
          }
        };

        if (map.isStyleLoaded()) renderResult();
        else map.once("load", renderResult);
      })
      .catch((e) => console.warn("[WildfirePortal] 3D map render failed:", e));
    return () => {
      cancelled = true;
    };
  }, [simViewMode, simResult, simActiveHour]);

  // Tear down the 3D map when the user switches away from 3D, freeing
  // GPU resources. Re-init happens on next 3D switch.
  useEffect(() => {
    if (simViewMode === "2d" && sim3dMapInstanceRef.current) {
      try { sim3dMapInstanceRef.current.remove(); } catch (_) {}
      sim3dMapInstanceRef.current = null;
    }
  }, [simViewMode]);

  // Highlight the active checkpoint hour.
  useEffect(() => {
    if (!simResult || simActiveHour === null) return;
    for (const [hStr, layer] of Object.entries(simLayersRef.current)) {
      const h = Number(hStr);
      const active = h === simActiveHour;
      layer.setStyle({
        weight: active ? 4 : 1.5,
        fillOpacity: active ? 0.35 : 0.08,
        opacity: active ? 1 : 0.5,
      });
      if (active) layer.bringToFront();
    }
  }, [simActiveHour, simResult]);

  async function loadReport() {
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-wildfire-daily-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json?.html) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setReportHtml(json.html);
      setReportTs(new Date().toLocaleString());
      logUsage("report_view", { generated_at: json?.metadata?.generated_at });
    } catch (e: any) {
      setReportError(e?.message || "Could not load the report.");
    } finally {
      setReportLoading(false);
    }
  }

  async function sendChat() {
    const text = chatInput.trim();
    // Allow sending with no text if a photo is attached — operator may
    // just want WILDFIRE to read the photo with no caption.
    if ((!text && !pendingImage) || chatBusy) return;
    const outgoingImage = pendingImage;
    setChatInput("");
    setPendingImage(null);
    setImageError(null);
    const newUserMsg: ChatMessage = {
      role: "user",
      content: text || "(photo attached)",
      ts: Date.now(),
      imageDataUrl: outgoingImage?.dataUrl,
    };
    const next = [...messages, newUserMsg];
    setMessages(next);
    setChatBusy(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/wildfire-portal-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({
          // Don't echo prior images back to the server — only the
          // current send carries one. The transcript text stays as
          // "(photo attached)" placeholder for context continuity.
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          sessionId: getSessionId(),
          image: outgoingImage
            ? { data: outgoingImage.dataUrl, mime: "image/jpeg" }
            : undefined,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HTTP ${res.status}: ${errBody.substring(0, 200)}`);
      }

      // The function returns SSE; parse a single content chunk.
      const text = await res.text();
      let assistantText = "";
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          assistantText += evt?.choices?.[0]?.delta?.content ?? "";
        } catch { /* skip */ }
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: assistantText || "(no response)", ts: Date.now() },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `*Sorry — I couldn't reach the wildfire agent. ${e?.message || ""}*`,
          ts: Date.now(),
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile + responsive tweaks for the embedded report HTML.
          Without these the report's tables overflow viewport and force
          horizontal page scroll on phones. Scoped to .wildfire-report-html
          so the simulator + chat are unaffected. */}
      <style>{`
        .wildfire-report-html section { margin-bottom: 1.25rem; }
        .wildfire-report-html h2 { font-size: 1.05rem; line-height: 1.3; }
        .wildfire-report-html table {
          display: block;
          max-width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          font-size: 12px;
        }
        .wildfire-report-html td, .wildfire-report-html th {
          padding: 4px 6px !important;
        }
        .wildfire-report-html .info-row { flex-wrap: wrap; }
        .wildfire-report-html .info-box { min-width: 100px !important; }
        @media (max-width: 640px) {
          .wildfire-report-html h2 { font-size: 0.95rem; }
          .wildfire-report-html p, .wildfire-report-html li { font-size: 12px; line-height: 1.4; }
          .wildfire-report-html table { font-size: 11px; }
          .wildfire-report-html .note { font-size: 10px; }
        }

        /* ─── Print-to-PDF (triggered by handlePrintReport) ─────────
           When body.printing-report is set, hide the entire page
           tree and reveal only the report card. Approach: blanket
           visibility:hidden on every descendant, then visibility:
           visible on the printable subtree — works regardless of
           how deep React nests the report element. */
        @media print {
          body.printing-report {
            background: #fff !important;
          }
          body.printing-report * {
            visibility: hidden !important;
          }
          body.printing-report .wildfire-report-printable,
          body.printing-report .wildfire-report-printable * {
            visibility: visible !important;
          }
          /* The visible region escapes flow constraints so it fills
             the printable page width. Also drop the scroll cap so
             the entire report — not just the visible viewport
             slice — gets paginated into the PDF. */
          body.printing-report .wildfire-report-printable {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            right: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          body.printing-report .wildfire-report-scroll {
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
          }
          body.printing-report .wildfire-report-html {
            max-height: none !important;
            overflow: visible !important;
          }
          /* Preserve color-coded badges and status banners — without
             this, Chrome strips background colors from print output
             by default and the rating badges become unreadable. */
          body.printing-report .wildfire-report-html *,
          body.printing-report .wildfire-report-html section {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* Anything tagged no-print (Refresh / Download PDF buttons
             in the report header) drops out of the printed copy. */
          body.printing-report .no-print,
          body.printing-report .no-print * {
            display: none !important;
          }
          /* Pagination hints — keep sections together where possible
             and never break right after a heading. */
          body.printing-report .wildfire-report-html section {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          body.printing-report .wildfire-report-html h2,
          body.printing-report .wildfire-report-html h3 {
            break-after: avoid;
            page-break-after: avoid;
          }
          /* Tables that overflow a page should still render; allow
             tbody/tr to break. */
          body.printing-report .wildfire-report-html tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          /* Reasonable page margins for letter / A4 paper. */
          @page {
            margin: 0.5in;
          }
        }
      `}</style>

      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 sm:gap-3">
          <Shield className="h-6 w-6 text-cyan-400 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold leading-tight">Wildfire Intelligence Portal</h1>
            <p className="text-[10px] sm:text-xs text-slate-400 leading-tight truncate">
              Live BC Wildfire Service · Silent Shield Fortress
            </p>
          </div>
          <div className="ml-auto text-[10px] sm:text-xs text-slate-400 text-right whitespace-nowrap">
            {reportTs ? `Updated ${reportTs}` : "Loading…"}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 sm:gap-6">
        {/* Report */}
        <section className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden wildfire-report-printable">
          <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between no-print">
            <h2 className="font-medium">Daily Wildfire & Air Quality Report</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={handlePrintReport}
                className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={reportLoading || !reportHtml}
                title="Open the browser print dialog. Choose 'Save as PDF' as the destination."
              >
                <Download className="h-4 w-4" />
                Download PDF
              </button>
              <button
                onClick={loadReport}
                className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors"
                disabled={reportLoading}
              >
                <RefreshCw className={`h-4 w-4 ${reportLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
          <div className="p-3 sm:p-4 bg-white max-h-[60vh] sm:max-h-[80vh] overflow-y-auto wildfire-report-scroll">
            {reportLoading && !reportHtml && (
              <div className="flex items-center gap-2 text-slate-500 py-12 justify-center">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Generating today's report from BCWS, Open-Meteo, and Environment Canada…</span>
              </div>
            )}
            {reportError && !reportHtml && (
              <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3 text-sm">
                Could not load the report. {reportError}
              </div>
            )}
            {reportHtml && (
              <div
                ref={reportContainerRef}
                className="wildfire-report-html"
                dangerouslySetInnerHTML={{ __html: reportHtml }}
              />
            )}
          </div>
        </section>

        {/* Chat with WILDFIRE */}
        <aside className="bg-white rounded-lg shadow-sm border border-slate-200 flex flex-col h-[70vh] lg:h-[80vh]">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-medium">Ask WILDFIRE</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live agent. Asks BCWS, CWFIS, Open-Meteo, and Environment Canada in real time.
            </p>
          </div>
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="text-sm text-slate-500 text-center py-8 px-2">
                <p className="mb-3">Try asking:</p>
                <ul className="space-y-1.5 text-left text-slate-600">
                  <li>· What's the fire danger at Hudson Hope?</li>
                  <li>· Are there evacuations near Fort St. John?</li>
                  <li>· What's the AQHI in Fort St. John today?</li>
                  <li>· Any wildfires of note in BC right now?</li>
                </ul>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-900"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-li:my-0.5">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {m.imageDataUrl && (
                        <a
                          href={m.imageDataUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={m.imageDataUrl}
                            alt="Operator photo"
                            className="max-h-48 rounded border border-slate-700 object-cover"
                          />
                        </a>
                      )}
                      {m.content && m.content !== "(photo attached)" && (
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chatBusy && (
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>WILDFIRE is checking sources…</span>
              </div>
            )}
          </div>
          <div className="border-t border-slate-200 p-2 sm:p-3 space-y-2">
            {/* Hidden file inputs — gallery picker + dedicated camera capture
                so mobile users get a one-tap "take photo" affordance. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                handleImagePick(f);
                if (e.target) e.target.value = "";
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                handleImagePick(f);
                if (e.target) e.target.value = "";
              }}
            />

            {pendingImage && (
              <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded p-2">
                <img
                  src={pendingImage.dataUrl}
                  alt="Pending upload"
                  className="h-12 w-12 object-cover rounded border border-slate-300"
                />
                <div className="flex-1 text-xs text-slate-600">
                  Photo attached
                  <span className="text-slate-400">
                    {" "}· {(pendingImage.bytes / 1024).toFixed(0)} KB
                  </span>
                  <div className="text-[11px] text-slate-500">
                    WILDFIRE will analyze for fire / smoke / distance.
                  </div>
                </div>
                <button
                  onClick={() => {
                    setPendingImage(null);
                    setImageError(null);
                  }}
                  className="p-1 text-slate-500 hover:text-slate-900"
                  aria-label="Remove photo"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            )}
            {imageError && (
              <div className="text-xs text-red-600">{imageError}</div>
            )}

            <div className="flex gap-2">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={onKey}
                placeholder={
                  pendingImage
                    ? "Add a note (optional) and send…"
                    : "Ask about fire danger, evacuations, AQHI… or attach a photo of fire / smoke."
                }
                className="flex-1 resize-none border border-slate-300 rounded px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 min-h-[44px]"
                rows={2}
                disabled={chatBusy}
              />
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={chatBusy || !!pendingImage}
                  className="border border-slate-300 bg-white text-slate-700 px-2 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center min-w-[44px] h-[44px]"
                  aria-label="Take photo"
                  title="Take photo"
                >
                  <Camera className="h-4 w-4" />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={chatBusy || !!pendingImage}
                  className="border border-slate-300 bg-white text-slate-700 px-2 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center min-w-[44px] h-[44px]"
                  aria-label="Attach photo"
                  title="Attach photo from gallery"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={sendChat}
                disabled={(!chatInput.trim() && !pendingImage) || chatBusy}
                className="bg-slate-900 text-white px-4 rounded hover:bg-slate-700 active:bg-slate-950 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            {/* AI disclaimer — sits where the AI-generated content
                lives. Industry-standard placement (mirrors ChatGPT,
                Claude, Gemini). The report and simulator have their
                own context-specific qualifiers and don't need a
                generic AI warning here. */}
            <p className="text-[11px] text-slate-500 text-center mt-1 leading-tight">
              WILDFIRE is AI and can make mistakes. Verify safety-critical claims against{" "}
              <a
                href="https://www2.gov.bc.ca/gov/content/safety/wildfire-status"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-slate-700"
              >
                BC Wildfire Service
              </a>{" "}
              before acting.
            </p>
          </div>
        </aside>
      </main>

      {/* Spread Simulator */}
      <section className="max-w-7xl mx-auto px-3 sm:px-6 pb-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-600" />
              <h2 className="font-medium">Wildfire Spread Simulator</h2>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-semibold">
                Phase E · Beta
              </span>
            </div>
          </div>

          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 leading-relaxed">
              <strong>Strategic tool, not tactical.</strong> {simWeatherMode === "forecast"
                ? "Live Open-Meteo hourly forecast + Copernicus DEM-derived slope. Single fuel type (C2 boreal spruce-lichen), no spotting/barriers/crown-fire model, convex-hull perimeters."
                : "Manual weather snapshot (synthetic inputs you set), DEM-derived slope, single fuel type, no spotting/barriers."} Output is a strategic estimate only — do not divert real resources based on it.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-0">
            {/* Inputs */}
            <div className="p-3 sm:p-4 lg:border-r border-b lg:border-b-0 border-slate-200 bg-slate-50 space-y-3 text-sm">
              {bcwsFires.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Quick start (BCWS active fires)</label>
                  <select
                    value={bcwsPickValue}
                    onChange={(e) => handleBcwsPick(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white"
                  >
                    <option value="">— Custom ignition point —</option>
                    {bcwsFires.map((f) => (
                      <option key={f.fire_number} value={f.fire_number}>
                        {f.fire_number} · {f.name.substring(0, 40)} · {f.status}{f.size_ha != null ? ` · ${Math.round(f.size_ha)}ha` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">{bcwsFires.length} active BCWS fires in Petronas operational zones (NE BC · Skeena/Kitimat · Calgary)</p>

                  {/* Perimeter status badge — surfaces what the simulator
                      will actually start from. Three states:
                        loading: BCWS perimeter fetch in progress
                        loaded:  perimeter polygon obtained — sim will
                                 seed every cell inside it as t=0 burning
                        none:    no published perimeter (small/new fire)
                                 — sim falls back to point ignition. */}
                  {simPerimeterLoading && (
                    <div className="mt-2 text-[11px] text-slate-600 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Fetching perimeter…
                    </div>
                  )}
                  {simPerimeter && !simPerimeterLoading && (
                    <div className="mt-2 bg-orange-50 border border-orange-200 rounded p-2 text-[11px] text-orange-900 flex items-start gap-2">
                      <Flame className="h-3.5 w-3.5 text-orange-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">Using actual BCWS perimeter</div>
                        <div className="text-[10px] text-orange-800 mt-0.5 truncate">{simPerimeter.label}</div>
                        <div className="text-[10px] text-orange-700 mt-0.5">Simulation will project FROM this perimeter forward, not from a single point.</div>
                      </div>
                      <button
                        onClick={clearSimPerimeter}
                        className="text-orange-700 hover:text-orange-900 p-0.5"
                        aria-label="Use point ignition instead"
                        title="Discard perimeter, use centroid as point ignition"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {bcwsPickValue && !simPerimeter && !simPerimeterLoading && !simPerimeterError && (
                    <p className="text-[10px] text-slate-500 mt-2 italic">
                      No published perimeter for this fire — using centroid as point ignition.
                    </p>
                  )}
                  {simPerimeterError && (
                    <p className="text-[10px] text-amber-700 mt-2">
                      Perimeter fetch failed ({simPerimeterError}). Falling back to point ignition.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Ignition (or click on map)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number" step="0.001"
                    value={simLat}
                    onChange={(e) => setSimLat(e.target.value)}
                    placeholder="Lat"
                    className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                  />
                  <input
                    type="number" step="0.001"
                    value={simLng}
                    onChange={(e) => setSimLng(e.target.value)}
                    placeholder="Lng"
                    className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">e.g. 56.0, -121.0 (NE BC) — or drop a pin on the map →</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Duration (hours)</label>
                <select
                  value={simDuration}
                  onChange={(e) => setSimDuration(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white"
                >
                  <option value="24">24h</option>
                  <option value="48">48h</option>
                  <option value="72">72h</option>
                </select>
              </div>

              {/* Weather mode toggle */}
              <div className="pt-2 border-t border-slate-200">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Weather source</label>
                <div className="grid grid-cols-2 gap-1 bg-slate-200 rounded p-0.5">
                  <button
                    type="button"
                    onClick={() => setSimWeatherMode("forecast")}
                    className={`text-xs font-medium rounded py-1.5 transition-colors ${
                      simWeatherMode === "forecast" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    🛰 Live forecast
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimWeatherMode("manual")}
                    className={`text-xs font-medium rounded py-1.5 transition-colors ${
                      simWeatherMode === "manual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    ✎ Manual
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  {simWeatherMode === "forecast"
                    ? "Hourly weather from Open-Meteo + slope from Copernicus DEM. FFMC/BUI auto-derived from today's BCWS danger rating + recent precipitation at the ignition point."
                    : "Set a synthetic weather snapshot. No time-stepping. Use this to model worst-case scenarios."}
                </p>
              </div>

              {simWeatherMode === "manual" && (
                <div className="pt-2 border-t border-slate-200">
                  <p className="text-xs font-medium text-slate-700 mb-2">Manual weather</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-600">Wind km/h</label>
                      <input type="number" step="1" min="0" max="100"
                        value={simWindKph} onChange={(e) => setSimWindKph(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-600">Wind from°</label>
                      <input type="number" step="10" min="0" max="360"
                        value={simWindDir} onChange={(e) => setSimWindDir(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-600">FFMC</label>
                      <input type="number" step="1" min="0" max="100"
                        value={simFfmc} onChange={(e) => setSimFfmc(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-600">BUI</label>
                      <input type="number" step="1" min="0" max="200"
                        value={simBui} onChange={(e) => setSimBui(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={runSimulation}
                disabled={simBusy}
                className="w-full mt-2 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-md px-4 py-3 text-sm flex items-center justify-center gap-2 transition-colors min-h-[44px]"
              >
                {simBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Simulating…</> : <><Flame className="h-4 w-4" /> Run Simulation</>}
              </button>

              {simError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{simError}</div>
              )}

              {simResult?.metadata && (
                <div className="pt-3 border-t border-slate-200 text-xs space-y-1 text-slate-700">
                  <div className="font-semibold text-slate-900 mb-1">Model output</div>
                  <div>Mode: <strong className={simResult.metadata.weather_mode === "forecast" ? "text-emerald-700" : "text-slate-700"}>
                    {simResult.metadata.weather_mode === "forecast" ? "🛰 Live forecast" : "✎ Manual"}
                  </strong></div>
                  {simResult.metadata.forecast_error && (
                    <div className="text-amber-700 text-[11px]">⚠ Forecast unavailable — used manual fallback ({simResult.metadata.forecast_error})</div>
                  )}
                  <div>Head ROS: <strong>{simResult.metadata.head_ros_m_per_min} m/min</strong></div>
                  <div>HFI: <strong>{simResult.metadata.head_fire_intensity_kw_per_m?.toLocaleString()} kW/m</strong></div>
                  <div>L:B ratio: <strong>{simResult.metadata.length_to_breadth}</strong></div>
                  <div>Spread (hr 0): <strong>{simResult.metadata.spread_direction_deg}°</strong></div>
                  {simResult.metadata.slope_used && simResult.metadata.elevation_range_m && (
                    <div>Elevation: <strong>{simResult.metadata.elevation_range_m.min}–{simResult.metadata.elevation_range_m.max} m</strong></div>
                  )}
                  {(simResult.metadata.ffmc_used !== undefined || simResult.metadata.bui_used !== undefined) && (
                    <div className="pt-1 mt-1 border-t border-slate-100">
                      <div>
                        FFMC: <strong>{simResult.metadata.ffmc_used}</strong>
                        {" · "}BUI: <strong>{simResult.metadata.bui_used}</strong>
                        {simResult.metadata.fwi_source && !simResult.metadata.ffmc_user_supplied && (
                          <span className="text-emerald-700 text-[10px] ml-1">(auto)</span>
                        )}
                        {simResult.metadata.ffmc_user_supplied && (
                          <span className="text-slate-500 text-[10px] ml-1">(manual)</span>
                        )}
                      </div>
                      {simResult.metadata.fwi_source?.note && !simResult.metadata.ffmc_user_supplied && (
                        <div className="text-[10px] text-slate-500 mt-0.5 italic">
                          {simResult.metadata.fwi_source.note}
                        </div>
                      )}
                      {simResult.metadata.fwi_estimate_error && (
                        <div className="text-amber-700 text-[10px] mt-0.5">
                          ⚠ FWI estimate failed — using defaults ({simResult.metadata.fwi_estimate_error})
                        </div>
                      )}
                    </div>
                  )}
                  {simResult.metadata.weather_summary?.hour_0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer font-medium text-slate-900 hover:text-slate-700 text-[11px]">Hourly weather sample</summary>
                      <div className="mt-1.5 space-y-0.5 text-[11px] pl-2">
                        {(["hour_0", "hour_24", "hour_48"] as const).map((k) => {
                          const w = simResult.metadata.weather_summary?.[k];
                          if (!w) return null;
                          const hr = k.replace("hour_", "");
                          return (
                            <div key={k}>
                              <span className="text-slate-500">{hr}h:</span>{" "}
                              <strong>{w.tempC}°C</strong> / {w.rhPct}% RH /{" "}
                              <strong>{w.windKph} km/h</strong> from {w.windDir}°
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                  <div className="text-slate-500 text-[10px] mt-1">
                    Cells burned: {simResult.metadata.cells_burned?.toLocaleString()} ·
                    Sim {simResult.metadata.compute_ms}ms
                    {simResult.metadata.slope_fetch_ms != null && ` · Slope ${simResult.metadata.slope_fetch_ms}ms`}
                  </div>
                </div>
              )}
            </div>

            {/* Map + checkpoint slider */}
            <div className="flex flex-col">
              {simResult?.features?.length > 0 && (() => {
                const features = (simResult.features as any[]).slice().sort((a, b) => a.properties.hour - b.properties.hour);
                const hours = features.map((f) => f.properties.hour);
                const activeIdx = Math.max(0, hours.indexOf(simActiveHour ?? hours[hours.length - 1]));
                const activeFeat = features[activeIdx];
                return (
                  <div className="px-3 sm:px-4 py-3 border-b border-slate-200 bg-white space-y-2">
                    <div className="flex items-baseline justify-between flex-wrap gap-2">
                      <div>
                        <span className="text-[11px] uppercase tracking-wider text-slate-500">Checkpoint</span>
                        <span className="ml-2 text-lg font-bold text-orange-700">{activeFeat.properties.hour}h</span>
                      </div>
                      <div className="text-xs text-slate-700 space-x-3">
                        <span><strong>{Math.round(activeFeat.properties.area_ha).toLocaleString()}</strong> ha</span>
                        <span className="text-slate-400">·</span>
                        <span>{activeFeat.properties.perimeter_km} km perimeter</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={hours.length - 1}
                      step={1}
                      value={activeIdx}
                      onChange={(e) => setSimActiveHour(hours[Number(e.target.value)])}
                      className="w-full accent-orange-600"
                      aria-label="Time slider"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 px-1 select-none">
                      {hours.map((h) => (
                        <button
                          key={h}
                          onClick={() => setSimActiveHour(h)}
                          className={`hover:text-slate-900 transition-colors ${h === activeFeat.properties.hour ? "text-orange-700 font-bold" : ""}`}
                        >
                          {h}h
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* 2D / 3D view-mode toggle */}
              <div className="px-3 sm:px-4 py-2 border-b border-slate-200 bg-white flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1 bg-slate-200 rounded p-0.5">
                  <button
                    type="button"
                    onClick={() => setSimViewMode("2d")}
                    className={`text-xs font-medium rounded px-3 py-1 transition-colors ${
                      simViewMode === "2d" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    2D Map
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimViewMode("3d")}
                    className={`text-xs font-medium rounded px-3 py-1 transition-colors ${
                      simViewMode === "3d" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    🏔 3D Terrain
                  </button>
                </div>
                {simViewMode === "3d" && (
                  <span className="text-[10px] text-slate-500">
                    Drag to pan · Right-drag to rotate · Scroll to zoom
                  </span>
                )}
              </div>

              {/* 2D Leaflet map — kept mounted but hidden when 3D is
                  active so its state (pin position, layers) survives a
                  view-mode switch. */}
              <div style={{ display: simViewMode === "2d" ? "block" : "none" }}>
                <div
                  ref={simMapRef}
                  className="bg-slate-100"
                  style={{ height: "min(60vh, 600px)", minHeight: "320px" }}
                />
                {!simResult && (
                  <div className="px-4 py-2 border-t border-slate-200 bg-amber-50 text-amber-900 text-xs text-center">
                    💡 Click anywhere on the map (or drag the red pin) to set the ignition. Then hit <strong>Run Simulation</strong>.
                  </div>
                )}
              </div>

              {/* 3D MapLibre map — only mounted when active. Tear-down
                  effect releases the GPU on switch back to 2D. */}
              {simViewMode === "3d" && (
                <div className="relative">
                  <div
                    ref={sim3dMapRef}
                    className="bg-slate-900"
                    style={{ height: "min(65vh, 640px)", minHeight: "360px" }}
                  />
                  {!simResult && (
                    <div className="px-4 py-2 border-t border-slate-200 bg-amber-50 text-amber-900 text-xs text-center">
                      💡 Set ignition coordinates in the sidebar, then hit <strong>Run Simulation</strong> to project the perimeter onto 3D terrain.
                    </div>
                  )}
                </div>
              )}
              {simResult?.metadata?.limitations && (
                <details className="px-4 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium hover:text-slate-900">Model limitations ({simResult.metadata.limitations.length})</summary>
                  <ul className="mt-2 space-y-0.5 pl-4 list-disc">
                    {simResult.metadata.limitations.map((l: string, i: number) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 text-[11px] sm:text-xs text-slate-500 text-center leading-relaxed">
        Data sources: BC Wildfire Service · CWFIS (NRCan) · Environment Canada · Open-Meteo. Operational restrictions reflect Petronas Canada published protocol — confirm with Site Supervisor before high-risk activity.
      </footer>
    </div>
  );
}
