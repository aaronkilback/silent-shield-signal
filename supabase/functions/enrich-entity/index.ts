import { callAiGateway } from "../_shared/ai-gateway.ts";

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

    console.log('Enriching entity:', entityName);

    const tools = [
      {
        type: "function",
        function: {
          name: "enrich_entity",
          description: "Return structured entity information for security analysis",
          parameters: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "other"] },
              description: { type: "string" },
              risk_level: { type: "string", enum: ["critical", "high", "medium", "low"] },
              risk_justification: { type: "string" },
              aliases: { type: "array", items: { type: "string" } },
              threat_indicators: { type: "array", items: { type: "string" } },
              associations: { type: "array", items: { type: "string" } },
              threat_score: { type: "number", minimum: 0, maximum: 10 },
              recency_factor: { type: "number", minimum: 0, maximum: 3 },
              confidence_factor: { type: "number", minimum: 0, maximum: 4 },
              relevancy_factor: { type: "number", minimum: 0, maximum: 3 },
              contact_info: {
                type: "object",
                properties: {
                  email: { type: "array", items: { type: "string" } },
                  phone: { type: "array", items: { type: "string" } },
                  website: { type: "string" },
                  address: { type: "string" },
                  social_media: {
                    type: "object",
                    properties: {
                      linkedin: { type: "string" },
                      twitter: { type: "string" },
                      facebook: { type: "string" },
                      instagram: { type: "string" },
                      other: { type: "array", items: { type: "string" } }
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
    ];

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are a threat intelligence analyst. Extract and structure entity information for security analysis.' },
        { role: 'user', content: `Research and provide structured information about: ${entityName}\n\nContext: ${context || 'No additional context'}\n\nProvide:\n1. Entity type\n2. Brief description\n3. Risk level with justification\n4. Known aliases\n5. Threat indicators\n6. Associated organizations or locations\n7. Contact information\n8. Threat score (0-10)\n\nFormat as JSON.` }
      ],
      functionName: 'enrich-entity',
      extraBody: { tools, tool_choice: { type: "function", function: { name: "enrich_entity" } } },
      dlqOnFailure: true,
      dlqPayload: { entityName, context },
    });

    if (aiResult.error) {
      throw new Error(aiResult.error);
    }

    // Extract tool call from raw response
    const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
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
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});