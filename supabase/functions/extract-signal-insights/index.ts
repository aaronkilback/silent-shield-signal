import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Extract structured insights from signals
 * 
 * Processes signal text to extract:
 * - Named entities (people, organizations, locations, infrastructure)
 * - Key dates and timeframes
 * - Actions and events
 * - Geographic locations with coordinates if possible
 * - Threat indicators and tactics
 * 
 * This enhances signals beyond basic normalization for immediate actionability.
 */

interface ExtractedInsights {
  entities: Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'infrastructure' | 'domain' | 'ip_address' | 'other';
    confidence: number;
    context?: string;
  }>;
  dates?: Array<{
    date: string;
    type: 'event' | 'deadline' | 'reference';
    context: string;
  }>;
  locations?: Array<{
    name: string;
    type: 'city' | 'region' | 'country' | 'facility' | 'coordinates';
    coordinates?: { lat: number; lng: number };
  }>;
  actions?: Array<{
    action: string;
    actor?: string;
    target?: string;
    status: 'past' | 'ongoing' | 'planned' | 'threatened';
  }>;
  threat_indicators?: string[];
  key_facts: string[];
  summary: string;
  primary_location?: string;
  refined_category?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { signal_id, text, batch_mode = false, limit = 10 } = await req.json();

    console.log(`[extract-signal-insights] Mode: ${batch_mode ? 'batch' : 'single'}`);

    let signalsToProcess: any[] = [];

    if (batch_mode) {
      // Find signals needing insight extraction
      const { data: signalsNeedingExtraction } = await supabase
        .from('signals')
        .select('id, normalized_text, raw_json, location, entity_tags, category')
        .or('entity_tags.is.null,location.is.null,category.eq.unknown')
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(limit);

      signalsToProcess = signalsNeedingExtraction || [];
    } else if (signal_id) {
      const { data: signal } = await supabase
        .from('signals')
        .select('id, normalized_text, raw_json, location, entity_tags, category')
        .eq('id', signal_id)
        .single();

      if (signal) {
        signalsToProcess = [signal];
      }
    } else if (text) {
      // Process raw text without database record
      signalsToProcess = [{ id: 'adhoc', normalized_text: text }];
    } else {
      return new Response(
        JSON.stringify({ error: 'Provide signal_id, text, or batch_mode' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: any[] = [];

    for (const signal of signalsToProcess) {
      try {
        const signalText = signal.normalized_text || JSON.stringify(signal.raw_json) || '';

        if (!signalText || signalText.length < 20) {
          results.push({ signal_id: signal.id, success: false, error: 'Insufficient text content' });
          continue;
        }

        const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are an intelligence analyst specializing in structured data extraction from security reports.

Extract the following from the provided text:
1. Named entities: People, organizations, locations, infrastructure, domains, IP addresses
2. Dates and timeframes: When events occurred, are planned, or referenced
3. Geographic locations: Cities, regions, countries, facilities with coordinates if identifiable
4. Actions and events: What happened, is happening, or is threatened
5. Threat indicators: Tactics, techniques, IOCs, warning signs
6. Key facts: The most important 3-5 facts an analyst needs to know immediately

Be precise and only extract what is explicitly stated or strongly implied.`
              },
              {
                role: 'user',
                content: `Extract structured insights from this security signal:

${signalText.substring(0, 4000)}`
              }
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "extract_insights",
                  description: "Extract structured intelligence insights from signal text",
                  parameters: {
                    type: "object",
                    properties: {
                      entities: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            type: { type: "string", enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "other"] },
                            confidence: { type: "number", minimum: 0, maximum: 1 },
                            context: { type: "string" }
                          },
                          required: ["name", "type", "confidence"]
                        }
                      },
                      dates: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            date: { type: "string" },
                            type: { type: "string", enum: ["event", "deadline", "reference"] },
                            context: { type: "string" }
                          },
                          required: ["date", "type", "context"]
                        }
                      },
                      locations: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            type: { type: "string", enum: ["city", "region", "country", "facility", "coordinates"] },
                            coordinates: {
                              type: "object",
                              properties: {
                                lat: { type: "number" },
                                lng: { type: "number" }
                              }
                            }
                          },
                          required: ["name", "type"]
                        }
                      },
                      actions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            action: { type: "string" },
                            actor: { type: "string" },
                            target: { type: "string" },
                            status: { type: "string", enum: ["past", "ongoing", "planned", "threatened"] }
                          },
                          required: ["action", "status"]
                        }
                      },
                      threat_indicators: {
                        type: "array",
                        items: { type: "string" }
                      },
                      key_facts: {
                        type: "array",
                        items: { type: "string" }
                      },
                      summary: {
                        type: "string",
                        description: "2-3 sentence executive summary"
                      },
                      refined_category: {
                        type: "string",
                        description: "Best category for this signal"
                      },
                      primary_location: {
                        type: "string",
                        description: "The main geographic location mentioned"
                      }
                    },
                    required: ["entities", "key_facts", "summary"],
                    additionalProperties: false
                  }
                }
              }
            ],
            tool_choice: { type: "function", function: { name: "extract_insights" } }
          }),
        });

        if (!aiResponse.ok) {
          throw new Error(`AI gateway error: ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

        if (!toolCall) {
          throw new Error('No tool call in AI response');
        }

        const insights: ExtractedInsights = JSON.parse(toolCall.function.arguments);

        // Update the signal in the database if it has an ID
        if (signal.id && signal.id !== 'adhoc') {
          const entityTags = insights.entities.map(e => e.name);
          const primaryLocation = insights.primary_location || 
            (insights.locations && insights.locations[0]?.name) || 
            signal.location;

          const updatePayload: any = {
            entity_tags: entityTags.length > 0 ? entityTags : signal.entity_tags,
            location: primaryLocation || signal.location,
            updated_at: new Date().toISOString()
          };

          // Update category if we have a better one
          if (insights.refined_category && (!signal.category || signal.category === 'unknown')) {
            updatePayload.category = insights.refined_category;
          }

          // Store extracted insights in raw_json
          const existingRaw = signal.raw_json || {};
          updatePayload.raw_json = {
            ...existingRaw,
            extracted_insights: {
              entities: insights.entities,
              dates: insights.dates,
              locations: insights.locations,
              actions: insights.actions,
              threat_indicators: insights.threat_indicators,
              key_facts: insights.key_facts,
              extracted_at: new Date().toISOString()
            }
          };

          await supabase
            .from('signals')
            .update(updatePayload)
            .eq('id', signal.id);

          // Create entity suggestions for high-confidence entities
          for (const entity of insights.entities.filter(e => e.confidence >= 0.7)) {
            try {
              await supabase
                .from('entity_suggestions')
                .insert({
                  source_type: 'signal',
                  source_id: crypto.randomUUID(),
                  suggested_name: entity.name,
                  suggested_type: entity.type,
                  confidence: entity.confidence,
                  context: entity.context || `Extracted from signal ${signal.id}`,
                  status: 'pending'
                });
            } catch (err) {
              // Ignore duplicate suggestions
            }
          }
        }

        results.push({
          signal_id: signal.id,
          success: true,
          insights: {
            entity_count: insights.entities.length,
            date_count: insights.dates?.length || 0,
            location_count: insights.locations?.length || 0,
            action_count: insights.actions?.length || 0,
            threat_indicators: insights.threat_indicators,
            key_facts: insights.key_facts,
            summary: insights.summary
          }
        });

        console.log(`[extract-signal-insights] Processed ${signal.id}: ${insights.entities.length} entities, ${insights.key_facts.length} key facts`);

      } catch (signalError) {
        console.error(`[extract-signal-insights] Error processing ${signal.id}:`, signalError);
        results.push({
          signal_id: signal.id,
          success: false,
          error: signalError instanceof Error ? signalError.message : 'Unknown error'
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        successful: results.filter(r => r.success).length,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-signal-insights] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
