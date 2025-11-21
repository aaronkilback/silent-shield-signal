import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const { filePath } = await req.json();

    if (!filePath) {
      throw new Error("File path is required");
    }

    console.log("Parsing document from storage:", filePath);

    // Call the existing parse-document function
    const { data: parseData, error: parseError } = await supabaseClient.functions.invoke(
      "parse-document",
      {
        body: {
          bucket: "travel-documents",
          path: filePath,
        },
      }
    );

    if (parseError) {
      console.error("Parse document error:", parseError);
      throw new Error(`Failed to parse document: ${parseError.message}`);
    }

    console.log("Document parsed, extracted text length:", parseData.text?.length || 0);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    console.log("Calling AI to extract travel details");

    // Call AI to extract structured data from parsed text
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are a travel document parser. Extract structured travel information from flight itineraries and e-tickets.",
          },
          {
            role: "user",
            content: `Extract all travel details from this itinerary text:\n\n${parseData.text}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_travel_details",
              description: "Extract structured travel information from an itinerary",
              parameters: {
                type: "object",
                properties: {
                  traveler_name: { type: "string" },
                  trip_name: { type: "string", description: "Descriptive name for the trip" },
                  trip_type: { type: "string", enum: ["domestic", "international"] },
                  departure_date: { type: "string", format: "date-time" },
                  return_date: { type: "string", format: "date-time" },
                  origin_city: { type: "string" },
                  origin_country: { type: "string" },
                  destination_city: { type: "string" },
                  destination_country: { type: "string" },
                  flight_numbers: {
                    type: "array",
                    items: { type: "string" },
                  },
                  hotel_name: { type: "string" },
                  hotel_address: { type: "string" },
                  notes: { type: "string" },
                },
                required: [
                  "traveler_name",
                  "trip_name",
                  "trip_type",
                  "departure_date",
                  "return_date",
                  "origin_city",
                  "origin_country",
                  "destination_city",
                  "destination_country",
                ],
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "extract_travel_details" },
        },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      throw new Error(`AI API request failed: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    console.log("AI response received");

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("No travel data could be extracted from the document");
    }

    const travelData = JSON.parse(toolCall.function.arguments);
    console.log("Extracted travel data:", JSON.stringify(travelData, null, 2));

    return new Response(
      JSON.stringify({
        success: true,
        data: travelData,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error parsing travel itinerary:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
