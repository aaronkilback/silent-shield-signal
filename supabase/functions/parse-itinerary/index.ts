import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_base64, mime_type } = await req.json();

    if (!image_base64) {
      return new Response(
        JSON.stringify({ error: "Missing image_base64" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: `You are a travel itinerary extraction assistant. Extract all travel details from the provided image. You MUST respond by calling the extract_itinerary function with the extracted data. Extract as many flights and trip details as you can find. Use ISO date format (YYYY-MM-DD) for dates and ISO datetime (YYYY-MM-DDTHH:mm:ss) for times. If you can't determine a value, omit it.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all travel itinerary details from this image including trip name, destination, dates, flights with reservation codes, airlines, airports, and times.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mime_type || "image/jpeg"};base64,${image_base64}`,
                },
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_itinerary",
              description: "Extract structured travel itinerary data from an image",
              parameters: {
                type: "object",
                properties: {
                  trip_name: { type: "string", description: "Name or title of the trip" },
                  destination: { type: "string", description: "Primary destination city/country" },
                  departure_date: { type: "string", description: "Trip start date (YYYY-MM-DD)" },
                  return_date: { type: "string", description: "Trip return date (YYYY-MM-DD)" },
                  notes: { type: "string", description: "Any additional notes, hotel info, or details" },
                  flights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        flight_number: { type: "string", description: "Flight number e.g. UA123" },
                        reservation_code: { type: "string", description: "PNR / booking reference / confirmation code" },
                        airline: { type: "string", description: "Airline name" },
                        departure_airport: { type: "string", description: "3-4 letter IATA code" },
                        arrival_airport: { type: "string", description: "3-4 letter IATA code" },
                        departure_time: { type: "string", description: "ISO datetime YYYY-MM-DDTHH:mm:ss" },
                        arrival_time: { type: "string", description: "ISO datetime YYYY-MM-DDTHH:mm:ss" },
                        terminal: { type: "string" },
                        gate: { type: "string" },
                      },
                      required: ["flight_number", "departure_airport", "arrival_airport", "departure_time"],
                    },
                  },
                },
                required: ["destination", "departure_date"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_itinerary" } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to process itinerary image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ error: "Could not extract itinerary details from image" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ extracted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Parse itinerary error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
