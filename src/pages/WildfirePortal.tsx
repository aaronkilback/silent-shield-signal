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
import { Loader2, Send, RefreshCw, Shield, Flame, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
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

  // ── Spread Simulator (Phase B: live forecast + DEM slope) ──────────
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
        body: JSON.stringify({
          lat: Number(simLat),
          lng: Number(simLng),
          duration_hours: Number(simDuration),
          weather_mode: simWeatherMode,
          weather: {
            tempC: 22, rhPct: 35,
            windKph: Number(simWindKph),
            windDir: Number(simWindDir),
            ffmc: Number(simFfmc),
            bui: Number(simBui),
          },
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

  // Render the simulator GeoJSON on a Leaflet map. One layer per
  // checkpoint hour; the active hour is highlighted, others faded.
  useEffect(() => {
    if (!simResult || !simMapRef.current) return;
    let cancelled = false;
    loadLeafletOnce()
      .then(() => {
        if (cancelled || !simMapRef.current) return;
        const L = (window as any).L;
        if (!L) return;
        // Tear down any previous map instance before re-rendering.
        if (simMapInstanceRef.current) {
          simMapInstanceRef.current.remove();
          simMapInstanceRef.current = null;
          simLayersRef.current = {};
        }
        const map = L.map(simMapRef.current, { zoomControl: true });

        // Multi-layer basemap. Topographic is the default because fire
        // behaviour depends on terrain — slope direction and elevation
        // are the operator's primary visual cues. Satellite is useful
        // for matching a fire to ground features (roads, clearings,
        // facilities). OSM Standard kept for road-network reference.
        const baseLayers = {
          "Topographic": L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
            {
              maxZoom: 18,
              attribution:
                'Topo: <a href="https://www.esri.com">Esri</a>, USGS, NOAA',
            },
          ),
          "Satellite": L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
              maxZoom: 18,
              attribution:
                'Imagery: <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
            },
          ),
          "OpenTopoMap": L.tileLayer(
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            {
              maxZoom: 17,
              attribution:
                '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
            },
          ),
          "OSM Standard": L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
              maxZoom: 19,
              attribution:
                '© <a href="https://www.openstreetmap.org/copyright">OSM</a>',
            },
          ),
        };

        // Add the default (Topographic) to the map; the others stand by
        // until the user switches via the layers control.
        baseLayers["Topographic"].addTo(map);
        L.control.layers(baseLayers, undefined, { position: "topright" }).addTo(map);
        simMapInstanceRef.current = map;

        // Ignition marker
        const ig = simResult.metadata?.ignition;
        if (ig) {
          L.marker([ig.lat, ig.lng]).addTo(map).bindPopup(
            `<strong>Ignition</strong><br>${ig.lat.toFixed(3)}°N ${Math.abs(ig.lng).toFixed(3)}°W`,
          );
        }

        const colorFor = (h: number): string => {
          if (h <= 1) return "#fde047";
          if (h <= 3) return "#fb923c";
          if (h <= 6) return "#f97316";
          if (h <= 12) return "#ef4444";
          if (h <= 24) return "#dc2626";
          return "#7f1d1d";
        };

        // Render perimeters from largest to smallest so smaller (earlier)
        // hours stack on top and remain visible.
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
          }).addTo(map);
          simLayersRef.current[hour] = layer;
          allBounds.push(layer.getBounds());
        }

        if (allBounds.length > 0) {
          const merged = allBounds.reduce((acc, b) => (acc ? acc.extend(b) : b), null);
          if (merged) map.fitBounds(merged, { padding: [20, 20] });
        }
      })
      .catch((e) => console.warn("[WildfirePortal] sim map render failed:", e));
    return () => {
      cancelled = true;
    };
  }, [simResult]);

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
    if (!text || chatBusy) return;
    setChatInput("");
    const newUserMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    const next = [...messages, newUserMsg];
    setMessages(next);
    setChatBusy(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/wildfire-portal-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          sessionId: getSessionId(),
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
        <section className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
            <h2 className="font-medium">Daily Wildfire & Air Quality Report</h2>
            <button
              onClick={loadReport}
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors"
              disabled={reportLoading}
            >
              <RefreshCw className={`h-4 w-4 ${reportLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          <div className="p-3 sm:p-4 bg-white max-h-[60vh] sm:max-h-[80vh] overflow-y-auto">
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
                    <div className="whitespace-pre-wrap">{m.content}</div>
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
          <div className="border-t border-slate-200 p-2 sm:p-3 flex gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask about fire danger, evacuations, AQHI…"
              className="flex-1 resize-none border border-slate-300 rounded px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 min-h-[44px]"
              rows={2}
              disabled={chatBusy}
            />
            <button
              onClick={sendChat}
              disabled={!chatInput.trim() || chatBusy}
              className="bg-slate-900 text-white px-4 rounded hover:bg-slate-700 active:bg-slate-950 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
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
                Phase A · Beta
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
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Ignition</label>
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
                <p className="text-[10px] text-slate-500 mt-1">e.g. 56.0, -121.0 (NE BC)</p>
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
                    ? "Open-Meteo hourly forecast + Copernicus DEM. Wind direction shifts hour-by-hour."
                    : "Set a synthetic weather snapshot. No time-stepping."}
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
              {simResult?.features?.length > 0 && (
                <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-slate-500 mr-1">Checkpoint:</span>
                  {(simResult.features as any[]).map((f: any) => {
                    const h = f.properties?.hour;
                    const active = h === simActiveHour;
                    return (
                      <button
                        key={h}
                        onClick={() => setSimActiveHour(h)}
                        className={`text-xs font-medium rounded px-2.5 py-1 transition-colors ${
                          active ? "bg-orange-600 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                        }`}
                      >
                        {h}h · {Math.round(f.properties.area_ha).toLocaleString()} ha
                      </button>
                    );
                  })}
                </div>
              )}
              <div
                ref={simMapRef}
                className="bg-slate-100"
                style={{ height: "min(60vh, 600px)", minHeight: "320px" }}
              >
                {!simResult && (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm p-6 text-center">
                    Set ignition coordinates and weather, then run the simulation. Each hourly perimeter renders as a translucent polygon — click the checkpoint chips to highlight one.
                  </div>
                )}
              </div>
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
