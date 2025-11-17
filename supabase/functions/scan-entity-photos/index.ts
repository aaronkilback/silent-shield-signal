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

    // Build search query
    let searchQuery = `"${entity.name}"`;
    
    if (entity.type === 'person') {
      searchQuery += ' professional photo OR headshot OR portrait OR board director';
      if (entity.attributes && entity.attributes.company) {
        searchQuery += ` "${entity.attributes.company}"`;
      }
    } else if (entity.type === 'organization') {
      searchQuery += ' official logo OR headquarters';
    }

    if (entity.aliases && entity.aliases.length > 0) {
      searchQuery += ` OR "${entity.aliases[0]}"`;
    }
    
    searchQuery += ' -stock -clipart -illustration';

    console.log(`Search query: ${searchQuery}`);

    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const GOOGLE_CX = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    
    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
      throw new Error('Google Search API credentials not configured');
    }

    // Collect all image URLs
    const imageUrls: Array<{url: string, source: string, title: string}> = [];

    // STEP 1: Search web pages and extract images
    const webSearchUrl = new URL('https://www.googleapis.com/customsearch/v1');
    webSearchUrl.searchParams.set('key', GOOGLE_API_KEY);
    webSearchUrl.searchParams.set('cx', GOOGLE_CX);
    webSearchUrl.searchParams.set('q', searchQuery);
    webSearchUrl.searchParams.set('num', '10');

    console.log('Searching web pages...');
    const webResponse = await fetch(webSearchUrl.toString());
    
    if (webResponse.ok) {
      const webData = await webResponse.json();
      console.log(`Found ${webData.items?.length || 0} web pages`);
      
      for (const page of webData.items || []) {
        if (page.pagemap?.cse_image) {
          for (const img of page.pagemap.cse_image) {
            if (img.src) {
              imageUrls.push({
                url: img.src,
                source: page.displayLink,
                title: page.title
              });
            }
          }
        }
        if (page.pagemap?.metatags) {
          for (const meta of page.pagemap.metatags) {
            if (meta['og:image']) {
              imageUrls.push({
                url: meta['og:image'],
                source: page.displayLink,
                title: page.title
              });
            }
          }
        }
      }
    }

    // STEP 2: Direct image search
    const imgSearchUrl = new URL('https://www.googleapis.com/customsearch/v1');
    imgSearchUrl.searchParams.set('key', GOOGLE_API_KEY);
    imgSearchUrl.searchParams.set('cx', GOOGLE_CX);
    imgSearchUrl.searchParams.set('q', searchQuery);
    imgSearchUrl.searchParams.set('searchType', 'image');
    imgSearchUrl.searchParams.set('num', '10');
    imgSearchUrl.searchParams.set('safe', 'off');
    imgSearchUrl.searchParams.set('imgType', 'photo');

    console.log('Searching direct images...');
    const imgResponse = await fetch(imgSearchUrl.toString());
    
    if (imgResponse.ok) {
      const imgData = await imgResponse.json();
      console.log(`Found ${imgData.items?.length || 0} direct images`);
      
      for (const item of imgData.items || []) {
        imageUrls.push({
          url: item.link,
          source: new URL(item.link).hostname,
          title: item.title || ''
        });
      }
    }

    console.log(`Total images to process: ${imageUrls.length}`);

    // Blocked domains
    const blockedDomains = [
      'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com',
      'pinterest.com', 'gettyimages.com', 'shutterstock.com', 'istockphoto.com'
    ];

    let photosAdded = 0;
    const errors = [];
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 25000; // 25 seconds to leave buffer before timeout
    const MAX_IMAGES_TO_PROCESS = 8; // Process max 8 images per scan
    const MAX_IMAGE_SIZE = 500000; // 500KB max per image

    // Limit images to process
    const imagesToProcess = imageUrls.slice(0, MAX_IMAGES_TO_PROCESS);
    console.log(`Processing ${imagesToProcess.length} of ${imageUrls.length} images`);

    // Process each image
    for (const item of imagesToProcess) {
      // Check time budget
      if (Date.now() - startTime > MAX_PROCESSING_TIME) {
        console.log('Time budget exceeded, stopping early');
        break;
      }
      
      // Stop if we have enough photos
      if (photosAdded >= 5) {
        console.log('Found enough photos, stopping');
        break;
      }
      try {
        const imageUrl = new URL(item.url);
        const isBlocked = blockedDomains.some(d => imageUrl.hostname.includes(d));
        
        if (isBlocked) {
          console.log(`Skipped blocked domain: ${imageUrl.hostname}`);
          continue;
        }
        
        console.log(`Processing: ${item.url}`);
        
        const imageResponse = await fetch(item.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FortressAI/1.0)'
          },
          redirect: 'follow'
        });

        if (!imageResponse.ok) {
          console.log(`Failed to download: ${imageResponse.statusText}`);
          continue;
        }

        const imageBlob = await imageResponse.blob();
        const imageBuffer = await imageBlob.arrayBuffer();
        
        if (imageBuffer.byteLength < 1000) {
          console.log(`Image too small: ${imageBuffer.byteLength} bytes`);
          continue;
        }
        
        if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
          console.log(`Image too large: ${imageBuffer.byteLength} bytes, skipping`);
          continue;
        }
        
        console.log(`Downloaded: ${imageBuffer.byteLength} bytes`);
        
        // AI verification
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        if (LOVABLE_API_KEY) {
          try {
            const base64Image = btoa(
              new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            
            const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
            
            const verifyResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: `Does this image clearly show "${entity.name}"? Answer only YES or NO. Only say YES if you can identify ${entity.name}. If it's generic, stock photo, or wrong person, say NO.`
                      },
                      {
                        type: 'image_url',
                        image_url: {
                          url: `data:${mimeType};base64,${base64Image}`
                        }
                      }
                    ]
                  }
                ],
                max_tokens: 10
              })
            });

            if (verifyResponse.ok) {
              const verifyData = await verifyResponse.json();
              const aiAnswer = verifyData.choices[0]?.message?.content?.trim().toUpperCase();
              
              console.log(`AI verification: ${aiAnswer}`);
              
              if (aiAnswer !== 'YES') {
                console.log(`AI rejected - not ${entity.name}`);
                errors.push(`AI rejected ${item.url}`);
                continue;
              }
            }
          } catch (aiError) {
            console.error('AI verification error:', aiError);
          }
        }
        
        // Save image
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
        const fileName = `${entityId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

        const { error: uploadError } = await supabaseClient.storage
          .from('entity-photos')
          .upload(fileName, imageBuffer, {
            contentType: contentType,
            upsert: false
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          continue;
        }

        const { error: dbError } = await supabaseClient
          .from('entity_photos')
          .insert({
            entity_id: entityId,
            storage_path: fileName,
            caption: item.title || null,
            source: item.source,
            created_by: null
          });

        if (dbError) {
          console.error('DB error:', dbError);
          await supabaseClient.storage.from('entity-photos').remove([fileName]);
          continue;
        }

        photosAdded++;
        console.log(`Successfully added photo ${photosAdded}`);

      } catch (error) {
        console.error(`Error processing ${item.url}:`, error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed: ${errorMsg}`);
      }
    }

    console.log(`Photo scan complete. Added ${photosAdded} photos`);
    
    let message = `Successfully added ${photosAdded} photos for ${entity.name}`;
    if (imageUrls.length > MAX_IMAGES_TO_PROCESS) {
      message += `. Found ${imageUrls.length} total images, processed ${MAX_IMAGES_TO_PROCESS} to stay within time limits`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        photosAdded,
        totalFound: imageUrls.length,
        processed: Math.min(imageUrls.length, MAX_IMAGES_TO_PROCESS),
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
        message
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
