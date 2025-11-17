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
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are a helpful support assistant for a Security Operations Center (SOC) platform. 

**Platform Overview:**
This is an autonomous security operations platform that helps organizations monitor, detect, and respond to security threats.

**Key Features:**

1. **Signals**: Security events ingested from various sources (OSINT, threat intel, news, social media). Each signal has:
   - Severity levels (P1-P4)
   - Status (new, triaged, investigating, resolved, false_positive)
   - Normalized text, category, confidence score
   - Can be matched to clients and entities

2. **Incidents**: Escalated signals that require investigation. Includes:
   - Priority levels (P1-P4)
   - Status tracking (open, acknowledged, contained, resolved, closed)
   - SLA targets (MTTD - Mean Time To Detect, MTTR - Mean Time To Resolve)
   - Timeline tracking

3. **Entities**: Tracked items like persons, organizations, locations, infrastructure, domains, IPs, emails, phones, vehicles
   - Can have relationships with other entities
   - Risk levels and threat scores
   - Photo attachments
   - Mentioned in signals/incidents

4. **Autonomous SOC System**:
   - AI Decision Engine analyzes signals automatically
   - Auto-escalation based on severity
   - OSINT monitoring (dark web, social media, news, threat intel)
   - Pattern detection and campaign assessment

5. **Client Management**: Multi-tenant system where signals/incidents are matched to specific clients based on industry, location, assets, etc.

6. **Learning Dashboard**: Shows AI accuracy, false positive rates, trends over time

7. **Reports**: Executive reports can be generated for time periods

**Common User Questions:**
- How to ingest signals
- How to create/manage entities
- How to view relationships between entities
- How incidents are auto-escalated
- How to configure automation settings
- How to interpret AI decisions
- How to mark false positives
- How to understand SLA metrics

**Your Role:**
- Answer questions clearly and concisely
- Guide users through features
- Explain security concepts when needed
- Provide step-by-step instructions
- Be friendly and professional

Keep answers focused and practical. If you don't know something specific about their data, acknowledge it and guide them to where they can find the information in the UI.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits to your Lovable AI workspace." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Support chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
