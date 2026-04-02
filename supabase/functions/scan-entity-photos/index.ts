import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { entityId } = await req.json();

    if (!entityId) {
      return errorResponse('entityId is required', 400);
    }

    const supabase = createServiceClient();
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const GOOGLE_CX = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

    // Get entity details
    const { data: entity, error: entityError } = await supabase
      .from('entities')
      .select('*')
      .eq('id', entityId)
      .single();

    if (entityError || !entity) {
      return errorResponse('Entity not found', 404);
    }

    console.log(`Scanning for photos of: ${entity.name} (${entity.type})`);

    if (!GOOGLE_API_KEY || !GOOGLE_CX) {
      return errorResponse('Google Search API credentials not configured', 500);
    }

    // Get ONLY approved photos (positive feedback) to use as references
    const { data: existingPhotos } = await supabase
      .from('entity_photos')
      .select('storage_path, feedback_rating, source')
      .eq('entity_id', entityId)
      .eq('feedback_rating', 1)
      .order('created_at', { ascending: false })
      .limit(5);

    // Get all photos with feedback for learning patterns
    const { data: allPhotosWithFeedback } = await supabase
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
          const { data: photoData } = await supabase.storage
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

    // Collect all image URLs
    const imageUrls: Array<{ url: string; source: string; title: string }> = [];
    const seenUrls = new Set<string>();

    // Web search for images
    const webSearchUrl = new URL('https://www.googleapis.com/customsearch/v1');
    webSearchUrl.searchParams.set('key', GOOGLE_API_KEY);
    webSearchUrl.searchParams.set('cx', GOOGLE_CX);
    webSearchUrl.searchParams.set('q', searchQuery);
    webSearchUrl.searchParams.set('num', '10');

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
      }
    }

    // Direct image search
    const imgSearchUrl = new URL('https://www.googleapis.com/customsearch/v1');
    imgSearchUrl.searchParams.set('key', GOOGLE_API_KEY);
    imgSearchUrl.searchParams.set('cx', GOOGLE_CX);
    imgSearchUrl.searchParams.set('q', searchQuery);
    imgSearchUrl.searchParams.set('searchType', 'image');
    imgSearchUrl.searchParams.set('num', '10');
    imgSearchUrl.searchParams.set('imgType', 'photo');

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

    console.log(`Total images to process: ${imageUrls.length}`);

    // Blocked domains
    const blockedDomains = [
      'facebook.com', 'instagram.com', 'twitter.com',
      'pinterest.com', 'gettyimages.com', 'shutterstock.com', 'istockphoto.com'
    ];

    let photosAdded = 0;
    const errors: string[] = [];
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 28000;
    const MAX_IMAGES_TO_PROCESS = 15;
    const MAX_IMAGE_SIZE = 2000000;

    // Prioritize news sources
    const sortedImages = imageUrls.sort((a, b) => {
      const aIsNews = a.source.includes('news') || a.source.includes('post') || a.source.includes('times');
      const bIsNews = b.source.includes('news') || b.source.includes('post') || b.source.includes('times');
      if (aIsNews && !bIsNews) return -1;
      if (!aIsNews && bIsNews) return 1;
      return 0;
    });

    const imagesToProcess = sortedImages.slice(0, MAX_IMAGES_TO_PROCESS);

    for (const item of imagesToProcess) {
      if (Date.now() - startTime > MAX_PROCESSING_TIME) {
        console.log('Time budget exceeded, stopping early');
        break;
      }

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

        console.log(`Processing: ${item.url}`);

        const imageResponse = await fetch(item.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FortressAI/1.0)' },
          redirect: 'follow'
        });

        if (!imageResponse.ok) {
          console.log(`Failed to download: ${imageResponse.statusText}`);
          continue;
        }

        const imageBlob = await imageResponse.blob();
        const imageBuffer = await imageBlob.arrayBuffer();

        if (imageBuffer.byteLength < 1000 || imageBuffer.byteLength > MAX_IMAGE_SIZE) {
          console.log(`Image size out of range: ${imageBuffer.byteLength} bytes`);
          continue;
        }

        // AI verification
        if (GEMINI_API_KEY) {
          const base64Image = btoa(
            new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );

          const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
          const aiContent: any[] = [];
          let verificationPrompt = '';

          // Build feedback context
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
          }

          if (referenceImages.length > 0) {
            verificationPrompt = entity.type === 'person'
              ? `I'm showing you ${referenceImages.length} user-approved reference photo(s) of "${entity.name}", followed by a new candidate photo. Does the candidate photo (the LAST image) show the SAME PERSON as the reference photos? Answer YES only if they are clearly the same person. Answer NO if different person or unrelated.${feedbackContext}`
              : `I'm showing you ${referenceImages.length} reference photo(s) of "${entity.name}", followed by a new candidate. Does the candidate match? Answer YES or NO.${feedbackContext}`;

            aiContent.push({ type: 'text', text: verificationPrompt });

            for (const ref of referenceImages) {
              aiContent.push({
                type: 'image_url',
                image_url: { url: `data:${ref.mimeType};base64,${ref.base64}` }
              });
            }

            aiContent.push({ type: 'text', text: 'Candidate photo to compare:' });
            aiContent.push({
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` }
            });
          } else {
            verificationPrompt = entity.type === 'person'
              ? `This image was found searching for "${entity.name}". Is this a professional photo OF this specific person "${entity.name}"? Answer YES only if you can verify identity. Answer NO if uncertain.${feedbackContext}`
              : `Is this a photo/logo of "${entity.name}"? Answer YES or NO.${feedbackContext}`;

            aiContent.push(
              { type: 'text', text: verificationPrompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            );
          }

          const verifyResult = await callAiGateway({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: aiContent }],
            functionName: 'scan-entity-photos',
            extraBody: { max_tokens: 10 },
          });

          if (verifyResult.error) {
            console.log('AI verification failed, skipping');
            continue;
          }

          const aiAnswer = verifyResult.content?.trim().toUpperCase();
          console.log(`AI verification: ${aiAnswer}`);

          if (aiAnswer !== 'YES') {
            console.log('AI rejected image');
            continue;
          }
        }

        // Save image
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
        const fileName = `${entityId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('entity-photos')
          .upload(fileName, imageBuffer, { contentType, upsert: false });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          errors.push(`Failed to upload: ${uploadError.message}`);
          continue;
        }

        // Insert record
        const { error: dbError } = await supabase
          .from('entity_photos')
          .insert({
            entity_id: entityId,
            storage_path: fileName,
            source: item.source,
            source_url: item.url,
            is_primary: photosAdded === 0 && !existingPhotos?.length,
            metadata: { title: item.title, ai_verified: true }
          });

        if (dbError) {
          console.error('Database error:', dbError);
          errors.push(`Failed to save record: ${dbError.message}`);
          continue;
        }

        photosAdded++;
        console.log(`Successfully added photo from ${item.source}`);

      } catch (error) {
        console.error(`Error processing ${item.url}:`, error);
        errors.push(`Failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    console.log(`Photo scan complete. Added ${photosAdded} photos`);

    return successResponse({
      success: true,
      photosAdded,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully added ${photosAdded} photos for ${entity.name}`
    });

  } catch (error) {
    console.error('Photo scan error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
