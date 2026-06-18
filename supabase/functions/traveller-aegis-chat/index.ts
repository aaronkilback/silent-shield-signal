// traveller-aegis-chat — Traveller Aegis Home conversation, V1 READ-ONLY + itinerary-bound risk
// awareness. Real multi-turn Aegis conversation quality, traveller-safe scope, fail-closed.
//
// REUSE: the genuine Aegis engine PRIMITIVE — callAiGateway (resilience + guardrails) — inside a
// REQUEST-LOCAL tool loop with REQUEST-LOCAL handlers. We intentionally do NOT use the module-global
// runAgentLoop TOOL_REGISTRY: that registry persists across invocations in a warm isolate, so
// registering handlers that close over per-request traveller scope would risk cross-request leakage.
// Request-local closures are isolated per invocation by construction.
//
// FORBIDDEN (never imported here): agent-tools-core, aegis-tool-definitions, operator handlers,
// common-operating-picture, dashboard-ai-assistant, agent-chat, aegis-chat, voice-tool-executor,
// entity/signal/incident/report/document/web-search/client retrieval, realtime. Only the two
// read-only traveller tools below exist, and the model cannot reach anything else.
//
// SCOPE: server-derived from auth.uid() → travelers.user_id. traveler_id / client_id / tenant_id /
// locations are NEVER taken from the model or the request body. Every read is bound to the caller's
// own linked traveler id(s). Read-only: no writes, no routing, no approvals, no notifications.

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
  getCallerIdentity,
} from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const MODEL = "openai/gpt-4o-mini";
const MAX_ITERS = 4;
const MAX_HISTORY = 12;

// Safe column allow-lists (mirror get-my-travel — never SELECT *).
const TRAVELER_SELECT = "id, name, status, current_location, current_country";
const ITINERARY_SELECT = "id, trip_name, trip_type, departure_date, return_date, origin_city, origin_country, destination_city, destination_country, status, next_check_in_due_at, last_check_in_at, journey_overdue, hotel_name";
const ALERT_SELECT = "id, itinerary_id, title, severity, alert_type, location, is_active, created_at";

const RISK_CATEGORIES = [
  "severe_weather", "wildfire_flood_natural_hazard", "airport_disruption", "airline_transit_disruption",
  "road_closure_transport", "civil_unrest_protest", "public_safety_incident", "government_travel_advisory",
  "destination_security",
] as const;
const CATEGORY_TERMS: Record<string, string> = {
  severe_weather: "severe weather OR storm OR hurricane OR typhoon OR heatwave",
  wildfire_flood_natural_hazard: "wildfire OR flood OR earthquake OR natural hazard OR evacuation",
  airport_disruption: "airport disruption OR airport closure OR flight delays",
  airline_transit_disruption: "airline strike OR transit strike OR rail disruption",
  road_closure_transport: "road closure OR highway closed OR major transport disruption",
  civil_unrest_protest: "protest OR civil unrest OR demonstration OR riot",
  public_safety_incident: "public safety incident OR major incident OR security alert",
  government_travel_advisory: "government travel advisory OR travel warning",
  destination_security: "travel safety OR security concern OR travel advisory",
};
const ALL_RISK_TERMS = "travel advisory OR severe weather OR wildfire OR flood OR protest OR civil unrest OR airport disruption OR transit strike OR road closure OR public safety incident";

// ── Scope context (server-derived; mirrors get-my-travel ownership rules) ──
interface TravellerCtx {
  userId: string;
  travelerIds: string[];
  travelerName: string;
  itineraries: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
  tripRequests: Record<string, unknown>[];
  journeyByItin: Record<string, { event_type: string; at: string; note: string | null }>;
  destinations: { city: string | null; country: string | null }[];
}

function uniqById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const r of rows) { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } }
  return out;
}

