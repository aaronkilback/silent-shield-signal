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

    // Check for existing photos with feedback data
    const { data: existingPhotos } = await supabaseClient
      .from('entity_photos')
      .select('storage_path, feedback_rating, source')
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(1);
    
    // Get all photos with feedback for learning patterns
    const { data: allPhotosWithFeedback } = await supabaseClient
      .from('entity_photos')
      .select('feedback_rating, source')
      .eq('entity_id', entityId)
      .not('feedback_rating', 'is', null);
    
    const approvedPhotos = allPhotosWithFeedback?.filter(p => p.feedback_rating === 1) || [];
    const rejectedPhotos = allPhotosWithFeedback?.filter(p => p.feedback_rating === -1) || [];

    let referenceImage: { base64: string; mimeType: string } | null = null;
    
    if (existingPhotos && existingPhotos.length > 0) {
      console.log('Found reference photo, will use for comparison');
      try {
        const { data: photoData } = await supabaseClient.storage
          .from('entity-photos')
          .download(existingPhotos[0].storage_path);
        
        if (photoData) {
          const photoBuffer = await photoData.arrayBuffer();
          const photoBase64 = btoa(
            new Uint8Array(photoBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          referenceImage = {
            base64: photoBase64,
            mimeType: photoData.type || 'image/jpeg'
          };
          console.log('Reference photo loaded successfully');
        }
      } catch (err) {
        console.error('Failed to load reference photo:', err);
      }
    } else {
      console.log('No reference photo found - will accept professional photos');
    }

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
            
            // Build AI prompt based on whether we have a reference photo
            const aiContent = [];
            let verificationPrompt = '';
            
            // Add user feedback context to improve AI decisions
            let feedbackContext = '';
            if (approvedPhotos.length > 0 || rejectedPhotos.length > 0) {
              feedbackContext = '\n\nUser feedback from previous scans:';
              if (approvedPhotos.length > 0) {
                const approvedSources = [...new Set(approvedPhotos.map(p => p.source).filter(Boolean))];
                feedbackContext += `\n- User has approved ${approvedPhotos.length} photo(s) from sources like: ${approvedSources.join(', ')}`;
              }
              if (rejectedPhotos.length > 0) {
                const rejectedSources = [...new Set(rejectedPhotos.map(p => p.source).filter(Boolean))];
                feedbackContext += `\n- User has rejected ${rejectedPhotos.length} photo(s) from sources like: ${rejectedSources.join(', ')}`;
              }
              feedbackContext += '\n\nPlease use this feedback pattern to make better decisions.';
            }
            
            if (referenceImage) {
              // Compare with reference photo
              verificationPrompt = entity.type === 'person'
                ? `Look at these two images. The first image is a reference photo. Does the second image show the SAME PERSON as the first image? Answer YES only if they are clearly the same person. Answer NO if they are different people, or if the second image is a logo, illustration, or unrelated content.${feedbackContext}`
                : `Look at these two images. The first image is a reference. Does the second image show the SAME organization/entity as the first image? Answer YES only if they match. Answer NO if different or unrelated.${feedbackContext}`;
              
              aiContent.push(
                { type: 'text', text: verificationPrompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:${referenceImage.mimeType};base64,${referenceImage.base64}` }
                },
                { type: 'text', text: 'Second image to compare:' },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${base64Image}` }
                }
              );
            } else {
              // No reference - use generic check with feedback context
              verificationPrompt = entity.type === 'person' 
                ? `Is this a professional photo of a real person (headshot, portrait, or profile photo)? Answer YES if it shows a clear photo of a person's face. Answer NO if it's a logo, illustration, group photo, stock image, or unrelated content.${feedbackContext}`
                : `Is this a professional photo or logo of an organization/company? Answer YES if it's a clear organizational image. Answer NO if it's unrelated, stock, or illustration.${feedbackContext}`;
              
              aiContent.push(
                { type: 'text', text: verificationPrompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${base64Image}` }
                }
              );
            }
            
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
                    content: aiContent
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
                const rejectReason = referenceImage 
                  ? 'AI rejected - does not match reference photo'
                  : 'AI rejected - not a suitable professional photo';
                console.log(rejectReason);
                errors.push(`Rejected ${item.url}`);
                continue;
              }
              
              const approvalMsg = referenceImage
                ? `AI approved - matches reference photo from ${item.source}`
                : `AI approved image from ${item.source}`;
              console.log(approvalMsg);
            } else {
              console.log('AI verification request failed, skipping image');
              continue;
            }
          } catch (aiError) {
            console.error('AI verification error:', aiError);
            continue;
          }
        } else {
          console.log('No LOVABLE_API_KEY, accepting image without verification');
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
