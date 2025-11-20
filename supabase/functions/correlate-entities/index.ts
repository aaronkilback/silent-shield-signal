import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CorrelationRequest {
  text: string;
  sourceType: 'signal' | 'archival_document' | 'investigation' | 'source';
  sourceId: string;
  autoApprove?: boolean;
}

interface EntityMatch {
  entityId: string;
  entityName: string;
  confidence: number;
  matchedOn: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, sourceType, sourceId, autoApprove = false }: CorrelationRequest = await req.json();
    
    if (!text || !sourceType || !sourceId) {
      return new Response(
        JSON.stringify({ error: 'text, sourceType, and sourceId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Correlating entities for ${sourceType}:${sourceId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all active entities
    const { data: entities, error: entitiesError } = await supabase
      .from('entities')
      .select('id, name, aliases, type, attributes')
      .eq('is_active', true);

    if (entitiesError) throw entitiesError;

    const textLower = text.toLowerCase();
    const matches: EntityMatch[] = [];
    const potentialNewEntities: string[] = [];

    // Common entity patterns
    const personPattern = /\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    const orgPattern = /\b([A-Z][A-Za-z]+(?:\s+(?:Inc|Corp|LLC|Ltd|Company|Corporation|Group|Association|Organization)\.?))\b/gi;
    const emailPattern = /\b([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
    const phonePattern = /\b(\+?1?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g;
    const domainPattern = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b/gi;

    // Extract potential entities from text
    const extractedNames = new Set<string>();
    
    // Extract person names
    let match;
    while ((match = personPattern.exec(text)) !== null) {
      extractedNames.add(match[1]);
    }
    
    // Extract organizations
    while ((match = orgPattern.exec(text)) !== null) {
      extractedNames.add(match[1]);
    }

    // Extract emails
    while ((match = emailPattern.exec(text)) !== null) {
      extractedNames.add(match[1]);
    }

    // Extract domains
    while ((match = domainPattern.exec(textLower)) !== null) {
      const domain = match[1];
      if (!domain.includes('@') && domain.split('.').length >= 2) {
        extractedNames.add(domain);
      }
    }

    console.log(`Extracted ${extractedNames.size} potential entity names`);

    // Match against existing entities
    if (entities && entities.length > 0) {
      for (const entity of entities) {
        const names = [entity.name, ...(entity.aliases || [])];
        const matchedTerms: string[] = [];

        for (const name of names) {
          const nameLower = name.toLowerCase();
          
          // Exact match in text
          if (textLower.includes(nameLower)) {
            matchedTerms.push(name);
          }

          // Check if any extracted name matches
          for (const extracted of extractedNames) {
            if (extracted.toLowerCase().includes(nameLower) || nameLower.includes(extracted.toLowerCase())) {
              matchedTerms.push(extracted);
              extractedNames.delete(extracted);
            }
          }
        }

        if (matchedTerms.length > 0) {
          matches.push({
            entityId: entity.id,
            entityName: entity.name,
            confidence: Math.min(matchedTerms.length * 0.3, 0.95),
            matchedOn: matchedTerms
          });
          console.log(`Matched entity: ${entity.name} (${matchedTerms.length} terms)`);
        }
      }
    }

    // Remaining extracted names are potential new entities
    const remainingNames = Array.from(extractedNames).slice(0, 10); // Limit to 10 suggestions

    // Determine entity type based on pattern
    const suggestions = [];
    for (const name of remainingNames) {
      let suggestedType = 'other';
      
      if (emailPattern.test(name)) {
        suggestedType = 'email';
      } else if (phonePattern.test(name)) {
        suggestedType = 'phone';
      } else if (domainPattern.test(name) && !name.includes('@')) {
        suggestedType = 'domain';
      } else if (/\b(?:Inc|Corp|LLC|Ltd|Company)\b/i.test(name)) {
        suggestedType = 'organization';
      } else if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(name)) {
        suggestedType = 'person';
      }

      // Extract context around the mention
      const nameIndex = text.indexOf(name);
      const contextStart = Math.max(0, nameIndex - 100);
      const contextEnd = Math.min(text.length, nameIndex + name.length + 100);
      const context = text.substring(contextStart, contextEnd);

      if (autoApprove) {
        // Create entity immediately
        const { data: newEntity, error: createError } = await supabase
          .from('entities')
          .insert({
            name: name,
            type: suggestedType,
            is_active: true,
            description: `Auto-created from ${sourceType}`,
          })
          .select()
          .single();

        if (!createError && newEntity) {
          matches.push({
            entityId: newEntity.id,
            entityName: newEntity.name,
            confidence: 0.7,
            matchedOn: [name]
          });
          console.log(`Auto-created entity: ${name}`);
        }
      } else {
        // Create suggestion for approval
        const { data: suggestion, error: suggestionError } = await supabase
          .from('entity_suggestions')
          .insert({
            suggested_name: name,
            suggested_type: suggestedType,
            source_type: sourceType,
            source_id: sourceId,
            confidence: 0.7,
            context: context,
            status: 'pending'
          })
          .select()
          .single();

        if (!suggestionError && suggestion) {
          suggestions.push(suggestion);
          console.log(`Created suggestion for: ${name}`);
        }
      }
    }

    // Update source with correlated entities
    const entityIds = matches.map(m => m.entityId);
    if (entityIds.length > 0) {
      let updateColumn = '';
      let updateTable = '';

      switch (sourceType) {
        case 'signal':
          updateTable = 'signals';
          updateColumn = 'auto_correlated_entities';
          break;
        case 'archival_document':
          updateTable = 'archival_documents';
          updateColumn = 'correlated_entity_ids';
          break;
        case 'investigation':
          updateTable = 'investigations';
          updateColumn = 'correlated_entity_ids';
          break;
      }

      if (updateTable && updateColumn) {
        await supabase
          .from(updateTable)
          .update({ [updateColumn]: entityIds })
          .eq('id', sourceId);
        
        console.log(`Updated ${sourceType} with ${entityIds.length} correlated entities`);
      }

      // Create entity mentions
      const mentions = matches.map(m => ({
        entity_id: m.entityId,
        signal_id: sourceType === 'signal' ? sourceId : null,
        confidence: m.confidence,
        context: m.matchedOn.join(', ')
      }));

      await supabase.from('entity_mentions').insert(mentions);
    }

    console.log(`Correlation complete: ${matches.length} matches, ${suggestions.length} suggestions`);

    return new Response(
      JSON.stringify({ 
        success: true,
        matches: matches,
        suggestions: suggestions,
        totalMatches: matches.length,
        pendingSuggestions: suggestions.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in correlate-entities function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
