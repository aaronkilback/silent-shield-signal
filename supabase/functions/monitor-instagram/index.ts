import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { 
  extractMediaUrls, 
  downloadAndStoreMedia, 
  createMediaAttachments,
  detectMediaType 
} from '../_shared/media-capture.ts';
import {
  extractMentions,
  extractHashtags,
  extractEventDetails,
  parseEngagement,
  isHighPriorityContent,
  detectPostType
} from '../_shared/social-media-parser.ts';

// Activism and protest-related keywords to monitor
// HIGH-SPECIFICITY keywords that indicate actionable intelligence
// Generic terms like 'pipeline', 'LNG', 'protest' alone cause too many false positives
// They match content about completely unrelated pipelines, LNG projects, and protests worldwide
const ACTIVISM_KEYWORDS = [
  'Coastal GasLink', 'CGL pipeline', 'PRGT', 'Wet\'suwet\'en', 'Gidimt\'en',
  'Unist\'ot\'en', 'Petronas Canada', 'LNG Canada', 'Cedar LNG',
  'Ksi Lisims', 'Prince Rupert Gas', 'TC Energy pipeline',
  'stand.earth', 'standearth', 'Dogwood BC', 'Dogwood Initiative',
  'BC Counter Info', 'Frack Free BC', 'pipeline blockade',
  'pipeline sabotage', 'pipeline protest', 'LNG protest', 'LNG blockade',
  'indigenous pipeline', 'first nation pipeline'
];

// Custom error to signal rate limit bail-out
class RateLimitError extends Error {
  constructor() { super('Google API rate limited'); this.name = 'RateLimitError'; }
}

