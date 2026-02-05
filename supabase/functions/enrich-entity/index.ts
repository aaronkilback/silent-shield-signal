const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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
            content: `Research and provide structured information about: ${entityName}\n\nContext: ${context || 'No additional context'}\n\nProvide:\n1. Entity type (person/organization/location/infrastructure/domain/ip_address/email/phone/vehicle/other)\n2. Brief description (2-3 sentences)\n3. Risk level (critical/high/medium/low) with justification\n4. Known aliases or alternate names\n5. Threat indicators (if any)\n6. Associated organizations or locations\n7. Contact information:\n   - Email addresses\n   - Phone numbers\n   - Website URL\n   - Physical address\n   - Social media profiles (LinkedIn, Twitter, Facebook, etc.)\n8. Threat score (0-10) calculated by:\n   - Recency: Recent activity/mentions = higher score (0-3 points)\n   - Confidence: Source reliability and verification level (0-4 points)\n   - Relevancy: Direct threat to client interests/assets (0-3 points)\n\nFormat as JSON with keys: type, description, risk_level, risk_justification, aliases, threat_indicators, associations, contact_info (object with email, phone, website, address, social_media), threat_score, recency_factor, confidence_factor, relevancy_factor` 
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
                    maximum: 10,
                    description: "Total threat score from 0-10"
                  },
                  recency_factor: {
                    type: "number",
                    minimum: 0,
                    maximum: 3,
                    description: "Recency score: recent activity = higher"
                  },
                  confidence_factor: {
                    type: "number",
                    minimum: 0,
                    maximum: 4,
                    description: "Confidence in source accuracy"
                  },
                  relevancy_factor: {
                    type: "number",
                    minimum: 0,
                    maximum: 3,
                    description: "Relevance to client threats"
                  },
                  contact_info: {
                    type: "object",
                    properties: {
                      email: { 
                        type: "array",
                        items: { type: "string" },
                        description: "Email addresses"
                      },
                      phone: { 
                        type: "array",
                        items: { type: "string" },
                        description: "Phone numbers"
                      },
                      website: { type: "string", description: "Website URL" },
                      address: { type: "string", description: "Physical address" },
                      social_media: {
                        type: "object",
                        properties: {
                          linkedin: { type: "string" },
                          twitter: { type: "string" },
                          facebook: { type: "string" },
                          instagram: { type: "string" },
                          other: { 
                            type: "array",
                            items: { type: "string" }
                          }
                        }
                      }
                    }
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
