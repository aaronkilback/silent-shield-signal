/**
 * Shared storage URL helpers for Fortress edge functions.
 *
 * ALL Fortress buckets are private. Using getPublicUrl() on a private bucket
 * produces a URL that returns 400/InvalidJWT when fetched. NEVER call
 * getPublicUrl() directly — use getSignedUrl() from this module.
 *
 * Bucket registry (authoritative — update here when adding a new bucket):
 *
 *   BUCKET              VISIBILITY   RECOMMENDED EXPIRY
 *   tenant-files        private      604800s (7 days)
 *   osint-media         private      604800s (7 days)  — or 3600s for pipeline use
 *   entity-photos       private      604800s (7 days)
 *   agent-avatars       private      604800s (7 days)
 *
 * --- Usage ---
 *
 *   import { getSignedUrl, BUCKETS } from "../_shared/storage.ts";
 *
 *   // 7-day link for a user-facing report image
 *   const url = await getSignedUrl(supabase, BUCKETS.OSINT_MEDIA, storagePath);
 *
 *   // 1-hour link for transient pipeline use
 *   const url = await getSignedUrl(supabase, BUCKETS.OSINT_MEDIA, storagePath, 3600);
 *
 *   // Returns '' if signing fails — always check before embedding in output
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const BUCKETS = {
  TENANT_FILES:  "tenant-files",
  OSINT_MEDIA:   "osint-media",
  ENTITY_PHOTOS: "entity-photos",
  AGENT_AVATARS: "agent-avatars",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

/** Default signed URL expiry: 7 days */
const DEFAULT_EXPIRY_SECONDS = 604800;

/**
 * Create a signed URL for a file in a private Fortress bucket.
 * Returns '' if the signing call fails (log the error and handle gracefully).
 */
export async function getSignedUrl(
  supabase: SupabaseClient,
  bucket: BucketName,
  path: string,
  expirySeconds: number = DEFAULT_EXPIRY_SECONDS
): Promise<string> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expirySeconds);
    if (error) {
      console.error(`[storage] createSignedUrl failed (${bucket}/${path}):`, error.message);
      return "";
    }
    return data?.signedUrl ?? "";
  } catch (e) {
    console.error(`[storage] createSignedUrl threw (${bucket}/${path}):`, e);
    return "";
  }
}
