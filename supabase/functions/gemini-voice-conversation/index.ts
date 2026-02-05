import { handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return errorResponse("LOVABLE_API_KEY is not configured", 500);
    }

    const { action, audioData, conversationHistory } = await req.json();

    console.log(`[GeminiVoice] Action: ${action}`);

    if (action === "initialize") {
      const systemPrompt = `You are an intelligent security intelligence assistant for the Fortress platform.

Fortress is a comprehensive security intelligence and threat monitoring system that helps security teams:
- Monitor real-time threats from multiple OSINT sources
- Track entities (people, organizations, locations, vehicles)
- Manage security incidents and investigations
- Assess travel risks for personnel
- Automate threat detection and escalation

When users ask questions, provide concise, actionable security guidance. You can help them:
- Analyze current threats and patterns
- Understand security signals and incidents
- Make informed decisions about security posture
- Navigate platform features
- Interpret monitoring data and risk levels

Be professional, security-focused, and conversational in your voice responses. Keep responses brief but informative.`;

      return successResponse({ status: "initialized", systemPrompt });
    }

    if (action === "process_audio" && audioData) {
      const messages = [
        { role: "system", content: "You are a security intelligence assistant. Respond naturally and conversationally." },
        ...(conversationHistory || []),
        { role: "user", content: "Audio input received" }
      ];

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[GeminiVoice] AI gateway error:", response.status, errorText);
        return errorResponse(`AI gateway error: ${errorText}`, 500);
      }

      const data = await response.json();
      const assistantMessage = data.choices[0].message.content;

      console.log("[GeminiVoice] Generated voice response");

      return successResponse({ 
        transcription: audioData.transcription || "Voice input processed",
        response: assistantMessage,
        status: "processed"
      });
    }

    return errorResponse("Invalid action or missing audioData", 400);

  } catch (error) {
    console.error("[GeminiVoice] Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
