// Small URL sanitizer used by UI components to avoid rendering raw XML/HTML as links.
// Extracts the first http(s) URL from a string, after decoding common entities.

export function extractHttpUrl(input?: string | null): string | null {
  if (!input) return null;

  const decoded = String(input)
    .trim()
    // decode common entities (enough for our feed/link use-cases)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ");

  // If it already looks like a URL, just trim common trailing delimiters.
  if (/^https?:\/\//i.test(decoded)) {
    return decoded.replace(/[\"'<>\)]+$/g, "");
  }

  // Otherwise, extract the first URL-like substring.
  const match = decoded.match(/https?:\/\/[^\s"<>]+/i);
  if (!match?.[0]) return null;
  return match[0].replace(/[\"'<>\)]+$/g, "");
}
