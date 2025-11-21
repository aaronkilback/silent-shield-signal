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
      // Read first 100KB of text files
      const arrayBuffer = await fileData.slice(0, 100 * 1024).arrayBuffer();
      textContent = new TextDecoder().decode(arrayBuffer);
    } else if (document.file_type === 'application/pdf') {
      // For PDFs, extract first 50KB of content
      const arrayBuffer = await fileData.slice(0, 50 * 1024).arrayBuffer();
      const rawText = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
      // Clean up PDF binary artifacts
      textContent = rawText.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    console.log(`Extracted ${textContent.length} characters for AI analysis`);

    // Use AI to extract entities
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const entitySuggestions: Array<{
      suggested_name: string;
      suggested_type: string;
      confidence: number;
      context: string;
      source_id: string;
      source_type: string;
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
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are an expert entity extraction system for security and intelligence documents. Extract all relevant entities with high precision.'
          },
          {
            role: 'user',
            content: `Extract entities from this document: "${document.filename}"

Document content:
${sampleText}

Find all relevant entities including:
- Person names (executives, employees, suspects, witnesses)
- Organizations (companies, agencies, groups)
- Locations (addresses, cities, facilities)
- Infrastructure (systems, networks, assets)
- Threat indicators (malware, vulnerabilities, attack vectors)
- Contact information (emails, phones)
- Technical identifiers (domains, IPs, URLs)

Provide context snippets showing where each entity appears.`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_entities",
              description: "Extract entities from the document",
              parameters: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "The entity name or identifier" },
                        type: { 
                          type: "string",
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "other"],
                          description: "Entity type"
                        },
                        confidence: { 
                          type: "number",
                          minimum: 0,
                          maximum: 1,
                          description: "Confidence score 0-1"
                        },
                        context: { 
                          type: "string",
                          description: "Short snippet showing where this entity appears in the document"
                        }
                      },
                      required: ["name", "type", "confidence", "context"]
                    }
                  }
                },
                required: ["entities"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_entities" } }
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
      
      console.log(`AI extracted ${entities.length} entities`);

      // Convert to entity suggestions
      for (const entity of entities) {
        // Skip low confidence entities
        if (entity.confidence < 0.6) continue;
        
        entitySuggestions.push({
          suggested_name: entity.name,
          suggested_type: entity.type,
          confidence: entity.confidence,
          context: entity.context || `Found in ${document.filename}`,
          source_id: documentId,
          source_type: 'archival_document'
        });
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
