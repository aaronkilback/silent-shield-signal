import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    const googleApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const googleEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

    if (!lovableApiKey) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!googleApiKey || !googleEngineId) {
      console.error('Google Search API not configured');
      return new Response(
        JSON.stringify({ error: 'Search service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Check if a specific entity_id was provided
    const body = await req.json().catch(() => ({}));
    const specificEntityId = body.entity_id;

    let entities;
    if (specificEntityId) {
      // Fetch specific entity
      const { data, error } = await supabase
        .from('entities')
        .select('*')
        .eq('id', specificEntityId)
        .single();
      
      if (error) {
        console.error('Error fetching entity:', error);
        throw error;
      }
      entities = data ? [data] : [];
    } else {
      // Fetch active entities for batch processing
      const { data, error: entitiesError } = await supabase
        .from('entities')
        .select('*')
        .eq('is_active', true)
        .order('updated_at', { ascending: true })
        .limit(10); // Process 10 entities per run

      if (entitiesError) {
        console.error('Error fetching entities:', entitiesError);
        throw entitiesError;
      }
      entities = data || [];
    }

    console.log(`Processing ${entities?.length || 0} entities for OSINT web search and relationship scan`);

    let totalRelationshipsCreated = 0;
    let totalContentCreated = 0;
    let totalSignalsCreated = 0;

    for (const entity of entities || []) {
      console.log(`Scanning entity: ${entity.name} (${entity.type})`);

      try {
        // Extract entity details for targeted searching
        const attributes = entity.attributes || {};
        const contactInfo = attributes.contact_info || {};
        const socialMedia = contactInfo.social_media || {};
        const location = entity.current_location || '';
        
        // PART 1: Perform targeted web searches using entity details
        const searchQueries: string[] = [
          `"${entity.name}"`,
          `"${entity.name}" news`,
        ];

        // Add location-specific searches
        if (location) {
          searchQueries.push(`"${entity.name}" "${location}"`);
        }

        // Add social media searches with handles
        if (socialMedia.facebook) {
          searchQueries.push(`site:facebook.com "${socialMedia.facebook}"`);
        } else {
          searchQueries.push(`site:facebook.com "${entity.name}"`);
        }

        if (socialMedia.linkedin) {
          searchQueries.push(`site:linkedin.com "${socialMedia.linkedin}"`);
        } else {
          searchQueries.push(`site:linkedin.com "${entity.name}"`);
        }

        // Add first alias if available
        if (entity.aliases && entity.aliases.length > 0) {
          searchQueries.push(`"${entity.aliases[0]}"`);
        }

        console.log(`Generated ${searchQueries.length} targeted searches for ${entity.name}`);

        for (const query of searchQueries.slice(0, 3)) { // Limit to 3 searches per entity
          console.log(`Web search: ${query}`);
          
          const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleEngineId}&q=${encodeURIComponent(query)}&num=5`;
          const searchResponse = await fetch(searchUrl);
          
          if (!searchResponse.ok) continue;

          const searchData = await searchResponse.json();
          const items = searchData.items || [];

          for (const item of items) {
            // CRITICAL: Validate search result is actually about this specific entity
            // before creating signals. Common names like "Scott" match too broadly.
            const contentToCheck = `${item.title} ${item.snippet || ''}`.toLowerCase();
            const entityNameLower = entity.name.toLowerCase();
            
            // For person entities, require full name match or very high relevance
            let isRelevant = false;
            
            if (entity.type === 'person') {
              // For person names, check if the full name appears together
              // Handle formats like "BROW, Scott" → check both "brow scott" and "scott brow"
              const nameParts = entityNameLower.split(/[,\s]+/).filter((p: string) => p.length > 2);
              
              if (nameParts.length >= 2) {
                // Check if both name parts appear within close proximity
                const allPartsPresent = nameParts.every((part: string) => contentToCheck.includes(part));
                
                if (allPartsPresent) {
                  // Use AI to verify this is actually about the same person
                  const verifyResult = await callAiGateway({
                    model: 'google/gemini-2.5-flash',
                    messages: [
                      { role: 'system', content: 'You are verifying if a web search result is actually about a specific person. Respond with only "YES" or "NO".' },
                      { role: 'user', content: `Is this search result about the person "${entity.name}"?\n\nDescription: ${entity.description || 'No description available'}\n\nSearch result title: ${item.title}\nSearch result snippet: ${item.snippet || 'No snippet'}\nURL: ${item.link}\n\nAnswer YES only if this content is clearly about the same specific individual named "${entity.name}". Answer NO if it's about a different person who happens to have a similar name, or if it's unrelated content.` }
                    ],
                    functionName: 'osint-entity-scan',
                    extraBody: { max_tokens: 10 },
                  });
                  
                  if (!verifyResult.error) {
                    const answer = verifyResult.content?.trim().toUpperCase();
                    isRelevant = answer === 'YES';
                    console.log(`Relevance check for "${item.title}" vs "${entity.name}": ${answer}`);
                  }
                }
              } else {
                // Single-word name - require exact match
                isRelevant = contentToCheck.includes(entityNameLower);
              }
            } else {
              // For non-person entities (organizations, etc.), exact name match is usually sufficient
              isRelevant = contentToCheck.includes(entityNameLower);
            }
            
            if (!isRelevant) {
              console.log(`Skipping irrelevant result for ${entity.name}: ${item.title}`);
              continue;
            }
            
            // Create ingested document and process with AI
            const { data: doc, error: docError } = await supabase
              .from('ingested_documents')
              .insert({
                title: item.title,
                raw_text: `${item.title}\n\n${item.snippet || ''}`,
                metadata: {
                  url: item.link,
                  source: 'osint_scan',
                  entity_id: entity.id
                }
              })
              .select()
              .single();

            if (!docError && doc) {
              // CRITICAL: Create document_entity_mentions linkage for immediate AI access
              await supabase
                .from('document_entity_mentions')
                .insert({
                  document_id: doc.id,
                  entity_id: entity.id,
                  confidence: 0.9, // High confidence since we're explicitly scanning this entity
                  mention_text: entity.name
                });

              // Invoke intelligence processing
              await supabase.functions.invoke('process-intelligence-document', {
                body: { documentId: doc.id }
              });
              totalContentCreated++;
            }
          }

          await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
        }

        // PART 2: Perform AI-powered relationship analysis
        const relationshipResult = await callAiGateway({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'You are an OSINT analyst expert. Analyze the provided entity and identify potential relationships with other entities based on open-source intelligence. Return structured data about relationships.' },
            { role: 'user', content: `Analyze this entity for OSINT intelligence and identify potential relationships:\n\nEntity Name: ${entity.name}\nEntity Type: ${entity.type}\nDescription: ${entity.description || 'Not provided'}\nAliases: ${entity.aliases?.join(', ') || 'None'}\nRisk Level: ${entity.risk_level || 'Unknown'}\nThreat Indicators: ${entity.threat_indicators?.join(', ') || 'None'}\n\nIdentify up to 5 potential entities this might be related to and the type of relationship. Consider:\n- Professional associations\n- Geographic connections\n- Organizational memberships\n- Communication patterns\n- Transaction history\n- Social connections\n\nFormat your response as a JSON array of relationship suggestions with this structure:\n[\n  {\n    "target_entity_name": "name of related entity",\n    "target_entity_type": "person|organization|location|infrastructure|domain|ip_address|email|phone|vehicle|other",\n    "relationship_type": "associated_with|works_for|reports_to|owns|located_at|communicates_with|etc",\n    "description": "brief description of the relationship",\n    "confidence": 0.0-1.0\n  }\n]` }
          ],
          functionName: 'osint-entity-scan',
          extraBody: {
            tools: [{
              type: 'function',
              function: {
                name: 'suggest_relationships',
                description: 'Suggest potential entity relationships based on OSINT',
                parameters: {
                  type: 'object',
                  properties: {
                    relationships: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          target_entity_name: { type: 'string' },
                          target_entity_type: { type: 'string' },
                          relationship_type: { type: 'string' },
                          description: { type: 'string' },
                          confidence: { type: 'number' }
                        },
                        required: ['target_entity_name', 'target_entity_type', 'relationship_type', 'confidence']
                      }
                    }
                  },
                  required: ['relationships']
                }
              }
            }],
            tool_choice: { type: 'function', function: { name: 'suggest_relationships' } }
          },
        });

        if (relationshipResult.error) {
          console.error(`AI API error for ${entity.name}:`, relationshipResult.error);
          continue;
        }

        const toolCall = relationshipResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
        
        if (!toolCall) {
          console.log(`No relationships found for ${entity.name}`);
          continue;
        }

        const relationships = JSON.parse(toolCall.function.arguments).relationships;
        console.log(`Found ${relationships.length} potential relationships for ${entity.name}`);

        // Process each suggested relationship
        for (const rel of relationships) {
          // Only process high-confidence relationships
          if (rel.confidence < 0.6) continue;

          // Check if target entity exists or create it
          let { data: targetEntity, error: findError } = await supabase
            .from('entities')
            .select('id')
            .eq('name', rel.target_entity_name)
            .maybeSingle();

          if (findError) {
            console.error('Error finding target entity:', findError);
            continue;
          }

          // Create target entity if it doesn't exist
          if (!targetEntity) {
            const { data: newEntity, error: createError } = await supabase
              .from('entities')
              .insert({
                name: rel.target_entity_name,
                type: rel.target_entity_type,
                description: `Entity discovered via OSINT scan of ${entity.name}`,
                risk_level: 'low',
                is_active: false // Mark as unverified
              })
              .select('id')
              .single();

            if (createError) {
              console.error('Error creating target entity:', createError);
              continue;
            }
            targetEntity = newEntity;
          }

          // Check if relationship already exists
          const { data: existingRel } = await supabase
            .from('entity_relationships')
            .select('id, occurrence_count')
            .or(`and(entity_a_id.eq.${entity.id},entity_b_id.eq.${targetEntity.id}),and(entity_a_id.eq.${targetEntity.id},entity_b_id.eq.${entity.id})`)
            .maybeSingle();

          if (existingRel) {
            // Update occurrence count
            await supabase
              .from('entity_relationships')
              .update({
                occurrence_count: (existingRel.occurrence_count || 1) + 1,
                last_observed: new Date().toISOString()
              })
              .eq('id', existingRel.id);
          } else {
            // Create new relationship
            const { error: relError } = await supabase
              .from('entity_relationships')
              .insert({
                entity_a_id: entity.id,
                entity_b_id: targetEntity.id,
                relationship_type: rel.relationship_type,
                description: `${rel.description} (OSINT confidence: ${(rel.confidence * 100).toFixed(0)}%)`,
                strength: rel.confidence || 0.5,
                occurrence_count: 1
              });

            if (relError) {
              console.error('Error creating relationship:', relError);
            } else {
              totalRelationshipsCreated++;
            }
          }
        }

        // Update entity's last scan timestamp
        await supabase
          .from('entities')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', entity.id);

      } catch (error) {
        console.error(`Error processing entity ${entity.name}:`, error);
        continue;
      }
    }

    console.log(`OSINT scan complete. Created ${totalRelationshipsCreated} relationships, ${totalContentCreated} content items`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        entities_scanned: entities?.length || 0,
        relationships_created: totalRelationshipsCreated,
        content_created: totalContentCreated,
        signals_created: totalSignalsCreated
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('OSINT scan error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
