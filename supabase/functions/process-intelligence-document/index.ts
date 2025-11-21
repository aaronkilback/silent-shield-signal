import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Processing document: ${documentId}`);

    // Update status
    await supabase
      .from('ingested_documents')
      .update({ processing_status: 'processing' })
      .eq('id', documentId);

    // Fetch document
    const { data: document, error: docError } = await supabase
      .from('ingested_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Fetch existing entities for context
    const { data: existingEntities } = await supabase
      .from('entities')
      .select('id, name, type, aliases, entity_status')
      .eq('is_active', true)
      .limit(200);

    const entityContext = (existingEntities || [])
      .filter(e => e.entity_status !== 'rejected')
      .map(e => `${e.name} (${e.type})${e.aliases?.length ? ` aka ${e.aliases.join(', ')}` : ''}`)
      .join('\n');

    // Fetch learning profiles
    const { data: approvedPatterns } = await supabase
      .from('learning_profiles')
      .select('features')
      .eq('profile_type', 'approved_signal_patterns')
      .limit(1)
      .single();

    const { data: rejectedPatterns } = await supabase
      .from('learning_profiles')
      .select('features')
      .eq('profile_type', 'rejected_signal_patterns')
      .limit(1)
      .single();

    const learningContext = `
APPROVED PATTERNS (prioritize these):
${JSON.stringify(approvedPatterns?.features || {}, null, 2)}

REJECTED PATTERNS (avoid these):
${JSON.stringify(rejectedPatterns?.features || {}, null, 2)}
`;

    // Call AI for extraction
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
            content: `You are an expert security intelligence analyst extracting actionable intelligence from documents.

KNOWN ENTITIES:
${entityContext}

${learningContext}

Extract:
1. ENTITIES - Named people, organizations, locations, assets, infrastructure
2. SIGNALS - Security-relevant events, threats, risks
3. ENTITY MENTIONS - Where entities appear in the document

Be precise and only extract information explicitly stated. Match entity names to existing entities when possible.`
          },
          {
            role: 'user',
            content: `Analyze this document and extract intelligence:

TITLE: ${document.title}
TEXT: ${document.raw_text}

Extract all entities, signals, and their relationships.`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_intelligence",
              description: "Extract entities, signals, and mentions from document",
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
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "asset", "project", "route"]
                        },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        matched_entity_id: { type: "string" },
                        mention_text: { type: "string" },
                        position_start: { type: "integer" }
                      },
                      required: ["name", "type", "confidence"]
                    }
                  },
                  signals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        signal_type: { 
                          type: "string",
                          enum: ["theft", "protest", "threat", "surveillance", "sabotage", "violence", "cyber", "data_exposure", "wildlife", "wildfire", "weather", "health", "regulatory", "legal", "operational"]
                        },
                        severity_score: { type: "integer", minimum: 0, maximum: 100 },
                        relevance_score: { type: "number", minimum: 0, maximum: 1 },
                        related_entity_names: { type: "array", items: { type: "string" } },
                        location: { type: "string" }
                      },
                      required: ["title", "description", "signal_type", "severity_score"]
                    }
                  }
                },
                required: ["entities", "signals"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_intelligence" } }
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const intelligence = JSON.parse(toolCall.function.arguments);

    const results = {
      entities_extracted: 0,
      entities_confirmed: 0,
      signals_created: 0,
      mentions_created: 0
    };

    // Process entities
    for (const entity of intelligence.entities || []) {
      if (entity.confidence < 0.6) continue;

      let entityId = entity.matched_entity_id;
      
      // Try to find existing entity
      if (!entityId) {
        const { data: existing } = await supabase
          .from('entities')
          .select('id, confidence_score')
          .ilike('name', entity.name)
          .eq('type', entity.type)
          .single();

        if (existing) {
          entityId = existing.id;
          // Update confidence
          await supabase
            .from('entities')
            .update({ 
              confidence_score: Math.min((existing.confidence_score + entity.confidence) / 2, 1),
              entity_status: 'confirmed'
            })
            .eq('id', entityId);
          
          results.entities_confirmed++;
        }
      }

      // Create new entity if not found
      if (!entityId) {
        const { data: newEntity, error: entityError } = await supabase
          .from('entities')
          .insert({
            name: entity.name,
            type: entity.type,
            confidence_score: entity.confidence,
            entity_status: 'suggested',
            is_active: true
          })
          .select('id')
          .single();

        if (!entityError && newEntity) {
          entityId = newEntity.id;
          results.entities_extracted++;
        }
      }

      // Create mention
      if (entityId) {
        await supabase
          .from('document_entity_mentions')
          .insert({
            entity_id: entityId,
            document_id: documentId,
            mention_text: entity.mention_text || entity.name,
            position_start: entity.position_start || 0,
            confidence: entity.confidence
          })
          .then(() => results.mentions_created++);
      }
    }

    // Process signals
    for (const signal of intelligence.signals || []) {
      // Create signal
      const { data: newSignal, error: signalError } = await supabase
        .from('signals')
        .insert({
          title: signal.title,
          description: signal.description,
          signal_type: signal.signal_type,
          severity_score: signal.severity_score,
          relevance_score: signal.relevance_score || 0.7,
          normalized_text: signal.description,
          severity: signal.severity_score >= 80 ? 'critical' : 
                    signal.severity_score >= 50 ? 'high' : 
                    signal.severity_score >= 20 ? 'medium' : 'low',
          location: signal.location,
          status: 'new',
          is_test: false
        })
        .select('id')
        .single();

      if (!signalError && newSignal) {
        results.signals_created++;

        // Link signal to document
        await supabase
          .from('signal_documents')
          .insert({
            signal_id: newSignal.id,
            document_id: documentId
          });

        // Link signal to entities
        if (signal.related_entity_names) {
          for (const entityName of signal.related_entity_names) {
            const { data: entity } = await supabase
              .from('entities')
              .select('id')
              .ilike('name', entityName)
              .single();

            if (entity) {
              await supabase.from('entity_mentions').insert({
                entity_id: entity.id,
                signal_id: newSignal.id,
                confidence: 0.8
              });
            }
          }
        }

        // Check for auto-escalation
        if (signal.severity_score >= 80) {
          await supabase.functions.invoke('check-incident-escalation', {
            body: { signalId: newSignal.id }
          });
        }
      }
    }

    // Mark document as processed
    await supabase
      .from('ingested_documents')
      .update({
        processing_status: 'completed',
        processed_at: new Date().toISOString()
      })
      .eq('id', documentId);

    console.log('Processing complete:', results);

    return new Response(
      JSON.stringify({
        success: true,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing document:', error);
    
    // Mark as failed
    if (req.json && (await req.json()).documentId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      await supabase
        .from('ingested_documents')
        .update({
          processing_status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', (await req.json()).documentId);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});