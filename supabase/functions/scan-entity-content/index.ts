import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entityId, searchType = 'news' } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get entity details
    const { data: entity, error: entityError } = await supabaseClient
      .from('entities')
      .select('*')
      .eq('id', entityId)
      .single();

    if (entityError || !entity) {
      throw new Error('Entity not found');
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
      throw new Error('Google Search API credentials not configured');
    }

    const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
    searchUrl.searchParams.set('key', GOOGLE_API_KEY);
    searchUrl.searchParams.set('cx', GOOGLE_CX);
    searchUrl.searchParams.set('q', searchQuery);
    searchUrl.searchParams.set('num', '10');
    searchUrl.searchParams.set('sort', 'date'); // Most recent first

    console.log(`Searching for: ${searchQuery}`);

    const searchResponse = await fetch(searchUrl.toString());

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Google Search API error:', errorText);
      throw new Error(`Google Search API returned ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    console.log(`Found ${searchData.items?.length || 0} results`);

    let contentAdded = 0;
    const errors = [];

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
        const { error: dbError } = await supabaseClient
          .from('entity_content')
          .insert({
            entity_id: entityId,
            content_type: contentType,
            title: item.title || null,
            url: item.link,
            source: new URL(item.link).hostname,
            published_date: publishedDate,
            excerpt: item.snippet || null,
            content_text: item.snippet || null, // We'll have full content later with web scraping
            relevance_score: relevanceScore,
            metadata: {
              image: item.pagemap?.cse_image?.[0]?.src || null,
              thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src || null,
            },
            created_by: null // System-generated
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

    return new Response(
      JSON.stringify({
        success: true,
        contentAdded,
        errors: errors.length > 0 ? errors : undefined,
        message: `Successfully added ${contentAdded} articles/content for ${entity.name}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Content scan error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
