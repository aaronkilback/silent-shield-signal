import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  recallChatContext,
  learnFromChatExchange,
} from "../_shared/agent-chat-memory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    // Fortress ai_agents.id (UUID). Mobile resolves slug → UUID via
    // src/lib/agent-mappings.ts and sends both. If absent, memory +
    // belief recall/learn is skipped (graceful degrade).
    const agentFortressId: string | null = body?.agentFortressId ?? null;
    const clientId: string | null = body?.clientId ?? null;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

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
    // Pull the agent's relevant prior exchanges and current beliefs,
    // inject as a prompt section. Same shared module as respond-as-agent
    // so a chat in any surface (mobile 1:1, mobile team @-mention,
    // Fortress webapp) builds the same memory layer.
    let memorySection = "";
    let queryEmbedding: number[] | null = null;
    const lastUserMsg = messages
      .slice()
      .reverse()
      .find((m: any) => m?.role === "user");
    const lastUserContent = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

    let admin: ReturnType<typeof createClient> | null = null;
    if (agentFortressId && lastUserContent) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey =
        Deno.env.get("SERVICE_ROLE_JWT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      admin = createClient(supabaseUrl, serviceKey);
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

Remember: You are the trusted AI partner for security professionals. Every interaction matters for mission success.${operatorLine}${platformStatusLine}${memorySection}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m: { role: string; content: string }) => {
            const role = m?.role === "system" || m?.role === "assistant" || m?.role === "user" ? m.role : "user";
            return {
              role,
              content: typeof m?.content === "string" ? m.content : "",
            };
          }),
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service credits depleted. Please contact administration." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: `AI gateway error (${response.status}): ${text.slice(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!response.body) {
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Tee the stream — pass it through to the client unchanged while
    // accumulating the assistant's content. When the upstream completes
    // we fire the memory+belief learn step against the assembled text.
    const decoder = new TextDecoder();
    let assistantContent = "";

    const learnAfterStream = async () => {
      if (!admin || !agentFortressId || !lastUserContent || !assistantContent.trim()) return;
      try {
        await learnFromChatExchange(admin, {
          agentId: agentFortressId,
          agentCallSign: agentConfig?.name || agentConfig?.codename || "AEGIS-CMD",
          conversationId: conversationId || "(no conversation)",
          triggerMessageId: null,
          responseMessageId: null,
          operatorExcerpt: lastUserContent,
          agentExcerpt: assistantContent,
          operatorId: operator?.id ?? null,
          clientId,
          queryEmbedding,
        });
      } catch (e) {
        console.warn("[aegis-chat] learn failed:", e);
      }
    };

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        // Decode + extract delta.content from SSE events to build the
        // assistant text. OpenAI emits `data: {...json...}\n\n` lines.
        const text = decoder.decode(chunk, { stream: true });
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") assistantContent += delta;
          } catch {
            // ignore malformed line
          }
        }
      },
      async flush() {
        // Stream finished — fire the learn step. Don't await so the
        // response bytes finish being delivered first.
        void learnAfterStream();
      },
    });

    return new Response(response.body.pipeThrough(transform), {
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
