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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
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

    console.log("Processing itinerary:", filePath);

    // Download the file from storage and convert to base64
    const { data: fileData, error: downloadError } = await supabaseClient
      .storage
      .from("travel-documents")
      .download(filePath);

    if (downloadError || !fileData) {
      console.error("Download error:", downloadError);
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    console.log("File downloaded, converting to base64...");

    // Convert blob to base64
    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const dataUrl = `data:application/pdf;base64,${base64}`;

    console.log("Sending PDF to AI for analysis...");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Use AI to extract structured data from PDF
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
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract ALL travel details from this travel itinerary PDF. Be thorough and extract everything you can find:

Extract:
- Traveler name (passenger name, traveler, guest name)
- Trip name or purpose
- Departure date and time (convert to ISO format)
- Return date and time (convert to ISO format)
- Origin city and country
- Destination city and country
- ALL flight numbers mentioned
- Hotel name
- Hotel full address
- Any other relevant details

Be very thorough - extract all information present.`
              },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl
                }
              }
            ]
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_travel_details",
              description: "Extract structured travel information from itinerary",
              parameters: {
                type: "object",
                properties: {
                  traveler_name: { type: "string", description: "Full name of traveler" },
                  trip_name: { type: "string", description: "Trip name or destination description" },
                  trip_type: { 
                    type: "string", 
                    enum: ["domestic", "international"],
                    description: "Domestic or international travel"
                  },
                  departure_date: { 
                    type: "string", 
                    format: "date-time",
                    description: "Departure date and time in ISO format (YYYY-MM-DDTHH:mm:ss)"
                  },
                  return_date: { 
                    type: "string", 
                    format: "date-time",
                    description: "Return date and time in ISO format (YYYY-MM-DDTHH:mm:ss)"
                  },
                  origin_city: { type: "string" },
                  origin_country: { type: "string" },
                  destination_city: { type: "string" },
                  destination_country: { type: "string" },
                  flight_numbers: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "All flight numbers mentioned"
                  },
                  hotel_name: { type: "string" },
                  hotel_address: { type: "string" },
                  notes: { type: "string", description: "Any additional relevant details" },
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
      console.error("AI error:", aiResponse.status, errorText);
      throw new Error(`AI failed: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    console.log("AI response:", JSON.stringify(aiData, null, 2));

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("Could not extract travel data from PDF");
    }

    const travelData = JSON.parse(toolCall.function.arguments);
    console.log("Successfully extracted:", travelData.traveler_name, "to", travelData.destination_city);

    return new Response(
      JSON.stringify({ success: true, data: travelData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
