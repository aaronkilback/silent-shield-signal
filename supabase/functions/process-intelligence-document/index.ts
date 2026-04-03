import { createClient } from "npm:@supabase/supabase-js@2";
import { isFalsePositiveContent } from '../_shared/keyword-matcher.ts';
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { checkWatchListHits, applyWatchListBoosts } from "../_shared/watch-list.ts";

const AI_REFUSAL_PATTERNS = [
  /i cannot (fulfill|provide|complete|generate)/i,
  /i('m| am) unable to/i,
  /i (don't|do not) have (access|information|enough)/i,
  /i (don't|do not) have sufficient/i,
  /not able to provide/i,
  /cannot (search|access|retrieve|browse)/i,
  /no (information|data|results) available/i,
  /based on (the |my )?(search results|information provided)/i,
  /sufficient information to (answer|provide|fulfill)/i,
];

function isAiRefusal(text: string): boolean {
  if (!text) return false;
  return AI_REFUSAL_PATTERNS.some((p) => p.test(text));
}

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

    // Resolve source_id: use document's source_id, or resolve from metadata
    let resolvedSourceId: string | null = document.source_id || null;
    if (!resolvedSourceId) {
      // For social media docs without source_id, resolve from source type
      const sourceType = document.metadata?.source_type;
      if (sourceType === 'social_media') {
        const { data: socialSource } = await supabase
          .from('sources')
          .select('id')
          .eq('name', 'Social Media Monitoring')
          .single();
        resolvedSourceId = socialSource?.id || null;
      } else if (sourceType === 'rss') {
        const { data: rssSource } = await supabase
          .from('sources')
          .select('id')
          .eq('name', 'RSS Sources (Aggregated)')
          .single();
        resolvedSourceId = rssSource?.id || null;
      } else if (sourceType === 'news') {
        const { data: newsSource } = await supabase
          .from('sources')
          .select('id')
          .eq('name', 'News Monitor')
          .single();
        resolvedSourceId = newsSource?.id || null;
      }
      if (resolvedSourceId) {
        console.log(`[SourceResolve] Resolved source_id from metadata: ${resolvedSourceId} (${sourceType})`);
      }
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

    // Build concise rejection reason summaries from feedback
    let feedbackRejectionContext = '';
    try {
      const { data: recentRejections } = await supabase
        .from('feedback_events')
        .select('notes, feedback_context')
        .eq('object_type', 'signal')
        .eq('feedback', 'irrelevant')
        .order('created_at', { ascending: false })
        .limit(30);

      if (recentRejections && recentRejections.length > 0) {
        const reasons = new Map<string, number>();
        const rejectedTitles: string[] = [];
        recentRejections.forEach(r => {
          const ctx = r.feedback_context as Record<string, string> | null;
          const reason = ctx?.reason_label || ctx?.reason || '';
          if (reason) reasons.set(reason, (reasons.get(reason) || 0) + 1);
          if (r.notes) rejectedTitles.push(r.notes.substring(0, 80));
        });
        const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        feedbackRejectionContext = `
ANALYST FEEDBACK — RECENTLY REJECTED SIGNALS (DO NOT create similar signals):
Top rejection reasons: ${topReasons.map(([r, c]) => `"${r}" (${c}x)`).join(', ')}
Examples of rejected signals: ${rejectedTitles.slice(0, 8).join(' | ')}
`;
      }
    } catch { /* non-critical */ }

    const learningContext = `
APPROVED PATTERNS (prioritize these):
${JSON.stringify(approvedPatterns?.features || {}, null, 2)}

REJECTED PATTERNS (avoid these):
${JSON.stringify(rejectedPatterns?.features || {}, null, 2)}

${feedbackRejectionContext}
`;

    // Call AI for extraction via resilient gateway
    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
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

**CRITICAL SOURCE-FIDELITY RULES:**
8. The source text you receive is often a SEARCH ENGINE SNIPPET — a short, fragmented excerpt. DO NOT construct a detailed narrative from fragments. If the text is under 200 characters, your signal description should be equally brief and hedged (e.g., "A search result mentions X in context of Y").
9. CHECK THE SOURCE URL DOMAIN. If the URL contains a non-Canadian location (e.g., "maribyrnong", "OtagoDailyTimes", "NetflixUKandIreland"), the content is likely NOT about Canadian events — set relevance_score to 0.1 or lower.
10. If the URL locale is non-English/non-Canadian (e.g., "locale=ro_RO"), treat it as geographically irrelevant.
11. DO NOT upgrade fragmentary snippets into urgent-sounding intelligence. A snippet saying "counter-protest" in passing does NOT mean "a counter-protest is being planned."
12. If you cannot verify the WHO, WHAT, WHEN, WHERE from the source text alone, set relevance_score below 0.3 and mark is_historical_content as true.
13. Netflix documentaries, webinars, books, and educational content are NOT security threats — skip them entirely or set relevance_score to 0.1.

**GEOGRAPHIC RELEVANCE RULES:**
14. Only create signals that are geographically relevant to the client's area of operations (NE British Columbia, pipeline corridors, LNG terminals) — OR that represent a relevant threat pattern (see rule 14a).
14a. EXCEPTION — THREAT PATTERN SIGNALS: If an event involves sabotage, vandalism, arson, physical attack, or activist/protest action against similar infrastructure (pipelines, LNG terminals, energy facilities, rail lines) ANYWHERE in the world, create a signal even if geographically distant. These are relevant threat intelligence — they demonstrate tactics, techniques, and precedents that could be replicated against the client's assets. Mark these as signal_type "sabotage", "threat", or "protest" as appropriate.
15. DO NOT create signals about unrelated events in distant locations (e.g., a car accident in Halifax, a political election in Quebec) unless they DIRECTLY impact the client's infrastructure, supply chain, or named stakeholders.
16. National policy/regulatory signals are acceptable only if they explicitly mention the client, their projects, or their region
17. CHECK THE URL DOMAIN for geographic cues — "OtagoDailyTimes" = New Zealand, "maribyrnong" = Australia, "culturalsurvival" = international NGO. These are almost never relevant.

**QUALITY RULES:**
18. Do NOT create signals for general government programs, worker safety policies, or agricultural programs unless they specifically impact the client
19. Do NOT create signals for wildlife/health events unless they directly threaten operations in the client's operating area
20. Give a relevance_score of 0.3 or lower to signals that are tangentially related
21. Do NOT create signals from Netflix/streaming content, webinars, book promotions, or educational resources
12. Do NOT create signals for wildlife/health events unless they directly threaten operations in the client's operating area
13. Give a relevance_score of 0.3 or lower to signals that are tangentially related

KNOWN ENTITIES (for reference only):
${entityContext}

**CRITICAL ENTITY RULE: Only add an entity to related_entity_names if that person's or organization's name (or a known alias) LITERALLY APPEARS in the source text. Do NOT infer, assume, or guess that a document is "about" an entity just because it was found via a search for them. The text must explicitly contain their name.**

${learningContext}

Extract entities, signals, and entity mentions from documents.`
        },
        {
          role: 'user',
          content: `Analyze this document and extract intelligence:

SOURCE URL: ${document.source_url || document.metadata?.url || 'unknown'}
SOURCE DOMAIN: ${(() => { try { return new URL(document.source_url || document.metadata?.url || '').hostname; } catch { return 'unknown'; } })()}
TITLE: ${document.title}
TEXT LENGTH: ${(document.raw_text || '').length} characters
TEXT: ${(document.raw_text || '').substring(0, 80000)}

IMPORTANT: Cross-check the SOURCE URL DOMAIN against the content. If the domain suggests a non-Canadian source (e.g., OtagoDailyTimes = New Zealand, maribyrnong = Australia, Netflix = entertainment), set relevance_score very low. If TEXT LENGTH is under 200, the source is a search snippet — be conservative and brief in your description. Extract all entities, signals, and their relationships.`
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
      try { // ← per-signal isolation: a crash here skips THIS signal, not all remaining ones
      // HARD RELEVANCE GATE: Skip signals the AI scored below 0.3
      if ((signal.relevance_score || 0) < 0.3) {
        console.log(`[RelevanceGate] Skipping low-relevance signal (${signal.relevance_score}): ${signal.title}`);
        continue;
      }
      
      // REFUSAL GATE: Skip if the AI returned a refusal message instead of real content
      if (isAiRefusal(signal.title) || isAiRefusal(signal.description)) {
        console.log(`[RefusalGate] Skipping AI refusal signal: ${(signal.title || '').slice(0, 80)}`);
        continue;
      }

      // HARD HISTORICAL GATE: Skip signals explicitly marked as historical
      if (signal.is_historical_content === true && (signal.relevance_score || 0) < 0.6) {
        console.log(`[HistoricalGate] Skipping historical signal: ${signal.title}`);
        continue;
      }
      // FIX 3: Generate content hash based on SOURCE URL only (when available) for deduplication
      // AI paraphrases title/description each run, so we hash on the stable source URL.
      // Fallback to title+description only when no source URL exists.
      const sourceUrl = document.metadata?.url || document.source_url || '';
      const contentToHash = sourceUrl
        ? `url:${sourceUrl}`
        : `content:${(signal.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(signal.description || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(contentToHash);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Create signal for each matched client
      for (const clientMatch of clientMatches) {
        try { // ← per-client isolation: a crash here skips THIS client, not remaining clients
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
        
        // Simple similarity check - if any recent signal contains 60% of the same words, skip
        // Lowered from 80% to catch AI-paraphrased duplicates of the same story
        let isNearDuplicate = false;
        if (recentSignals && recentSignals.length > 0) {
          const signalWords = new Set((signal.description || '').toLowerCase().split(/\s+/).filter(w => w.length > 3));
          for (const existing of recentSignals) {
            if (!existing.normalized_text) continue;
            const existingWords = new Set(existing.normalized_text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
            const intersection = new Set([...signalWords].filter(w => existingWords.has(w)));
            const similarity = intersection.size / Math.min(signalWords.size, existingWords.size);
            
            if (similarity > 0.6) {
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
        // Check post_date, then metadata.published_date (from RSS pubDate), then content extraction
        const metaPubDate = document.metadata?.published_date || document.metadata?.pubDate;
        let eventDate = document.post_date 
          ? new Date(document.post_date)
          : metaPubDate
            ? (() => { try { const d = new Date(metaPubDate); return isNaN(d.getTime()) ? null : d; } catch { return null; } })()
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
        
        // Map signal_type to category so both fields are populated
        const signalTypeToCategory: Record<string, string> = {
          theft: 'active_threat', protest: 'protest', threat: 'active_threat',
          surveillance: 'cybersecurity', sabotage: 'active_threat', violence: 'active_threat',
          cyber: 'cybersecurity', data_exposure: 'cybersecurity',
          wildlife: 'environmental', wildfire: 'civil_emergency', weather: 'civil_emergency',
          health: 'health_concern', regulatory: 'regulatory', legal: 'regulatory',
          operational: 'operational', media: 'social_sentiment', reputational: 'social_sentiment',
          environmental: 'environmental', community_impact: 'social_sentiment',
        };
        const derivedCategory = signalTypeToCategory[signal.signal_type] || 'general';

        const { data: newSignal, error: signalError } = await supabase
          .from('signals')
          .insert({
            source_id: resolvedSourceId,
            title: signal.title,
            description: signal.description,
            signal_type: signal.signal_type,
            category: derivedCategory,
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
            source_url: sourceUrl || null,
            image_url: document.metadata?.image_url || null,
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

          // If this document came from an entity scan, create an entity_mention
          // with mention_text='entity_scan' so the signal appears on the entity's
          // page even when their name isn't explicitly in the content.
          if (sourceEntityId) {
            await supabase.from('entity_mentions').insert({
              entity_id: sourceEntityId,
              signal_id: newSignal.id,
              confidence: 0.7,
              mention_text: 'entity_scan',
            }).catch(() => {}); // non-fatal if duplicate
          }
          
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

          // Run entity correlation on the document content so new entities (e.g. "Eavor Technologies")
          // get surfaced as suggestions even when discovered via a social/entity scan path.
          try {
            const correlationText = [document.raw_text, document.post_caption, signal.description]
              .filter(Boolean).join('\n\n');
            if (correlationText.trim().length > 20) {
              supabase.functions.invoke('correlate-entities', {
                body: {
                  text: correlationText,
                  sourceType: 'signal',
                  sourceId: newSignal.id,
                  autoApprove: false,
                }
              }).catch(err => console.error('[ProcessDoc] Entity correlation error:', err));
            }
          } catch (corrErr) {
            console.error('[ProcessDoc] Entity correlation setup error:', corrErr);
          }

          // Watch list check — boost severity if any extracted entities are being watched
          const watchEntityNames = signal.related_entity_names || [];
          let finalSeverityScore = signal.severity_score;
          if (watchEntityNames.length > 0) {
            try {
              const watchHits = await checkWatchListHits(supabase, watchEntityNames, clientMatch.clientId);
              if (watchHits.length > 0) {
                finalSeverityScore = await applyWatchListBoosts(supabase, newSignal.id, watchHits, signal.severity_score);
              }
            } catch (watchErr) {
              console.error('[WatchList] Check failed (non-critical):', watchErr);
            }
          }

          // Auto-escalation (use boosted score)
          if (finalSeverityScore >= 80) {
            await supabase.functions.invoke('check-incident-escalation', {
              body: { signalId: newSignal.id }
            });
          }
        } // closes if (!signalError && newSignal)
        } catch (clientErr) {
          console.error(`[ProcessDoc] Failed to create signal for client ${clientMatch.clientName}:`, clientErr);
          results.errors = (results.errors || 0) + 1;
        }
      } // closes for (const clientMatch of clientMatches)
      } catch (signalErr) {
        console.error(`[ProcessDoc] Failed to process signal "${signal.title?.slice(0, 60)}":`, signalErr);
        results.errors = (results.errors || 0) + 1;
      }
    } // closes for (const signal of intelligence.signals)

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