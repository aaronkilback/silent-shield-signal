import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

try {
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
} catch (_) { /* non-fatal */ }

async function extractTextFromPdf(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const pdf = await (pdfjsLib as any).getDocument({ data: uint8, disableWorker: true }).promise;
  const totalPages = Math.min(Number(pdf?.numPages || 0), 100);
  const out: string[] = [];
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = (content?.items ?? [])
      .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
      .filter((s: string) => s.trim().length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push(text);
  }
  return out.join("\n");
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const { filePath } = await req.json();

    if (!filePath) return errorResponse("File path is required", 400);

    console.log("Processing itinerary:", filePath);

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("travel-documents")
      .download(filePath);

    if (downloadError || !fileData) {
      return errorResponse(`Failed to download file: ${downloadError?.message}`, 400);
    }

    console.log("Extracting text from PDF...");
    const extractedText = await extractTextFromPdf(fileData);

    if (!extractedText || extractedText.trim().length < 30) {
      return errorResponse(
        "Could not extract text from this PDF. It may be a scanned/image-only document.",
        400
      );
    }

    console.log(`Extracted ${extractedText.length} chars — calling AI to parse structure`);

    const aiResult = await callAiGateway({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a travel itinerary parsing engine. Extract structured travel data from the provided text and call the parse_itinerary function with the results.

Rules:
- traveler_name: full name of the passenger/traveler.
- trip_title: descriptive title using main origin/destination and dates.
- start_date / end_date: YYYY-MM-DD format.
- start_datetime / end_datetime: YYYY-MM-DD HH:MM (24h). Empty string if unknown.
- Include each flight as a segment with type "flight".
- Include each hotel stay as a segment with type "hotel".
- If a field is unknown, use an empty string.`,
        },
        {
          role: "user",
          content: `Parse this travel itinerary:\n\n${extractedText.substring(0, 12000)}`,
        },
      ],
      functionName: "parse-travel-itinerary",
      extraBody: {
        tools: [
          {
            type: "function",
            function: {
              name: "parse_itinerary",
              description: "Parse travel itinerary into structured segments",
              parameters: {
                type: "object",
                properties: {
                  traveler_name: { type: "string" },
                  trip_title:    { type: "string" },
                  start_date:    { type: "string", description: "YYYY-MM-DD" },
                  end_date:      { type: "string", description: "YYYY-MM-DD" },
                  segments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type:                     { type: "string", enum: ["flight", "hotel"] },
                        start_datetime:           { type: "string", description: "YYYY-MM-DD HH:MM" },
                        end_datetime:             { type: "string", description: "YYYY-MM-DD HH:MM" },
                        origin_city:              { type: "string" },
                        origin_airport_code:      { type: "string" },
                        destination_city:         { type: "string" },
                        destination_airport_code: { type: "string" },
                        airline:                  { type: "string" },
                        flight_number:            { type: "string" },
                        hotel_name:               { type: "string" },
                        hotel_address:            { type: "string" },
                        notes:                    { type: "string" },
                      },
                      required: ["type", "start_datetime", "end_datetime"],
                    },
                  },
                },
                required: ["traveler_name", "trip_title", "start_date", "end_date", "segments"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "parse_itinerary" } },
      },
    });

    if (aiResult.error) throw new Error(`AI failed: ${aiResult.error}`);

    const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.log("AI response:", JSON.stringify(aiResult.raw, null, 2));
      throw new Error("Could not extract travel data. The document may not be a valid travel itinerary.");
    }

    const itineraryData = JSON.parse(toolCall.function.arguments);

    console.log("=== PARSED ITINERARY ===");
    console.log("Traveler:", itineraryData.traveler_name);
    console.log("Trip:", itineraryData.trip_title);
    console.log("Dates:", itineraryData.start_date, "to", itineraryData.end_date);
    console.log("Segments:", itineraryData.segments?.length);
    console.log("=======================");

    return successResponse({ success: true, data: itineraryData });
  } catch (error) {
    console.error("Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
