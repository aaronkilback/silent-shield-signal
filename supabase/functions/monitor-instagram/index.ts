import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Activism and protest-related keywords to monitor
const ACTIVISM_KEYWORDS = [
  'protest', 'pipeline', 'activist', 'demonstration', 'blockade',
  'environmental', 'climate', 'indigenous rights', 'first nation',
  'stand.earth', 'standearth', 'stop', 'oppose', 'rally', 'march',
  'occupation', 'resistance', 'campaign', 'PRGT', 'LNG', 'Coastal GasLink', 'CGL'
];

// Known activist organizations targeting energy sector
const ACTIVIST_ORGANIZATIONS = [
  'Stand.earth', 'Greenpeace', 'Sierra Club', '350.org', 'Extinction Rebellion',
  'Indigenous Environmental Network', 'Idle No More', 'Rainforest Action Network',
  'Oil Change International', 'RAVEN Trust', 'Dogwood Initiative',
  'Wilderness Committee', 'EcoJustice', 'Pembina Institute'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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

    // PART 1: Client-focused searches
    for (const client of clients || []) {
      try {
        const searchQueries: string[] = [];
        
        // Direct client name + activism/protest terms
        searchQueries.push(`site:instagram.com "${client.name}" (protest OR pipeline OR activist OR blockade OR demonstration OR environmental)`);
        
        // Client name + security threats
        searchQueries.push(`site:instagram.com "${client.name}" (hack OR scam OR fake OR phishing OR breach)`);
        
        // Search for known activist organizations mentioning client or related projects
        const orgSearchTerms = ACTIVIST_ORGANIZATIONS.slice(0, 5).map(org => `"${org}"`).join(' OR ');
        searchQueries.push(`site:instagram.com (${orgSearchTerms}) ("${client.name}" OR LNG OR pipeline)`);
        
        // Use client's monitoring keywords if available
        const clientKeywords = client.monitoring_keywords || [];
        const priorityKeywords = clientKeywords.filter((k: string) => 
          k.toLowerCase().includes('pipeline') || 
          k.toLowerCase().includes('lng') || 
          k.toLowerCase().includes('first nation') ||
          k.toLowerCase().includes('indigenous')
        );
        
        if (priorityKeywords.length > 0) {
          const keywordTerms = priorityKeywords.slice(0, 3).map((k: string) => `"${k}"`).join(' OR ');
          searchQueries.push(`site:instagram.com (protest OR activist OR stand.earth) (${keywordTerms})`);
        }
        
        // Specific search for PRGT/LNG Canada projects
        if (client.name.toLowerCase().includes('petronas') || client.industry?.toLowerCase().includes('energy')) {
          searchQueries.push(`site:instagram.com (stand.earth OR standearth) (PRGT OR "LNG Canada" OR "Pacific NorthWest" OR "Coastal GasLink")`);
        }

        for (const query of searchQueries) {
          totalSearches++;
          await processSearch(supabase, query, client.id, client.name, 'client', processedUrls, (count) => signalsCreated += count, (count) => mediaDownloaded += count);
        }

        console.log(`Processed Instagram mentions for ${client.name}`);

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Instagram search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring Instagram for ${client.name}:`, error);
        }
      }
    }

    // PART 2: Entity-focused searches (activist groups, threat actors, etc.)
    for (const entity of watchedEntities || []) {
      try {
        const searchQueries: string[] = [];
        
        // Get Instagram handle if available
        const instagramHandle = entity.attributes?.instagram_handle || 
          entity.aliases?.find((a: string) => a.startsWith('@'));
        
        // PRIORITY: Direct profile search if we have a handle
        if (instagramHandle) {
          const cleanHandle = instagramHandle.replace('@', '');
          // Search for recent posts from this specific profile
          searchQueries.push(`site:instagram.com/${cleanHandle}`);
          searchQueries.push(`site:instagram.com/reel "${cleanHandle}"`);
          searchQueries.push(`site:instagram.com/p "${cleanHandle}" (pipeline OR LNG OR protest OR blockade OR action)`);
          // Search for their tagged content
          searchQueries.push(`site:instagram.com "#${cleanHandle}" OR "@${cleanHandle}"`);
          console.log(`Direct profile monitoring for @${cleanHandle}`);
        }
        
        // Entity name + pipeline/energy project terms
        searchQueries.push(`site:instagram.com "${entity.name}" (pipeline OR LNG OR "Coastal GasLink" OR PRGT OR protest OR blockade)`);
        
        // Entity name + video/reel content (more likely to have protest footage)
        searchQueries.push(`site:instagram.com/reel "${entity.name}"`);
        searchQueries.push(`site:instagram.com/p "${entity.name}" (action OR campaign OR protest)`);
        
        // Include aliases in search
        if (entity.aliases && entity.aliases.length > 0) {
          for (const alias of entity.aliases.slice(0, 2)) {
            if (!alias.startsWith('@')) { // Skip handles, already covered
              searchQueries.push(`site:instagram.com "${alias}" (pipeline OR protest OR blockade)`);
            }
          }
        }
        
        // Search for focus areas if available
        const focusAreas = entity.attributes?.focus_areas || entity.attributes?.client_targets;
        if (focusAreas && focusAreas.length > 0) {
          const focusTerms = focusAreas.slice(0, 3).map((f: string) => `"${f}"`).join(' OR ');
          searchQueries.push(`site:instagram.com "${entity.name}" (${focusTerms})`);
        }

        for (const query of searchQueries) {
          totalSearches++;
          await processSearch(supabase, query, null, entity.name, 'entity', processedUrls, (count) => signalsCreated += count, (count) => mediaDownloaded += count, entity.id);
        }

        console.log(`Processed Instagram mentions for entity: ${entity.name}`);

      } catch (error) {
        console.error(`Error monitoring Instagram for entity ${entity.name}:`, error);
      }
    }

    console.log(`Instagram monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals. Downloaded ${mediaDownloaded} media files.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        entities_scanned: watchedEntities?.length || 0,
        searches_executed: totalSearches,
        signals_created: signalsCreated,
        media_downloaded: mediaDownloaded,
        source: 'instagram'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in Instagram monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
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
      console.log(`Instagram search failed: ${response.status}`);
      if (response.status === 429) {
        console.log('Rate limited, waiting longer...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      return;
    }

    const html = await response.text();

    // Extract all Instagram URLs from search results
    const instagramUrls: string[] = [];
    const urlPattern = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/g;
    let urlMatch;
    while ((urlMatch = urlPattern.exec(html)) !== null) {
      const fullUrl = urlMatch[0];
      if (!instagramUrls.includes(fullUrl) && !processedUrls.has(fullUrl)) {
        instagramUrls.push(fullUrl);
      }
    }

    console.log(`Found ${instagramUrls.length} Instagram URLs to fetch`);

    // Process each Instagram URL - fetch actual page content
    for (const instagramUrl of instagramUrls.slice(0, 5)) {
      processedUrls.add(instagramUrl);
      
      try {
        // Fetch the actual Instagram page to get post content
        const postData = await fetchInstagramPost(instagramUrl);
        
        if (!postData || !postData.caption) {
          console.log(`No content extracted from ${instagramUrl}`);
          continue;
        }

        const { caption, authorHandle, authorName, mediaUrls, comments, engagement, postType } = postData;

        // Check for relevance
        const lowerCaption = caption.toLowerCase();
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
        const mentions = extractMentions(caption);
        const hashtags = extractHashtags(caption);
        const eventDetails = extractEventDetails(caption);
        const isHighPriority = isHighPriorityContent(caption);

        // Determine category
        let category = 'social_media';
        if (lowerCaption.includes('protest') || lowerCaption.includes('blockade') || lowerCaption.includes('demonstration')) {
          category = 'protest_activity';
        } else if (ACTIVISM_KEYWORDS.some(k => lowerCaption.includes(k.toLowerCase()))) {
          category = 'activism';
        }

        // Create ingested document with FULL post data
        const { data: doc, error: docError } = await supabase
          .from('ingested_documents')
          .insert({
            title: `Instagram ${postType}: ${authorHandle || sourceName}`,
            raw_text: caption,
            source_url: instagramUrl,
            post_caption: caption,
            author_handle: authorHandle,
            author_name: authorName || sourceName,
            mentions: mentions,
            hashtags: hashtags,
            engagement_metrics: engagement,
            comments: comments.slice(0, 20), // Store top 20 comments
            media_urls: mediaUrls,
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
              has_media: mediaUrls.length > 0,
              media_count: mediaUrls.length,
              comment_count: comments.length,
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
          // Download and store media files
          let storedMediaCount = 0;
          for (const mediaUrl of mediaUrls.slice(0, 5)) {
            try {
              const mediaFile = await downloadAndStoreMedia(supabase, mediaUrl, 'instagram');
              if (mediaFile) {
                storedMediaCount++;
                await createMediaAttachments(supabase, 'document', doc.id, [mediaFile]);
                
                // Set thumbnail
                if (mediaFile.type === 'image' && storedMediaCount === 1) {
                  await supabase
                    .from('ingested_documents')
                    .update({ thumbnail_url: mediaFile.storageUrl })
                    .eq('id', doc.id);
                }
              }
            } catch (mediaError) {
              console.log(`Failed to download media: ${mediaError}`);
            }
          }
          
          if (storedMediaCount > 0) {
            onMediaDownloaded(storedMediaCount);
          }
          
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
          console.log(`✓ Ingested Instagram ${postType}: @${authorHandle} - "${caption.substring(0, 80)}..." (${comments.length} comments, ${mediaUrls.length} media)`);
        }

      } catch (postError) {
        console.error(`Error processing Instagram post ${instagramUrl}:`, postError);
      }

      // Small delay between posts
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`Instagram search timeout`);
    } else {
      throw error;
    }
  }
}

// Fetch actual Instagram post content by scraping the page
async function fetchInstagramPost(url: string): Promise<{
  caption: string;
  authorHandle: string;
  authorName: string;
  mediaUrls: string[];
  comments: Array<{ author: string; text: string }>;
  engagement: { likes?: number; comments?: number; views?: number };
  postType: 'image' | 'video' | 'reel' | 'carousel';
} | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    // Use a mobile user agent for better content access
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      console.log(`Failed to fetch Instagram post: ${response.status}`);
      return null;
    }

    const html = await response.text();
    
    // Extract data from Instagram's embedded JSON (meta tags and script data)
    let caption = '';
    let authorHandle = '';
    let authorName = '';
    const mediaUrls: string[] = [];
    const comments: Array<{ author: string; text: string }> = [];
    let engagement: { likes?: number; comments?: number; views?: number } = {};
    let postType: 'image' | 'video' | 'reel' | 'carousel' = 'image';

    // Extract from og:description meta tag (contains caption)
    const descMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i) ||
                      html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:description"/i);
    if (descMatch) {
      caption = descMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ');
    }

    // Extract from title tag as backup
    if (!caption) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        caption = titleMatch[1]
          .replace(/ on Instagram:?\s*"?/i, '')
          .replace(/"?\s*•\s*Instagram.*$/i, '')
          .trim();
      }
    }

    // Extract author from URL or meta tags
    const authorUrlMatch = url.match(/instagram\.com\/([a-zA-Z0-9_\.]+)\//);
    if (authorUrlMatch) {
      authorHandle = authorUrlMatch[1];
    }
    
    // Try to get author from caption (usually at start)
    const authorCaptionMatch = caption.match(/^@?([a-zA-Z0-9_\.]+):/);
    if (authorCaptionMatch) {
      authorHandle = authorCaptionMatch[1];
    }

    // Get author name from og:title
    const titleAuthorMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i);
    if (titleAuthorMatch) {
      const parts = titleAuthorMatch[1].split(/\s+on\s+Instagram/i);
      if (parts[0]) {
        authorName = parts[0].trim();
      }
    }

    // Extract media URLs from og:image and og:video
    const imageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/gi);
    if (imageMatch) {
      for (const match of imageMatch) {
        const urlMatch = match.match(/content="([^"]+)"/);
        if (urlMatch && urlMatch[1]) {
          mediaUrls.push(urlMatch[1].replace(/&amp;/g, '&'));
        }
      }
    }

    const videoMatch = html.match(/<meta\s+(?:property|name)="og:video"\s+content="([^"]+)"/i);
    if (videoMatch) {
      mediaUrls.push(videoMatch[1].replace(/&amp;/g, '&'));
      postType = 'video';
    }

    // Detect post type from URL
    if (url.includes('/reel/')) {
      postType = 'reel';
    } else if (url.includes('/tv/')) {
      postType = 'video';
    }

    // Try to extract engagement from page text
    const likesMatch = caption.match(/(\d+(?:,\d+)?(?:\.\d+)?[KkMm]?)\s*likes?/i) ||
                       html.match(/(\d+(?:,\d+)?(?:\.\d+)?[KkMm]?)\s*likes?/i);
    if (likesMatch) {
      engagement.likes = parseEngagementNumber(likesMatch[1]);
    }

    const commentsMatch = html.match(/(\d+(?:,\d+)?)\s*comments?/i);
    if (commentsMatch) {
      engagement.comments = parseInt(commentsMatch[1].replace(/,/g, ''), 10);
    }

    const viewsMatch = html.match(/(\d+(?:,\d+)?(?:\.\d+)?[KkMm]?)\s*views?/i);
    if (viewsMatch) {
      engagement.views = parseEngagementNumber(viewsMatch[1]);
    }

    // Try to extract comments from page (limited visibility without auth)
    const commentPattern = /@([a-zA-Z0-9_\.]+)\s+([^@]+?)(?=@[a-zA-Z0-9_\.]|$)/g;
    let commentMatch;
    while ((commentMatch = commentPattern.exec(html)) !== null && comments.length < 10) {
      const text = commentMatch[2].replace(/<[^>]+>/g, '').trim();
      if (text.length > 5 && text.length < 500) {
        comments.push({
          author: commentMatch[1],
          text: text
        });
      }
    }

    // Return null if we couldn't extract meaningful content
    if (!caption || caption.length < 10) {
      console.log('Could not extract caption from Instagram post');
      return null;
    }

    return {
      caption,
      authorHandle,
      authorName,
      mediaUrls,
      comments,
      engagement,
      postType
    };

  } catch (error) {
    console.error('Error fetching Instagram post:', error);
    return null;
  }
}

function parseEngagementNumber(str: string): number {
  const cleaned = str.replace(/,/g, '');
  const multiplier = cleaned.match(/[KkMm]$/);
  const num = parseFloat(cleaned.replace(/[KkMm]$/, ''));
  
  if (multiplier) {
    if (multiplier[0].toLowerCase() === 'k') return Math.round(num * 1000);
    if (multiplier[0].toLowerCase() === 'm') return Math.round(num * 1000000);
  }
  return Math.round(num);
}
