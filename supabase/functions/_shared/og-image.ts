/**
 * OG Image Extraction
 * Fetches a URL and extracts the og:image or twitter:image meta tag.
 */
import { safeFetch } from "./safe-fetch.ts"; // WO-SSRF-SHARED-GUARD-01 wave 2

export async function extractOGImage(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FortressIntelligence/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    return html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1]
      || html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
      || null;
  } catch (e) {
    // WO-SSRF-SHARED-GUARD-01: surface a swallowed guard block (fail-loud) instead of a silent null.
    console.warn('[og-image] fetch blocked/failed:', (e as Error)?.message);
    return null;
  }
}
