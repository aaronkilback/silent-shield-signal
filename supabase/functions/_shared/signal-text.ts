/**
 * signal-text — small text-cleanup helpers for incoming signal content.
 *
 * Google Custom Search snippets and several RSS aggregators return text
 * cluttered with artefacts that leak into Fortress signal feeds, brief
 * renderers, and especially the auto-generated `title` column. The most
 * common offenders:
 *
 *   - relative-time preludes: "1 day ago … …", "10 hours ago … "
 *   - multi-ellipsis truncation chains: "… … British Columbia"
 *   - trailing source attributions: "… in effect - Facebook"
 *
 * These artefacts shouldn't be parsed away by individual monitors with
 * one-off regex; they should be removed once, at signal-text intake,
 * before anything downstream sees them. This module owns that.
 *
 * Added 2026-05-12 after the CTI / BC Place demo prep surfaced both
 * (a) garbage middle-of-sentence titles in the live signal feed and
 * (b) the same artefacts leaking through to the Executive Intelligence
 * Brief's signal excerpts.
 */

/**
 * Strip Google CSE / RSS-snippet artefacts so signal text reads like
 * curated intelligence rather than raw search-result previews.
 *
 * - Leading "N (day|hour|minute|week|month)s? ago …" is removed
 * - Trailing " - Facebook | Reddit | Twitter | …" attributions removed
 * - Chained "… … …" ellipsis runs collapse to a single unicode ellipsis
 * - Multi-dot truncation (3+) collapsed to ellipsis
 * - Internal whitespace normalized
 *
 * Safe to call on any text including null/undefined — returns "".
 */
export function cleanSignalExcerpt(text: string | null | undefined): string {
  if (!text) return '';
  let t = text;
  t = t.replace(/^\s*\d+\s*(day|hour|minute|month|week)s?\s+ago\s*\.{2,}\s*/i, '');
  t = t.replace(/\s*[-–—]\s*(Facebook|Reddit|Twitter|X|LinkedIn|Instagram|YouTube|TikTok|Telegram)\s*$/i, '');
  t = t.replace(/(?:\.{2,}\s*){2,}/g, '… ');
  t = t.replace(/\.{3,}/g, '…');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}
