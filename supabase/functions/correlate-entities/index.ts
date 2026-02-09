import { createClient } from "npm:@supabase/supabase-js@2";

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

// Disambiguation: context-sensitive false-positive filters per entity type
// Maps entity type → sets of nearby words that indicate a FALSE match
const DISAMBIGUATION_NEGATIVES: Record<string, string[]> = {
  organization: [
    // "Shell" the company vs "shell casing", "shell out", "bombshell", "nutshell"
    'casing', 'casings', 'cartridge', 'ammunition', 'caliber', 'firearm', 'handgun',
    'shotgun', 'bullet', 'projectile', 'bombshell', 'nutshell', 'eggshell', 'seashell',
    'shell out', 'shell shock', 'tortoise shell',
  ],
  person: [
    // Common homonym traps for person names
    'password', 'username', 'login', 'variable', 'function', 'class',
  ],
};

/**
 * Checks whether a text mention of an entity name is contextually valid.
 * Returns false if nearby words indicate a different meaning (e.g., "shell casing").
 */
function isContextualMatch(fullText: string, entityName: string, entityType: string): boolean {
  const nameLower = entityName.toLowerCase();
  const textLower = fullText.toLowerCase();
  
  // Find the position of the entity name in text
  const idx = textLower.indexOf(nameLower);
  if (idx === -1) return false;
  
  // Extract a ±120-char window around the match for context analysis
  const windowStart = Math.max(0, idx - 120);
  const windowEnd = Math.min(textLower.length, idx + nameLower.length + 120);
  const window = textLower.substring(windowStart, windowEnd);
  
  // Check type-specific negatives
  const negatives = DISAMBIGUATION_NEGATIVES[entityType] || [];
  for (const neg of negatives) {
    if (window.includes(neg.toLowerCase())) {
      return false;
    }
  }
  
  // For short entity names (≤6 chars), require stronger context:
  // the name must appear as a standalone word (not part of compound like "eggshell")
  if (nameLower.length <= 6) {
    const wordBoundary = new RegExp(`(?:^|[\\s,."'(])${nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[\\s,."')]|$)`, 'i');
    if (!wordBoundary.test(window)) {
      return false;
    }
  }
  
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, sourceType, sourceId }: CorrelationRequest = await req.json();
    // Suggestions-first policy: never auto-create entities from correlation.
    const autoApprove = false;
    
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

    // Blacklist of common false positives
    const blacklist = new Set([
      // Common titles/words
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      // Days/Months
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
      'september', 'october', 'november', 'december',
      // Common names that are also words
      'will', 'may', 'john doe', 'jane doe', 'test user',
      // Generic terms
      'unknown', 'anonymous', 'n/a', 'none', 'null', 'undefined'
    ]);

    // Common entity patterns (more restrictive)
    const personPattern = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;
    const orgPattern = /\b([A-Z][A-Za-z]{2,}(?:\s+(?:Inc|Corp|LLC|Ltd|Company|Corporation|Group|Association|Organization|Systems|Solutions|Technologies|Services)\.?))\b/gi;
    const emailPattern = /\b([a-zA-Z0-9._-]{3,}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
    const phonePattern = /\b(\+?1?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g;
    const domainPattern = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b/gi;

    // Extract potential entities from text
    const extractedNames = new Set<string>();
    
    // Extract person names (minimum 3 chars per name part)
    let match;
    while ((match = personPattern.exec(text)) !== null) {
      const name = match[1];
      const nameLower = name.toLowerCase();
      
      // Skip if in blacklist or too generic
      if (!blacklist.has(nameLower) && 
          !nameLower.includes('test') && 
          !nameLower.includes('example') &&
          name.length >= 5) {
        extractedNames.add(name);
      }
    }
    
    // Extract organizations
    while ((match = orgPattern.exec(text)) !== null) {
      const org = match[1];
      if (org.length >= 5 && !blacklist.has(org.toLowerCase())) {
        extractedNames.add(org);
      }
    }

    // Extract emails (minimum 5 chars before @)
    while ((match = emailPattern.exec(text)) !== null) {
      extractedNames.add(match[1]);
    }

    // Extract domains (skip common public domains)
    const publicDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'example.com', 'test.com'];
    while ((match = domainPattern.exec(textLower)) !== null) {
      const domain = match[1];
      if (!domain.includes('@') && 
          domain.split('.').length >= 2 && 
          !publicDomains.includes(domain)) {
        extractedNames.add(domain);
      }
    }

    console.log(`Extracted ${extractedNames.size} potential entity names after filtering`);

    // Match against existing entities with disambiguation
    if (entities && entities.length > 0) {
      for (const entity of entities) {
        const names = [entity.name, ...(entity.aliases || [])];
        const matchedTerms: string[] = [];

        for (const name of names) {
          const nameLower = name.toLowerCase();
          
          // Skip very short entity names (3 chars or less) - too ambiguous
          if (nameLower.length <= 3) continue;
          
          // Check for word-boundary match (not substring of larger word)
          const wordBoundaryRegex = new RegExp(`\\b${nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          if (wordBoundaryRegex.test(text)) {
            // Disambiguation: check if the match is contextually relevant
            if (isContextualMatch(text, name, entity.type)) {
              matchedTerms.push(name);
            } else {
              console.log(`Disambiguation rejected: "${name}" in context (entity type: ${entity.type})`);
            }
          }

          // Check if any extracted name matches
          for (const extracted of extractedNames) {
            if (extracted.toLowerCase().includes(nameLower) || nameLower.includes(extracted.toLowerCase())) {
              if (isContextualMatch(text, extracted, entity.type)) {
                matchedTerms.push(extracted);
                extractedNames.delete(extracted);
              }
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
    // Only keep high confidence matches (appeared multiple times or in key positions)
    const remainingNames = Array.from(extractedNames).slice(0, 5); // Reduced to 5 suggestions max

    // Minimum confidence threshold for auto-creation
    const MIN_AUTO_CREATE_CONFIDENCE = 0.8;

    // Determine entity type based on pattern
    const suggestions = [];
    for (const name of remainingNames) {
      let suggestedType = 'other';
      let confidence = 0.7; // Base confidence
      
      if (emailPattern.test(name)) {
        suggestedType = 'email';
        confidence = 0.9; // High confidence for emails
      } else if (phonePattern.test(name)) {
        suggestedType = 'phone';
        confidence = 0.9; // High confidence for phones
      } else if (domainPattern.test(name) && !name.includes('@')) {
        suggestedType = 'domain';
        confidence = 0.85;
      } else if (/\b(?:Inc|Corp|LLC|Ltd|Company|Corporation|Group|Systems|Solutions)\b/i.test(name)) {
        suggestedType = 'organization';
        confidence = 0.85;
      } else if (/^[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}/.test(name)) {
        suggestedType = 'person';
        // Check if name appears multiple times in text
        const occurrences = (text.match(new RegExp(name, 'g')) || []).length;
        confidence = Math.min(0.7 + (occurrences * 0.1), 0.95);
      }

      // Extract context around the mention
      const nameIndex = text.indexOf(name);
      const contextStart = Math.max(0, nameIndex - 100);
      const contextEnd = Math.min(text.length, nameIndex + name.length + 100);
      const context = text.substring(contextStart, contextEnd);

      // Only auto-approve if confidence is high enough
      if (autoApprove && confidence >= MIN_AUTO_CREATE_CONFIDENCE) {
        // Create entity immediately
        const { data: newEntity, error: createError } = await supabase
          .from('entities')
          .insert({
            name: name,
            type: suggestedType,
            is_active: true,
            description: `Auto-created from ${sourceType} (confidence: ${confidence.toFixed(2)})`,
          })
          .select()
          .single();

        if (!createError && newEntity) {
          matches.push({
            entityId: newEntity.id,
            entityName: newEntity.name,
            confidence: confidence,
            matchedOn: [name]
          });
          console.log(`Auto-created high-confidence entity: ${name} (${confidence.toFixed(2)})`);
        }
      } else {
        // Create suggestion for approval (always create suggestions for manual review)
        const { data: suggestion, error: suggestionError } = await supabase
          .from('entity_suggestions')
          .insert({
            suggested_name: name,
            suggested_type: suggestedType,
            source_type: sourceType,
            source_id: sourceId,
            confidence: confidence,
            context: context,
            status: 'pending'
          })
          .select()
          .single();

        if (!suggestionError && suggestion) {
          suggestions.push(suggestion);
          console.log(`Created suggestion for: ${name} (confidence: ${confidence.toFixed(2)})`);
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
