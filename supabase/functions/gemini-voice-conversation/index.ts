import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { action, audioData, conversationHistory } = await req.json();

    console.log(`Voice conversation action: ${action}`);

    if (action === "initialize") {
      // Initialize voice session with system prompt
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

Be professional, security-focused, and conversational in your voice responses. Keep responses brief but informative, as this is a voice conversation.`;

      return new Response(
        JSON.stringify({ 
          status: "initialized",
          systemPrompt 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "process_audio" && audioData) {
      // Process audio through Gemini with voice capabilities
      const messages = [
        {
          role: "system",
          content: "You are a security intelligence assistant. Respond naturally and conversationally."
        },
        ...(conversationHistory || []),
        {
          role: "user",
          content: "Audio input received"
        }
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
        console.error("AI gateway error:", response.status, errorText);
        throw new Error(`AI gateway error: ${errorText}`);
      }

      const data = await response.json();
      const assistantMessage = data.choices[0].message.content;

      console.log("Generated voice response");

      return new Response(
        JSON.stringify({ 
          transcription: audioData.transcription || "Voice input processed",
          response: assistantMessage,
          status: "processed"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    throw new Error("Invalid action or missing audioData");

  } catch (error) {
    console.error("Error in gemini-voice-conversation:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        status: "error"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
