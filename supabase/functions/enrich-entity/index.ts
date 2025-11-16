import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entityName, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log('Enriching entity:', entityName);

    // Use Lovable AI to search and extract entity information
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: 'system', 
            content: 'You are a threat intelligence analyst. Extract and structure entity information for security analysis.' 
          },
          { 
            role: 'user', 
            content: `Research and provide structured information about: ${entityName}\n\nContext: ${context || 'No additional context'}\n\nProvide:\n1. Entity type (person/organization/location/infrastructure/domain/ip_address/email/phone/vehicle/other)\n2. Brief description (2-3 sentences)\n3. Risk level (critical/high/medium/low) with justification\n4. Known aliases or alternate names\n5. Threat indicators (if any)\n6. Associated organizations or locations\n7. Threat score (0-100) based on: public profile, threat indicators, associations, historical incidents\n\nFormat as JSON with keys: type, description, risk_level, risk_justification, aliases, threat_indicators, associations, threat_score` 
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "enrich_entity",
              description: "Return structured entity information for security analysis",
              parameters: {
                type: "object",
                properties: {
                  type: { 
                    type: "string",
                    enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "other"]
                  },
                  description: { type: "string" },
                  risk_level: { 
                    type: "string",
                    enum: ["critical", "high", "medium", "low"]
                  },
                  risk_justification: { type: "string" },
                  aliases: { 
                    type: "array",
                    items: { type: "string" }
                  },
                  threat_indicators: { 
                    type: "array",
                    items: { type: "string" }
                  },
                  associations: { 
                    type: "array",
                    items: { type: "string" }
                  },
                  threat_score: { 
                    type: "number",
                    minimum: 0,
                    maximum: 100
                  }
                },
                required: ["type", "description", "risk_level", "threat_score"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "enrich_entity" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices[0].message.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const enrichedData = JSON.parse(toolCall.function.arguments);
    console.log('Entity enrichment successful:', enrichedData);

    return new Response(
      JSON.stringify({ success: true, data: enrichedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in enrich-entity function:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