// Known activist organizations targeting energy sector
const ACTIVIST_ORGANIZATIONS = [
  'Stand.earth', 'Greenpeace', 'Sierra Club', '350.org', 'Extinction Rebellion',
  'Indigenous Environmental Network', 'Idle No More', 'Rainforest Action Network',
  'Oil Change International', 'RAVEN Trust', 'Dogwood Initiative',
  'Wilderness Committee', 'EcoJustice', 'Pembina Institute'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('Starting Instagram monitoring scan...');

    // Fetch clients with their monitoring keywords
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry, monitoring_keywords, locations');

    if (clientsError) throw clientsError;

    // Fetch high-risk/monitored entities WITH Instagram handles
    const { data: watchedEntities, error: entitiesError } = await supabase
      .from('entities')
      .select('id, name, type, aliases, risk_level, attributes')
      .eq('active_monitoring_enabled', true)
      .in('type', ['organization', 'person']);

    if (entitiesError) {
      console.error('Error fetching entities:', entitiesError);
    }

    // Extract entities with Instagram handles for profile-based monitoring
    const entitiesWithInstagram = (watchedEntities || []).filter(e => 
      e.attributes?.instagram_handle || 
      e.aliases?.some((a: string) => a.startsWith('@'))
    );

    console.log(`Monitoring Instagram for ${clients?.length || 0} clients, ${watchedEntities?.length || 0} watched entities (${entitiesWithInstagram.length} with Instagram profiles)`);

    let signalsCreated = 0;
    let totalSearches = 0;
    let mediaDownloaded = 0;
    const processedUrls = new Set<string>();

    // ═══ SEARCH BUDGET ═══
    // Cap total Google API calls to prevent Gateway Timeouts
    const MAX_SEARCHES = 12;
    let searchBudgetRemaining = MAX_SEARCHES;

    // PART 1: Client-focused searches (max 1 combined query per client)
    for (const client of clients || []) {
      if (searchBudgetRemaining <= 0) {
        console.log('Search budget exhausted — stopping client searches');
        break;
      }
      try {
        // Single combined query per client
        const query = `site:instagram.com "${client.name}" (protest OR blockade OR activist OR hack OR breach)`;
        totalSearches++;
        searchBudgetRemaining--;
        await processSearch(supabase, query, client.id, client.name, 'client', processedUrls, (count) => signalsCreated += count, (count) => mediaDownloaded += count);

        console.log(`Processed Instagram mentions for ${client.name}`);

      } catch (error) {
        if (error instanceof RateLimitError) {
          console.log('Rate limited — stopping all Instagram searches early');
          break;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Instagram search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring Instagram for ${client.name}:`, error);
        }
      }
    }

    // PART 2: Entity-focused searches (max 1 query per entity, prioritize handles)
    // Sort: entities with Instagram handles first
    const sortedEntities = [...(watchedEntities || [])].sort((a, b) => {
      const aHas = a.attributes?.instagram_handle || a.aliases?.some((al: string) => al.startsWith('@')) ? 1 : 0;
      const bHas = b.attributes?.instagram_handle || b.aliases?.some((al: string) => al.startsWith('@')) ? 1 : 0;
      return bHas - aHas;
    });

    for (const entity of sortedEntities) {
      if (searchBudgetRemaining <= 0) {
        console.log('Search budget exhausted — stopping entity searches');
        break;
      }
      try {
        const instagramHandle = entity.attributes?.instagram_handle || 
          entity.aliases?.find((a: string) => a.startsWith('@'));
        
        // Single targeted query per entity
        let query: string;
        if (instagramHandle) {
          const cleanHandle = instagramHandle.replace('@', '');
          query = `site:instagram.com/${cleanHandle}`;
          console.log(`Direct profile monitoring for @${cleanHandle}`);
        } else {
          query = `site:instagram.com "${entity.name}" (pipeline OR LNG OR protest OR blockade)`;
        }

        totalSearches++;
        searchBudgetRemaining--;
        await processSearch(supabase, query, null, entity.name, 'entity', processedUrls, (count) => signalsCreated += count, (count) => mediaDownloaded += count, entity.id);

        console.log(`Processed Instagram mentions for entity: ${entity.name}`);

      } catch (error) {
        if (error instanceof RateLimitError) {
          console.log('Rate limited — stopping all Instagram searches');
          break;
        }
        console.error(`Error monitoring Instagram for entity ${entity.name}:`, error);
      }
    }

    console.log(`Instagram monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals. Downloaded ${mediaDownloaded} media files.`);

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      entities_scanned: watchedEntities?.length || 0,
      searches_executed: totalSearches,
      signals_created: signalsCreated,
      media_downloaded: mediaDownloaded,
      source: 'instagram'
    });

  } catch (error) {
    console.error('Error in Instagram monitoring:', error);
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
  onSignalCreated: (count: number) => void,
  onMediaDownloaded: (count: number) => void,
  entityId?: string
) {
  // Rate limiting between searches
  await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    console.log(`Instagram search: ${query.substring(0, 80)}...`);
    
    // Use Google Custom Search API instead of raw scraping
    const apiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const engineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!apiKey || !engineId) {
      console.log('Google Search API not configured, skipping');
      return;
    }

    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(query)}&num=5`;
    
    const response = await fetch(apiUrl, {
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const status = response.status;
      console.log(`Instagram search failed: ${status}`);
      if (status === 429) {
        console.log('Google API rate limited — ending Instagram scan early');
        throw new RateLimitError();
      }
      return;
    }

    const data = await response.json();
    const items = data.items || [];

    // Extract Instagram URLs from API results
    const instagramUrls: string[] = [];
    for (const item of items) {
      const link = item.link || '';
      if (link.match(/instagram\.com\/(p|reel|tv)\//)) {
        if (!instagramUrls.includes(link) && !processedUrls.has(link)) {
          instagramUrls.push(link);
        }
      }
    }

    console.log(`Found ${instagramUrls.length} Instagram URLs to process`);

    // Process each Instagram URL
    for (const instagramUrl of instagramUrls.slice(0, 5)) {
      processedUrls.add(instagramUrl);
      
      try {
        // Extract content from API result context
        const matchingItem = items.find((item: any) => item.link === instagramUrl);
        const urlContext = matchingItem 
          ? `${matchingItem.title || ''} ${matchingItem.snippet || ''}`.trim()
          : '';
        
        if (!urlContext || urlContext.length < 30) {
          console.log(`No content extracted from ${instagramUrl}`);
          continue;
        }

        // Check for relevance
        const lowerCaption = urlContext.toLowerCase();
        const isRelevant = 
          ACTIVISM_KEYWORDS.some(k => lowerCaption.includes(k.toLowerCase())) ||
          ACTIVIST_ORGANIZATIONS.some(org => lowerCaption.includes(org.toLowerCase())) ||
          lowerCaption.includes(sourceName.toLowerCase());

        if (!isRelevant) {
          console.log(`Content not relevant, skipping`);
          continue;
        }

        // Check for duplicates
        const { data: existing } = await supabase
          .from('ingested_documents')
          .select('id')
          .eq('source_url', instagramUrl)
          .limit(1);

        if (existing && existing.length > 0) {
          console.log('Skipping duplicate Instagram post');
          continue;
        }

        // Extract structured data
        const mentions = extractMentions(urlContext);
        const hashtags = extractHashtags(urlContext);
        const eventDetails = extractEventDetails(urlContext);
        const isHighPriority = isHighPriorityContent(urlContext);
        const postType = detectPostType(instagramUrl, urlContext);

        // Determine category
        let category = 'social_media';
        if (lowerCaption.includes('protest') || lowerCaption.includes('blockade') || lowerCaption.includes('demonstration')) {
          category = 'protest_activity';
        } else if (ACTIVISM_KEYWORDS.some(k => lowerCaption.includes(k.toLowerCase()))) {
          category = 'activism';
        }

        // Create ingested document
        const { data: doc, error: docError } = await supabase
          .from('ingested_documents')
          .insert({
            title: `Instagram ${postType}: ${sourceName}`,
            raw_text: urlContext,
            source_url: instagramUrl,
            post_caption: urlContext,
            author_name: sourceName,
            mentions: mentions,
            hashtags: hashtags,
            media_type: postType,
            metadata: {
              source: 'instagram',
              source_type: 'social_media',
              client_id: clientId,
              entity_id: entityId,
              source_name: sourceName,
              search_type: sourceType,
              search_query: query,
              category: category,
              is_high_priority: isHighPriority,
              event_details: eventDetails,
              detected_keywords: ACTIVISM_KEYWORDS.filter(k => lowerCaption.includes(k.toLowerCase())),
              detected_organizations: ACTIVIST_ORGANIZATIONS.filter(org => lowerCaption.includes(org.toLowerCase())),
              mentioned_accounts: mentions,
              hashtag_count: hashtags.length
            }
          })
          .select()
          .single();

        if (!docError && doc) {
          // Link to entity
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
          
          onSignalCreated(1);
          console.log(`✓ Ingested Instagram ${postType}: ${sourceName} - "${urlContext.substring(0, 80)}..."`);
        }

      } catch (postError) {
        console.error(`Error processing Instagram post ${instagramUrl}:`, postError);
      }

      // Small delay between posts
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error; // Propagate to caller
    }
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`Instagram search timeout`);
    } else {
      throw error;
    }
  }
}

// extractUrlContext removed — API returns structured data directly