async function loadTravellerCtx(svc: ReturnType<typeof createServiceClient>, userId: string): Promise<TravellerCtx | null> {
  const { data: travelers } = await svc.from("travelers").select(TRAVELER_SELECT).eq("user_id", userId);
  if (!travelers || travelers.length === 0) return null;
  const travelerIds = travelers.map((t: { id: string }) => t.id);
  const travelerName = String((travelers[0] as { name?: string }).name ?? "traveller");

  const { data: directItins } = await svc.from("itineraries").select(ITINERARY_SELECT).in("traveler_id", travelerIds);
  const { data: partyRows } = await svc.from("itinerary_travelers").select("itinerary_id").in("traveler_id", travelerIds);
  const partyIds = [...new Set((partyRows ?? []).map((r: { itinerary_id: string }) => r.itinerary_id).filter(Boolean))];
  let partyItins: Record<string, unknown>[] = [];
  if (partyIds.length > 0) { const { data } = await svc.from("itineraries").select(ITINERARY_SELECT).in("id", partyIds); partyItins = data ?? []; }
  const itineraries = uniqById([...(directItins ?? []), ...partyItins] as { id: string }[]) as Record<string, unknown>[];
  const ownedItinIds = itineraries.map((i) => (i as { id: string }).id);

  const { data: alertsByTrav } = await svc.from("travel_alerts").select(ALERT_SELECT).in("traveler_id", travelerIds);
  let alertsByItin: Record<string, unknown>[] = [];
  if (ownedItinIds.length > 0) { const { data } = await svc.from("travel_alerts").select(ALERT_SELECT).in("itinerary_id", ownedItinIds); alertsByItin = data ?? []; }
  const alerts = uniqById([...(alertsByTrav ?? []), ...alertsByItin] as { id: string }[]) as Record<string, unknown>[];

  const journeyByItin: TravellerCtx["journeyByItin"] = {};
  if (ownedItinIds.length > 0) {
    const { data: events } = await svc.from("traveller_journey_events")
      .select("itinerary_id, event_type, note, created_at").in("itinerary_id", ownedItinIds).order("created_at", { ascending: false });
    for (const e of (events ?? []) as { itinerary_id: string; event_type: string; note: string | null; created_at: string }[]) {
      if (!journeyByItin[e.itinerary_id]) journeyByItin[e.itinerary_id] = { event_type: e.event_type, at: e.created_at, note: e.note ?? null };
    }
  }

  // Pending trip requests — own only (created_by = auth.uid(), the proven intake scope).
  const { data: trs } = await svc.from("traveller_trip_requests")
    .select("id, trip_name, status, start_date, end_date, destination_summary, created_at")
    .eq("created_by", userId).order("created_at", { ascending: false }).limit(10);
  const tripRequests = (trs ?? []) as Record<string, unknown>[];

  const destinations = itineraries.map((i) => ({
    city: (i as { destination_city?: string }).destination_city ?? null,
    country: (i as { destination_country?: string }).destination_country ?? null,
  })).filter((d) => d.city || d.country);

  return { userId, travelerIds, travelerName, itineraries, alerts, tripRequests, journeyByItin, destinations };
}

