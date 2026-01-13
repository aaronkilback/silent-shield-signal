import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function normalizeExtractedText(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
    .trim();
}

// Helper to convert Uint8Array to base64 without stack overflow
function uint8ToBase64(uint8: Uint8Array): string {
  const chunkSize = 8192;
  let result = '';
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

// Improved PDF text extraction - AI-first approach for reliability
async function extractPdfTextImproved(blob: Blob, lovableApiKey: string): Promise<string> {
  // Use smaller size for AI to avoid timeouts (1MB max)
  const maxBytes = 1 * 1024 * 1024;
  const arrayBuffer = await blob.slice(0, maxBytes).arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  
  console.log(`Processing PDF: ${blob.size} bytes, using ${uint8.length} bytes for extraction`);
  
  // Primary Strategy: Use AI vision to extract text (most reliable for complex PDFs)
  try {
    console.log('Using AI vision for PDF text extraction...');
    const base64Pdf = uint8ToBase64(uint8);
    
    const aiExtractionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract ALL text content from this PDF document. This is a security report that may contain:
- Entity names (people, organizations, locations)
- Security incidents and threats
- Risk assessments and recommendations

Return ONLY the extracted text content, maintaining paragraph structure. Do not summarize or omit any content - extract everything verbatim. If there are tables, preserve them as structured text.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/pdf;base64,${base64Pdf}`
                }
              }
            ]
          }
        ],
        max_tokens: 32000
      }),
    });
    
    if (aiExtractionResponse.ok) {
      const aiData = await aiExtractionResponse.json();
      const aiText = aiData.choices?.[0]?.message?.content;
      if (aiText && aiText.length > 200) {
        console.log(`AI extraction successful: ${aiText.length} characters`);
        return normalizeExtractedText(aiText);
      } else {
        console.warn('AI extraction returned insufficient content:', aiText?.length || 0);
      }
    } else {
      const errorText = await aiExtractionResponse.text();
      console.warn(`AI extraction failed: ${aiExtractionResponse.status} - ${errorText}`);
    }
  } catch (aiError) {
    console.warn('AI text extraction error:', aiError);
  }
  
  // Fallback Strategy: Basic text extraction from PDF structure
  console.log('Falling back to basic PDF text extraction...');
  const pdfString = new TextDecoder('latin1').decode(uint8);
  let extractedText = '';
  
  // Extract text from BT/ET blocks (text objects)
  const textBlocks = pdfString.match(/BT([\s\S]*?)ET/g) || [];
  for (const block of textBlocks.slice(0, 1000)) {
    const parenStrings = block.match(/\((?:\\.|[^\\)])*\)/g) || [];
    for (const str of parenStrings) {
      const text = str.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      extractedText += text + ' ';
    }
    
    const hexStrings = block.match(/<[0-9A-Fa-f]+>/g) || [];
    for (const hex of hexStrings) {
      const hexContent = hex.slice(1, -1);
      let decoded = '';
      for (let i = 0; i < hexContent.length; i += 2) {
        const charCode = parseInt(hexContent.substr(i, 2), 16);
        if (charCode >= 32 && charCode < 127) {
          decoded += String.fromCharCode(charCode);
        }
      }
      if (decoded.length > 2) {
        extractedText += decoded + ' ';
      }
    }
    
    if (extractedText.length > 100000) break;
  }
  
  extractedText = normalizeExtractedText(extractedText);
  
  // Validate extracted text quality
  const wordCount = extractedText.split(/\s+/).filter(w => /^[a-zA-Z]{2,}$/.test(w)).length;
  console.log(`Fallback extraction: ${extractedText.length} chars, ${wordCount} valid words`);
  
  if (extractedText.length < 200 || wordCount < 20) {
    throw new Error('Could not extract meaningful text from PDF. The file may be image-based or encrypted.');
  }
  
  return extractedText;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, textContent } = await req.json();
    
    if (!documentId && !textContent) {
      return new Response(
        JSON.stringify({ error: 'Either documentId or textContent is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing security report${documentId ? ` for document ${documentId}` : ''}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    let content = textContent;
    let document: any = null;
    let clientId: string | null = null;

    // If documentId provided, fetch the document
    if (documentId) {
      const { data: doc, error: docError } = await supabase
        .from('archival_documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        throw new Error(`Document not found: ${docError?.message}`);
      }

      document = doc;
      clientId = doc.client_id;

      // Check if content_text exists and is meaningful (not raw PDF binary)
      const hasValidContent = doc.content_text && 
        doc.content_text.length > 500 && 
        !doc.content_text.includes('content not processed') &&
        !doc.content_text.startsWith('%PDF') && // Not raw PDF data
        !doc.content_text.includes('\\x00') && // Not binary garbage
        /[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/.test(doc.content_text.slice(0, 500)); // Contains actual words

      if (!content && hasValidContent) {
        content = doc.content_text;
        console.log('Using existing valid content_text');
      } else if (!content) {
        console.log(`Re-extracting content - hasValidContent: ${hasValidContent}, content_text starts with: ${doc.content_text?.slice(0, 20) || 'null'}`);
        // Need to extract text from file
        console.log('Content not extracted yet, downloading file...');
        
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('archival-documents')
          .download(doc.storage_path);

        if (downloadError) {
          throw new Error(`Failed to download file: ${downloadError.message}`);
        }

        // Extract text based on file type
        if (doc.file_type === 'application/pdf') {
          console.log('Extracting text from PDF using improved extractor...');
          try {
            content = await extractPdfTextImproved(fileData, LOVABLE_API_KEY);

            console.log(`Extracted ${content.length} characters from PDF`);

            if (!content || content.trim().length < 200) {
              throw new Error(
                'Failed to extract meaningful text from PDF. The file may be scanned/image-based or encrypted. Please upload a PDF with selectable text (or upload a text export).'
              );
            }
          } catch (pdfError) {
            console.error('PDF parsing error:', pdfError);
            throw new Error(
              `Failed to parse PDF: ${pdfError instanceof Error ? pdfError.message : 'Unknown error'}`
            );
          }
        } else if (doc.file_type.includes('text')) {
          content = await fileData.text();
        } else {
          throw new Error(`Unsupported file type: ${doc.file_type}. Please upload PDF or text files.`);
        }

        // Update document with extracted text
        await supabase
          .from('archival_documents')
          .update({
            content_text: content.slice(0, 50000), // Store first 50k chars
            metadata: {
              ...doc.metadata,
              text_extracted: true,
              extraction_date: new Date().toISOString()
            }
          })
          .eq('id', documentId);
        
        console.log(`Extracted ${content.length} characters from ${doc.filename}`);
      }
    }

    if (!content || content.length < 100) {
      throw new Error('Document content is too short to analyze. Please ensure the document contains readable text.');
    }

    console.log(`Content length: ${content.length} characters`);

    // Fetch existing entities for context
    const { data: existingEntities } = await supabase
      .from('entities')
      .select('id, name, type, aliases')
      .eq('is_active', true)
      .limit(100);
    
    const entityContext = (existingEntities || []).map(e => 
      `${e.name} (${e.type})${e.aliases && e.aliases.length > 0 ? ` aka ${e.aliases.join(', ')}` : ''}`
    ).join('\n');

    // Fetch client info if available
    let clientContext = '';
    if (clientId) {
      const { data: client } = await supabase
        .from('clients')
        .select('name, monitoring_keywords')
        .eq('id', clientId)
        .single();
      
      if (client) {
        clientContext = `CLIENT: ${client.name}\nMONITORING KEYWORDS: ${client.monitoring_keywords?.join(', ') || 'None'}`;
      }
    }

    console.log('Calling AI to extract security intelligence...');

    // Limit content for AI processing
    const sampleText = content.slice(0, 30000);

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: `You are an expert security intelligence analyst. Extract structured intelligence from security reports.

KNOWN ENTITIES IN DATABASE:
${entityContext}

${clientContext}

EXTRACT THE FOLLOWING:

1. **ENTITIES** - Named people, organizations, locations, infrastructure:
   - Match against existing entities when possible
   - Include confidence score (0.0-1.0)
   - Provide context where mentioned

2. **THREAT SIGNALS** - Security-relevant events, activities, concerns:
   - Category: protest, surveillance, work_interruption, sabotage, violence, data_exposure, social_sentiment, health_concern, regulatory, legal, operational, environmental, cyber
   - Severity: low, medium, high, critical
   - Description of the threat/activity
   - Location if mentioned
   - Confidence score (0.0-1.0)
   - Related entity names

3. **RISK ASSESSMENTS** - Overall risk ratings and factors:
   - Risk level: LOW, MEDIUM, HIGH, CRITICAL
   - Specific threat factors assessed
   - Deductions/analysis provided

4. **INCIDENTS** - Events requiring immediate attention:
   - Only create for HIGH or CRITICAL severity
   - Priority: p1, p2, p3, p4
   - Description of what happened
   - Impact assessment

IMPORTANT:
- Be precise - only extract information explicitly stated
- Confidence must be >= 0.6
- Match entity names to existing entities when possible
- Group related signals
- Only create incidents for significant events`
          },
          {
            role: 'user',
            content: `Analyze this security report and extract all intelligence:

${sampleText}

Extract entities, threat signals, risk assessments, and any incidents requiring attention.`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_security_intelligence",
              description: "Extract structured security intelligence from report",
              parameters: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Entity name" },
                        type: { 
                          type: "string",
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "other"]
                        },
                        description: { type: "string" },
                        aliases: { type: "array", items: { type: "string" } },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        context: { type: "string", description: "Context where entity was mentioned" },
                        matched_entity_id: { type: "string", description: "ID of existing entity if matched" },
                        risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        threat_score: { type: "integer", minimum: 0, maximum: 100 }
                      },
                      required: ["name", "type", "confidence"]
                    }
                  },
                  signals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { 
                          type: "string",
                          enum: ["protest", "surveillance", "work_interruption", "sabotage", "violence", "data_exposure", "social_sentiment", "health_concern", "regulatory", "legal", "operational", "environmental", "cyber"]
                        },
                        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        description: { type: "string" },
                        location: { type: "string" },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        entity_names: { type: "array", items: { type: "string" } },
                        context: { type: "string" }
                      },
                      required: ["category", "severity", "description", "confidence"]
                    }
                  },
                  risk_assessment: {
                    type: "object",
                    properties: {
                      overall_risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
                      threat_factors: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            factor: { type: "string" },
                            level: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }
                          }
                        }
                      },
                      deductions: { type: "string" }
                    }
                  },
                  incidents: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        priority: { type: "string", enum: ["p1", "p2", "p3", "p4"] },
                        description: { type: "string" },
                        impact: { type: "string" },
                        related_signal_descriptions: { type: "array", items: { type: "string" } }
                      },
                      required: ["priority", "description"]
                    }
                  }
                },
                required: ["entities", "signals"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_security_intelligence" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const intelligence = JSON.parse(toolCall.function.arguments);
    console.log(`Extracted: ${intelligence.entities?.length || 0} entities, ${intelligence.signals?.length || 0} signals, ${intelligence.incidents?.length || 0} incidents`);

    const results = {
      entities_created: 0,
      signals_created: 0,
      incidents_created: 0,
      entity_suggestions_created: 0
    };

    // Process entities - create suggestions for review
    if (intelligence.entities && intelligence.entities.length > 0) {
      console.log(`Processing ${intelligence.entities.length} extracted entities...`);
      
      for (const entity of intelligence.entities) {
        if (entity.confidence < 0.6) {
          console.log(`Skipping entity "${entity.name}" - confidence ${entity.confidence} below threshold`);
          continue;
        }

        // Check if entity already exists
        let matchedEntityId = entity.matched_entity_id;
        if (!matchedEntityId) {
          const { data: existingEntity } = await supabase
            .from('entities')
            .select('id')
            .ilike('name', entity.name)
            .single();
          
          if (existingEntity) {
            matchedEntityId = existingEntity.id;
            console.log(`Entity "${entity.name}" matched to existing entity ${matchedEntityId}`);
          }
        }

        // Create entity suggestion with source_type that matches UI expectations
        const suggestionData = {
          source_id: documentId || 'manual',
          source_type: 'archival_document', // Changed from 'security_report' to match UI
          suggested_name: entity.name,
          suggested_type: entity.type,
          confidence: entity.confidence,
          context: entity.context || entity.description,
          suggested_aliases: entity.aliases || [],
          suggested_attributes: {
            risk_level: entity.risk_level,
            threat_score: entity.threat_score,
            description: entity.description
          },
          matched_entity_id: matchedEntityId,
          status: 'pending'
        };

        console.log(`Creating entity suggestion for "${entity.name}" (${entity.type})`);
        
        const { error: suggestionError } = await supabase
          .from('entity_suggestions')
          .insert(suggestionData);

        if (suggestionError) {
          console.error(`Error creating suggestion for "${entity.name}":`, suggestionError);
        } else {
          results.entity_suggestions_created++;
          console.log(`Created entity suggestion for "${entity.name}"`);
        }
      }
    }

    // Process signals
    const createdSignalIds: string[] = [];
    if (intelligence.signals && intelligence.signals.length > 0) {
      for (const signal of intelligence.signals) {
        if (signal.confidence < 0.6) continue;

        // Find matching entities
        const entityIds: string[] = [];
        if (signal.entity_names && signal.entity_names.length > 0) {
          for (const entityName of signal.entity_names) {
            const { data: matchedEntity } = await supabase
              .from('entities')
              .select('id')
              .ilike('name', entityName)
              .single();
            
            if (matchedEntity) {
              entityIds.push(matchedEntity.id);
            }
          }
        }

        const { data: newSignal, error: signalError } = await supabase
          .from('signals')
          .insert({
            category: signal.category,
            severity: signal.severity || 'medium',
            normalized_text: signal.description,
            location: signal.location,
            confidence: signal.confidence,
            client_id: clientId,
            auto_correlated_entities: entityIds,
            raw_json: {
              source: 'security_report',
              context: signal.context,
              entity_names: signal.entity_names,
              document_id: documentId
            },
            status: 'new',
            is_test: false
          })
          .select()
          .single();

        if (!signalError && newSignal) {
          results.signals_created++;
          createdSignalIds.push(newSignal.id);

          // Create entity mentions for matched entities
          if (entityIds.length > 0) {
            const mentions = entityIds.map(entityId => ({
              entity_id: entityId,
              signal_id: newSignal.id,
              confidence: signal.confidence,
              context: signal.context || signal.description
            }));

            await supabase.from('entity_mentions').insert(mentions);
          }
        }
      }
    }

    // Process incidents
    if (intelligence.incidents && intelligence.incidents.length > 0) {
      for (const incident of intelligence.incidents) {
        // Find related signal
        let signalId = null;
        if (incident.related_signal_descriptions && incident.related_signal_descriptions.length > 0) {
          for (const desc of incident.related_signal_descriptions) {
            const { data: matchedSignal } = await supabase
              .from('signals')
              .select('id')
              .contains('normalized_text', desc)
              .limit(1)
              .single();
            
            if (matchedSignal) {
              signalId = matchedSignal.id;
              break;
            }
          }
        }

        // If no signal matched, use first created signal
        if (!signalId && createdSignalIds.length > 0) {
          signalId = createdSignalIds[0];
        }

        const { error: incidentError } = await supabase
          .from('incidents')
          .insert({
            signal_id: signalId,
            client_id: clientId,
            priority: incident.priority,
            status: 'open',
            opened_at: new Date().toISOString(),
            timeline_json: [{
              timestamp: new Date().toISOString(),
              action: 'created',
              note: `Auto-created from security report: ${incident.description}`,
              metadata: { impact: incident.impact }
            }],
            is_test: false
          });

        if (!incidentError) {
          results.incidents_created++;
        }
      }
    }

    // Update document metadata if documentId provided
    if (documentId) {
      await supabase
        .from('archival_documents')
        .update({
          metadata: {
            ...document?.metadata,
            intelligence_processed: true,
            processed_at: new Date().toISOString(),
            extraction_results: results,
            risk_assessment: intelligence.risk_assessment
          },
          summary: intelligence.risk_assessment?.deductions || null
        })
        .eq('id', documentId);
    }

    console.log('Processing complete:', results);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Security report processed successfully',
        results,
        risk_assessment: intelligence.risk_assessment
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in process-security-report function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
