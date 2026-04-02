import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { file, filename, mimeType } = await req.json();
    
    if (!file || !filename) {
      return errorResponse('File and filename are required', 400);
    }

    console.log('Processing entities document:', filename, mimeType);

    // Decode base64 file
    const binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));
    let text = '';

    // Handle different file types
    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown' || filename.endsWith('.txt') || filename.endsWith('.csv') || filename.endsWith('.md')) {
      text = new TextDecoder().decode(binaryData);
    } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      const pdfText = new TextDecoder().decode(binaryData);
      text = pdfText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
      
      if (!text || text.length < 50) {
        return errorResponse('Unable to extract text from PDF', 400);
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
      const docxText = new TextDecoder().decode(binaryData);
      text = docxText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
      
      if (!text || text.length < 50) {
        return errorResponse('Unable to extract text from DOCX', 400);
      }
    } else {
      return errorResponse('Unsupported file type. Please upload TXT, CSV, PDF, or DOCX files.', 400);
    }

    console.log('Extracted text length:', text.length);

    // Use AI to extract entities from the text via resilient gateway
    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at extracting entity information from text. Extract all relevant entities with their details.'
        },
        {
          role: 'user',
          content: `Extract all entities from the following text. Return a JSON array of entities with the structure:
{
  "entities": [
    {
      "name": "entity name",
      "type": "person|organization|location|infrastructure|domain|ip_address|email|phone|vehicle|other",
      "description": "description of the entity",
      "aliases": ["alias1", "alias2"],
      "risk_level": "low|medium|high|critical",
      "threat_score": 0-100,
      "threat_indicators": ["indicator1", "indicator2"],
      "associations": ["associated entity names"]
    }
  ]
}

Text to analyze:
${text}`
        }
      ],
      functionName: 'parse-entities-document',
      extraBody: {
        tools: [
          {
            type: "function",
            function: {
              name: "extract_entities",
              description: "Extract entities from text",
              parameters: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { 
                          type: "string",
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "other"]
                        },
                        description: { type: "string" },
                        aliases: { type: "array", items: { type: "string" } },
                        risk_level: { 
                          type: "string",
                          enum: ["low", "medium", "high", "critical"]
                        },
                        threat_score: { type: "integer", minimum: 0, maximum: 100 },
                        threat_indicators: { type: "array", items: { type: "string" } },
                        associations: { type: "array", items: { type: "string" } }
                      },
                      required: ["name", "type"]
                    }
                  }
                },
                required: ["entities"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_entities" } }
      },
    });

    if (aiResult.error) {
      throw new Error(`AI API error: ${aiResult.error}`);
    }

    // Handle tool call response
    const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    const entities = extractedData.entities || [];

    console.log(`Extracted ${entities.length} entities`);

    const supabase = createServiceClient();

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    // Suggestions-first policy: store extracted entities as pending suggestions (not active entities)
    const uploadId = crypto.randomUUID();

    const normalizeEntityType = (t: string): 'person' | 'organization' | 'location' | 'infrastructure' | 'domain' | 'ip_address' => {
      switch ((t || '').toLowerCase()) {
        case 'person':
          return 'person';
        case 'organization':
          return 'organization';
        case 'location':
          return 'location';
        case 'infrastructure':
          return 'infrastructure';
        case 'domain':
          return 'domain';
        case 'ip_address':
          return 'ip_address';
        case 'email':
        case 'phone':
        case 'vehicle':
        case 'other':
        default:
          return 'infrastructure';
      }
    };

    const getContext = (fullText: string, needle: string) => {
      const idx = fullText.indexOf(needle);
      if (idx === -1) return null;
      const start = Math.max(0, idx - 120);
      const end = Math.min(fullText.length, idx + needle.length + 120);
      return fullText.substring(start, end);
    };

    const computeConfidence = (name: string, originalType: string) => {
      const base = (() => {
        switch ((originalType || '').toLowerCase()) {
          case 'email':
          case 'phone':
            return 0.9;
          case 'domain':
          case 'ip_address':
            return 0.85;
          case 'organization':
          case 'person':
          case 'location':
          case 'infrastructure':
            return 0.75;
          default:
            return 0.7;
        }
      })();

      const occurrences = (text.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      return Math.min(0.95, base + Math.min(0.2, occurrences * 0.05));
    };

    const insertedSuggestions: any[] = [];
    for (const entity of entities) {
      const originalType = entity.type || 'other';
      const suggestedType = normalizeEntityType(originalType);
      const confidence = computeConfidence(entity.name, originalType);

      const { data, error } = await supabase
        .from('entity_suggestions')
        .insert({
          suggested_name: entity.name,
          suggested_type: suggestedType,
          suggested_aliases: entity.aliases || [],
          suggested_attributes: {
            original_type: originalType,
            description: entity.description || null,
            risk_level: entity.risk_level || null,
            threat_score: entity.threat_score ?? null,
            threat_indicators: entity.threat_indicators || [],
            associations: entity.associations || [],
            source: 'document_upload',
            filename,
            upload_id: uploadId,
          },
          source_type: 'document_upload',
          source_id: uploadId,
          confidence,
          context: getContext(text, entity.name),
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        console.error('Error inserting entity suggestion:', entity.name, error);
      } else {
        insertedSuggestions.push(data);
      }
    }

    console.log(`Successfully inserted ${insertedSuggestions.length} entity suggestions`);

    return successResponse({
      success: true,
      message: `Successfully created ${insertedSuggestions.length} entity suggestions`,
      suggestions: insertedSuggestions,
      uploadId,
    });
  } catch (error) {
    console.error('Error in parse-entities-document function:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
