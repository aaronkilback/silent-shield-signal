import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { file_base64, file_name, file_type, provider, storage_path } = await req.json();

    const supabase = createServiceClient();

    // Auth client validation
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : authHeader;

    if (!token) {
      return errorResponse("Unauthorized", 401);
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      console.error("Failed to load user:", userError);
      return errorResponse("Unauthorized", 401);
    }

    console.log(`Processing travel security report: ${file_name} from ${provider}`);

    const prompt = `You are a security intelligence analyst. Parse this security briefing document and extract structured intelligence for travel risk assessment.

The document is from: ${provider}
File name: ${file_name}

Extract the following information in a structured JSON format:

{
  "source_provider": "The company that produced this report",
  "report_type": "Type of report",
  "location": {
    "city": "Primary city covered",
    "country": "Country",
    "region": "Region if applicable"
  },
  "risk_rating": "Overall risk rating (LOW, MEDIUM, HIGH, EXTREME)",
  "key_risks": ["Array of key risk categories mentioned"],
  "latest_developments": ["Array of recent security developments or alerts"],
  "security_advice": ["Array of key security recommendations"],
  "emergency_contacts": [{"name": "Contact name/org", "number": "Phone number"}],
  "valid_date": "Date the report was generated or is valid for",
  "incidents_mentioned": [
    {
      "date": "Date of incident",
      "type": "Type of incident",
      "location": "Location",
      "description": "Brief description",
      "severity": "low|medium|high|critical"
    }
  ]
}

Parse the document content carefully and extract all relevant security intelligence.`;

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-pro',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at parsing security briefing documents from providers like International SOS, Control Risks, and other security consultancies. Extract structured intelligence data accurately.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${file_type};base64,${file_base64}`
              }
            }
          ]
        }
      ],
      functionName: 'parse-travel-security-report',
      dlqOnFailure: true,
      dlqPayload: { file_name, provider },
      extraBody: {
        tools: [
          {
            type: "function",
            function: {
              name: "extract_security_intelligence",
              description: "Extract structured security intelligence from a briefing document",
              parameters: {
                type: "object",
                properties: {
                  source_provider: { type: "string" },
                  report_type: { type: "string" },
                  location: {
                    type: "object",
                    properties: {
                      city: { type: "string" },
                      country: { type: "string" },
                      region: { type: "string" }
                    }
                  },
                  risk_rating: { type: "string" },
                  key_risks: { type: "array", items: { type: "string" } },
                  latest_developments: { type: "array", items: { type: "string" } },
                  security_advice: { type: "array", items: { type: "string" } },
                  emergency_contacts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        number: { type: "string" }
                      }
                    }
                  },
                  valid_date: { type: "string" },
                  incidents_mentioned: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        date: { type: "string" },
                        type: { type: "string" },
                        location: { type: "string" },
                        description: { type: "string" },
                        severity: { type: "string" }
                      }
                    }
                  }
                },
                required: ["source_provider", "report_type", "location", "risk_rating", "key_risks"]
              }
            }
          }
        ],
        tool_choice: {
          type: "function",
          function: { name: "extract_security_intelligence" }
        }
      },
    });

    // Extract structured output from tool call
    const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error("No structured data extracted from report");
    }

    const parsedReport = JSON.parse(toolCall.function.arguments);
    console.log("Parsed report:", JSON.stringify(parsedReport, null, 2));

    // Store the parsed report in the archival_documents table
    const { data: insertData, error: insertError } = await supabase
      .from("archival_documents")
      .insert({
        filename: file_name,
        file_type,
        file_size: file_base64.length,
        storage_path: storage_path || `security-reports/${file_name}`,
        content_text: JSON.stringify(parsedReport),
        summary: `${parsedReport.source_provider} ${parsedReport.report_type} for ${parsedReport.location?.city}, ${parsedReport.location?.country}`,
        tags: ["travel-security", provider, parsedReport.risk_rating?.toLowerCase()].filter(Boolean),
        uploaded_by: userData.user.id,
        metadata: {
          provider,
          uploaded_by: userData.user.id,
          parsed_data: parsedReport,
          location_city: parsedReport.location?.city,
          location_country: parsedReport.location?.country,
          risk_rating: parsedReport.risk_rating,
          valid_date: parsedReport.valid_date,
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to store report:", insertError);
    }

    // Create signals from incidents mentioned in the report
    if (parsedReport.incidents_mentioned && parsedReport.incidents_mentioned.length > 0) {
      for (const incident of parsedReport.incidents_mentioned) {
        await supabase.from("signals").insert({
          title: `[${parsedReport.source_provider}] ${incident.type}: ${incident.location}`,
          content: incident.description,
          source_type: "third_party_report",
          severity: incident.severity || "medium",
          location: incident.location,
          category: "security",
          raw_json: {
            source_provider: parsedReport.source_provider,
            report_type: parsedReport.report_type,
            incident_date: incident.date,
          }
        });
      }
      console.log(`Created ${parsedReport.incidents_mentioned.length} signals from report`);
    }

    // Create travel alerts from key developments
    if (parsedReport.location?.city && parsedReport.latest_developments?.length > 0) {
      for (const development of parsedReport.latest_developments.slice(0, 3)) {
        const isActionable = development.toLowerCase().includes("avoid") ||
                            development.toLowerCase().includes("alert") ||
                            development.toLowerCase().includes("warning") ||
                            development.toLowerCase().includes("disruption");
        
        if (isActionable) {
          await supabase.from("travel_alerts").insert({
            alert_type: "security",
            severity: parsedReport.risk_rating?.toLowerCase() === "high" ? "high" : "medium",
            title: `${parsedReport.source_provider}: Security Update`,
            description: development,
            location: `${parsedReport.location.city}, ${parsedReport.location.country}`,
            source: parsedReport.source_provider,
            recommended_actions: parsedReport.security_advice?.slice(0, 3) || [],
          });
        }
      }
    }

    return successResponse({
      success: true,
      parsed_report: parsedReport,
      document_id: insertData?.id,
    });
  } catch (error) {
    console.error("Error processing travel security report:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