// ── Itinerary-bound public risk retrieval (Google CSE direct; server-built query only) ──
async function travellerRiskAwareness(ctx: TravellerCtx, category?: string): Promise<unknown> {
  const key = Deno.env.get("GOOGLE_SEARCH_API_KEY");
  const engine = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
  if (!key || !engine) return { available: false, reason: "Risk awareness service is not configured." };
  // Locations come ONLY from the traveller's own itinerary — never from the model.
  const dests = uniqDestStrings(ctx.destinations).slice(0, 2);
  if (dests.length === 0) return { available: false, reason: "No destination is on file for this traveller's trips yet." };
  const cat = category && RISK_CATEGORIES.includes(category as typeof RISK_CATEGORIES[number]) ? category : undefined;
  const terms = cat ? (CATEGORY_TERMS[cat] ?? ALL_RISK_TERMS) : ALL_RISK_TERMS;

  const items: { title: string; url: string; source: string; snippet: string }[] = [];
  for (const dest of dests) {
    const q = `"${dest}" (${terms})`;
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${engine}&q=${encodeURIComponent(q)}&num=4&dateRestrict=m1&sort=date`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const it of (data.items ?? []).slice(0, 4)) {
        items.push({
          title: String(it.title ?? "").slice(0, 200),
          url: String(it.link ?? ""),
          source: String(it.displayLink ?? "").slice(0, 120),
          snippet: String(it.snippet ?? "").slice(0, 400),
        });
      }
    } catch { /* skip this destination on error */ }
  }
  const deduped = items.filter((it, i) => items.findIndex((x) => x.url === it.url) === i).slice(0, 8);
  return {
    available: true,
    destinations_checked: dests,
    category: cat ?? "all_risk_categories",
    result_count: deduped.length,
    no_relevant_signal: deduped.length === 0, // say "no signal found", NOT "all clear"
    low_confidence: deduped.length > 0 && deduped.length < 2,
    items: deduped,
    note: "Public web results for the traveller's own destinations. Cite sources; if confidence is low, say so; if empty, say no current public risk signal was found (not 'all clear').",
  };
}
function uniqDestStrings(dests: { city: string | null; country: string | null }[]): string[] {
  const out: string[] = [];
  for (const d of dests) {
    const s = [d.city, d.country].filter(Boolean).join(", ");
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// ── Read-only own-trip snapshot (the get_my_travel tool result) ──
function ownTravelSnapshot(ctx: TravellerCtx): unknown {
  const JOURNEY_LABEL: Record<string, string> = { safe: "Safe", arrived: "Arrived", at_pickup: "At pickup", in_vehicle: "In the vehicle", need_assistance: "Assistance requested" };
  return {
    traveler_name: ctx.travelerName,
    itineraries: ctx.itineraries.map((i) => {
      const id = (i as { id: string }).id;
      const j = ctx.journeyByItin[id];
      return {
        trip_name: (i as Record<string, unknown>).trip_name ?? null,
        from: [(i as Record<string, unknown>).origin_city, (i as Record<string, unknown>).origin_country].filter(Boolean).join(", ") || null,
        to: [(i as Record<string, unknown>).destination_city, (i as Record<string, unknown>).destination_country].filter(Boolean).join(", ") || null,
        departure_date: (i as Record<string, unknown>).departure_date ?? null,
        return_date: (i as Record<string, unknown>).return_date ?? null,
        status: (i as Record<string, unknown>).status ?? null,
        check_in_due: (i as Record<string, unknown>).next_check_in_due_at ?? null,
        check_in_overdue: (i as Record<string, unknown>).journey_overdue ?? false,
        latest_journey_status: j ? (JOURNEY_LABEL[j.event_type] ?? j.event_type) : null,
      };
    }),
    active_alerts: ctx.alerts.filter((a) => (a as { is_active?: boolean }).is_active !== false).map((a) => ({
      title: (a as Record<string, unknown>).title ?? null, severity: (a as Record<string, unknown>).severity ?? null,
      type: (a as Record<string, unknown>).alert_type ?? null, location: (a as Record<string, unknown>).location ?? null,
    })),
    pending_trip_requests: ctx.tripRequests.map((r) => ({
      trip_name: (r as Record<string, unknown>).trip_name ?? null, status: (r as Record<string, unknown>).status ?? null,
      destinations: (r as Record<string, unknown>).destination_summary ?? null,
    })),
  };
}

function buildPersona(ctx: TravellerCtx): string {
  const snap = JSON.stringify(ownTravelSnapshot(ctx));
  return [
    `You are Aegis, a calm, concise personal travel assistant on Silent Shield's traveller portal, speaking with ${ctx.travelerName}.`,
    "Style: warm, brief, plain language, one question at a time. Replies are often read aloud, so keep them short (2–4 sentences).",
    "",
    "STRICT SCOPE — you can see ONLY this traveller's own trip information (provided below) and current PUBLIC risk information for this traveller's own destinations (via the traveller_risk_awareness tool).",
    "You have NO access to: other travellers, operators, company/Fortress intelligence, signals, entities, incidents, investigations, reports, documents, clients, dark web, sanctions, social-media or person investigations, or any internal systems. If asked for any of that, briefly say you don't have access to that here, and offer what you can help with (their own trip + trip-relevant public risk).",
    "Never browse arbitrary topics. The risk tool only checks this traveller's own destinations; you cannot choose other places or subjects.",
    "",
    "READ-ONLY: you cannot make changes, add or submit trips, check in, request assistance, approve, notify anyone, dispatch help, or start monitoring. If the traveller wants to do those, tell them you'll guide them and that they can do it on the page — it is saved only when they confirm. NEVER claim an action was done.",
    "Never say: 'monitoring has started', 'I notified security', 'help is dispatched', 'security is responding', 'scanning', 'threats detected'. Never name internal agents.",
    "",
    "GROUNDING: state trip facts only if they appear in the data below or a tool result. If something isn't there, say you don't see it — do not invent flights, dates, or details. When you report public risk, cite the source name; if results are sparse/low-confidence, say so; if none are found, say you didn't find a current public risk signal for their destinations — do not say 'all clear'.",
    "",
    "Tools:",
    "- get_my_travel(): this traveller's own itineraries, dates, destinations, check-in status, alerts, pending trip requests.",
    "- traveller_risk_awareness(category?): current public risk for THIS traveller's own destinations only (weather, wildfire/flood, airport/airline/transit disruption, road closures, civil unrest/protest, public-safety incidents, government advisories, destination security).",
    "",
    `THIS TRAVELLER'S CURRENT TRIP DATA (the only personal data you may use):\n${snap}`,
  ].join("\n");
}

