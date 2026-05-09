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
import { callAiGateway } from "../_shared/ai-gateway.ts";
// Side-effect import — registers every tool in the registry.
import "../_shared/agent-tools-core.ts";

// Caps for inline image uploads. Photo is sent as a base64 data URL
// in the request body (no separate storage). 8MB raw byte cap covers
// a 1024px JPEG @ 0.85 quality with margin; rejects oversized blobs
// before we ship them to the vision API.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const VISION_SYSTEM_PROMPT = `You are a wildfire visual-analysis specialist. The user (a field worker or operator in NE BC oil-and-gas country) has shared a photo. Analyze it for wildfire-relevant content. Be concrete and operationally honest about what you can and cannot tell from a single still image.

Output as short markdown sections — no preamble, no apologies. If the image clearly is NOT fire / smoke / wildfire-relevant (selfie, screenshot, document, etc.), say so in one line and stop.

When the image IS wildfire-relevant, report:
- **Subject** — fire, smoke column, both, or aftermath. State which.
- **Smoke** — color (white = water-heavy / early, gray = mature, dark = active/high-carbon, brown = vegetation/crown, black = synthetic/structures); shape (vertical / bent / pyrocumulus); apparent drift direction relative to the photographer.
- **Flame** (if visible) — height relative to surrounding vegetation; intensity cues.
- **Distance estimate** — cite the scale reference you used (foreground tree height, vehicle, road, structure, terrain feature) AND give an uncertainty range (e.g. "~3–8 km based on tree-line scale"). If you cannot reliably estimate, say so plainly.
- **Fuel / terrain** — visible fuel (grass, mixed boreal, slash piles, structures) and terrain (flat, valley, ridgeline, drainage).
- **Wildfire vs. industrial** — call out if it looks more like an industrial flare (hot point source, no advancing front, near visible facility) than a free-burning wildfire.
- **One-line operator note** — what should they do right now? (Examples: "Report to BCWS at 1-800-663-5555 with these coordinates"; "Monitor BCWS evacuation alerts — column drift suggests it's heading toward populated area"; "This reads as routine industrial flaring; no action.")

<250 words total. They're on a phone in a truck.`;

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

    // Optional inline photo for vision analysis. Frontend resizes to
    // <=1024px JPEG, encodes as a data URL, and sends here. We do a
    // dedicated single-pass vision call before the tool loop so the
    // tool-using agent can reason over a text summary of what's in
    // the photo (and decide whether to look up BCWS fires near a
    // mentioned location, etc.).
    const rawImage = body?.image;
    const hasImage =
      rawImage &&
      typeof rawImage === "object" &&
      typeof rawImage.data === "string" &&
      rawImage.data.startsWith("data:image/");
    let imageBytes = 0;
    let imageRejected: string | null = null;
    if (hasImage) {
      const base64Part = (rawImage.data as string).split(",")[1] ?? "";
      // base64 length * 3/4 ≈ raw bytes (close enough for the cap)
      imageBytes = Math.floor((base64Part.length * 3) / 4);
      if (imageBytes > MAX_IMAGE_BYTES) {
        imageRejected = `Image too large (${(imageBytes / 1024 / 1024).toFixed(1)}MB). Max ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`;
      }
    }

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
        has_image: !!hasImage,
        image_bytes: hasImage ? imageBytes : null,
        image_rejected: imageRejected,
      },
    });

    if (imageRejected) {
      return new Response(ssePayload(`*${imageRejected}*`), {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Vision pass — only when an image is attached. Uses gpt-4o
    // (vision-capable) with skipGuardrails since the visual
    // grounding-instructions are already in our specialist prompt.
    let visionAnalysis: string | null = null;
    let visionError: string | null = null;
    if (hasImage) {
      const tVisionStart = Date.now();
      // Multipart `content` array (text + image_url) is the OpenAI
      // vision format. callAiGateway types content as string but
      // forwards messages verbatim to the provider, which DOES accept
      // the array form — cast at the boundary.
      const visionResult = await callAiGateway({
        functionName: "wildfire-portal-chat:vision",
        model: "openai/gpt-4o",
        skipGuardrails: true,
        messages: [
          { role: "system", content: VISION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: lastUserContent
                  ? `Operator message accompanying the photo: "${lastUserContent}"`
                  : "(No accompanying message — analyze the photo on its own.)",
              },
              { type: "image_url", image_url: { url: rawImage.data } },
            ],
          },
        ] as any,
      });
      const visionMs = Date.now() - tVisionStart;
      if (visionResult.error || !visionResult.content) {
        visionError = visionResult.error || "Vision pass returned no content.";
        console.warn(`[wildfire-portal-chat] vision pass failed (${visionMs}ms): ${visionError}`);
      } else {
        visionAnalysis = visionResult.content.trim();
        console.log(`[wildfire-portal-chat] vision pass ok in ${visionMs}ms (${visionAnalysis.length} chars)`);
      }
      void admin.from("wildfire_portal_usage").insert({
        event_type: "vision_pass",
        session_id: sessionId,
        ip_hash: ipHash,
        payload: {
          ok: !!visionAnalysis,
          duration_ms: visionMs,
          image_bytes: imageBytes,
          error: visionError,
        },
      });
    }

    const transcript = messages
      .filter((m: any) => m?.role === "user" || m?.role === "assistant")
      .map((m: any) => `${m.role === "user" ? "OPERATOR" : "WILDFIRE"}: ${typeof m.content === "string" ? m.content : ""}`)
      .join("\n");

    // If we have a vision analysis, splice it into the user message so
    // the tool-using agent can reason over it (correlate against BCWS,
    // run lookup_location_coords if the operator named a place, etc.)
    // and reference it explicitly in its reply.
    let userMessage: string;
    if (visionAnalysis) {
      userMessage =
        `Conversation transcript:\n${transcript}\n\n` +
        `The operator attached a photo with their latest message. A vision specialist has analyzed it; their findings are below verbatim. Treat these as ground truth about the image (you cannot see the photo yourself).\n\n` +
        `--- VISION ANALYSIS ---\n${visionAnalysis}\n--- END VISION ANALYSIS ---\n\n` +
        `Now respond as WILDFIRE. Begin your reply with a short bolded "**Photo read:**" section that paraphrases the vision findings in 2-3 lines (so the operator sees what you saw). Then call any tools needed to ground operational guidance (e.g. get_bcws_active_fires_near if the photo and message suggest a location, get_bcws_evacuations_near for column-drift assessment, get_bc_danger_rating_for_station if a Petronas station was mentioned). End with a short "**What to do now:**" line.`;
    } else if (visionError && hasImage) {
      userMessage =
        `Conversation transcript:\n${transcript}\n\n` +
        `The operator attached a photo, but the vision analysis failed (${visionError}). Acknowledge the photo couldn't be analyzed and continue based on their text message. Respond as WILDFIRE.`;
    } else {
      userMessage = `Conversation transcript:\n${transcript}\n\nThe operator's latest message is the last OPERATOR line above. Respond as WILDFIRE.`;
    }

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
