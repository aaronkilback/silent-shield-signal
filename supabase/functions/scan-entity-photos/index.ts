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

    // Build search query based on entity type
    let searchQuery = entity.name;
    
    if (entity.type === 'person') {
      searchQuery += ' person photo official';
    } else if (entity.type === 'location') {
      searchQuery += ' location landmark photo';
    } else if (entity.type === 'organization') {
      searchQuery += ' company logo building official';
    } else if (entity.type === 'infrastructure') {
      searchQuery += ' infrastructure facility photo';
    }

    // Add aliases to improve search
    if (entity.aliases && entity.aliases.length > 0) {
      searchQuery += ' ' + entity.aliases[0];
    }

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
    searchUrl.searchParams.set('num', '3');

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

    // Download and store each image
    for (const item of searchData.items || []) {
      try {
        console.log(`Downloading image from: ${item.link}`);
        
        // Download the image
        const imageResponse = await fetch(item.link, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FortressAI/1.0; +https://fortressai.com)'
          }
        });

        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.statusText}`);
        }

        const imageBlob = await imageResponse.blob();
        const imageBuffer = await imageBlob.arrayBuffer();
        
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
