import { createClient } from "npm:@supabase/supabase-js@2";
import { isFalsePositiveContent } from '../_shared/keyword-matcher.ts';
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Extract publication date from social media content and text
// IMPORTANT: Returns the date closest to ingestion time (most likely the publication date),
// NOT the first date found in content (which may be an event date or historical reference).
function extractPublicationDate(text: string, _url: string = ''): Date | null {
  const now = new Date();
  
  // Pattern 1: Relative time — strongest publication signal, return immediately
  const relativeTimePatterns = [
    { pattern: /(\d+)\s*(?:second|sec)s?\s*ago/i, unit: 'seconds' },
    { pattern: /(\d+)\s*(?:minute|min)s?\s*ago/i, unit: 'minutes' },
    { pattern: /(\d+)\s*(?:hour|hr)s?\s*ago/i, unit: 'hours' },
    { pattern: /(\d+)\s*days?\s*ago/i, unit: 'days' },
    { pattern: /(\d+)\s*weeks?\s*ago/i, unit: 'weeks' },
    { pattern: /(\d+)\s*months?\s*ago/i, unit: 'months' },
  ];
  
  for (const { pattern, unit } of relativeTimePatterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseInt(match[1], 10);
      const date = new Date(now);
      switch (unit) {
        case 'seconds': date.setSeconds(date.getSeconds() - value); break;
        case 'minutes': date.setMinutes(date.getMinutes() - value); break;
        case 'hours': date.setHours(date.getHours() - value); break;
        case 'days': date.setDate(date.getDate() - value); break;
        case 'weeks': date.setDate(date.getDate() - (value * 7)); break;
        case 'months': date.setMonth(date.getMonth() - value); break;
      }
      return date;
    }
  }
  
  // Pattern 2: Collect ALL absolute date candidates, then pick closest to now
  const candidates: Date[] = [];
  
  const absoluteDatePatterns = [
    /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/g,
    /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/gi,
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s+(\d{4})/gi,
  ];
  
  for (const pattern of absoluteDatePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      try {
        const parsed = new Date(match[0]);
        if (!isNaN(parsed.getTime()) && parsed <= now) {
          candidates.push(parsed);
        }
      } catch {
        continue;
      }
    }
  }
  
  // Pattern 3: Facebook-specific (e.g., "March 15 at 3:30 PM")
  const fbDatePattern = /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi;
  let fbMatch;
  while ((fbMatch = fbDatePattern.exec(text)) !== null) {
    try {
      const dateStr = `${fbMatch[0]} ${now.getFullYear()}`;
      const parsed = new Date(dateStr);
      if (parsed > now) parsed.setFullYear(parsed.getFullYear() - 1);
      if (!isNaN(parsed.getTime())) candidates.push(parsed);
    } catch { /* ignore */ }
  }
  
  // Pick the candidate closest to ingestion time (most likely the publication date)
  if (candidates.length > 0) {
    candidates.sort((a, b) => 
      Math.abs(now.getTime() - a.getTime()) - Math.abs(now.getTime() - b.getTime())
    );
    return candidates[0];
  }
  
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let documentId: string | undefined;
  try {
    const body = await req.json();
    documentId = body.documentId;
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

    // Fetch all active clients and their keywords
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, monitoring_keywords, competitor_names, high_value_assets')
      .eq('status', 'active');

    // IMPROVED: Match document against client keywords with weighted scoring
    // Returns only the BEST matching client to avoid cross-contamination
    function matchClientKeywords(text: string, clients: any[]) {
      const lowerText = text.toLowerCase();
      
      interface ClientScore {
        clientId: string;
        clientName: string;
        matchedKeywords: string[];
        score: number;
      }
      
      const clientScores: ClientScore[] = [];
      
      for (const client of clients || []) {
        let score = 0;
        const matchedKeywords: string[] = [];
        
        // Check client name (highest priority - 1000 points base + length bonus)
        if (lowerText.includes(client.name.toLowerCase())) {
          score += 1000 + client.name.length;
          matchedKeywords.push(`client_name:${client.name}`);
        }
        
        // Check monitoring keywords - score by specificity (length) and word count
        for (const keyword of (client.monitoring_keywords || [])) {
          if (keyword && lowerText.includes(keyword.toLowerCase())) {
            const wordCount = keyword.split(/\s+/).length;
            const keywordScore = keyword.length + (wordCount * 10);
            score += keywordScore;
            matchedKeywords.push(keyword);
          }
        }
        
        // Check competitor names (slightly lower priority)
        for (const competitor of (client.competitor_names || [])) {
          if (competitor && lowerText.includes(competitor.toLowerCase())) {
            score += competitor.length + 5;
            matchedKeywords.push(`competitor:${competitor}`);
          }
        }
        
        // Check high value assets
        for (const asset of (client.high_value_assets || [])) {
          if (asset && lowerText.includes(asset.toLowerCase())) {
            score += asset.length + 5;
            matchedKeywords.push(`asset:${asset}`);
          }
        }
        
        if (score > 0) {
          clientScores.push({
            clientId: client.id,
            clientName: client.name,
            matchedKeywords,
            score
          });
        }
      }
      
      // Sort by score descending and return only the best match
      clientScores.sort((a, b) => b.score - a.score);
      
      if (clientScores.length > 0) {
        const best = clientScores[0];
        console.log(`✓ BEST CLIENT MATCH: ${best.clientName} (score: ${best.score})`);
        console.log(`  Keywords: ${best.matchedKeywords.join(', ')}`);
        
        if (clientScores.length > 1) {
          console.log(`  Runner-up: ${clientScores[1].clientName} (score: ${clientScores[1].score})`);
        }
        
        // Return only the best match to avoid creating signals for wrong clients
        return [{ clientId: best.clientId, clientName: best.clientName, matchedKeywords: best.matchedKeywords }];
      }
      
      return [];
    }

    // PRIORITY 1: Check if document came from an entity scan - use entity's client_id
    let clientMatches: Array<{ clientId: string; clientName: string; matchedKeywords: string[] }> = [];
    
    const sourceEntityId = document.metadata?.entity_id;
    if (sourceEntityId) {
      console.log(`Document from entity scan, checking entity ${sourceEntityId} for client_id`);
      
      const { data: sourceEntity } = await supabase
        .from('entities')
        .select('id, name, client_id')
        .eq('id', sourceEntityId)
        .single();
      
      if (sourceEntity?.client_id) {
        // Use the entity's client_id - this takes priority over keyword matching
        const { data: entityClient } = await supabase
          .from('clients')
          .select('id, name')
          .eq('id', sourceEntity.client_id)
          .single();
        
        if (entityClient) {
          console.log(`✓ ENTITY CLIENT OVERRIDE: Using entity's client ${entityClient.name}`);
          clientMatches = [{
            clientId: entityClient.id,
            clientName: entityClient.name,
            matchedKeywords: [`entity:${sourceEntity.name}`]
          }];
        }
      } else {
        console.log(`Entity ${sourceEntity?.name || sourceEntityId} has no client_id, falling back to keyword matching`);
      }
    }
    
    // PRIORITY 2: If no entity client, use keyword matching
    if (clientMatches.length === 0) {
      clientMatches = matchClientKeywords(document.raw_text || '', clients || []);
    }
    
    // PRIORITY 3: Filter out known false positive content patterns
    const documentText = document.raw_text || document.title || '';
    if (isFalsePositiveContent(documentText)) {
      console.log(`[FP Filter] Rejecting false positive content: ${documentText.substring(0, 100)}...`);
      await supabase
        .from('ingested_documents')
        .update({
          processing_status: 'completed',
          processed_at: new Date().toISOString(),
          error_message: 'False positive content pattern detected'
        })
        .eq('id', documentId);
      
      return new Response(
        JSON.stringify({
          success: true,
          results: { message: 'False positive content rejected', skipped: true }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Skip processing if no client matches at all
    if (clientMatches.length === 0) {
      console.log('No client matches found (entity or keyword), skipping document');
      await supabase
        .from('ingested_documents')
        .update({
          processing_status: 'completed',
          processed_at: new Date().toISOString(),
          error_message: 'No client matches'
        })
        .eq('id', documentId);
      
      return new Response(
        JSON.stringify({
          success: true,
          results: { message: 'No client matches', skipped: true }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Matched ${clientMatches.length} client(s):`, clientMatches.map(m => m.clientName).join(', '));

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

    // Call AI for extraction via resilient gateway
    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-pro',
      messages: [
        {
          role: 'system',
          content: `You are an expert security intelligence analyst extracting actionable intelligence from documents.

**CRITICAL ANTI-HALLUCINATION RULES:**
1. ONLY extract information EXPLICITLY stated in the source text
2. DO NOT infer, assume, or connect topics that are not explicitly linked in the source
3. If an article mentions an Indigenous community AND a nearby industrial project, DO NOT assume they are connected unless the article EXPLICITLY states a connection
4. Geographic proximity does NOT equal causation or connection
5. A fire at a school is NOT related to activism unless the article explicitly says activists were involved
6. If in doubt, describe ONLY what the article explicitly states - never extrapolate
7. Signal descriptions must be direct paraphrases of source content, not interpretations

KNOWN ENTITIES:
${entityContext}

${learningContext}

Extract entities, signals, and entity mentions from documents.`
        },
        {
          role: 'user',
          content: `Analyze this document and extract intelligence:

TITLE: ${document.title}
TEXT: ${(document.raw_text || '').substring(0, 80000)}

Extract all entities, signals, and their relationships.`
        }
      ],
      functionName: 'process-intelligence-document',
      retries: 2,
      dlqOnFailure: true,
      dlqPayload: { documentId },
      extraBody: {
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
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "asset", "project", "route", "research_initiative"]
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
                          enum: ["theft", "protest", "threat", "surveillance", "sabotage", "violence", "cyber", "data_exposure", "wildlife", "wildfire", "weather", "health", "regulatory", "legal", "operational", "media", "reputational", "environmental", "community_impact"]
                        },
                        severity_score: { type: "integer", minimum: 0, maximum: 100 },
                        relevance_score: { type: "number", minimum: 0, maximum: 1 },
                        estimated_event_date: { type: "string" },
                        is_historical_content: { type: "boolean" },
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
      },
    });

    if (aiResult.error) {
      throw new Error(`AI Gateway error: ${aiResult.error}`);
    }

    const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
    
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

    // ── Entity deduplication ──
    // 1. Intra-batch dedup: collapse duplicate names within this extraction
    const normalizeEntityName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const seenNormNames = new Map<string, number>(); // normName → index in deduped array
    const dedupedEntities: typeof intelligence.entities = [];
    
    for (const entity of intelligence.entities || []) {
      if (entity.confidence < 0.3) continue; // low threshold per memory standard
      const norm = normalizeEntityName(entity.name);
      if (norm.length < 2) continue; // skip single-char names
      
      const existingIdx = seenNormNames.get(norm);
      if (existingIdx !== undefined) {
        // Merge: keep highest confidence
        if (entity.confidence > dedupedEntities[existingIdx].confidence) {
          dedupedEntities[existingIdx] = { ...entity, confidence: entity.confidence };
        }
        console.log(`[EntityDedup] Intra-batch duplicate collapsed: "${entity.name}" → "${dedupedEntities[existingIdx].name}"`);
        continue;
      }
      
      // Check if this is an alias/substring of an already-seen entity
      let isAlias = false;
      for (const [seenNorm, idx] of seenNormNames) {
        // If one contains the other and they share the same type
        if ((norm.includes(seenNorm) || seenNorm.includes(norm)) && 
            entity.type === dedupedEntities[idx].type &&
            Math.min(norm.length, seenNorm.length) / Math.max(norm.length, seenNorm.length) > 0.4) {
          // Keep the longer (more descriptive) name
          if (norm.length > seenNorm.length) {
            dedupedEntities[idx] = { ...entity };
            seenNormNames.delete(seenNorm);
            seenNormNames.set(norm, idx);
          }
          console.log(`[EntityDedup] Alias collapsed: "${entity.name}" ↔ "${dedupedEntities[idx].name}"`);
          isAlias = true;
          break;
        }
      }
      if (isAlias) continue;
      
      seenNormNames.set(norm, dedupedEntities.length);
      dedupedEntities.push(entity);
    }
    
    console.log(`[EntityDedup] ${(intelligence.entities || []).length} raw → ${dedupedEntities.length} after intra-batch dedup`);
    
    // 2. Process deduped entities against DB
    for (const entity of dedupedEntities) {
      let entityId = entity.matched_entity_id;
      
      // Validate matched_entity_id is a real UUID
      if (entityId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
        entityId = undefined;
      }
      
      // Cross-DB dedup: try exact match, then normalized match
      if (!entityId) {
        const { data: exact } = await supabase
          .from('entities')
          .select('id, confidence_score')
          .ilike('name', entity.name)
          .eq('type', entity.type)
          .limit(1)
          .maybeSingle();
        
        if (exact) {
          entityId = exact.id;
        } else {
          // Fuzzy: search broader and compare normalized names
          const searchTerm = entity.name.split(/\s+/)[0]; // first word
          if (searchTerm.length >= 3) {
            const { data: candidates } = await supabase
              .from('entities')
              .select('id, name, confidence_score')
              .eq('type', entity.type)
              .ilike('name', `%${searchTerm}%`)
              .limit(20);
            
            if (candidates) {
              for (const c of candidates) {
                const cNorm = normalizeEntityName(c.name);
                const eNorm = normalizeEntityName(entity.name);
                // Check containment or high word overlap
                if (cNorm === eNorm || cNorm.includes(eNorm) || eNorm.includes(cNorm)) {
                  entityId = c.id;
                  console.log(`[EntityDedup] Cross-DB match: "${entity.name}" → existing "${c.name}"`);
                  break;
                }
              }
            }
          }
        }
        
        if (entityId) {
          // Update confidence on match
          await supabase
            .from('entities')
            .update({ 
              confidence_score: Math.min(entity.confidence, 1),
              entity_status: 'confirmed'
            })
            .eq('id', entityId);
          results.entities_confirmed++;
        }
      }

      // Create new entity only if truly novel
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

      // Create mention (with dedup check)
      if (entityId) {
        const { data: existingMention } = await supabase
          .from('document_entity_mentions')
          .select('id')
          .eq('entity_id', entityId)
          .eq('document_id', documentId)
          .limit(1)
          .maybeSingle();
        
        if (!existingMention) {
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
    }

    // Process signals - create one per matched client
    for (const signal of intelligence.signals || []) {
      // FIX 3: Generate content hash based on SOURCE URL + signal content for better deduplication
      // This ensures the same RSS article always produces the same hash regardless of AI phrasing variations
      const sourceUrl = document.metadata?.url || '';
      const contentToHash = `${sourceUrl}|${signal.title || ''}|${signal.description || ''}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(contentToHash);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Create signal for each matched client
      for (const clientMatch of clientMatches) {
        // Check for existing signal with same content hash (within 30 days instead of 7)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const { data: existingSignal } = await supabase
          .from('signals')
          .select('id')
          .eq('content_hash', contentHash)
          .eq('client_id', clientMatch.clientId)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .single();

        if (existingSignal) {
          console.log(`Skipping duplicate signal for client ${clientMatch.clientName}: ${signal.title}`);
          continue;
        }

        // Check if this content was previously rejected/deleted
        const { data: rejectedHash } = await supabase
          .from('rejected_content_hashes')
          .select('id')
          .eq('content_hash', contentHash)
          .limit(1)
          .maybeSingle();

        if (rejectedHash) {
          console.log(`Skipping previously rejected signal for client ${clientMatch.clientName}: ${signal.title}`);
          continue;
        }
        
        // Additional near-duplicate check: look for similar normalized_text in recent signals
        const { data: recentSignals } = await supabase
          .from('signals')
          .select('id, normalized_text')
          .eq('client_id', clientMatch.clientId)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .limit(50);
        
        // Simple similarity check - if any recent signal contains 80% of the same words, skip
        let isNearDuplicate = false;
        if (recentSignals && recentSignals.length > 0) {
          const signalWords = new Set((signal.description || '').toLowerCase().split(/\s+/));
          for (const existing of recentSignals) {
            if (!existing.normalized_text) continue;
            const existingWords = new Set(existing.normalized_text.toLowerCase().split(/\s+/));
            const intersection = new Set([...signalWords].filter(w => existingWords.has(w)));
            const similarity = intersection.size / Math.min(signalWords.size, existingWords.size);
            
            if (similarity > 0.8) {
              console.log(`Skipping near-duplicate signal (${(similarity * 100).toFixed(0)}% similar): ${signal.title}`);
              isNearDuplicate = true;
              break; // Exit the comparison loop
            }
          }
        }
        
        // CRITICAL FIX: Skip to next client if near-duplicate found
        if (isNearDuplicate) {
          continue; // Skip to next clientMatch
        }

        // Extract event date from document content, with AI-extracted date as fallback
        const sourceUrl = document.source_url || document.metadata?.url || '';
        const contentText = `${document.raw_text || ''} ${document.post_caption || ''}`;
        let eventDate = document.post_date 
          ? new Date(document.post_date)
          : extractPublicationDate(contentText, sourceUrl);
        
        // If no date extracted from text, use AI-estimated event date
        if (!eventDate && signal.estimated_event_date) {
          try {
            const aiDate = new Date(signal.estimated_event_date);
            if (!isNaN(aiDate.getTime())) {
              eventDate = aiDate;
              console.log(`[DateExtract] Using AI-estimated event date: ${eventDate.toISOString()} (historical: ${signal.is_historical_content})`);
            }
          } catch { /* ignore invalid dates */ }
        }
        
        const { data: newSignal, error: signalError } = await supabase
          .from('signals')
          .insert({
            title: signal.title,
            description: signal.description,
            signal_type: signal.signal_type,
            severity_score: signal.severity_score,
            relevance_score: signal.relevance_score || 0.7,
            normalized_text: signal.description,
            content_hash: contentHash,
            severity: signal.severity_score >= 80 ? 'critical' : 
                      signal.severity_score >= 50 ? 'high' : 
                      signal.severity_score >= 20 ? 'medium' : 'low',
            location: signal.location,
            status: 'new',
            is_test: false,
            client_id: clientMatch.clientId,
            event_date: eventDate?.toISOString() || null,
            // Propagate media and social data from document to signal
            media_urls: document.media_urls || [],
            thumbnail_url: document.thumbnail_url,
            post_caption: document.post_caption,
            mentions: document.mentions || [],
            hashtags: document.hashtags || [],
            engagement_metrics: document.engagement_metrics || {},
            comments: document.comments || [],
            raw_json: {
              matched_keywords: clientMatch.matchedKeywords,
              client_name: clientMatch.clientName,
              source_metadata: document.metadata,
              has_media: (document.media_urls?.length || 0) > 0,
              media_type: document.media_type,
              author_handle: document.author_handle,
              author_name: document.author_name,
              is_high_priority: document.metadata?.is_high_priority,
              event_details: document.metadata?.event_details,
              // Propagate source URL so UI can render links
              url: sourceUrl || null,
              source_url: sourceUrl || null,
            }
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
          
          // Copy attachments from document to signal
          const { data: docAttachments } = await supabase
            .from('attachments')
            .select('*')
            .eq('parent_type', 'document')
            .eq('parent_id', documentId);
          
          if (docAttachments && docAttachments.length > 0) {
            for (const attachment of docAttachments) {
              await supabase.from('attachments').insert({
                parent_type: 'signal',
                parent_id: newSignal.id,
                filename: attachment.filename,
                mime: attachment.mime,
                storage_url: attachment.storage_url
              });
            }
            console.log(`Linked ${docAttachments.length} media files to signal`);
          }

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
    
    // Mark as failed using documentId captured at the top
    if (documentId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        await supabase
          .from('ingested_documents')
          .update({
            processing_status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', documentId);
      } catch (updateErr) {
        console.error('Failed to update document status:', updateErr);
      }
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