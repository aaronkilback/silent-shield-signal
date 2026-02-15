import { supabase } from "@/integrations/supabase/client";

const SIGNED_URL_EXPIRY = 3600; // 1 hour

/**
 * Get a signed URL for a file in a private storage bucket.
 * Falls back to empty string on error.
 */
export async function getSignedUrl(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_EXPIRY);
  
  if (error || !data?.signedUrl) {
    console.error(`Failed to get signed URL for ${bucket}/${path}:`, error);
    return '';
  }
  return data.signedUrl;
}

/**
 * Get signed URLs for multiple files in a bucket.
 */
export async function getSignedUrls(bucket: string, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, SIGNED_URL_EXPIRY);
  
  if (error || !data) {
    console.error(`Failed to get signed URLs for ${bucket}:`, error);
    return {};
  }
  
  const urlMap: Record<string, string> = {};
  data.forEach((item) => {
    if (item.signedUrl && item.path) {
      urlMap[item.path] = item.signedUrl;
    }
  });
  return urlMap;
}

/**
 * Upload a file and return a signed URL (for private buckets).
 */
export async function uploadAndGetSignedUrl(
  bucket: string,
  path: string,
  file: Blob | File,
  options?: { contentType?: string }
): Promise<{ url: string; error: Error | null }> {
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, options);

  if (uploadError) {
    return { url: '', error: uploadError };
  }

  const url = await getSignedUrl(bucket, path);
  return { url, error: null };
}
