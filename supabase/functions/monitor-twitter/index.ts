import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { captureMediaFromContent, createMediaAttachments } from '../_shared/media-capture.ts';
import { 
  extractMentions, 
  extractHashtags, 
  parseEngagement,
  isHighPriorityContent,
  detectPostType,
  extractEventDetails,
  extractAuthorFromUrl 
} from '../_shared/social-media-parser.ts';

// Activism and threat-related keywords
const ACTIVISM_KEYWORDS = [
  'protest', 'pipeline', 'activist', 'demonstration', 'blockade',
  'environmental', 'climate', 'indigenous rights', 'first nation',
  'stop', 'oppose', 'rally', 'march', 'occupation', 'resistance',
  'campaign', 'PRGT', 'LNG', 'Coastal GasLink', 'CGL', 'shutdown',
  'strike', 'boycott', 'divest', 'fossil fuel', 'tar sands'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('Starting Twitter/X monitoring scan...');

    // Fetch clients with monitoring keywords
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry, monitoring_keywords, locations');

    if (clientsError) throw clientsError;

    // Fetch entities with active monitoring and twitter handles
    const { data: watchedEntities, error: entitiesError } = await supabase
      .from('entities')
      .select('id, name, type, aliases, risk_level, attributes, active_monitoring_enabled')
      .eq('active_monitoring_enabled', true);

    if (entitiesError) {
      console.error('Error fetching entities:', entitiesError);
    }

    // Filter entities that have twitter handles
    const twitterEntities = (watchedEntities || []).filter(e => 
      e.attributes?.twitter_handle || 
      e.attributes?.x_handle ||
      e.aliases?.some((a: string) => a.startsWith('@'))
    );

    console.log(`Monitoring Twitter/X for ${clients?.length || 0} clients and ${twitterEntities.length} entities with Twitter handles`);

    let signalsCreated = 0;
    let mediaCaptures = 0;
    let totalSearches = 0;
    const processedUrls = new Set<string>();

    // PART 1: Entity-focused searches (activist groups with Twitter presence)
    for (const entity of twitterEntities) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        
        const searchQueries: string[] = [];
        const twitterHandle = entity.attributes?.twitter_handle || 
                              entity.attributes?.x_handle ||
                              entity.aliases?.find((a: string) => a.startsWith('@'));
        
        if (twitterHandle) {
          const cleanHandle = twitterHandle.replace('@', '');
          
          // Direct profile search on X/Twitter
          searchQueries.push(`site:x.com/${cleanHandle}`);
          searchQueries.push(`site:twitter.com/${cleanHandle}`);
          
          // Entity's recent tweets with media
          searchQueries.push(`site:x.com from:${cleanHandle} (pic OR video OR photo)`);
          
          // Entity + relevant topics
          const focusAreas = entity.attributes?.focus_areas || [];
          if (focusAreas.length > 0) {
            const topics = focusAreas.slice(0, 2).join(' OR ');
            searchQueries.push(`site:x.com "${entity.name}" (${topics})`);
          }
        }
        
        // Entity name searches
        searchQueries.push(`site:x.com "${entity.name}" (protest OR action OR pipeline OR LNG)`);

        for (const query of searchQueries) {
          totalSearches++;
          const result = await processTwitterSearch(
            supabase, query, null, entity.name, 'entity', processedUrls, entity.id
          );
          signalsCreated += result.signals;
          mediaCaptures += result.media;
        }

        console.log(`Processed Twitter/X for entity: ${entity.name}`);

      } catch (error) {
        console.error(`Error monitoring Twitter/X for entity ${entity.name}:`, error);
      }
    }

    // PART 2: Client-focused searches
    for (const client of clients || []) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        
        const searchQueries: string[] = [];
        
        // Client name + activism terms
        searchQueries.push(`site:x.com "${client.name}" (protest OR pipeline OR activist OR blockade)`);
        searchQueries.push(`site:twitter.com "${client.name}" (protest OR threat OR boycott)`);
        
        // Use client's monitoring keywords
        const clientKeywords = client.monitoring_keywords || [];
        const priorityKeywords = clientKeywords.filter((k: string) => 
          k.toLowerCase().includes('pipeline') || 
          k.toLowerCase().includes('lng') || 
          k.toLowerCase().includes('first nation')
        );
        
        if (priorityKeywords.length > 0) {
          const keywordTerms = priorityKeywords.slice(0, 3).map((k: string) => `"${k}"`).join(' OR ');
          searchQueries.push(`site:x.com (protest OR activist) (${keywordTerms})`);
        }

        for (const query of searchQueries) {
          totalSearches++;
          const result = await processTwitterSearch(
            supabase, query, client.id, client.name, 'client', processedUrls
          );
          signalsCreated += result.signals;
          mediaCaptures += result.media;
        }

        console.log(`Processed Twitter/X mentions for ${client.name}`);

      } catch (error) {
        console.error(`Error monitoring Twitter/X for ${client.name}:`, error);
      }
    }

    console.log(`Twitter/X monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals. Captured ${mediaCaptures} media files.`);

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      entities_scanned: twitterEntities.length,
      searches_executed: totalSearches,
      signals_created: signalsCreated,
      media_captured: mediaCaptures,
      source: 'twitter'
    });

  } catch (error) {
    console.error('Error in Twitter/X monitoring:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function processTwitterSearch(
  supabase: any,
  query: string,
  clientId: string | null,
  sourceName: string,
  sourceType: 'client' | 'entity',
  processedUrls: Set<string>,
  entityId?: string
): Promise<{ signals: number; media: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let signalsCreated = 0;
  let mediaCount = 0;

  try {
    console.log(`Twitter/X search: ${query.substring(0, 80)}...`);
    
    const response = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&num=15`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal
      }
    ).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      console.log(`Twitter/X search failed: ${response.status}`);
      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      return { signals: 0, media: 0 };
    }

    const html = await response.text();
    
    // Extract search results
    const resultMatches = html.matchAll(/<div class="g"[^>]*>(.*?)<\/div>/gs);
    const altMatches = html.matchAll(/href="(https?:\/\/(?:x|twitter)\.com\/[^"]+)"[^>]*>([^<]*)<\/a>/gs);

    const results: Array<{ url: string; text: string }> = [];

    // Parse main results
    for (const match of Array.from(resultMatches).slice(0, 10)) {
      const text = match[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[^;]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const urlMatch = text.match(/(x|twitter)\.com\/[^\s"'<>]+/);
      if (urlMatch) {
        results.push({
          url: `https://${urlMatch[0]}`,
          text
        });
      }
    }

    // Also capture from direct links
    for (const match of Array.from(altMatches).slice(0, 5)) {
      if (!results.some(r => r.url === match[1])) {
        results.push({
          url: match[1],
          text: match[2] || ''
        });
      }
    }

    for (const result of results) {
      const { url: twitterUrl, text } = result;

      // Skip duplicates
      if (processedUrls.has(twitterUrl)) continue;
      processedUrls.add(twitterUrl);

      // Extract social media metadata
      const mentions = extractMentions(text);
      const hashtags = extractHashtags(text);
      const engagement = parseEngagement(text);
      const postType = detectPostType(twitterUrl, text);
      const eventDetails = extractEventDetails(text);
      const authorHandle = extractAuthorFromUrl(twitterUrl, 'twitter');

      // Check for relevance
      const lowerText = text.toLowerCase();
      const sourceNameLower = sourceName.toLowerCase();
      
      // ═══ DISAMBIGUATION GATE ═══
      // For short entity names (<=4 chars), require contextual keywords
      const isShortSourceName = sourceNameLower.length <= 4;
      let nameAppearsInContext = lowerText.includes(sourceNameLower);
      
      if (isShortSourceName && nameAppearsInContext) {
        const contextualKeywords = ['pipeline', 'lng', 'gas', 'energy', 'protest', 'indigenous', 'first nation', 'coastal gaslink', 'prgt'];
        const hasContext = contextualKeywords.some(kw => lowerText.includes(kw));
        if (!hasContext) {
          console.log(`Skipping disambiguation failure for "${sourceName}": ${text.substring(0, 60)}`);
          nameAppearsInContext = false;
        }
      }
      
      const isRelevant = 
        ACTIVISM_KEYWORDS.some(k => lowerText.includes(k.toLowerCase())) ||
        nameAppearsInContext ||
        isHighPriorityContent(text);

      if (text.length > 20 && isRelevant) {
        // Check for duplicates in DB
        const { data: existing } = await supabase
          .from('ingested_documents')
          .select('id')
          .or(`source_url.eq.${twitterUrl},metadata->>source.eq.twitter`)
          .ilike('raw_text', `%${text.substring(0, 50)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          console.log('Skipping duplicate Twitter/X content');
          continue;
        }

        // Determine category
        let category = 'social_media';
        if (lowerText.includes('protest') || lowerText.includes('blockade') || lowerText.includes('demonstration')) {
          category = 'protest_activity';
        } else if (ACTIVISM_KEYWORDS.some(k => lowerText.includes(k.toLowerCase()))) {
          category = 'activism';
        } else if (lowerText.includes('threat') || lowerText.includes('warning')) {
          category = 'threat_indication';
        }

        // Capture media from the content
        const mediaResult = await captureMediaFromContent(supabase, text, 'twitter', 5);
        if (mediaResult.storedMedia.length > 0) {
          mediaCount += mediaResult.storedMedia.length;
        }

        // Create ingested document with full social media data
        const { data: doc, error: docError } = await supabase
          .from('ingested_documents')
          .insert({
            title: `Twitter/X ${postType}: ${sourceName}`,
            raw_text: text,
            source_url: twitterUrl,
            post_caption: text,
            author_handle: authorHandle,
            author_name: sourceName,
            mentions: mentions,
            hashtags: hashtags,
            engagement_metrics: engagement,
            media_urls: mediaResult.storedMedia.map((m: any) => m.storageUrl),
            thumbnail_url: mediaResult.storedMedia[0]?.storageUrl || null,
            metadata: {
              source: 'twitter',
              source_type: 'social_media',
              platform: twitterUrl.includes('x.com') ? 'x' : 'twitter',
              client_id: clientId,
              entity_id: entityId,
              source_name: sourceName,
              search_type: sourceType,
              search_query: query,
              category: category,
              post_type: postType,
              event_details: eventDetails,
              detected_keywords: ACTIVISM_KEYWORDS.filter(k => lowerText.includes(k.toLowerCase())),
              media_count: mediaResult.storedMedia.length
            }
          })
          .select()
          .single();

        if (!docError && doc) {
          // Create media attachments
          if (mediaResult.storedMedia.length > 0) {
            await createMediaAttachments(supabase, 'document', doc.id, mediaResult.storedMedia);
          }

          // Link to entity if applicable
          if (entityId) {
            await supabase
              .from('document_entity_mentions')
              .insert({
                document_id: doc.id,
                entity_id: entityId,
                confidence: 0.85,
                mention_text: sourceName
              });
          }

          // Invoke intelligence processing
          await supabase.functions.invoke('process-intelligence-document', {
            body: { documentId: doc.id }
          });
          signalsCreated++;
          console.log(`Ingested Twitter/X ${category}: ${sourceName} - ${text.substring(0, 60)}... (${mediaResult.storedMedia.length} media)`);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`Twitter/X search timeout`);
    } else {
      throw error;
    }
  }

  return { signals: signalsCreated, media: mediaCount };
}
