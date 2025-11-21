import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Enhanced PDF text extraction that works in Deno
function extractTextFromPDF(arrayBuffer: ArrayBuffer): string {
  const uint8Array = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let rawText = decoder.decode(uint8Array);
  
  // Try latin1 if utf-8 produces minimal output
  if (!rawText || rawText.length < 100) {
    const latin1Decoder = new TextDecoder('latin1');
    rawText = latin1Decoder.decode(uint8Array);
  }
  
  let extractedText = '';
  
  // Method 1: Extract text objects (between BT and ET markers)
  const textObjectRegex = /BT\s+(.*?)\s+ET/gs;
  const textObjects = rawText.match(textObjectRegex) || [];
  
  for (const obj of textObjects) {
    // Extract strings in parentheses or angle brackets
    const stringRegex = /\(([^)]*)\)|<([^>]*)>/g;
    let match;
    
    while ((match = stringRegex.exec(obj)) !== null) {
      const text = match[1] || match[2];
      if (text) {
        let decoded = text
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
        
        extractedText += decoded + ' ';
      }
    }
  }
  
  // Method 2: Extract from Tj and TJ operators
  const tjRegex = /\((.*?)\)\s*(?:Tj|TJ)/g;
  let tjMatch;
  while ((tjMatch = tjRegex.exec(rawText)) !== null) {
    extractedText += tjMatch[1] + ' ';
  }
  
  // Method 3: Extract readable text from stream objects
  const streamRegex = /stream\s+([\s\S]*?)\s+endstream/g;
  let streamMatch;
  while ((streamMatch = streamRegex.exec(rawText)) !== null) {
    const streamContent = streamMatch[1];
    // Extract only printable ASCII characters and common symbols
    const readable = streamContent.replace(/[^\x20-\x7E\n\r\t]/g, '');
    if (readable.length > 20 && readable.match(/[a-zA-Z]{3,}/)) {
      extractedText += readable + ' ';
    }
  }
  
  // Clean up the extracted text
  extractedText = extractedText
    .replace(/\s+/g, ' ')
    .replace(/\x00/g, '')
    .replace(/[^\x20-\x7E\n\r\t]/g, '')
    .trim();
  
  return extractedText;
}

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

    console.log("File downloaded, extracting text...");

    // Extract text from PDF
    const arrayBuffer = await fileData.arrayBuffer();
    const textContent = extractTextFromPDF(arrayBuffer);

    console.log(`Extracted ${textContent.length} characters from PDF`);
    console.log("First 500 chars:", textContent.substring(0, 500));

    if (!textContent || textContent.length < 50) {
      throw new Error("Could not extract sufficient text from PDF. Please ensure the PDF contains readable text (not just images or scanned documents).");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    console.log("Calling AI to extract travel details from text");

    // Use AI to extract structured data from text
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
            content: `Extract ALL travel details from this itinerary text. Be thorough and extract everything you can find:

ITINERARY TEXT:
${textContent}

Extract:
- Traveler name (look for passenger name, traveler, guest name)
- Trip name or purpose
- Departure date and time (convert to ISO 8601 format: YYYY-MM-DDTHH:mm:ss)
- Return date and time (convert to ISO 8601 format: YYYY-MM-DDTHH:mm:ss)
- Origin city and country
- Destination city and country
- ALL flight numbers mentioned
- Hotel name
- Hotel full address
- Any other relevant details

Be very thorough - extract all information present.`,
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
                    description: "Departure date and time in ISO 8601 format"
                  },
                  return_date: { 
                    type: "string", 
                    format: "date-time",
                    description: "Return date and time in ISO 8601 format"
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
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      console.log("AI response:", JSON.stringify(aiData, null, 2));
      throw new Error("Could not extract travel data from text. The PDF may not contain a valid travel itinerary.");
    }

    const travelData = JSON.parse(toolCall.function.arguments);
    
    // Log all extracted data for debugging
    console.log("=== EXTRACTED TRAVEL DATA ===");
    console.log(JSON.stringify(travelData, null, 2));
    console.log("Traveler:", travelData.traveler_name);
    console.log("Trip:", travelData.trip_name);
    console.log("Dates:", travelData.departure_date, "to", travelData.return_date);
    console.log("Route:", travelData.origin_city, "->", travelData.destination_city);
    console.log("Flights:", travelData.flight_numbers);
    console.log("Hotel:", travelData.hotel_name, "at", travelData.hotel_address);
    console.log("============================");

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