// ── Request-local tool schemas (the ONLY tools the model can see) ──
const TOOL_SCHEMAS = [
  { type: "function", function: { name: "get_my_travel", description: "Get THIS traveller's own trip data: itineraries, dates, destinations, journey check-in status, active travel alerts, and pending trip requests. No arguments.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "traveller_risk_awareness", description: "Check CURRENT public risk information for THIS traveller's own destinations only (destinations are taken from their itinerary automatically — you cannot search arbitrary places or topics). Categories: severe weather, wildfire/flood/natural hazard, airport disruption, airline/transit disruption, road/transport closures, civil unrest/protest, public-safety incidents, government travel advisories, destination security.", parameters: { type: "object", properties: { category: { type: "string", enum: RISK_CATEGORIES as unknown as string[], description: "Optional single category to focus on." } }, additionalProperties: false } } },
];

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
  if (caller.kind === "service_role") return errorResponse("SERVICE_ROLE_NOT_ALLOWED: traveller-aegis-chat is for authenticated traveller users only", 403);
  const userId = caller.userId;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return errorResponse("invalid JSON body", 400); }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return errorResponse("EMPTY_MESSAGE", 400);
  // History is advisory context only; scope is NEVER derived from it.
  const historyIn = Array.isArray(body.conversation_history) ? body.conversation_history : [];
  const history = historyIn
    .filter((m): m is { role: string; content: string } => !!m && typeof (m as { content?: unknown }).content === "string" && ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant"))
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

  const svc = createServiceClient();
  const ctx = await loadTravellerCtx(svc, userId);
  if (!ctx) return errorResponse("NOT_LINKED: no traveller profile is linked to this account", 403);

  // Request-local handlers — closures over the server-derived ctx ONLY (no module-global state,
  // no scope from model args). traveler/client/tenant scope cannot be passed or widened.
  const runTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name === "get_my_travel") return ownTravelSnapshot(ctx);
    if (name === "traveller_risk_awareness") {
      const category = typeof args.category === "string" ? args.category : undefined;
      return await travellerRiskAwareness(ctx, category);
    }
    return { error: `Unknown tool: ${name}` };
  };

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: buildPersona(ctx) },
    ...history,
    { role: "user", content: message },
  ];

  const toolTrace: { tool: string; result_summary: string }[] = [];
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const ai = await callAiGateway({
      model: MODEL,
      messages,
      functionName: "traveller-aegis-chat",
      extraBody: { tools: TOOL_SCHEMAS, tool_choice: "auto" },
      retries: 1,
    });
    if (ai.error || !ai.raw) {
      return errorResponse(ai.circuitOpen ? "AEGIS_UNAVAILABLE" : "AEGIS_FAILED", 502);
    }
    const msg = ai.raw?.choices?.[0]?.message;
    if (!msg) return errorResponse("AEGIS_FAILED", 502);
    messages.push(msg);
    const toolCalls = msg.tool_calls as Array<{ id: string; function?: { name?: string; arguments?: string } }> | undefined;
    if (!toolCalls || toolCalls.length === 0) {
      return successResponse({ reply: msg.content ?? "", tools_used: toolTrace.map((t) => t.tool) });
    }
    for (const tc of toolCalls) {
      const fnName = tc.function?.name ?? "";
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* ignore */ }
      const result = await runTool(fnName, args);
      toolTrace.push({ tool: fnName, result_summary: JSON.stringify(result).slice(0, 120) });
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) });
    }
  }

  // Out of iterations — final answer with tools disabled.
  const final = await callAiGateway({
    model: MODEL,
    messages: [...messages, { role: "user", content: "Give your final short answer now using what you already have." }],
    functionName: "traveller-aegis-chat",
    extraBody: {},
    retries: 1,
  });
  return successResponse({ reply: final.content ?? "", tools_used: toolTrace.map((t) => t.tool) });
});
