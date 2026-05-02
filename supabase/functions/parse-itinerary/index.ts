// parse-itinerary — extract structured trip + flight data from a photo
// of an itinerary, boarding pass, etc.
//
// Routes through _shared/ai-gateway.ts (OPENAI_API_KEY) using gpt-4o-mini
// vision + function-calling for guaranteed-valid structured output. Was
// previously calling the Lovable AI gateway directly with LOVABLE_API_KEY,
// which isn't configured in prod — every photo upload 500'd.

import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTRACT_TOOL = {
  type: "function" as const,
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
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_base64, mime_type } = await req.json();
    if (!image_base64) {
      return new Response(JSON.stringify({ error: "Missing image_base64" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await callAiGateway({
      model: "openai/gpt-4o-mini",
      functionName: "parse-itinerary",
      skipGuardrails: true, // structured tool-call output, no anti-hallucination guard needed
      retries: 1,
      messages: [
        {
          role: "system",
          content:
            "You are a travel itinerary extraction assistant. Extract all travel details from the provided image. You MUST respond by calling the extract_itinerary function with the extracted data. Extract as many flights and trip details as you can find. Use ISO date format (YYYY-MM-DD) for dates and ISO datetime (YYYY-MM-DDTHH:mm:ss) for times. If you can't determine a value, omit it.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract all travel itinerary details from this image including trip name, destination, dates, flights with reservation codes, airlines, airports, and times.",
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
      extraBody: {
        tools: [EXTRACT_TOOL],
        tool_choice: { type: "function", function: { name: "extract_itinerary" } },
      },
    });

    if (result.error || !result.raw) {
      const status = (result as any)?.status === 429 ? 429 : 502;
      console.error("[parse-itinerary] gateway error:", result.error);
      return new Response(
        JSON.stringify({ error: result.error || "AI gateway failed" }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const toolCall = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ error: "Could not extract itinerary details from image" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let extracted: unknown;
    try {
      extracted = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("[parse-itinerary] tool args not valid JSON:", e);
      return new Response(
        JSON.stringify({ error: "AI returned malformed extraction" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[parse-itinerary] unhandled:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
