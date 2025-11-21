import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import pdfParse from "https://esm.sh/pdf-parse@1.1.1";

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

      // Check if content_text exists and is meaningful
      const hasValidContent = doc.content_text && 
        doc.content_text.length > 500 && 
        !doc.content_text.includes('content not processed');

      if (!content && hasValidContent) {
        content = doc.content_text;
      } else if (!content) {
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
          console.log('Extracting text from PDF using pdf-parse...');
          try {
            const arrayBuffer = await fileData.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);
            
            // Use pdf-parse to extract text
            const pdfData = await pdfParse(buffer);
            content = pdfData.text;
            
            console.log(`Extracted ${content.length} characters from PDF (${pdfData.numpages} pages)`);
            
            if (!content || content.trim().length < 100) {
              throw new Error('Failed to extract meaningful text from PDF. File may be scanned, image-based, or encrypted. Please ensure the PDF contains selectable text.');
            }
          } catch (pdfError) {
            console.error('PDF parsing error:', pdfError);
            throw new Error(`Failed to parse PDF: ${pdfError instanceof Error ? pdfError.message : 'Unknown error'}. The file may be corrupted, encrypted, or contain only images.`);
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
      for (const entity of intelligence.entities) {
        if (entity.confidence < 0.6) continue;

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
          }
        }

        // Create entity suggestion
        const { error: suggestionError } = await supabase
          .from('entity_suggestions')
          .insert({
            source_id: documentId || 'manual',
            source_type: 'security_report',
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
          });

        if (!suggestionError) {
          results.entity_suggestions_created++;
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