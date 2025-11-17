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
    const { entityId } = await req.json();

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

    console.log(`Scanning for photos of: ${entity.name} (${entity.type})`);

    // Build more specific search query based on entity type and attributes
    let searchQuery = `"${entity.name}"`;
    
    if (entity.type === 'person') {
      // For people, add professional/official context
      searchQuery += ' professional photo OR headshot OR portrait';
      
      // Add company/organization if available in attributes
      if (entity.attributes && entity.attributes.company) {
        searchQuery += ` "${entity.attributes.company}"`;
      }
      
      // Add title/position if available
      if (entity.attributes && entity.attributes.title) {
        searchQuery += ` "${entity.attributes.title}"`;
      }
    } else if (entity.type === 'organization') {
      searchQuery += ' official logo OR headquarters OR building';
    } else if (entity.type === 'location') {
      searchQuery += ' official photo OR landmark';
    } else if (entity.type === 'infrastructure') {
      searchQuery += ' facility photo';
    }

    // Add most relevant alias if available (only first one for precision)
    if (entity.aliases && entity.aliases.length > 0) {
      searchQuery += ` OR "${entity.aliases[0]}"`;
    }
    
    // Exclude common wrong results
    searchQuery += ' -stock -clipart -illustration -cartoon -drawing';

    console.log(`Enhanced search query: ${searchQuery}`);

    // Use Google Custom Search API to find images
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const GOOGLE_CX = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    console.log('API Key exists:', !!GOOGLE_API_KEY);
    console.log('Search Engine ID:', GOOGLE_CX);
    
    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
      throw new Error('Google Search API credentials not configured');
    }
    
    // Verify credentials format
    if (GOOGLE_CX.length < 10) {
      throw new Error(`Invalid Search Engine ID format: ${GOOGLE_CX}`);
    }

    const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
    searchUrl.searchParams.set('key', GOOGLE_API_KEY);
    searchUrl.searchParams.set('cx', GOOGLE_CX);
    searchUrl.searchParams.set('q', searchQuery);
    searchUrl.searchParams.set('searchType', 'image');
    searchUrl.searchParams.set('num', '10'); // Increased from 3 to 10
    searchUrl.searchParams.set('safe', 'off'); // Turn off safe search for more results
    searchUrl.searchParams.set('imgType', 'photo'); // Focus on actual photos
    searchUrl.searchParams.set('imgSize', 'large'); // Prefer larger, higher quality images

    console.log(`Searching Google Images for: ${searchQuery}`);
    console.log(`Search parameters:`, {
      cx: GOOGLE_CX,
      q: searchQuery,
      searchType: 'image',
      num: 3
    });

    const searchResponse = await fetch(searchUrl.toString());

    console.log('Response status:', searchResponse.status);
    console.log('Response headers:', Object.fromEntries(searchResponse.headers.entries()));

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Google Search API full error:', errorText);
      
      let errorDetail = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = JSON.stringify(errorJson, null, 2);
        console.error('Parsed error:', errorJson);
      } catch (e) {
        console.error('Could not parse error as JSON');
      }
      
      throw new Error(`Google Search API returned ${searchResponse.status}: ${errorDetail}`);
    }

    const searchData = await searchResponse.json();
    console.log('Search response keys:', Object.keys(searchData));
    console.log(`Found ${searchData.items?.length || 0} potential images`);
    
    if (searchData.error) {
      console.error('API returned error in response:', searchData.error);
      throw new Error(`Google Search API error: ${JSON.stringify(searchData.error)}`);
    }

    let photosAdded = 0;
    const errors = [];
    
    // Skip images from problematic domains that require authentication or block downloads
    const blockedDomains = [
      'linkedin.com',
      'facebook.com', 
      'fb.com',
      'instagram.com',
      'twitter.com',
      'x.com',
      'resourceworks.com',
      'pinterest.com',
      'gettyimages.com',
      'shutterstock.com',
      'istockphoto.com',
      'dreamstime.com',
      'alamy.com',
      '123rf.com' // Block stock photo sites
    ];
    
    // Prefer these reliable sources
    const preferredDomains = [
      'wikipedia.org',
      'wikimedia.org',
      'linkedin.com', // Paradox: blocked from download but good for verification
      'news',
      'gov',
      'edu',
      'org'
    ];

    // Download and store each image
    for (const item of searchData.items || []) {
      try {
        // Check if image is from a blocked domain
        const imageUrl = new URL(item.link);
        const isBlocked = blockedDomains.some(domain => 
          imageUrl.hostname.includes(domain)
        );
        
        if (isBlocked) {
          console.log(`Skipping blocked domain: ${imageUrl.hostname}`);
          errors.push(`Skipped ${item.link}: Source requires authentication or is stock photo`);
          continue;
        }
        
        // Check if image URL or title contains entity name for relevance
        const titleLower = (item.title || '').toLowerCase();
        const nameLower = entity.name.toLowerCase();
        const isRelevant = titleLower.includes(nameLower) || item.link.toLowerCase().includes(nameLower);
        
        if (!isRelevant) {
          console.log(`Skipping irrelevant image: ${item.title}`);
          errors.push(`Skipped ${item.link}: Not relevant to entity`);
          continue;
        }
        
        console.log(`Downloading image from: ${item.link}`);
        
        // Download the image
        const imageResponse = await fetch(item.link, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FortressAI/1.0; +https://fortressai.com)'
          },
          redirect: 'follow'
        });

        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.statusText}`);
        }

        const imageBlob = await imageResponse.blob();
        const imageBuffer = await imageBlob.arrayBuffer();
        
        // Skip images that are too small (likely blank/placeholder)
        if (imageBuffer.byteLength < 1000) {
          console.log(`Skipping tiny image (${imageBuffer.byteLength} bytes): ${item.link}`);
          errors.push(`Skipped ${item.link}: Image too small (likely blank)`);
          continue;
        }
        
        console.log(`Downloaded image: ${imageBuffer.byteLength} bytes`);
        
        // Determine file extension from content type
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
        
        // Generate unique filename
        const fileName = `${entityId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

        // Upload to storage
        const { error: uploadError } = await supabaseClient.storage
          .from('entity-photos')
          .upload(fileName, imageBuffer, {
            contentType: contentType,
            upsert: false
          });

        if (uploadError) {
          console.error('Storage upload error:', uploadError);
          errors.push(`Upload failed for ${item.link}: ${uploadError.message}`);
          continue;
        }

        // Create database record
        const { error: dbError } = await supabaseClient
          .from('entity_photos')
          .insert({
            entity_id: entityId,
            storage_path: fileName,
            caption: item.title || null,
            source: item.displayLink || 'Google Image Search',
            created_by: null // System-generated
          });

        if (dbError) {
          console.error('Database insert error:', dbError);
          errors.push(`Database insert failed: ${dbError.message}`);
          // Clean up uploaded file
          await supabaseClient.storage.from('entity-photos').remove([fileName]);
          continue;
        }

        photosAdded++;
        console.log(`Successfully added photo: ${fileName}`);

      } catch (error) {
        console.error(`Error processing image ${item.link}:`, error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to process ${item.link}: ${errorMsg}`);
      }
    }

    console.log(`Photo scan complete. Added ${photosAdded} photos`);

    return new Response(
      JSON.stringify({
        success: true,
        photosAdded,
        errors: errors.length > 0 ? errors : undefined,
        message: `Successfully added ${photosAdded} photos to ${entity.name}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Photo scan error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
