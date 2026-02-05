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

    // Add aliases for better coverage
    if (entity.aliases && entity.aliases.length > 0) {
      searchQuery += ` OR "${entity.aliases[0]}"`;
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
        const nameLower = entity.name.toLowerCase();
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
