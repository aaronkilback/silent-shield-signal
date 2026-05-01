import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  recallChatContext,
  learnFromChatExchange,
} from "../_shared/agent-chat-memory.ts";
import { runAgentLoop } from "../_shared/agent-tools.ts";
// Side-effect import — registers every tool in the registry. New
// tools added to agent-tools-core.ts (or any other file calling
// registerTool) automatically become available to the dedicated 1:1
// chat surface on next deploy.
import "../_shared/agent-tools-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Mobile clients expect SSE-formatted output with chunks shaped like
// OpenAI's chat-completions stream:
//   data: {"choices":[{"delta":{"content":"..."}}]}\n\n
//   ...
//   data: [DONE]\n\n
// We run the iterative tool loop non-streaming, then deliver the final
// answer as a single SSE event to keep the existing parser happy.
function ssePayload(content: string): string {
  const evt = JSON.stringify({ choices: [{ delta: { content } }] });
  return `data: ${evt}\n\ndata: [DONE]\n\n`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const operator = body?.operator ?? null;
    const conversationId = body?.conversationId ?? null;
    const platformContext = body?.platformContext ?? null;
    const agentConfig = body?.agentConfig ?? null;
    const agentFortressId: string | null = body?.agentFortressId ?? null;
    const clientId: string | null = body?.clientId ?? null;

    const operatorLine = operator?.id
      ? `\n\nOperator context:\n- id: ${operator.id}${operator?.name ? `\n- name: ${operator.name}` : ""}${conversationId ? `\n- conversation_id: ${conversationId}` : ""}\n\nYou MUST use the operator name when available; if not available, ask the operator for their preferred name once.`
      : conversationId
        ? `\n\nConversation context:\n- conversation_id: ${conversationId}`
        : "";

    const platformStatusLine = platformContext
      ? `\n\nCURRENT PLATFORM STATUS:\n${platformContext}\n\nYou have full access to platform intelligence. Reference signals, team status, available agents, and locations when relevant to the operator's queries.`
      : "";

    const baseSystemPrompt = agentConfig?.systemPrompt || `You are Aegis, the lead AI security agent for Silent Shield Security Operations Center. You are:
- Professional, tactical, and concise
- Expert in security operations, threat assessment, travel risk analysis, and team coordination
- Connected to a network of specialized agents (Sentinel, OSINT, Monitor, etc.)
- Protective of your operators and always prioritizing their safety

When asked about flights:
- Ask for the flight number if not provided (e.g., "UA123", "BA456")
- Provide departure/arrival times, delays, gate info when available
- Flag any travel advisories for origin/destination airports

When asked to generate a security briefing:
- Ask for the city and country if not provided
- Optionally ask for travel dates and purpose for more tailored advice
- Generate comprehensive ISOS-style briefings with all risk categories`;

    // ── MEMORY + BELIEFS RECALL ──────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey =
      Deno.env.get("SERVICE_ROLE_JWT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const lastUserMsg = messages
      .slice()
      .reverse()
      .find((m: any) => m?.role === "user");
    const lastUserContent = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

    let memorySection = "";
    let queryEmbedding: number[] | null = null;
    if (agentFortressId && lastUserContent) {
      try {
        const recall = await recallChatContext(admin, {
          agentId: agentFortressId,
          query: lastUserContent,
          clientId,
        });
        memorySection = recall.promptInjection;
        queryEmbedding = recall.queryEmbedding;
      } catch (e) {
        console.warn("[aegis-chat] recall failed:", e);
      }
    }

    const systemPrompt = `${baseSystemPrompt}

Communication style:
- Use military/security terminology when appropriate
- Be direct but supportive
- Acknowledge the operator's requests clearly
- Provide actionable intelligence and recommendations
- Use markdown formatting for clarity (headers, bullets, bold for emphasis)
- Reference current signals, team status, and locations when relevant

USING YOUR TOOLS — HARD RULE:
- Before stating ANY specific fact (numbers, locations, "no active fires", "X signals in the last 24h", entity relationships, current status, recent events, danger levels), you MUST call a tool to verify.
- Acceptable to answer from training only if the operator asked a CONCEPTUAL question ("what is FWI?", "explain CARVER"). Anything operational requires a tool call.
- If you're tempted to say "based on current data..." or "as of today..." or "no [thing] reported within X km" — STOP, call lookup_historical_signals or get_signal_velocity or query_entity_relationships first. Don't make claims you didn't verify.
- If tools return nothing, say so honestly: "I queried lookup_historical_signals — no matches. I cannot confirm from chat tools alone."
- Tool calls are cheap. Use 1-3 per turn when they help.
- DO NOT stall with "querying...", "let me check", "please hold" — actually call the tool now and answer in this turn.

Remember: You are the trusted AI partner for security professionals. Every interaction matters for mission success.${operatorLine}${platformStatusLine}${memorySection}`;

    // Build the user message — feed the entire conversation transcript
    // so the loop has context, then put the latest user turn last so
    // the model knows what to answer.
    const transcript = messages
      .filter((m: any) => m?.role === "user" || m?.role === "assistant")
      .map((m: any) => `${m.role === "user" ? "OPERATOR" : "AGENT"}: ${typeof m.content === "string" ? m.content : ""}`)
      .join("\n");

    const userMessage = `Conversation transcript:\n${transcript}\n\nThe operator's latest message is the last OPERATOR line above. Respond as ${agentConfig?.name || "AEGIS-CMD"}.`;

    // ── ITERATIVE TOOL LOOP ──────────────────────────────────────────
    const investigation = await runAgentLoop(admin, {
      agentCallSign: agentConfig?.name || agentConfig?.codename || "AEGIS-CMD",
      functionName: "aegis-chat",
      // gpt-4o for reliable tool selection. Same model as
      // respond-as-agent so chat parity is preserved across surfaces.
      model: "openai/gpt-4o",
      contextClientId: clientId ?? undefined,
      maxIterations: 5,
      systemPrompt,
      userMessage,
    });

    if (investigation.error && !investigation.finalContent) {
      console.error("[aegis-chat] tool loop error:", investigation.error);
      return new Response(
        JSON.stringify({ error: `agent loop error: ${investigation.error}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const content: string = (investigation.finalContent ?? "").trim() || "(no response)";

    // ── LEARN — fire-and-forget memory + belief write ────────────────
    if (agentFortressId && lastUserContent) {
      void learnFromChatExchange(admin, {
        agentId: agentFortressId,
        agentCallSign: agentConfig?.name || agentConfig?.codename || "AEGIS-CMD",
        conversationId: conversationId || "(no conversation)",
        triggerMessageId: null,
        responseMessageId: null,
        operatorExcerpt: lastUserContent,
        agentExcerpt: content,
        operatorId: operator?.id ?? null,
        clientId,
        queryEmbedding,
      });
    }

    return new Response(ssePayload(content), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Aegis chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
