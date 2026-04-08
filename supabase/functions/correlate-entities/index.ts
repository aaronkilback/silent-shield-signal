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

// Normalise curly/smart quotes to straight apostrophes.
// Entity names use typographic apostrophes (Gidimt'en) while signal text
// often uses plain ASCII. Normalise both before matching.
function normaliseQuotes(s: string): string {
  return s
    .replace(/\u2018|\u2019|\u201a|\u201b|\u2032|\u2035/g, "'")
    .replace(/\u201c|\u201d|\u201e|\u201f|\u2033|\u2036/g, '"');
}

// Token boundary check — more reliable than \b when phrases contain apostrophes.
// Returns true if 'phrase' appears in 'text' as a complete token
// (not embedded mid-word). Case-insensitive.
function hasTokenMatch(text: string, phrase: string): boolean {
  const t = text.toLowerCase();
  const p = phrase.toLowerCase();
  let idx = t.indexOf(p);
  while (idx !== -1) {
    const charBefore = idx === 0 ? '' : t[idx - 1];
    const charAfter  = idx + p.length >= t.length ? '' : t[idx + p.length];
    const beforeOk = charBefore === '' || !/[a-z0-9]/i.test(charBefore);
    const afterOk  = charAfter  === '' || !/[a-z0-9]/i.test(charAfter);
    if (beforeOk && afterOk) return true;
    idx = t.indexOf(p, idx + 1);
  }
  return false;
}

// Disambiguation: context-sensitive false-positive filters per entity type
const DISAMBIGUATION_NEGATIVES: Record<string, string[]> = {
  organization: [
    'casing', 'casings', 'cartridge', 'ammunition', 'caliber', 'firearm', 'handgun',
    'shotgun', 'bullet', 'projectile', 'bombshell', 'nutshell', 'eggshell', 'seashell',
    'shell out', 'shell shock', 'tortoise shell',
  ],
  person: [
    'password', 'username', 'login', 'variable', 'function', 'class',
  ],
};

