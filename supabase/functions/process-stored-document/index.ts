import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();
    
    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'Missing documentId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing document: ${documentId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Get document details
    const { data: document, error: docError } = await supabase
      .from('archival_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error(`Document not found: ${docError?.message}`);
    }

    console.log(`Found document: ${document.filename}`);

    // Download file from storage (first 100KB for entity detection)
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('archival-documents')
      .download(document.storage_path);

    if (downloadError) {
      console.error(`Storage download error for ${document.filename}:`, downloadError);
      
      // If file doesn't exist in storage, mark as processed to avoid retry loops
      if (downloadError.message?.includes('not found') || downloadError.message?.includes('does not exist')) {
        await supabase
          .from('archival_documents')
          .update({
            metadata: {
              ...document.metadata,
              entities_processed: true,
              processing_error: 'File not found in storage',
              processed_at: new Date().toISOString()
            }
          })
          .eq('id', documentId);
        
        return new Response(
          JSON.stringify({ 
            error: 'File not found in storage',
            documentId 
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    console.log(`Downloaded file: ${document.filename}`);

    let textContent = '';
    
    // Extract text based on file type
    if (document.file_type.includes('text') || document.file_type.includes('json')) {
      // Read text files
      const arrayBuffer = await fileData.arrayBuffer();
      textContent = new TextDecoder().decode(arrayBuffer);
    } else if (document.file_type === 'application/pdf') {
      // For PDFs, extract text streams (PDF text objects start with "BT" and end with "ET")
      console.log('Extracting text from PDF...');
      
      const arrayBuffer = await fileData.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const pdfString = new TextDecoder('latin1').decode(uint8Array);
      
      // Extract text between BT (Begin Text) and ET (End Text) markers
      const textMatches = pdfString.match(/BT(.*?)ET/gs);
      if (textMatches && textMatches.length > 0) {
        // Extract actual text content (strings in parentheses or angle brackets)
        let extractedText = '';
        for (const match of textMatches) {
          // Extract strings in parentheses: (text)
          const parenStrings = match.match(/\((.*?)\)/g);
          if (parenStrings) {
            extractedText += parenStrings.map(s => s.slice(1, -1)).join(' ') + ' ';
          }
          // Extract strings in angle brackets: <hex>
          const hexStrings = match.match(/<([0-9A-Fa-f]+)>/g);
          if (hexStrings) {
            for (const hex of hexStrings) {
              const hexContent = hex.slice(1, -1);
              try {
                const bytes = hexContent.match(/.{2}/g)?.map(h => parseInt(h, 16)) || [];
                extractedText += new TextDecoder().decode(new Uint8Array(bytes)) + ' ';
              } catch {}
            }
          }
        }
        textContent = extractedText.replace(/\\r|\\n|\\t/g, ' ').replace(/\s+/g, ' ').trim();
        console.log(`Extracted ${textContent.length} characters from PDF text streams`);
      } else {
        // Fallback: basic text extraction
        textContent = pdfString.replace(/[\x00-\x1F\x7F-\xFF]/g, ' ').replace(/\s+/g, ' ').trim();
        console.log(`Fallback: extracted ${textContent.length} characters`);
      }
    }

    console.log(`Text content ready for AI analysis (${textContent.length} chars)`);

    // Fetch existing entities for context and matching
    const { data: existingEntities } = await supabase
      .from('entities')
      .select('id, name, type, aliases, threat_score, associations')
      .eq('is_active', true);
    
    const entityContext = (existingEntities || []).map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      aliases: e.aliases || [],
      threat_score: e.threat_score,
      known_associations: e.associations || []
    }));
    
    console.log(`Loaded ${entityContext.length} existing entities for matching`);

    const entitySuggestions: Array<{
      suggested_name: string;
      suggested_type: string;
      confidence: number;
      context: string;
      source_id: string;
      source_type: string;
      matched_entity_id?: string | null;
      suggested_aliases?: string[];
    }> = [];

    // Only process if we have meaningful content
    if (textContent.length < 50) {
      console.log('Document too short for entity extraction');
      await supabase
        .from('archival_documents')
        .update({
          metadata: {
            ...document.metadata,
            entities_processed: true,
            processing_note: 'Document too short for analysis',
            processed_at: new Date().toISOString()
          }
        })
        .eq('id', documentId);
      
      return new Response(
        JSON.stringify({ 
          success: true,
          documentId,
          entitiesFound: 0,
          note: 'Document too short'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare text sample (max 8000 chars for AI processing)
    const sampleText = textContent.slice(0, 8000);

    console.log('Calling Lovable AI for entity extraction...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro', // Use more powerful model for better extraction
        messages: [
          {
            role: 'system',
            content: `You are an expert entity extraction and relationship detection system for security intelligence. 

CRITICAL INSTRUCTIONS:
1. Extract ONLY real security entities from actual incidents (not document metadata)
2. Match extracted entities to existing known entities when possible
3. Detect relationships between entities that appear together
4. Build connections across the knowledge base

EXISTING ENTITIES IN DATABASE:
${JSON.stringify(entityContext, null, 2)}

When you find an entity, check if it matches any existing entity by name or alias. If it matches, reference that entity_id.`
          },
          {
            role: 'user',
            content: `Analyze this security document for entities and relationships: "${document.filename}"

Document content:
${sampleText}

EXTRACT:
1. Security-relevant entities (threat actors, victims, suspicious individuals, compromised systems, attack targets, incident locations)
2. Relationships between entities when they appear together in the same context

DO NOT EXTRACT:
- Document metadata (titles, dates, filenames)
- Report author organizations (unless they're incident victims)
- Generic phrases or section headers

For each entity:
- Check if it matches an existing entity in the database
- Note the context where it appears
- Identify what other entities it's connected to in the text`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_entities_and_relationships",
              description: "Extract security entities and detect relationships between them",
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
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        context: { type: "string", description: "Where entity appears in incident" },
                        matched_entity_id: { 
                          type: "string", 
                          description: "UUID of existing entity this matches (if any)" 
                        },
                        aliases: {
                          type: "array",
                          items: { type: "string" },
                          description: "Alternative names or identifiers"
                        }
                      },
                      required: ["name", "type", "confidence", "context"]
                    }
                  },
                  relationships: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        entity_a: { type: "string", description: "First entity name" },
                        entity_b: { type: "string", description: "Second entity name" },
                        relationship_type: { 
                          type: "string",
                          description: "Type of relationship (e.g., 'targeted', 'employed_by', 'located_at', 'communicates_with')"
                        },
                        context: { type: "string", description: "How they're related in the text" },
                        confidence: { type: "number", minimum: 0, maximum: 1 }
                      },
                      required: ["entity_a", "entity_b", "relationship_type", "context", "confidence"]
                    }
                  }
                },
                required: ["entities", "relationships"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_entities_and_relationships" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        throw new Error('Rate limit exceeded - please try again later');
      }
      if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted - please add credits to continue');
      }
      
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log('AI response received');

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.log('No tool call in AI response');
    } else {
      const extractedData = JSON.parse(toolCall.function.arguments);
      const entities = extractedData.entities || [];
      const relationships = extractedData.relationships || [];
      
      console.log(`AI extracted ${entities.length} entities and ${relationships.length} relationships`);

      // Check for existing suggestions to avoid duplicates
      const { data: existingSuggestions } = await supabase
        .from('entity_suggestions')
        .select('suggested_name, suggested_type')
        .eq('source_type', 'archival_document')
        .in('status', ['pending', 'approved']);
      
      const existingSet = new Set(
        (existingSuggestions || []).map(s => `${s.suggested_name.toLowerCase()}:${s.suggested_type}`)
      );

      // Convert to entity suggestions with matching
      for (const entity of entities) {
        if (entity.confidence < 0.7) continue;
        
        const key = `${entity.name.toLowerCase()}:${entity.type}`;
        if (existingSet.has(key)) {
          console.log(`Skipping duplicate: ${entity.name}`);
          continue;
        }
        
        entitySuggestions.push({
          suggested_name: entity.name,
          suggested_type: entity.type,
          confidence: entity.confidence,
          context: entity.context || `Found in ${document.filename}`,
          source_id: documentId,
          source_type: 'archival_document',
          matched_entity_id: entity.matched_entity_id || null,
          suggested_aliases: entity.aliases || []
        });
      }
      
      // Store detected relationships for processing after entities are created/matched
      if (relationships.length > 0) {
        console.log(`Storing ${relationships.length} detected relationships`);
        
        // Store relationships in document metadata for later processing
        await supabase
          .from('archival_documents')
          .update({
            metadata: {
              ...document.metadata,
              detected_relationships: relationships,
              relationships_detected_at: new Date().toISOString()
            }
          })
          .eq('id', documentId);
      }
    }

    console.log(`Found ${entitySuggestions.length} high-confidence entities`);

    // Insert entity suggestions
    if (entitySuggestions.length > 0) {
      const { error: suggestError } = await supabase
        .from('entity_suggestions')
        .insert(entitySuggestions);

      if (suggestError) {
        console.error('Error inserting entity suggestions:', suggestError);
      }
    }

    // Update document with entity mentions
    const entityNames = entitySuggestions.map(e => e.suggested_name);
    await supabase
      .from('archival_documents')
      .update({
        entity_mentions: entityNames,
        metadata: {
          ...document.metadata,
          entities_processed: true,
          entities_processed_at: new Date().toISOString()
        }
      })
      .eq('id', documentId);

    console.log(`Successfully processed document: ${document.filename}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        documentId,
        entitiesFound: entitySuggestions.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in process-stored-document function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
