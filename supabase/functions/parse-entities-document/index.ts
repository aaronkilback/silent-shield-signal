import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file, filename, mimeType } = await req.json();
    
    if (!file || !filename) {
      return new Response(
        JSON.stringify({ error: 'File and filename are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
        return new Response(
          JSON.stringify({ error: 'Unable to extract text from PDF' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
      const docxText = new TextDecoder().decode(binaryData);
      text = docxText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
      
      if (!text || text.length < 50) {
        return new Response(
          JSON.stringify({ error: 'Unable to extract text from DOCX' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Unsupported file type. Please upload TXT, CSV, PDF, or DOCX files.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Extracted text length:', text.length);

    // Use AI to extract entities from the text
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

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
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log('AI response received');

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    const entities = extractedData.entities || [];

    console.log(`Extracted ${entities.length} entities`);

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Insert entities into database
    const insertedEntities = [];
    for (const entity of entities) {
      const { data, error } = await supabase
        .from('entities')
        .insert({
          name: entity.name,
          type: entity.type,
          description: entity.description || null,
          aliases: entity.aliases || [],
          risk_level: entity.risk_level || 'medium',
          threat_score: entity.threat_score || null,
          threat_indicators: entity.threat_indicators || [],
          associations: entity.associations || [],
          created_by: user.id,
          attributes: {
            source: 'document_upload',
            filename: filename
          }
        })
        .select()
        .single();

      if (error) {
        console.error('Error inserting entity:', entity.name, error);
      } else {
        insertedEntities.push(data);
      }
    }

    console.log(`Successfully inserted ${insertedEntities.length} entities`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully created ${insertedEntities.length} entities`,
        entities: insertedEntities
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in parse-entities-document function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