function isContextualMatch(fullText: string, phrase: string, entityType: string): boolean {
  const phraseLower = phrase.toLowerCase();
  const textLower = fullText.toLowerCase();
  const idx = textLower.indexOf(phraseLower);
  if (idx === -1) return false;
  const windowStart = Math.max(0, idx - 120);
  const windowEnd = Math.min(textLower.length, idx + phraseLower.length + 120);
  const window = textLower.substring(windowStart, windowEnd);
  const negatives = DISAMBIGUATION_NEGATIVES[entityType] || [];
  for (const neg of negatives) {
    if (window.includes(neg.toLowerCase())) return false;
  }
  // Extra guard for very short phrases: require they appear as standalone tokens
  if (phraseLower.length <= 6) {
    if (!hasTokenMatch(window, phraseLower)) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, sourceType, sourceId }: CorrelationRequest = await req.json();
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

    // Fetch all active entities with pagination (PostgREST max-rows cap = 1000)
    const entities: any[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const { data: page, error: pageError } = await supabase
        .from('entities')
        .select('id, name, aliases, type, attributes')
        .eq('is_active', true)
        .range(offset, offset + pageSize - 1);
      if (pageError) throw pageError;
      if (!page || page.length === 0) break;
      entities.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    // Normalise the incoming text once so all matching uses consistent apostrophes
    const textNorm = normaliseQuotes(text);

    const matches: EntityMatch[] = [];

    const blacklist = new Set([
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
      'september', 'october', 'november', 'december',
      'will', 'may', 'john doe', 'jane doe', 'test user',
      'unknown', 'anonymous', 'n/a', 'none', 'null', 'undefined',
      'chief executive', 'chief officer', 'vice president', 'senior director',
      'managing director', 'board director', 'executive director', 'operations manager',
      'project manager', 'account manager', 'general manager', 'deputy minister',
      'prime minister', 'foreign minister', 'defense minister', 'attorney general',
      'solicitor general', 'chief justice', 'associate justice',
      'federal government', 'provincial government', 'local government', 'city council',
      'town council', 'the government', 'the department', 'the ministry', 'the agency',
      'the organization', 'the company', 'the corporation', 'the group',
      'the association', 'the institute', 'national security', 'public safety',
      'law enforcement', 'new report', 'new study', 'breaking news', 'top story',
      'latest news', 'press release', 'media release', 'official statement',
      'smith', 'jones', 'brown', 'wilson', 'taylor', 'johnson', 'williams',
      'davies', 'evans', 'thomas',
      'john', 'jane', 'james', 'robert', 'michael', 'william', 'david', 'richard',
      'joseph', 'mary', 'patricia', 'linda', 'barbara', 'elizabeth', 'jennifer',
      'maria', 'susan', 'margaret',
    ]);

    const personPattern = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;
    const orgPattern = /\b([A-Z][A-Za-z]{2,}(?:\s+(?:Inc|Corp|LLC|Ltd|Company|Corporation|Group|Association|Organization|Systems|Solutions|Technologies|Services)\.?))\b/gi;
    const emailPattern = /\b([a-zA-Z0-9._-]{3,}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
    const phonePattern = /\b(\+?1?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g;
    const domainPattern = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b/gi;

    const extractedNames = new Set<string>();
    let m: RegExpExecArray | null;

    while ((m = personPattern.exec(text)) !== null) {
      const name = m[1];
      if (!blacklist.has(name.toLowerCase()) && !name.toLowerCase().includes('test') &&
          !name.toLowerCase().includes('example') && name.length >= 5) {
        extractedNames.add(name);
      }
    }
    while ((m = orgPattern.exec(text)) !== null) {
      const org = m[1];
      if (org.length >= 5 && !blacklist.has(org.toLowerCase())) extractedNames.add(org);
    }
    while ((m = emailPattern.exec(text)) !== null) extractedNames.add(m[1]);
    const publicDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'example.com', 'test.com'];
    while ((m = domainPattern.exec(text.toLowerCase())) !== null) {
      const domain = m[1];
      if (!domain.includes('@') && domain.split('.').length >= 2 && !publicDomains.includes(domain)) {
        extractedNames.add(domain);
      }
    }

    console.log(`Extracted ${extractedNames.size} potential entity names`);

    if (entities && entities.length > 0) {
      for (const entity of entities) {
        const names = [entity.name, ...(entity.aliases || [])];
        const matchedTerms: string[] = [];

        for (const rawName of names) {
          // Normalise quotes in entity name to match signal text
          const nameNorm = normaliseQuotes(rawName);
          const nameLower = nameNorm.toLowerCase();

          // Skip 1-2 char entries — too ambiguous.
          // 3-char acronyms like CGL are valid.
          if (nameLower.length <= 2) continue;

          // Build match variants to handle common formatting differences:
          // 1. Full normalised name
          // 2. Without parenthetical: "Coastal GasLink (CGL)" -> "Coastal GasLink"
          // 3. Without punctuation: "Houston, BC" -> "Houston BC"
          const variants = new Set<string>([nameLower]);
          const withoutParens = nameLower.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
          if (withoutParens && withoutParens !== nameLower) variants.add(withoutParens);
          const withoutPunct = nameLower.replace(/[,;:]/g, '').replace(/\s+/g, ' ').trim();
          if (withoutPunct && withoutPunct !== nameLower) variants.add(withoutPunct);

          for (const variant of variants) {
            if (matchedTerms.includes(rawName)) break;
            // Use token boundary check instead of \b regex for reliability with apostrophes
            if (hasTokenMatch(textNorm, variant)) {
              if (isContextualMatch(textNorm, variant, entity.type)) {
                matchedTerms.push(rawName);
              } else {
                console.log(`Disambiguation rejected: "${rawName}" (variant: "${variant}")`);
              }
            }
          }

          // Leading-phrase match for long entity names (3+ words)
          if (!matchedTerms.includes(rawName)) {
            const nameWords = nameLower.split(/\s+/);
            if (nameWords.length >= 3 && nameWords[0].length >= 4 && nameWords[1].length >= 4) {
              const leadPhrase = nameWords.slice(0, 2).join(' ');
              if (hasTokenMatch(textNorm, leadPhrase) && isContextualMatch(textNorm, leadPhrase, entity.type)) {
                matchedTerms.push(leadPhrase);
                console.log(`Leading-phrase match: "${leadPhrase}" -> entity "${rawName}"`);
              }
            }
          }

          // Extracted-name cross-check
          for (const extracted of extractedNames) {
            if (matchedTerms.includes(rawName)) break;
            const extractedLower = extracted.toLowerCase();
            const entityWords = nameLower.split(/\s+/);
            const extractedWords = extractedLower.split(/\s+/);
            const allExtractedInEntity = extractedWords.every(w => entityWords.includes(w));
            const allEntityInExtracted = entityWords.every(w => extractedWords.includes(w));
            if (allExtractedInEntity || allEntityInExtracted) {
              if (isContextualMatch(textNorm, extracted, entity.type)) {
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
            matchedOn: matchedTerms,
          });
          console.log(`Matched entity: ${entity.name} (terms: ${matchedTerms.join(', ')})`);
        }
      }
    }

    // Remaining extracted names -> entity suggestions
    const remainingNames = Array.from(extractedNames).slice(0, 5);
    const MIN_AUTO_CREATE_CONFIDENCE = 0.8;
    const suggestions = [];

    for (const name of remainingNames) {
      let suggestedType = 'other';
      let confidence = 0.7;
      if (emailPattern.test(name)) { suggestedType = 'email'; confidence = 0.9; }
      else if (phonePattern.test(name)) { suggestedType = 'phone'; confidence = 0.9; }
      else if (domainPattern.test(name) && !name.includes('@')) { suggestedType = 'domain'; confidence = 0.85; }
      else if (/\b(?:Inc|Corp|LLC|Ltd|Company|Corporation|Group|Systems|Solutions)\b/i.test(name)) {
        suggestedType = 'organization'; confidence = 0.85;
      } else if (/^[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}/.test(name)) {
        suggestedType = 'person';
        const occurrences = (text.match(new RegExp(name, 'g')) || []).length;
        confidence = Math.min(0.7 + (occurrences * 0.1), 0.95);
      }
      const nameIndex = text.indexOf(name);
      const ctx = text.substring(Math.max(0, nameIndex - 100), Math.min(text.length, nameIndex + name.length + 100));

      if (autoApprove && confidence >= MIN_AUTO_CREATE_CONFIDENCE) {
        const { data: newEntity, error: createError } = await supabase
          .from('entities')
          .insert({ name, type: suggestedType, is_active: true,
            description: `Auto-created from ${sourceType} (confidence: ${confidence.toFixed(2)})` })
          .select().single();
        if (!createError && newEntity) {
          matches.push({ entityId: newEntity.id, entityName: newEntity.name, confidence, matchedOn: [name] });
        }
      } else {
        const { data: suggestion, error: suggestionError } = await supabase
          .from('entity_suggestions')
          .insert({ suggested_name: name, suggested_type: suggestedType, source_type: sourceType,
            source_id: sourceId, confidence, context: ctx, status: 'pending' })
          .select().single();
        if (!suggestionError && suggestion) suggestions.push(suggestion);
      }
    }

    // Write correlated entity IDs back to source record
    const entityIds = matches.map(m => m.entityId);
    console.log(`[Phase4B] Total matches found: ${matches.length} — ${matches.map(m => m.entityName).join(', ')}`);

    if (entityIds.length > 0) {
      const tableMap: Record<string, { table: string; col: string }> = {
        signal: { table: 'signals', col: 'auto_correlated_entities' },
        archival_document: { table: 'archival_documents', col: 'correlated_entity_ids' },
        investigation: { table: 'investigations', col: 'correlated_entity_ids' },
      };
      const dest = tableMap[sourceType];
      if (dest) {
        await supabase.from(dest.table).update({ [dest.col]: entityIds }).eq('id', sourceId);
        console.log(`Updated ${sourceType} with ${entityIds.length} correlated entities`);
      }

      // Dedup: check existing mentions before inserting to handle double-fire
      const { data: existingMentions } = await supabase
        .from('entity_mentions')
        .select('entity_id')
        .eq('signal_id', sourceId);

      const alreadyMentioned = new Set((existingMentions || []).map((row: any) => row.entity_id));

      const mentions = matches
        .filter(match => !alreadyMentioned.has(match.entityId))
        .map(match => ({
          entity_id: match.entityId,
          signal_id: sourceType === 'signal' ? sourceId : null,
          confidence: match.confidence,
          context: match.matchedOn.join(', '),
        }));

      if (mentions.length > 0) {
        const { error: mentionError } = await supabase.from('entity_mentions').insert(mentions);
        if (mentionError) {
          console.error('[Phase4B] entity_mentions INSERT failed:', JSON.stringify(mentionError));
          console.error('[Phase4B] Failed payload:', JSON.stringify(mentions));
        } else {
          console.log(`[Phase4B] Inserted ${mentions.length} entity mentions (${matches.length - mentions.length} deduped)`);
        }
      }

      // ───────────────────────────────────────────────────────────────────────
      // PHASE 4D: RELATIONSHIP GRAPH TRAVERSAL
      // For each matched entity, traverse its relationships to find related
      // entities. If any related entity has recent signal activity, that is
      // corroboration — the signal is more likely real and significant.
      // Corroboration boosts the signal's composite_confidence score.
      // ───────────────────────────────────────────────────────────────────────
      if (sourceType === 'signal' && entityIds.length > 0) {
        try {
          // Step 1: fetch relationships for matched entities (one hop, strength >= 0.5)
          const { data: relationships } = await supabase
            .from('entity_relationships')
            .select('entity_a_id, entity_b_id, relationship_type, strength')
            .or(`entity_a_id.in.(${entityIds.join(',')}),entity_b_id.in.(${entityIds.join(',')})`)
            .gte('strength', 0.5);

          if (relationships && relationships.length > 0) {
            // Step 2: collect all entity IDs needed for name lookup
            const allIds = new Set<string>();
            for (const rel of relationships) {
              allIds.add(rel.entity_a_id);
              allIds.add(rel.entity_b_id);
            }
            const { data: nameRows } = await supabase
              .from('entities')
              .select('id, name')
              .in('id', Array.from(allIds));
            const nameMap: Record<string, string> = {};
            for (const e of (nameRows || [])) nameMap[e.id] = e.name;

            // Step 3: build related entity map (one hop away, not already matched)
            const relatedEntityIds = new Set<string>();
            const relatedEntityNames: Record<string, string> = {};
            const traversedRelationships: Array<{ from: string; type: string; to: string; strength: number }> = [];

            for (const rel of relationships) {
              const aId = rel.entity_a_id;
              const bId = rel.entity_b_id;
              const matchedId = entityIds.includes(aId) ? aId : bId;
              const relatedId = entityIds.includes(aId) ? bId : aId;
              const matchedName = nameMap[matchedId] || matchedId;
              const relatedName = nameMap[relatedId] || relatedId;

              if (!entityIds.includes(relatedId)) {
                relatedEntityIds.add(relatedId);
                relatedEntityNames[relatedId] = relatedName;
                traversedRelationships.push({
                  from: matchedName,
                  type: rel.relationship_type,
                  to: relatedName,
                  strength: rel.strength,
                });
              }
            }

            // Step 4: check for recent mentions of related entities (72h window)
            if (relatedEntityIds.size > 0) {
              const seventyTwoHoursAgo = new Date(Date.now() - 72 * 3600000).toISOString();
              const { data: recentRelatedMentions } = await supabase
                .from('entity_mentions')
                .select('entity_id, signal_id')
                .in('entity_id', Array.from(relatedEntityIds))
                .gte('created_at', seventyTwoHoursAgo)
                .neq('signal_id', sourceId);

              if (recentRelatedMentions && recentRelatedMentions.length > 0) {
                // Corroboration detected — related entities have recent activity
                const corroboratingEntityIds = [...new Set(recentRelatedMentions.map((m: any) => m.entity_id))];
                const corroboratingNames = corroboratingEntityIds.map(id => relatedEntityNames[id]).filter(Boolean);
                const boost = Math.min(corroboratingEntityIds.length * 0.05, 0.15);

                console.log(`[Phase4D] Corroboration: ${corroboratingNames.join(', ')} have recent activity. Boost: +${boost.toFixed(3)}`);

                // Step 5: boost composite_confidence and write graph context to raw_json
                const { data: sig } = await supabase
                  .from('signals')
                  .select('composite_confidence, raw_json')
                  .eq('id', sourceId)
                  .maybeSingle();

                if (sig) {
                  const oldScore = sig.composite_confidence ?? null;
                  const newScore = oldScore !== null ? Math.min(0.98, oldScore + boost) : null;

                  await supabase.from('signals').update({
                    composite_confidence: newScore,
                    raw_json: {
                      ...(sig.raw_json || {}),
                      phase4d_traversal: {
                        matched_entities: entityIds,
                        traversed_relationships: traversedRelationships,
                        corroborating_entities: corroboratingNames,
                        corroboration_signal_count: recentRelatedMentions.length,
                        confidence_boost: boost,
                        traversal_window_hours: 72,
                        detected_at: new Date().toISOString(),
                      },
                    },
                  }).eq('id', sourceId);

                  console.log(`[Phase4D] ${sourceId} composite_confidence: ${oldScore?.toFixed(3) ?? 'null'} → ${newScore?.toFixed(3) ?? 'null'}`);
                }
              } else {
                console.log(`[Phase4D] No corroboration — related entities have no recent activity`);
              }
            }
          }
        } catch (err) {
          console.error('[Phase4D] Traversal failed (non-blocking):', err);
        }
      }
    }

    console.log(`Correlation complete: ${matches.length} matches, ${suggestions.length} suggestions`);

    return new Response(
      JSON.stringify({ success: true, matches, suggestions, totalMatches: matches.length, pendingSuggestions: suggestions.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in correlate-entities:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
