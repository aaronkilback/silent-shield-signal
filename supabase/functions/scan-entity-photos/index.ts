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

    // Get ALL existing photos to use as references
    const { data: existingPhotos } = await supabaseClient
      .from('entity_photos')
      .select('storage_path, feedback_rating, source')
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(10); // Load up to 10 reference photos
    
    // Get all photos with feedback for learning patterns
    const { data: allPhotosWithFeedback } = await supabaseClient
      .from('entity_photos')
      .select('feedback_rating, source')
      .eq('entity_id', entityId)
      .not('feedback_rating', 'is', null);
    
    const approvedPhotos = allPhotosWithFeedback?.filter(p => p.feedback_rating === 1) || [];
    const rejectedPhotos = allPhotosWithFeedback?.filter(p => p.feedback_rating === -1) || [];

    const referenceImages: Array<{ base64: string; mimeType: string }> = [];
    
    if (existingPhotos && existingPhotos.length > 0) {
      console.log(`Found ${existingPhotos.length} existing photos, loading as references`);
      
      for (const photo of existingPhotos) {
        try {
          const { data: photoData } = await supabaseClient.storage
            .from('entity-photos')
            .download(photo.storage_path);
          
          if (photoData) {
            const photoBuffer = await photoData.arrayBuffer();
            const photoBase64 = btoa(
              new Uint8Array(photoBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            referenceImages.push({
              base64: photoBase64,
              mimeType: photoData.type || 'image/jpeg'
            });
          }
        } catch (err) {
          console.error(`Failed to load reference photo ${photo.storage_path}:`, err);
        }
      }
      console.log(`Successfully loaded ${referenceImages.length} reference photos for comparison`);
    } else {
      console.log('No reference photos found - will accept professional photos');
    }

    // Build search query
    let searchQuery = `"${entity.name}"`;
    
    if (entity.type === 'person') {
      searchQuery += ' professional photo OR headshot OR portrait OR board director OR LinkedIn profile';
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
    const seenUrls = new Set<string>(); // Track URLs to prevent duplicates

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
            if (img.src && !seenUrls.has(img.src)) {
              seenUrls.add(img.src);
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
            if (meta['og:image'] && !seenUrls.has(meta['og:image'])) {
              seenUrls.add(meta['og:image']);
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
        if (!seenUrls.has(item.link)) {
          seenUrls.add(item.link);
          imageUrls.push({
            url: item.link,
            source: new URL(item.link).hostname,
            title: item.title || ''
          });
        }
      }
    }

    // STEP 3: LinkedIn-specific search for persons
    if (entity.type === 'person') {
      const linkedinSearchUrl = new URL('https://www.googleapis.com/customsearch/v1');
      linkedinSearchUrl.searchParams.set('key', GOOGLE_API_KEY);
      linkedinSearchUrl.searchParams.set('cx', GOOGLE_CX);
      linkedinSearchUrl.searchParams.set('q', `site:linkedin.com "${entity.name}" profile photo`);
      linkedinSearchUrl.searchParams.set('searchType', 'image');
      linkedinSearchUrl.searchParams.set('num', '10');
      linkedinSearchUrl.searchParams.set('imgType', 'photo');

      console.log('Searching LinkedIn profiles...');
      const linkedinResponse = await fetch(linkedinSearchUrl.toString());
      
      if (linkedinResponse.ok) {
        const linkedinData = await linkedinResponse.json();
        console.log(`Found ${linkedinData.items?.length || 0} LinkedIn images`);
        
        for (const item of linkedinData.items || []) {
          if (!seenUrls.has(item.link)) {
            seenUrls.add(item.link);
            imageUrls.push({
              url: item.link,
              source: 'linkedin.com',
              title: item.title || 'LinkedIn Profile'
            });
          }
        }
      }
    }

    console.log(`Total images to process: ${imageUrls.length}`);

    // Blocked domains - removed LinkedIn to allow professional profile photos
    const blockedDomains = [
      'facebook.com', 'instagram.com', 'twitter.com',
      'pinterest.com', 'gettyimages.com', 'shutterstock.com', 'istockphoto.com'
    ];

    let photosAdded = 0;
    const errors = [];
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 28000; // Increased to 28 seconds
    const MAX_IMAGES_TO_PROCESS = 15; // Increased to process more diverse results
    const MAX_IMAGE_SIZE = 2000000; // Increased to 2MB to allow news site images
    
    // Prioritize news sources and diverse domains
    const sortedImages = imageUrls.sort((a, b) => {
      const aIsNews = a.source.includes('news') || a.source.includes('post') || a.source.includes('times') || a.source.includes('journal');
      const bIsNews = b.source.includes('news') || b.source.includes('post') || b.source.includes('times') || b.source.includes('journal');
      if (aIsNews && !bIsNews) return -1;
      if (!aIsNews && bIsNews) return 1;
      return 0;
    });

    // Limit images to process
    const imagesToProcess = sortedImages.slice(0, MAX_IMAGES_TO_PROCESS);
    console.log(`Processing ${imagesToProcess.length} of ${imageUrls.length} images`);

    // Process each image
    for (const item of imagesToProcess) {
      // Check time budget
      if (Date.now() - startTime > MAX_PROCESSING_TIME) {
        console.log('Time budget exceeded, stopping early');
        break;
      }
      
      // Stop if we have enough photos
      if (photosAdded >= 8) {
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
        
        console.log(`Processing: ${item.url} (source: ${item.source})`);
        
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
            
            // Build AI prompt based on whether we have reference photos
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
            
            if (referenceImages.length > 0) {
              // Compare with multiple reference photos
              verificationPrompt = entity.type === 'person'
                ? `I'm showing you ${referenceImages.length} reference photo(s) of the same person, followed by a new candidate photo. Does the candidate photo (the LAST image) show the SAME PERSON as the reference photos? Answer YES only if they are clearly the same person. Answer NO if different, or if the candidate is a logo, illustration, or unrelated.${feedbackContext}`
                : `I'm showing you ${referenceImages.length} reference photo(s), followed by a new candidate. Does the candidate (the LAST image) show the SAME organization/entity as the references? Answer YES only if they match. Answer NO if different or unrelated.${feedbackContext}`;
              
              aiContent.push({ type: 'text', text: verificationPrompt });
              
              // Add all reference images
              for (let i = 0; i < referenceImages.length; i++) {
                aiContent.push({
                  type: 'image_url',
                  image_url: { url: `data:${referenceImages[i].mimeType};base64,${referenceImages[i].base64}` }
                });
              }
              
              aiContent.push({ type: 'text', text: 'Candidate photo to compare:' });
              aiContent.push({
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` }
              });
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
                const rejectReason = referenceImages.length > 0
                  ? `AI rejected - does not match ${referenceImages.length} reference photo(s)`
                  : 'AI rejected - not a suitable professional photo';
                console.log(rejectReason);
                errors.push(`Rejected ${item.url}: ${aiAnswer || 'AI said NO'}`);
                continue;
              }
              
              const approvalMsg = referenceImages.length > 0
                ? `AI approved - matches ${referenceImages.length} reference photo(s) from ${item.source}`
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
    
    // Diagnostic summary
    const diagnostics = {
      totalFound: imageUrls.length,
      processed: Math.min(imageUrls.length, MAX_IMAGES_TO_PROCESS),
      approved: photosAdded,
      rejected: errors.length,
      referencePhotosUsed: referenceImages.length,
      feedbackAvailable: approvedPhotos.length + rejectedPhotos.length
    };
    
    console.log('Scan diagnostics:', JSON.stringify(diagnostics, null, 2));
    console.log('Sample rejections:', errors.slice(0, 3));
    
    let message = `Successfully added ${photosAdded} photos for ${entity.name}`;
    if (imageUrls.length > MAX_IMAGES_TO_PROCESS) {
      message += `. Found ${imageUrls.length} total images, processed ${MAX_IMAGES_TO_PROCESS} to stay within time limits`;
    }
    if (referenceImages.length > 0) {
      message += `. Used ${referenceImages.length} existing photos for comparison`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        photosAdded,
        diagnostics: {
          totalFound: imageUrls.length,
          processed: Math.min(imageUrls.length, MAX_IMAGES_TO_PROCESS),
          approved: photosAdded,
          rejected: errors.length,
          referencePhotosUsed: referenceImages.length,
          feedbackAvailable: approvedPhotos.length + rejectedPhotos.length,
          timeoutReached: errors.some(e => e.includes('Time budget'))
        },
        sampleRejections: errors.slice(0, 5),
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
