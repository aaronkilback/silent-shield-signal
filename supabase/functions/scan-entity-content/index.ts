import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { entityId, searchType = 'news' } = await req.json();

    if (!entityId) {
      return errorResponse('entityId is required', 400);
    }

    const supabase = createServiceClient();

    // Get entity details
    const { data: entity, error: entityError } = await supabase
      .from('entities')
      .select('*')
      .eq('id', entityId)
      .single();

    if (entityError || !entity) {
      return errorResponse('Entity not found', 404);
    }

    console.log(`Scanning for ${searchType} content about: ${entity.name} (${entity.type})`);

    // Build search query
    let searchQuery = `"${entity.name}"`;
    
    // Add context based on entity type
    if (entity.type === 'person') {
      searchQuery += ' news articles profile';
    } else if (entity.type === 'organization') {
      searchQuery += ' company news press release';
    } else if (entity.type === 'location') {
      searchQuery += ' news events';
    }

    // Add aliases for better coverage — but SKIP short aliases (<=4 chars)
    // to prevent disambiguation failures (e.g., "CGL" matching game miniatures)
    if (entity.aliases && entity.aliases.length > 0) {
      const usableAliases = entity.aliases.filter((a: string) => a.length > 4);
      if (usableAliases.length > 0) {
        searchQuery += ` OR "${usableAliases[0]}"`;
      }
    }

    // Use Google Custom Search API
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const GOOGLE_CX = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
      return errorResponse('Google Search API credentials not configured', 500);
    }

    const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
    searchUrl.searchParams.set('key', GOOGLE_API_KEY);
    searchUrl.searchParams.set('cx', GOOGLE_CX);
    searchUrl.searchParams.set('q', searchQuery);
    searchUrl.searchParams.set('num', '10');
    searchUrl.searchParams.set('sort', 'date');
    // Restrict to last 30 days to prevent historical content from polluting the feed
    searchUrl.searchParams.set('dateRestrict', 'm1');

    console.log(`Searching for: ${searchQuery}`);

    const searchResponse = await fetch(searchUrl.toString());

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Google Search API error:', errorText);
      return errorResponse(`Google Search API returned ${searchResponse.status}`, 500);
    }

    const searchData = await searchResponse.json();
    console.log(`Found ${searchData.items?.length || 0} results`);

    let contentAdded = 0;
    const errors: string[] = [];

    // Process each search result
    for (const item of searchData.items || []) {
      try {
        console.log(`Processing: ${item.link}`);

        // ═══ RELEVANCE GATE ═══
        // Verify the entity name actually appears in the result to prevent
        // disambiguation failures (e.g., "CGL" matching unrelated content)
        const resultText = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
        const nameLower = entity.name.toLowerCase();
        const nameWords = nameLower.split(' ').filter((w: string) => w.length > 3);
        
        // For short entity names (<=4 chars), require EXACT match in context
        const isShortName = nameLower.length <= 4;
        let isRelevant = false;
        
        if (isShortName) {
          // Short names must appear as standalone words with surrounding context
          const wordBoundaryPattern = new RegExp(`(^|[^a-z0-9])${nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
          isRelevant = wordBoundaryPattern.test(resultText);
          // Additional check: must also contain a contextual word from the entity description or type
          if (isRelevant && entity.description) {
            const contextWords = entity.description.toLowerCase().split(' ').filter((w: string) => w.length > 4);
            const hasContext = contextWords.some((cw: string) => resultText.includes(cw));
            if (!hasContext) isRelevant = false;
          }
        } else {
          isRelevant = resultText.includes(nameLower) || 
            nameWords.some((word: string) => resultText.includes(word));
        }
        
        if (!isRelevant) {
          console.log(`Skipping irrelevant result (no entity match): ${item.title?.substring(0, 60)}`);
          continue;
        }

        // Determine content type based on source
        let contentType = 'news_article';
        const hostname = new URL(item.link).hostname.toLowerCase();
        
        if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
          contentType = 'social_post';
        } else if (hostname.includes('youtube.com') || hostname.includes('vimeo.com')) {
          contentType = 'video';
        } else if (hostname.includes('blog') || hostname.includes('medium.com')) {
          contentType = 'blog';
        }

        // Extract publication date if available
        let publishedDate = null;
        if (item.pagemap?.metatags?.[0]) {
          const metaTags = item.pagemap.metatags[0];
          publishedDate = metaTags['article:published_time'] || 
                         metaTags['datePublished'] || 
                         metaTags['date'] || null;
        }

        // Calculate relevance score based on title match
        const titleLower = (item.title || '').toLowerCase();
        let relevanceScore = titleLower.includes(nameLower) ? 80 : 50;
        
        // Boost score for exact matches
        if (titleLower === nameLower) relevanceScore = 100;

        // Insert into database
        const { error: dbError } = await supabase
          .from('entity_content')
          .insert({
            entity_id: entityId,
            content_type: contentType,
            title: item.title || null,
            url: item.link,
            source: new URL(item.link).hostname,
            published_date: publishedDate,
            excerpt: item.snippet || null,
            content_text: item.snippet || null,
            relevance_score: relevanceScore,
            metadata: {
              image: item.pagemap?.cse_image?.[0]?.src || null,
              thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src || null,
            },
            created_by: null
          });

        if (dbError) {
          // Check if it's a duplicate (unique constraint violation)
          if (dbError.code === '23505') {
            console.log(`Skipping duplicate: ${item.link}`);
            continue;
          }
          console.error('Database insert error:', dbError);
          errors.push(`Failed to save ${item.link}: ${dbError.message}`);
          continue;
        }

        contentAdded++;
        console.log(`Successfully added: ${item.title}`);

      } catch (error) {
        console.error(`Error processing ${item.link}:`, error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to process ${item.link}: ${errorMsg}`);
      }
    }

    console.log(`Content scan complete. Added ${contentAdded} items`);

    return successResponse({
      success: true,
      contentAdded,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully added ${contentAdded} articles/content for ${entity.name}`
    });

  } catch (error) {
    console.error('Content scan error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
