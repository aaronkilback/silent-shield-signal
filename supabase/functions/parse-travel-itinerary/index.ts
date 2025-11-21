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

    // Download the file from storage
    const { data: fileData, error: downloadError } = await supabaseClient
      .storage
      .from("travel-documents")
      .download(filePath);

    if (downloadError || !fileData) {
      console.error("Download error:", downloadError);
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    console.log("File downloaded, converting to base64...");

    // Convert PDF to base64 for AI processing (avoid spread operator for large files)
    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Convert to base64 in chunks to avoid stack overflow
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64Pdf = btoa(binary);
    
    console.log(`PDF converted to base64, size: ${fileData.size} bytes, base64 length: ${base64Pdf.length}`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    console.log("Calling AI to parse itinerary with structured segments");

    // Send PDF directly to AI with the structured parsing prompt
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
            content: `You are an itinerary parsing engine. Extract travel information from documents and return ONLY valid JSON.

Output a single, valid JSON object in this EXACT schema:

{
  "trip_title": "",
  "start_date": "",
  "end_date": "",
  "segments": [
    {
      "type": "",
      "start_datetime": "",
      "end_datetime": "",
      "origin_city": "",
      "origin_airport_code": "",
      "destination_city": "",
      "destination_airport_code": "",
      "airline": "",
      "flight_number": "",
      "hotel_name": "",
      "hotel_address": "",
      "notes": ""
    }
  ]
}

Rules:
- Always return VALID JSON. No comments, no trailing commas, no markdown.
- Use ISO date format: YYYY-MM-DD for start_date and end_date.
- Use YYYY-MM-DD HH:MM (24h) for start_datetime and end_datetime.
- If you do not know a field, use an empty string "".
- If multiple flights, include each as a separate segment with "type": "flight".
- If multiple hotels, include each as a separate segment with "type": "hotel".
- Derive a useful trip_title using main origin/destination and dates.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Parse this travel itinerary and return ONLY the JSON object with no additional text or explanation."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:application/pdf;base64,${base64Pdf}`
                }
              }
            ]
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "parse_itinerary",
              description: "Parse travel itinerary into structured segments",
              parameters: {
                type: "object",
                properties: {
                  trip_title: { 
                    type: "string", 
                    description: "Descriptive title with origin/destination and dates" 
                  },
                  start_date: { 
                    type: "string", 
                    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                    description: "Trip start date in YYYY-MM-DD format"
                  },
                  end_date: { 
                    type: "string", 
                    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                    description: "Trip end date in YYYY-MM-DD format"
                  },
                  segments: {
                    type: "array",
                    description: "Array of flight and hotel segments",
                    items: {
                      type: "object",
                      properties: {
                        type: { 
                          type: "string", 
                          enum: ["flight", "hotel"],
                          description: "Segment type"
                        },
                        start_datetime: { 
                          type: "string",
                          description: "Start date/time in YYYY-MM-DD HH:MM format"
                        },
                        end_datetime: { 
                          type: "string",
                          description: "End date/time in YYYY-MM-DD HH:MM format"
                        },
                        origin_city: { type: "string" },
                        origin_airport_code: { type: "string" },
                        destination_city: { type: "string" },
                        destination_airport_code: { type: "string" },
                        airline: { type: "string" },
                        flight_number: { type: "string" },
                        hotel_name: { type: "string" },
                        hotel_address: { type: "string" },
                        notes: { type: "string" }
                      },
                      required: ["type", "start_datetime", "end_datetime"]
                    }
                  }
                },
                required: ["trip_title", "start_date", "end_date", "segments"]
              }
            }
          }
        ],
        tool_choice: {
          type: "function",
          function: { name: "parse_itinerary" }
        }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errorText);
      throw new Error(`AI failed: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      console.log("AI response:", JSON.stringify(aiData, null, 2));
      throw new Error("Could not extract travel data from PDF. The document may not contain a valid travel itinerary.");
    }

    const itineraryData = JSON.parse(toolCall.function.arguments);
    
    // Log the parsed itinerary
    console.log("=== PARSED ITINERARY ===");
    console.log(JSON.stringify(itineraryData, null, 2));
    console.log("Trip:", itineraryData.trip_title);
    console.log("Dates:", itineraryData.start_date, "to", itineraryData.end_date);
    console.log("Segments:", itineraryData.segments.length);
    console.log("=======================");

    return new Response(
      JSON.stringify({ success: true, data: itineraryData }),
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
