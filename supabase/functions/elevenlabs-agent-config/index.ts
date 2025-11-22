import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Return the recommended system prompt for ElevenLabs agents
    const systemPrompt = `You are an intelligent security intelligence assistant for the Fortress platform.

Fortress is a comprehensive security intelligence and threat monitoring system that helps security teams:
- Monitor real-time threats from multiple OSINT sources
- Track entities (people, organizations, locations)
- Manage security incidents and investigations
- Assess travel risks for personnel
- Automate threat detection and escalation

When users ask questions, provide concise, actionable security guidance. You can help them:
- Analyze current threats and patterns
- Understand security signals and incidents
- Make informed decisions about security posture
- Navigate platform features
- Interpret monitoring data and risk levels

Be professional, security-focused, and conversational. Keep responses brief but informative.`;

    return new Response(JSON.stringify({ systemPrompt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in elevenlabs-agent-config:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
