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
import { Loader2, Send, RefreshCw, Shield } from "lucide-react";
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

export default function WildfirePortal() {
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportTs, setReportTs] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Page view + report load on mount.
  useEffect(() => {
    logUsage("page_view");
    void loadReport();
  }, []);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, chatBusy]);

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
      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <Shield className="h-6 w-6 text-cyan-400" />
          <div>
            <h1 className="text-lg font-semibold">Wildfire Intelligence Portal</h1>
            <p className="text-xs text-slate-400">
              Live BC Wildfire Service data · Powered by Silent Shield Fortress
            </p>
          </div>
          <div className="ml-auto text-xs text-slate-400">
            {reportTs ? `Updated ${reportTs}` : "Loading…"}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
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
          <div className="p-4 bg-white max-h-[80vh] overflow-y-auto">
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
                className="wildfire-report-html"
                dangerouslySetInnerHTML={{ __html: reportHtml }}
              />
            )}
          </div>
        </section>

        {/* Chat with WILDFIRE */}
        <aside className="bg-white rounded-lg shadow-sm border border-slate-200 flex flex-col h-[80vh]">
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
          <div className="border-t border-slate-200 p-3 flex gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask about fire danger, evacuations, AQHI…"
              className="flex-1 resize-none border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500"
              rows={2}
              disabled={chatBusy}
            />
            <button
              onClick={sendChat}
              disabled={!chatInput.trim() || chatBusy}
              className="bg-slate-900 text-white px-3 rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </aside>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-6 text-xs text-slate-500 text-center">
        Data sources: BC Wildfire Service · CWFIS (NRCan) · Environment Canada · Open-Meteo. Operational restrictions reflect Petronas Canada published protocol — confirm with Site Supervisor before high-risk activity.
      </footer>
    </div>
  );
}
