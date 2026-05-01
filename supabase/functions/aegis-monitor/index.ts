import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMERGENCY_KEYWORDS = [
  "help", "emergency", "urgent", "danger", "threat", "attack", 
  "breach", "compromised", "critical", "mayday", "sos", "hostile",
  "injured", "casualty", "evacuate", "lockdown", "shooter",
  "intrusion", "perimeter", "backup", "medic", "fire", "bomb",
  "trapped", "down", "ambush", "abort", "panic", "alarm"
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, conversationId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ shouldIntervene: false, suggestion: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get recent messages for context
    const recentMessages = messages.slice(-5);
    const lastMessage = recentMessages[recentMessages.length - 1];
    const messageContent = lastMessage?.content?.toLowerCase() || "";

    // Quick check for emergency keywords
    const hasEmergencyKeyword = EMERGENCY_KEYWORDS.some(keyword => 
      messageContent.includes(keyword)
    );

    // Analyze with AI
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are Aegis, an AI security assistant monitoring team communications for a security operations center. Your role is to:
1. Detect emergencies, threats, or distress in messages
2. Identify when team members might need tactical assistance
3. Offer helpful suggestions for security operations
4. Prioritize safety and rapid response

Analyze the conversation and determine:
- severity: "critical" (immediate danger/emergency), "high" (potential threat), "medium" (needs attention), "low" (informational), or "none"
- shouldIntervene: true if Aegis should offer help
- suggestion: A brief, actionable message if intervention is needed
- emergencyType: classify if emergency (e.g., "security_breach", "medical", "hostile_threat", "evacuation", "technical_failure", null)

Respond ONLY with valid JSON. Be concise but helpful.`
          },
          {
            role: "user",
            content: `Analyze this security team conversation for emergencies or assistance opportunities:\n\n${recentMessages.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join("\n")}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "analyze_message",
              description: "Analyze message for emergencies and provide recommendations",
              parameters: {
                type: "object",
                properties: {
                  severity: {
                    type: "string",
                    enum: ["critical", "high", "medium", "low", "none"],
                    description: "Severity level of the situation"
                  },
                  shouldIntervene: {
                    type: "boolean",
                    description: "Whether Aegis should offer assistance"
                  },
                  suggestion: {
                    type: "string",
                    description: "Helpful suggestion or alert message"
                  },
                  emergencyType: {
                    type: "string",
                    enum: ["security_breach", "medical", "hostile_threat", "evacuation", "technical_failure", "personnel_issue", "null"],
                    description: "Type of emergency if applicable"
                  }
                },
                required: ["severity", "shouldIntervene"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "analyze_message" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded", shouldIntervene: false }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required", shouldIntervene: false }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      
      // Fallback to keyword detection if AI fails
      if (hasEmergencyKeyword) {
        return new Response(
          JSON.stringify({
            severity: "high",
            shouldIntervene: true,
            suggestion: "Emergency keywords detected. Aegis is standing by to assist. Do you need immediate support?",
            emergencyType: "unknown"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ shouldIntervene: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const analysis = JSON.parse(toolCall.function.arguments);
      return new Response(
        JSON.stringify(analysis),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fallback
    return new Response(
      JSON.stringify({ shouldIntervene: false, severity: "none" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Monitor error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        shouldIntervene: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
