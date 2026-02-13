import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { limit = 50, signal_id } = await req.json().catch(() => ({}));

    // Build query for signals missing media data
    let query = supabase
      .from('signals')
      .select('id, raw_json, normalized_text')
      .is('thumbnail_url', null)
      .not('raw_json', 'is', null);

    if (signal_id) {
      query = query.eq('id', signal_id);
    } else {
      query = query.order('created_at', { ascending: false }).limit(limit);
    }

    const { data: signals, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch signals: ${fetchError.message}`);
    }

    console.log(`[backfill-signal-media] Found ${signals?.length || 0} signals to process`);

    const results = {
      processed: 0,
      updated: 0,
      errors: [] as string[],
    };

    for (const signal of signals || []) {
      try {
        results.processed++;

        const rawJson = signal.raw_json || {};
        const sourceUrl = rawJson.source_metadata?.url || rawJson.url || rawJson.source_url;

        if (!sourceUrl) {
          console.log(`[backfill-signal-media] Signal ${signal.id} has no source URL`);
          continue;
        }

        // Detect platform
        const platform = detectPlatform(sourceUrl);
        if (!platform) {
          console.log(`[backfill-signal-media] Unknown platform for ${sourceUrl}`);
          continue;
        }

        console.log(`[backfill-signal-media] Processing ${platform} signal: ${signal.id}`);

        // Fetch content from the source URL
        const content = await fetchSocialContent(sourceUrl, platform);

        if (!content) {
          console.log(`[backfill-signal-media] No content fetched for ${signal.id}`);
          continue;
        }

        // Upload media if available
        let mediaUrls: string[] = [];
        let thumbnailUrl: string | null = null;

        if (content.imageUrl) {
          try {
            const uploaded = await captureAndUploadMedia(supabase, content.imageUrl, platform);
            if (uploaded) {
              thumbnailUrl = uploaded;
              mediaUrls.push(uploaded);
            }
          } catch (mediaError) {
            console.error(`[backfill-signal-media] Media upload failed:`, mediaError);
          }
        }

        // Update signal with extracted data
        const updateData: Record<string, any> = {};

        if (content.caption) {
          updateData.post_caption = content.caption;
        }
        if (thumbnailUrl) {
          updateData.thumbnail_url = thumbnailUrl;
        }
        if (mediaUrls.length > 0) {
          updateData.media_urls = mediaUrls;
        }
        if (content.engagement) {
          updateData.engagement_metrics = content.engagement;
        }
        if (content.hashtags && content.hashtags.length > 0) {
          updateData.hashtags = content.hashtags;
        }
        if (content.mentions && content.mentions.length > 0) {
          updateData.mentions = content.mentions;
        }

        // Update raw_json with source URL for linking
        if (sourceUrl && !rawJson.url) {
          updateData.raw_json = { ...rawJson, url: sourceUrl };
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from('signals')
            .update(updateData)
            .eq('id', signal.id);

          if (updateError) {
            throw new Error(`Update failed: ${updateError.message}`);
          }

          results.updated++;
          console.log(`[backfill-signal-media] Updated signal ${signal.id} with ${Object.keys(updateData).join(', ')}`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.errors.push(`Signal ${signal.id}: ${message}`);
        console.error(`[backfill-signal-media] Error processing signal ${signal.id}:`, error);
      }
    }

    console.log(`[backfill-signal-media] Complete: ${results.updated}/${results.processed} updated`);

    return new Response(JSON.stringify({
      success: true,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[backfill-signal-media] Fatal error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function detectPlatform(url: string): string | null {
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('linkedin.com')) return 'linkedin';
  return null;
}

async function fetchSocialContent(url: string, platform: string): Promise<{
  caption?: string;
  imageUrl?: string;
  engagement?: Record<string, number>;
  hashtags?: string[];
  mentions?: string[];
} | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      console.log(`[fetchSocialContent] HTTP ${response.status} for ${url}`);
      return null;
    }

    const html = await response.text();
    return extractContentFromHtml(html, platform);

  } catch (error) {
    console.error(`[fetchSocialContent] Error fetching ${url}:`, error);
    return null;
  }
}

function extractContentFromHtml(html: string, platform: string): {
  caption?: string;
  imageUrl?: string;
  engagement?: Record<string, number>;
  hashtags?: string[];
  mentions?: string[];
} | null {
  const result: {
    caption?: string;
    imageUrl?: string;
    engagement?: Record<string, number>;
    hashtags?: string[];
    mentions?: string[];
  } = {};

  // Extract Open Graph image
  const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                       html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
  if (ogImageMatch) {
    result.imageUrl = ogImageMatch[1];
  }

  // Extract Open Graph description (often contains caption)
  const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                      html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i);
  if (ogDescMatch) {
    result.caption = decodeHtmlEntities(ogDescMatch[1]);
  }

  // Extract Twitter card image as fallback
  if (!result.imageUrl) {
    const twitterImageMatch = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    if (twitterImageMatch) {
      result.imageUrl = twitterImageMatch[1];
    }
  }

  // Platform-specific extraction
  if (platform === 'instagram') {
    // Try to get higher quality image from Instagram
    const instagramImageMatch = html.match(/"display_url"\s*:\s*"([^"]+)"/);
    if (instagramImageMatch) {
      result.imageUrl = instagramImageMatch[1].replace(/\\u0026/g, '&');
    }

    // Extract caption from Instagram
    const captionMatch = html.match(/"edge_media_to_caption".*?"text"\s*:\s*"([^"]+)"/);
    if (captionMatch) {
      result.caption = decodeHtmlEntities(captionMatch[1].replace(/\\n/g, '\n'));
    }

    // Extract engagement
    const likesMatch = html.match(/"edge_media_preview_like".*?"count"\s*:\s*(\d+)/);
    const commentsMatch = html.match(/"edge_media_to_comment".*?"count"\s*:\s*(\d+)/);
    if (likesMatch || commentsMatch) {
      result.engagement = {};
      if (likesMatch) result.engagement.likes = parseInt(likesMatch[1]);
      if (commentsMatch) result.engagement.comments = parseInt(commentsMatch[1]);
    }
  }

  // Extract hashtags from caption
  if (result.caption) {
    const hashtagMatches = result.caption.match(/#[\w]+/g);
    if (hashtagMatches) {
      result.hashtags = [...new Set(hashtagMatches)];
    }

    // Extract mentions
    const mentionMatches = result.caption.match(/@[\w.]+/g);
    if (mentionMatches) {
      result.mentions = [...new Set(mentionMatches)];
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function captureAndUploadMedia(
  supabase: any,
  imageUrl: string,
  platform: string
): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    });

    if (!response.ok) {
      console.log(`[captureAndUploadMedia] Failed to fetch image: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const extension = contentType.includes('png') ? 'png' : 
                      contentType.includes('gif') ? 'gif' : 
                      contentType.includes('webp') ? 'webp' : 'jpg';

    const arrayBuffer = await response.arrayBuffer();
    const fileName = `${platform}/images/${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;

    const { data, error } = await supabase.storage
      .from('osint-media')
      .upload(fileName, arrayBuffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      console.error(`[captureAndUploadMedia] Upload error:`, error);
      return null;
    }

    // Get signed URL (bucket is private)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('osint-media')
      .createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year signed URL

    if (signedUrlError) {
      console.error(`[captureAndUploadMedia] Signed URL error:`, signedUrlError);
      return null;
    }

    return signedUrlData?.signedUrl || null;

  } catch (error) {
    console.error(`[captureAndUploadMedia] Error:`, error);
    return null;
  }
}
