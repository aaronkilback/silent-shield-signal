// Media capture utilities for OSINT monitoring
// Supports downloading and storing images, videos, and audio from social media

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSignedUrl, BUCKETS } from "./storage.ts";

export interface MediaFile {
  url: string;
  type: 'image' | 'video' | 'audio' | 'unknown';
  filename: string;
  storagePath?: string;
  storageUrl?: string;
  thumbnailUrl?: string;
  mime?: string;
  size?: number;
}

export interface MediaCaptureResult {
  success: boolean;
  storedMedia: MediaFile[];
  errors: string[];
}

// Detect media type from URL or content-type
export function detectMediaType(url: string, contentType?: string): 'image' | 'video' | 'audio' | 'unknown' {
  const urlLower = url.toLowerCase();
  
  // Check content-type first
  if (contentType) {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('audio/')) return 'audio';
  }
  
  // Image extensions
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif)(\?|$)/i.test(urlLower)) return 'image';
  
  // Video extensions
  if (/\.(mp4|mov|avi|wmv|flv|webm|mkv|m4v|3gp)(\?|$)/i.test(urlLower)) return 'video';
  
  // Audio extensions
  if (/\.(mp3|wav|aac|ogg|flac|m4a|wma)(\?|$)/i.test(urlLower)) return 'audio';
  
  // Platform-specific patterns
  if (urlLower.includes('instagram.com/p/') || urlLower.includes('instagram.com/reel/')) return 'image'; // Could be video
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) return 'video';
  if (urlLower.includes('tiktok.com')) return 'video';
  if (urlLower.includes('twitter.com/i/status') || urlLower.includes('x.com/i/status')) return 'image';
  
  return 'unknown';
}

// Extract media URLs from text content
export function extractMediaUrls(text: string): string[] {
  const mediaUrls: string[] = [];
  
  // Common media URL patterns
  const patterns = [
    // Direct image/video URLs
    /https?:\/\/[^\s<>"{}|\\^`\[\]]+\.(jpg|jpeg|png|gif|webp|mp4|mov|webm|mp3|wav)/gi,
    // Instagram media
    /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[a-zA-Z0-9_-]+/gi,
    // Twitter/X media
    /https?:\/\/(?:pbs\.twimg\.com|video\.twimg\.com)\/[^\s<>"]+/gi,
    // YouTube
    /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/gi,
    // Facebook videos
    /https?:\/\/(?:www\.)?facebook\.com\/[^\s<>"]+\/videos\/[0-9]+/gi,
    // CDN image patterns
    /https?:\/\/[^\s<>"]+(?:cdn|media|image|photo|video)[^\s<>"]*\.(jpg|jpeg|png|gif|mp4)/gi,
  ];
  
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (!mediaUrls.includes(match[0])) {
        mediaUrls.push(match[0]);
      }
    }
  }
  
  return mediaUrls;
}

// Generate a unique filename for storage
function generateFilename(url: string, mediaType: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  
  // Try to extract extension from URL
  const extMatch = url.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|webm|mp3|wav|m4a)(\?|$)/i);
  let ext = extMatch ? extMatch[1].toLowerCase() : '';
  
  // Default extensions by type
  if (!ext) {
    switch (mediaType) {
      case 'image': ext = 'jpg'; break;
      case 'video': ext = 'mp4'; break;
      case 'audio': ext = 'mp3'; break;
      default: ext = 'bin';
    }
  }
  
  return `${timestamp}_${random}.${ext}`;
}

// Download and store a media file
export async function downloadAndStoreMedia(
  supabase: SupabaseClient,
  url: string,
  sourceType: string = 'osint'
): Promise<MediaFile | null> {
  try {
    // Skip if URL is too long or invalid
    if (!url || url.length > 2048 || !url.startsWith('http')) {
      return null;
    }

    // Detect media type
    const mediaType = detectMediaType(url);
    
    // Only process known media types
    if (mediaType === 'unknown') {
      console.log(`Skipping unknown media type: ${url.substring(0, 100)}`);
      return null;
    }

    console.log(`Downloading ${mediaType}: ${url.substring(0, 100)}...`);

    // Fetch the media file
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      console.log(`Failed to fetch media: ${response.status}`);
      return null;
    }

    // Check content type and size
    const contentType = response.headers.get('content-type') || '';
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    
    // Skip if too large (50MB limit)
    if (contentLength > 50 * 1024 * 1024) {
      console.log(`Media too large: ${contentLength} bytes`);
      return null;
    }

    // Get the file data
    const buffer = await response.arrayBuffer();
    const blob = new Blob([buffer], { type: contentType });
    
    // Generate filename and path
    const filename = generateFilename(url, mediaType);
    const storagePath = `${sourceType}/${mediaType}s/${filename}`;
    
    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('osint-media')
      .upload(storagePath, blob, {
        contentType: contentType || `${mediaType}/*`,
        upsert: false,
      });

    if (uploadError) {
      console.error(`Upload error: ${uploadError.message}`);
      return null;
    }

    const storageUrl = await getSignedUrl(supabase, BUCKETS.OSINT_MEDIA, storagePath, 3600);

    const mediaFile: MediaFile = {
      url: url,
      type: mediaType,
      filename: filename,
      storagePath: storagePath,
      storageUrl,
      mime: contentType,
      size: buffer.byteLength,
    };

    console.log(`Stored ${mediaType}: ${storagePath}`);
    return mediaFile;

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`Download timeout: ${url.substring(0, 100)}`);
    } else {
      console.error(`Media download error: ${error}`);
    }
    return null;
  }
}

// Process multiple media URLs and store them
export async function captureMediaFromContent(
  supabase: SupabaseClient,
  content: string,
  sourceType: string = 'osint',
  maxFiles: number = 5
): Promise<MediaCaptureResult> {
  const result: MediaCaptureResult = {
    success: true,
    storedMedia: [],
    errors: [],
  };

  // Extract media URLs from content
  const mediaUrls = extractMediaUrls(content);
  console.log(`Found ${mediaUrls.length} potential media URLs`);

  // Limit number of downloads
  const urlsToProcess = mediaUrls.slice(0, maxFiles);

  for (const url of urlsToProcess) {
    try {
      const mediaFile = await downloadAndStoreMedia(supabase, url, sourceType);
      if (mediaFile) {
        result.storedMedia.push(mediaFile);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Failed to download ${url}: ${errorMsg}`);
    }
    
    // Small delay between downloads to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return result;
}

// Create attachment records for stored media
export async function createMediaAttachments(
  supabase: SupabaseClient,
  parentType: 'signal' | 'incident' | 'document' | 'entity',
  parentId: string,
  storedMedia: MediaFile[]
): Promise<string[]> {
  const attachmentIds: string[] = [];

  for (const media of storedMedia) {
    if (!media.storageUrl) continue;

    const { data, error } = await supabase
      .from('attachments')
      .insert({
        parent_type: parentType,
        parent_id: parentId,
        filename: media.filename,
        mime: media.mime || `${media.type}/*`,
        storage_url: media.storageUrl,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`Failed to create attachment: ${error.message}`);
    } else if (data) {
      attachmentIds.push(data.id);
    }
  }

  return attachmentIds;
}

// Get media summary for display
export function getMediaSummary(media: MediaFile[]): { images: number; videos: number; audio: number } {
  return {
    images: media.filter(m => m.type === 'image').length,
    videos: media.filter(m => m.type === 'video').length,
    audio: media.filter(m => m.type === 'audio').length,
  };
}