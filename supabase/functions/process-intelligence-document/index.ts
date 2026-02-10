import { createClient } from "npm:@supabase/supabase-js@2";
import { isFalsePositiveContent } from '../_shared/keyword-matcher.ts';

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

    // Call AI for extraction
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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

**EXAMPLES OF WHAT NOT TO DO:**
- Article: "School in Blueberry River First Nation destroyed by fire. PETRONAS operates nearby."
  WRONG: "School fire near PETRONAS assets may indicate activist activity"
  RIGHT: "School in Blueberry River First Nation destroyed by fire. Cause under investigation."
  
- Article: "Protest at Vancouver Art Gallery against LNG"
  WRONG: Linking unrelated events to this protest
  RIGHT: Only describe what the article states about this specific protest

KNOWN ENTITIES:
${entityContext}

${learningContext}

Extract:
1. ENTITIES - Named people, organizations, locations, assets, infrastructure
   
   PEOPLE TO CAPTURE:
   - Political figures: Prime Ministers, Ministers, MPs, government officials (with titles)
   - Corporate executives: CEOs, Presidents, Directors (with titles)
   - Journalists, reporters, authors
   - Community leaders, activists (ONLY if article describes them as such)
   - **ACTIVISTS & ORGANIZERS**: Named individuals EXPLICITLY described as activists in the source
   - **RESEARCHERS & ACADEMICS**: Scientists, PhDs, researchers with their credentials
   
   ORGANIZATIONS TO CAPTURE:
   - Media organizations (CBC News, The Narwhal, Reuters, etc.)
   - Government agencies and offices
   - Companies and corporations
   - NGOs, activist groups (ONLY if article explicitly identifies them as such)
   - Indigenous communities (as community entities, NOT assumed to be activist groups)
   - Any organization explicitly mentioned in the source
   
   INFRASTRUCTURE/PROJECTS:
   - LNG facilities, pipelines, transmission lines
   - Schools, community centers, public buildings
   - Energy projects, resource extraction sites

2. SIGNALS - Identify security concerns ONLY as stated in the source
   
   **WHAT COUNTS AS A SIGNAL:**
   - Events the article EXPLICITLY describes: fires, accidents, protests, statements
   - Official statements or press releases quoted in the article
   - Investigations or legal actions explicitly mentioned
   - Community concerns or opposition EXPLICITLY stated by named sources
   
   **WHAT DOES NOT COUNT:**
   - Implied connections you infer from geographic proximity
   - Assumed motivations not stated in the article
   - Historical context not mentioned in THIS specific article
   - Your speculation about what might happen
   
   SIGNAL TYPES - Choose based on EXPLICIT content:
   - wildfire/fire: Building fires, wildfires (use if cause unknown or accidental)
   - protest: ONLY if article describes protest activity
   - community_impact: Community events, local news, infrastructure issues
   - operational: Industrial incidents, equipment issues
   - reputational: Media coverage about company/project
   
   SEVERITY GUIDANCE:
   - CRITICAL (90-100): Major casualties, significant property destruction, major legal action
   - HIGH (70-89): Serious incidents, widespread coverage, regulatory violations
   - MEDIUM (40-69): Moderate incidents, emerging concerns
   - LOW (20-39): Minor incidents, general news coverage

3. ENTITY MENTIONS - Where entities appear in the document

**FINAL CHECK:** Before outputting, ask yourself: "Is this interpretation EXPLICITLY stated in the source, or am I inferring it?" If inferring, remove it.`
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
                        estimated_event_date: { type: "string", description: "ISO 8601 date (YYYY-MM-DD) of when the described event ACTUALLY OCCURRED. Extract from article dates, bylines, or temporal references. Null if clearly current/today." },
                        is_historical_content: { type: "boolean", description: "True if the event described occurred more than 90 days ago" },
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