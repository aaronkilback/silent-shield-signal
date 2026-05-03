/**
 * Public Wildfire Portal chat endpoint. Stateless SSE chat with the
 * WILDFIRE specialist agent — no auth required, no message persistence
 * (each portal session is its own conversation, held only in the
 * browser).
 *
 * verify_jwt=false in supabase/config.toml so anonymous visitors at
 * fortress.silentshieldsecurity.com/wildfire can use it without
 * signing in. Usage telemetry written to wildfire_portal_usage so we
 * can track adoption.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { runAgentLoop } from "../_shared/agent-tools.ts";
// Side-effect import — registers every tool in the registry.
import "../_shared/agent-tools-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function ssePayload(content: string): string {
  const evt = JSON.stringify({ choices: [{ delta: { content } }] });
  return `data: ${evt}\n\ndata: [DONE]\n\n`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const WILDFIRE_SYSTEM_PROMPT = `You are WILDFIRE, the Silent Shield wildfire intelligence specialist.

You are speaking through a public-facing portal — visitors are field workers, contractors, and operators in NE BC oil-and-gas country. They want fast, grounded answers about fire conditions, evacuations, and operational protocols. They are NOT signed-in Fortress analysts; do not assume they have access to other platform context.

OPERATING PRINCIPLES:
- Ground every specific fact (rating, evac order, fire size, AQHI, FWI, days at rating) in a tool call. Never claim a number you didn't fetch.
- Lead with the operational implication, then the data. Field workers want to know if they should be doing something differently RIGHT NOW.
- Petronas operational protocol mapping for high-risk activities:
    LOW                       — no work restrictions
    MODERATE  days <  3       — continue normal practices
    MODERATE  days >= 3       — fire watcher 1 hr after work
    HIGH      always          — fire watcher 2 hrs after work
    HIGH      days >= 3       — + cease activity 1 pm – sunset
    EXTREME / VERY HIGH       — cease 1 pm – sunset, fire watcher 2 hrs
    EXTREME   days >= 3       — CEASE ALL ACTIVITY for the entire day
- The five Petronas-monitored AWS stations are Hudson Hope, Graham, Wonowon, Pink Mountain, Muskwa. If asked about one, use get_bc_danger_rating_for_station.
- For an evacuation question: get_bcws_evacuations_near. For a fire question: get_bcws_active_fires_near. For air quality: get_air_quality_index. For weather forecasts: get_fire_weather_index. For location → coords: lookup_location_coords.
- Tool calls are cheap. Use 1–3 per turn when they help.
- Be terse. Field workers are on phones in trucks. Bullet points or 2–3 sentence answers. No long lectures.

TONE: calm, professional, operational. Like a senior fire boss giving a morning briefing.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const sessionId = String(body?.sessionId || "anon");

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role admin client for usage logging.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey =
      Deno.env.get("SERVICE_ROLE_JWT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Visitor fingerprint — hash the IP so we can count unique users
    // without storing PII. CF / Supabase pass the client IP in
    // x-forwarded-for; first hop is the visitor.
    const fwd = req.headers.get("x-forwarded-for") || "";
    const visitorIp = fwd.split(",")[0]?.trim() || "unknown";
    const ipHash = visitorIp !== "unknown" ? await sha256Hex(visitorIp) : null;
    const userAgent = req.headers.get("user-agent") || null;
    const referrer = req.headers.get("referer") || null;

    const lastUserMessage = messages[messages.length - 1];
    const lastUserContent =
      lastUserMessage?.role === "user" && typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : "";

    // Log the inbound chat message.
    void admin.from("wildfire_portal_usage").insert({
      event_type: "chat_message",
      session_id: sessionId,
      ip_hash: ipHash,
      user_agent: userAgent,
      referrer,
      payload: {
        message_excerpt: lastUserContent.substring(0, 500),
        message_count: messages.length,
      },
    });

    const transcript = messages
      .filter((m: any) => m?.role === "user" || m?.role === "assistant")
      .map((m: any) => `${m.role === "user" ? "OPERATOR" : "WILDFIRE"}: ${typeof m.content === "string" ? m.content : ""}`)
      .join("\n");
    const userMessage = `Conversation transcript:\n${transcript}\n\nThe operator's latest message is the last OPERATOR line above. Respond as WILDFIRE.`;

    const investigation = await runAgentLoop(admin, {
      agentCallSign: "WILDFIRE",
      functionName: "wildfire-portal-chat",
      model: "openai/gpt-4o",
      maxIterations: 5,
      systemPrompt: WILDFIRE_SYSTEM_PROMPT,
      userMessage,
    });

    if (investigation.error && !investigation.finalContent) {
      console.error("[wildfire-portal-chat] tool loop error:", investigation.error);
      return new Response(
        JSON.stringify({ error: `agent loop error: ${investigation.error}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const content: string = (investigation.finalContent ?? "").trim() || "(no response)";

    // Log every tool call individually + the final agent response.
    if (investigation.toolCalls && investigation.toolCalls.length > 0) {
      for (const tc of investigation.toolCalls) {
        void admin.from("wildfire_portal_usage").insert({
          event_type: "tool_call",
          session_id: sessionId,
          ip_hash: ipHash,
          payload: {
            tool: tc.toolName,
            iteration: tc.iteration,
            duration_ms: tc.durationMs,
            error: tc.errorMessage ?? null,
          },
        });
      }
    }
    void admin.from("wildfire_portal_usage").insert({
      event_type: "agent_response",
      session_id: sessionId,
      ip_hash: ipHash,
      payload: {
        response_excerpt: content.substring(0, 500),
        iterations: investigation.iterations,
        capped_at_max: investigation.cappedAtMax,
        tool_calls: (investigation.toolCalls || []).length,
      },
    });

    return new Response(ssePayload(content), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("[wildfire-portal-chat] unhandled:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
