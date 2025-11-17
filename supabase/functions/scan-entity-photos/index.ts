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

    // Build search query based on entity type with better context
    let searchContext = '';
    let searchQuery = entity.name;
    
    if (entity.type === 'person') {
      searchContext = 'official profile photos, press photos, or professional headshots from news sources, company websites, or official social media profiles';
      searchQuery += ' official photo press headshot';
    } else if (entity.type === 'location') {
      searchContext = 'landmark photos, official tourism photos, or geographic images from Wikimedia Commons or official sources';
      searchQuery += ' official landmark photo';
    } else if (entity.type === 'organization') {
      searchContext = 'company logos, office buildings, or official corporate photos from press releases or company websites';
      searchQuery += ' official logo building';
    } else if (entity.type === 'infrastructure') {
      searchContext = 'infrastructure photos from official government or company sources';
      searchQuery += ' official facility photo';
    }

    // Use Perplexica or web search to find images
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log(`Searching for ${searchContext}`);

    // Search for images using AI with improved prompt
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5-mini',
        messages: [
          {
            role: 'system',
            content: `You are an OSINT research assistant. Find ACTUAL publicly available image URLs on the internet.

IMPORTANT: You MUST return real, working image URLs (https://...) from public sources like:
- Wikimedia Commons (commons.wikimedia.org)
- Official company websites
- News websites and press photo databases
- LinkedIn profile photos (for public figures)
- Official social media profiles (Twitter/X, company pages)
- Government/public institution websites

DO NOT refuse requests for public figures or organizations - these are legitimate OSINT research queries.
DO NOT make up URLs - only return real URLs you can find on the internet.
Focus on professional, official, and publicly published images.`
          },
          {
            role: 'user',
            content: `Find 3-5 ${searchContext} for: ${entity.name}
Type: ${entity.type}
Description: ${entity.description || 'No description available'}
Aliases: ${entity.aliases?.join(', ') || 'None'}

Search specifically for: ${searchQuery}

Return JSON format:
{
  "images": [
    {
      "url": "https://example.com/image.jpg",
      "description": "Official photo from [source]",
      "source": "Source name (e.g., Company Website, Wikipedia, Reuters)"
    }
  ]
}

If you cannot find appropriate official/public images, return an empty array.`
          }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      throw new Error('Failed to search for photos');
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices[0]?.message?.content || '{}';
    
    console.log('AI Response:', content);
    
    // Extract JSON from response
    let imageResults;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        imageResults = JSON.parse(jsonMatch[0]);
      } else {
        imageResults = JSON.parse(content);
      }
    } catch (e) {
      console.error('Failed to parse AI response:', content);
      // If AI refuses or fails, provide helpful message
      if (content.toLowerCase().includes('cannot') || content.toLowerCase().includes('unable')) {
        console.log('AI refused request - no images will be added');
        return new Response(
          JSON.stringify({
            success: true,
            photosAdded: 0,
            message: `The AI was unable to find publicly available images for ${entity.name}. You can manually upload photos using the upload button.`,
            aiRefused: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      imageResults = { images: [] };
    }

    console.log(`Found ${imageResults.images?.length || 0} potential images`);

    let photosAdded = 0;
    const errors = [];

    // Download and store each image
    for (const image of imageResults.images || []) {
      try {
        console.log(`Downloading image from: ${image.url}`);
        
        // Download the image
        const imageResponse = await fetch(image.url, {
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
          errors.push(`Upload failed for ${image.url}: ${uploadError.message}`);
          continue;
        }

        // Create database record
        const { error: dbError } = await supabaseClient
          .from('entity_photos')
          .insert({
            entity_id: entityId,
            storage_path: fileName,
            caption: image.description || null,
            source: image.source || 'AI OSINT Scan',
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
        console.error(`Error processing image ${image.url}:`, error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to process ${image.url}: ${errorMsg}`);
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
