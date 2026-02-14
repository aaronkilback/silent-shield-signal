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

// Custom error to signal rate limit bail-out
class RateLimitError extends Error {
  constructor() { super('Google API rate limited'); this.name = 'RateLimitError'; }
}

// Activism and protest-related keywords
const ACTIVISM_KEYWORDS = [
  'protest', 'pipeline', 'activist', 'demonstration', 'blockade',
  'environmental', 'climate', 'indigenous rights', 'first nation',
  'stop', 'oppose', 'rally', 'march', 'occupation', 'resistance',
  'campaign', 'PRGT', 'LNG', 'Coastal GasLink', 'CGL',
  'facebook live', 'going live', 'live now', 'live video', 'streaming live',
  'watch live', 'live broadcast', 'live stream'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('Starting Facebook monitoring scan...');

    // Fetch clients with monitoring keywords
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry, monitoring_keywords, locations');

    if (clientsError) throw clientsError;

    // Fetch entities with active monitoring and facebook handles
    const { data: watchedEntities, error: entitiesError } = await supabase
      .from('entities')
      .select('id, name, type, aliases, risk_level, attributes, active_monitoring_enabled')
      .eq('active_monitoring_enabled', true);

    if (entitiesError) {
      console.error('Error fetching entities:', entitiesError);
    }

    console.log(`Monitoring Facebook for ${clients?.length || 0} clients and ${watchedEntities?.length || 0} watched entities`);

    // Filter entities that have facebook handles
    const facebookEntities = (watchedEntities || []).filter(e => 
      e.attributes?.facebook_page || 
      e.attributes?.facebook_handle
    );

    let signalsCreated = 0;
    let mediaCaptures = 0;
    let totalSearches = 0;
    const processedUrls = new Set<string>();

    // PART 1: Client-focused searches
    for (const client of clients || []) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        
        const searchQueries: string[] = [];
        
        // Client name + activism/protest terms
        searchQueries.push(`site:facebook.com "${client.name}" (protest OR pipeline OR activist OR blockade OR demonstration)`);
        
        // Client name + Facebook Live streams
        searchQueries.push(`site:facebook.com "${client.name}" ("facebook live" OR "going live" OR "live video" OR "streaming live")`);
        
        // Client name + security threats
        searchQueries.push(`site:facebook.com "${client.name}" (breach OR hack OR security OR scam OR threat)`);
        
        // Use client's monitoring keywords
        const clientKeywords = client.monitoring_keywords || [];
        const priorityKeywords = clientKeywords.filter((k: string) => 
          k.toLowerCase().includes('pipeline') || 
          k.toLowerCase().includes('lng') || 
          k.toLowerCase().includes('first nation')
        );
        
        if (priorityKeywords.length > 0) {
          const keywordTerms = priorityKeywords.slice(0, 3).map((k: string) => `"${k}"`).join(' OR ');
          searchQueries.push(`site:facebook.com (protest OR activist) (${keywordTerms})`);
        }

        for (const query of searchQueries) {
          totalSearches++;
          const result = await processSearch(supabase, query, client.id, client.name, 'client', processedUrls);
          signalsCreated += result.signals;
          mediaCaptures += result.media;
        }

        console.log(`Processed Facebook mentions for ${client.name}`);

      } catch (error) {
        if (error instanceof RateLimitError) {
          console.log('Rate limited — stopping all Facebook searches early');
          break;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Facebook search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring Facebook for ${client.name}:`, error);
        }
      }
    }

    // PART 2: Entity-focused searches - ALL monitored entities (not just those with FB handles)
    const allMonitoredEntities = watchedEntities || [];
    
    for (const entity of allMonitoredEntities) {
      try {
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1500));
        
        const searchQueries: string[] = [];
        const fbPage = entity.attributes?.facebook_page || entity.attributes?.facebook_handle;
        
        // If entity has a Facebook handle, search that directly
        if (fbPage) {
          searchQueries.push(`site:facebook.com/${fbPage}`);
          searchQueries.push(`site:facebook.com/${fbPage}/posts`);
        }
        
        // Skip broad name-only searches for short entity names (<=4 chars)
        // to prevent disambiguation failures (e.g., "CGL" matching unrelated pages)
        const isShortName = entity.name.length <= 4;
        
        if (!isShortName) {
          // ALWAYS search by entity name on Facebook (primary search)
          searchQueries.push(`site:facebook.com "${entity.name}"`);
        }
        
        // Entity name + pipeline/energy project terms for more targeted results
        searchQueries.push(`site:facebook.com "${entity.name}" (pipeline OR LNG OR "Coastal GasLink" OR PRGT OR protest OR indigenous)`);
        
        // Entity name + Facebook Live streams (only for longer names)
        if (!isShortName) {
          searchQueries.push(`site:facebook.com "${entity.name}" ("facebook live" OR "going live" OR "live video" OR "streaming")`);
        }
        
        // Include aliases in search — SKIP short aliases (<=4 chars)
        if (entity.aliases && entity.aliases.length > 0) {
          const usableAliases = entity.aliases.filter((a: string) => a.length > 4);
          for (const alias of usableAliases.slice(0, 3)) {
            searchQueries.push(`site:facebook.com "${alias}"`);
          }
        }

        for (const query of searchQueries) {
          totalSearches++;
          const result = await processSearch(supabase, query, null, entity.name, 'entity', processedUrls, entity.id);
          signalsCreated += result.signals;
          mediaCaptures += result.media;
        }

        console.log(`Processed Facebook mentions for entity: ${entity.name}`);

      } catch (error) {
        console.error(`Error monitoring Facebook for entity ${entity.name}:`, error);
      }
    }

    console.log(`Facebook monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals. Captured ${mediaCaptures} media files.`);

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      entities_scanned: allMonitoredEntities.length,
      searches_executed: totalSearches,
      signals_created: signalsCreated,
      media_captured: mediaCaptures,
      source: 'facebook'
    });

  } catch (error) {
    console.error('Error in Facebook monitoring:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function processSearch(
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
    console.log(`Facebook search: ${query.substring(0, 80)}...`);
    
    // Use Google Custom Search API instead of raw scraping
    const apiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const engineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!apiKey || !engineId) {
      console.log('Google Search API not configured, skipping');
      return { signals: 0, media: 0 };
    }

    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(query)}&num=5`;
    
    const response = await fetch(apiUrl, {
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const status = response.status;
      console.log(`Facebook search failed: ${status}`);
      if (status === 429) {
        console.log('Google API rate limited — ending Facebook scan early');
        // Signal caller to stop all further searches
        throw new RateLimitError();
      }
      return { signals: 0, media: 0 };
    }

    const data = await response.json();
    const items = data.items || [];
    
    // Process API results instead of scraping HTML
    const resultTexts: { text: string; url: string | null }[] = items.map((item: any) => ({
      text: `${item.title || ''} ${item.snippet || ''}`.trim(),
      url: item.link || null,
    }));

    for (const result of resultTexts.slice(0, 5)) {
      const text = result.text;
      const facebookUrl = result.url;

      // Skip duplicates
      if (facebookUrl && processedUrls.has(facebookUrl)) continue;
      if (facebookUrl) processedUrls.add(facebookUrl);

      // Extract social media metadata
      const mentions = extractMentions(text);
      const hashtags = extractHashtags(text);
      const engagement = parseEngagement(text);
      const postType = detectPostType(facebookUrl || '', text);
      const eventDetails = extractEventDetails(text);
      const authorHandle = extractAuthorFromUrl(facebookUrl || '', 'facebook');

      // Check for relevance
      const lowerText = text.toLowerCase();
      const sourceNameLower = sourceName.toLowerCase();
      
      // ═══ DISAMBIGUATION GATE ═══
      // For short entity names (<=4 chars), require BOTH the name AND a contextual keyword
      // to prevent false matches (e.g., "CGL" matching drug support centers or miniature gaming)
      const isShortSourceName = sourceNameLower.length <= 4;
      let nameAppearsInContext = lowerText.includes(sourceNameLower);
      
      if (isShortSourceName && nameAppearsInContext) {
        // Short names must appear with at least one activism/pipeline keyword
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

      if (text.length > 30 && isRelevant) {
        // Check for duplicates in DB
        const { data: existing } = await supabase
          .from('ingested_documents')
          .select('id')
          .eq('metadata->>source', 'facebook')
          .ilike('raw_text', `%${text.substring(0, 50)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          console.log('Skipping duplicate Facebook content');
          continue;
        }

        // Determine category
        let category = 'social_media';
        if (lowerText.includes('facebook live') || lowerText.includes('going live') || lowerText.includes('live video') || lowerText.includes('streaming live')) {
          category = 'live_stream';
        } else if (lowerText.includes('protest') || lowerText.includes('blockade') || lowerText.includes('demonstration')) {
          category = 'protest_activity';
        } else if (ACTIVISM_KEYWORDS.some(k => lowerText.includes(k.toLowerCase()))) {
          category = 'activism';
        }

        // Capture media from the content
        const mediaResult = await captureMediaFromContent(supabase, text, 'facebook', 5);
        if (mediaResult.storedMedia.length > 0) {
          mediaCount += mediaResult.storedMedia.length;
        }

        // Create ingested document with full social media data
        const { data: doc, error: docError } = await supabase
          .from('ingested_documents')
          .insert({
            title: `Facebook ${postType}: ${sourceName}`,
            raw_text: text,
            source_url: facebookUrl,
            post_caption: text,
            author_handle: authorHandle,
            author_name: sourceName,
            mentions: mentions,
            hashtags: hashtags,
            engagement_metrics: engagement,
            media_urls: mediaResult.storedMedia.map((m: any) => m.storageUrl),
            thumbnail_url: mediaResult.storedMedia[0]?.storageUrl || null,
            metadata: {
              source: 'facebook',
              source_type: 'social_media',
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
          console.log(`Ingested Facebook ${category}: ${sourceName} - ${text.substring(0, 60)}... (${mediaResult.storedMedia.length} media)`);
        }
      }
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error; // Propagate to caller
    }
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`Facebook search timeout`);
    } else {
      throw error;
    }
  }

  return { signals: signalsCreated, media: mediaCount };
}
