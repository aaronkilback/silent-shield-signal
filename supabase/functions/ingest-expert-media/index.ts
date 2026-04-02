/**
 * ingest-expert-media
 *
 * Ingests content from human experts — YouTube videos, podcast RSS feeds,
 * LinkedIn articles, and websites — and distills structured knowledge entries
 * into expert_knowledge for all agents to leverage.
 *
 * Supports:
 *   - YouTube transcript fetch (via timedtext API, fallback to page scrape)
 *   - Podcast RSS feed parsing (latest N episodes)
 *   - Generic URL fetch (articles, LinkedIn posts, blog posts)
 *   - Full expert profile sweep (ingest all sources for a given expert)
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

interface IngestRequest {
  url?: string;                  // Single URL to ingest
  expert_profile_id?: string;    // Sweep all sources for this expert
  expert_name?: string;          // Optional override / manual attribution
  domain?: string;               // Override domain classification
  force?: boolean;               // Re-ingest even if already processed
  topics_only?: boolean;         // Skip media sources, run topic sweep only
  media_only?: boolean;          // Skip topic sweep, run media sources only
  youtube_limit?: number;        // Max YouTube videos to process (default 10, max 50)
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createServiceClient();
    const body = await req.json() as IngestRequest;
    const { url, expert_profile_id, expert_name, domain, force, topics_only, media_only, youtube_limit } = body;

    if (!url && !expert_profile_id) {
      return errorResponse('Provide either url or expert_profile_id', 400);
    }

    const results: any[] = [];

    // ── Expert profile sweep ──────────────────────────────────────────────
    if (expert_profile_id) {
      const { data: profile } = await supabase
        .from('expert_profiles')
        .select('*')
        .eq('id', expert_profile_id)
        .single();

      if (!profile) return errorResponse('Expert profile not found', 404);

      const expertDomains = domain ? [domain] : (profile.expertise_domains || []);
      const ingestionTopics: string[] = profile.ingestion_topics || [];

      const ytLimit = Math.min(youtube_limit || 10, 50);

      // ── 1. Ingest structured media sources ────────────────────────────
      if (!topics_only) {
        const urls: Array<{ url: string; type: string }> = [];
        if (profile.youtube_channel_url) urls.push({ url: profile.youtube_channel_url, type: 'youtube_channel' });
        if (profile.podcast_rss_url) urls.push({ url: profile.podcast_rss_url, type: 'podcast_rss' });
        if (profile.website_url) urls.push({ url: profile.website_url, type: 'article' });
        if (profile.linkedin_url) urls.push({ url: profile.linkedin_url, type: 'linkedin' });

        for (const source of urls) {
          const res = await ingestUrl({
            url: source.url,
            mediaType: source.type,
            expertName: profile.name,
            expertTitle: profile.title,
            expertProfileId: profile.id,
            domains: expertDomains,
            supabase,
            force,
            youtubeLimit: ytLimit,
          });
          results.push(res);
        }
      }

      // ── 2. Topic-driven deep ingestion via Perplexity ─────────────────
      // Runs synchronously when topics_only=true, otherwise fires as a
      // background self-invocation so it doesn't race the media timeout.
      if (!media_only && ingestionTopics.length > 0) {
        if (topics_only) {
          // Called directly for topics — run synchronously
          const topicResult = await ingestExpertTopics({
            expertName: profile.name,
            expertTitle: profile.title || '',
            linkedinUrl: profile.linkedin_url || null,
            topics: ingestionTopics,
            domains: expertDomains,
            expertProfileId: profile.id,
            supabase,
            force,
          });
          results.push(topicResult);
        } else {
          // Fire background self-invocation so media results aren't held hostage
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          if (supabaseUrl && serviceKey) {
            fetch(`${supabaseUrl}/functions/v1/ingest-expert-media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
              body: JSON.stringify({ expert_profile_id: profile.id, topics_only: true, force }),
            }).catch(() => {}); // fire-and-forget
          }
          results.push({ source: 'topic_ingestion', status: 'queued_background', topics: ingestionTopics.length });
        }
      }

      // Update last_ingested_at
      const totalEntries = results.reduce((s, r) => s + (r.entries_stored || 0), 0);
      await supabase.from('expert_profiles').update({
        last_ingested_at: new Date().toISOString(),
        ingestion_count: (profile.ingestion_count || 0) + totalEntries,
        updated_at: new Date().toISOString(),
      }).eq('id', expert_profile_id);

      return successResponse({
        expert: profile.name,
        sources_processed: urls.length,
        topics_processed: ingestionTopics.length,
        total_entries: totalEntries,
        results,
      });
    }

    // ── Single URL ingestion ──────────────────────────────────────────────
    if (url) {
      const mediaType = detectMediaType(url);
      const res = await ingestUrl({
        url,
        mediaType,
        expertName: expert_name || 'Unknown Expert',
        expertTitle: '',
        expertProfileId: null,
        domains: domain ? [domain] : [],
        supabase,
        force,
      });
      results.push(res);
    }

    return successResponse({
      processed: results.length,
      total_entries: results.reduce((s, r) => s + (r.entries_stored || 0), 0),
      results,
    });

  } catch (err) {
    console.error('[ingest-expert-media] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});

// ── Detect media type from URL ──────────────────────────────────────────────
function detectMediaType(url: string): string {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('linkedin.com')) return 'linkedin';
  if (url.includes('.rss') || url.includes('/feed') || url.includes('/rss')) return 'podcast_rss';
  if (url.includes('spotify.com') || url.includes('podcasts.apple.com')) return 'podcast_page';
  return 'article';
}

// ── Main ingestion router ───────────────────────────────────────────────────
async function ingestUrl(params: {
  url: string;
  mediaType: string;
  expertName: string;
  expertTitle: string;
  expertProfileId: string | null;
  domains: string[];
  supabase: any;
  force?: boolean;
  youtubeLimit?: number;
}): Promise<any> {
  const { url, mediaType, expertName, expertTitle, expertProfileId, domains, supabase, force, youtubeLimit = 10 } = params;

  console.log(`[ingest-expert-media] Ingesting ${mediaType}: ${url} (expert: ${expertName})`);

  try {
    let rawText = '';
    let title = '';
    let sourceItems: Array<{ title: string; text: string; itemUrl: string }> = [];

    if (mediaType === 'youtube' || mediaType === 'youtube_channel') {
      sourceItems = await fetchYouTubeContent(url, youtubeLimit);
    } else if (mediaType === 'podcast_rss') {
      sourceItems = await fetchPodcastRSS(url);
    } else if (mediaType === 'linkedin') {
      // LinkedIn blocks direct scraping — use Perplexity to surface their public content
      sourceItems = await fetchLinkedInViaSearch(url, expertName, expertTitle, domains);
    } else {
      // Generic fetch for articles, websites
      const fetched = await fetchPageContent(url);
      rawText = fetched.text;
      title = fetched.title;
      sourceItems = [{ title, text: rawText, itemUrl: url }];
    }

    if (sourceItems.length === 0) {
      return { url, entries_stored: 0, error: 'No content fetched — LinkedIn requires login, falling back to Perplexity search' };
    }

    // Process up to 10 items per source
    const toProcess = sourceItems.slice(0, 10);
    let totalStored = 0;

    for (const item of toProcess) {
      if (!item.text || item.text.length < 200) continue;

      // Skip if already ingested (by URL)
      if (!force) {
        const { data: existing } = await supabase
          .from('expert_knowledge')
          .select('id')
          .eq('source_url', item.itemUrl)
          .limit(1);
        if (existing?.length) continue;
      }

      const entries = await extractKnowledgeFromContent({
        text: item.text,
        title: item.title,
        expertName,
        expertTitle,
        domains,
        sourceUrl: item.itemUrl,
      });

      if (entries.length > 0) {
        const rows = entries.map(e => ({
          expert_profile_id: expertProfileId,
          expert_name: expertName,
          source_url: item.itemUrl,
          media_type: mediaType,
          domain: e.domain || (domains[0] || 'general'),
          subdomain: e.subdomain,
          knowledge_type: e.knowledge_type,
          title: e.title,
          content: e.content,
          applicability_tags: e.tags,
          citation: `${expertName}${expertTitle ? ` (${expertTitle})` : ''} — ${item.title || item.itemUrl}`,
          confidence_score: 0.80,
          source_type: 'expert_media',
          last_validated_at: new Date().toISOString(),
        }));

        const { error: insertErr } = await supabase.from('expert_knowledge').insert(rows);
        if (!insertErr) totalStored += rows.length;
        else console.error('[ingest-expert-media] Insert error:', insertErr.message);
      } else if (item.text.length > 50) {
        // Extraction returned nothing but we have content — store raw as a single knowledge entry
        // so we don't lose the data. Useful when Perplexity returns a summary that AI can't parse.
        const rawDomain = domains[0] || 'general';
        const { error: rawErr } = await supabase.from('expert_knowledge').insert({
          expert_profile_id: expertProfileId,
          expert_name: expertName,
          source_url: item.itemUrl,
          media_type: mediaType,
          domain: rawDomain,
          subdomain: 'general',
          knowledge_type: 'methodology',
          title: item.title || `${expertName} — Expert Knowledge`,
          content: item.text.slice(0, 2000),
          applicability_tags: domains,
          citation: `${expertName}${expertTitle ? ` (${expertTitle})` : ''}`,
          confidence_score: 0.65,
          source_type: 'expert_media_raw',
          last_validated_at: new Date().toISOString(),
        });
        if (!rawErr) totalStored += 1;
      }
    }

    return { url, media_type: mediaType, items_processed: toProcess.length, entries_stored: totalStored };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ingest-expert-media] Failed for ${url}:`, msg);
    return { url, entries_stored: 0, error: msg };
  }
}

// ── YouTube content fetcher ─────────────────────────────────────────────────
// For single videos: fetch transcript via timedtext API.
// For channel URLs: use the public RSS feed (/feeds/videos.xml) to get recent
// video IDs — this works without JavaScript rendering.
async function fetchYouTubeContent(url: string, limit = 10): Promise<Array<{ title: string; text: string; itemUrl: string }>> {
  const videoId = extractYouTubeVideoId(url);

  if (videoId) {
    const transcript = await fetchYouTubeTranscript(videoId);
    if (transcript) {
      return [{ title: `YouTube Video ${videoId}`, text: transcript, itemUrl: `https://www.youtube.com/watch?v=${videoId}` }];
    }
    const page = await fetchPageContent(`https://www.youtube.com/watch?v=${videoId}`);
    if (page.text) return [{ title: page.title || `YouTube Video ${videoId}`, text: page.text, itemUrl: `https://www.youtube.com/watch?v=${videoId}` }];
    return [];
  }

  // Channel URL — resolve channel ID then use YouTube Data API (or RSS fallback)
  const channelId = await resolveChannelId(url);
  const videoIds = channelId
    ? await fetchVideoIdsViaYouTubeAPI(channelId, limit)
    : await fetchVideoIdsFromChannelRss(
        url.includes('/channel/') ? `https://www.youtube.com/feeds/videos.xml?channel_id=${url.split('/channel/')[1]?.split('/')[0]}` : url,
        limit
      );

  const results: Array<{ title: string; text: string; itemUrl: string }> = [];

  for (const { id, title } of videoIds.slice(0, limit)) {
    const transcript = await fetchYouTubeTranscript(id);
    if (transcript) {
      results.push({ title, text: transcript, itemUrl: `https://www.youtube.com/watch?v=${id}` });
    } else {
      // Fallback: use video description from watch page
      const page = await fetchPageContent(`https://www.youtube.com/watch?v=${id}`);
      if (page.text && page.text.length > 100) {
        results.push({ title: title || page.title, text: page.text, itemUrl: `https://www.youtube.com/watch?v=${id}` });
      }
    }
  }

  return results;
}

async function resolveChannelId(channelUrl: string): Promise<string | null> {
  const channelIdMatch = channelUrl.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/);
  if (channelIdMatch) return channelIdMatch[1];

  // Fetch channel page to extract channelId from page data
  try {
    const resp = await fetch(channelUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SecurityBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const idMatch = html.match(/"channelId":"(UC[A-Za-z0-9_-]+)"/) || html.match(/"externalId":"(UC[A-Za-z0-9_-]+)"/);
    if (idMatch) return idMatch[1];
  } catch (_) {}
  return null;
}

async function fetchVideoIdsViaYouTubeAPI(channelId: string, limit: number): Promise<Array<{ id: string; title: string }>> {
  const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY');
  if (!YOUTUBE_API_KEY) return fetchVideoIdsFromChannelRss(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, limit);

  const results: Array<{ id: string; title: string }> = [];
  let pageToken = '';

  while (results.length < limit) {
    const params = new URLSearchParams({
      part: 'snippet',
      channelId,
      maxResults: String(Math.min(50, limit - results.length)),
      order: 'date',
      type: 'video',
      key: YOUTUBE_API_KEY,
      ...(pageToken ? { pageToken } : {}),
    });

    try {
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) break;
      const data = await resp.json();

      for (const item of (data.items || [])) {
        const videoId = item.id?.videoId;
        const title = item.snippet?.title || '';
        if (videoId) results.push({ id: videoId, title });
      }

      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    } catch (_) {
      break;
    }
  }

  return results;
}

async function fetchVideoIdsFromChannelRss(rssUrl: string, limit = 15): Promise<Array<{ id: string; title: string }>> {
  try {
    const resp = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SecurityBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const results: Array<{ id: string; title: string }> = [];
    const entries = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
    for (const entry of entries) {
      const idMatch = entry[1].match(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/);
      const titleMatch = entry[1].match(/<title>([\s\S]*?)<\/title>/);
      if (idMatch) results.push({ id: idMatch[1], title: titleMatch?.[1]?.trim() || '' });
      if (results.length >= limit) break;
    }
    return results;
  } catch (_) {
    return [];
  }
}

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractVideoIdsFromPage(text: string): string[] {
  const ids = new Set<string>();
  const matches = text.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g);
  for (const m of matches) ids.add(m[1]);
  return [...ids].slice(0, 10);
}

async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
  // Try YouTube timedtext API
  const timedtextUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`;
  try {
    const resp = await fetch(timedtextUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SecurityBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const events = data.events || [];
      const lines: string[] = [];
      for (const ev of events) {
        if (ev.segs) {
          const line = ev.segs.map((s: any) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
          if (line) lines.push(line);
        }
      }
      if (lines.length > 10) return lines.join(' ');
    }
  } catch (_) { /* fallback */ }

  // Try watch page for auto-captions data
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SecurityBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const html = await resp.text();
      // Extract video description as fallback content
      const descMatch = html.match(/"description":\{"simpleText":"((?:[^"\\]|\\.)*)"\}/);
      if (descMatch) {
        const desc = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        if (desc.length > 100) return desc;
      }
    }
  } catch (_) { /* give up */ }

  return null;
}

// ── Podcast RSS fetcher ─────────────────────────────────────────────────────
async function fetchPodcastRSS(rssUrl: string): Promise<Array<{ title: string; text: string; itemUrl: string }>> {
  try {
    const resp = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SecurityBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const xml = await resp.text();

    // Extract <item> blocks
    const items: Array<{ title: string; text: string; itemUrl: string }> = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of itemMatches) {
      const block = match[1];
      const titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/);
      const descMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/);
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>|<enclosure[^>]*url="([^"]+)"/);
      const contentMatch = block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/);

      const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim();
      const rawText = (contentMatch?.[1] || descMatch?.[1] || descMatch?.[2] || '').trim();
      const text = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const itemUrl = (linkMatch?.[1] || linkMatch?.[2] || '').trim();

      if (title && text.length > 100) {
        items.push({ title, text, itemUrl: itemUrl || rssUrl });
      }

      if (items.length >= 5) break;
    }

    return items;
  } catch (err) {
    console.error('[ingest-expert-media] RSS fetch error:', err);
    return [];
  }
}

// ── LinkedIn via Perplexity search ─────────────────────────────────────────
// LinkedIn blocks direct scraping. Instead we use Perplexity to search for
// the expert's publicly available posts, articles, and interviews.
async function fetchLinkedInViaSearch(
  linkedinUrl: string,
  expertName: string,
  expertTitle: string,
  domains: string[]
): Promise<Array<{ title: string; text: string; itemUrl: string }>> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

  const domainHint = domains.length > 0 ? domains.join(', ') : 'security';

  // Extract LinkedIn slug for disambiguation — critical for common names like "Sarah Adams"
  const slugMatch = linkedinUrl.match(/linkedin\.com\/in\/([^/?&#]+)/);
  const linkedinSlug = slugMatch ? slugMatch[1] : null;
  const slugHint = linkedinSlug ? ` (LinkedIn: linkedin.com/in/${linkedinSlug})` : '';

  // Build specific queries — use title and slug to disambiguate common names
  const titleHint = expertTitle ? `"${expertTitle}"` : '';
  const queries = [
    // Most specific: name + title + domain
    `${expertName} ${titleHint} ${domainHint} expert insights advice frameworks`,
    // LinkedIn-specific: their posts and articles
    `${expertName}${slugHint} LinkedIn articles posts security tactical advice`,
    // Broader web presence: podcasts, interviews, books
    `${expertName} ${titleHint} podcast interview book keynote ${domainHint}`,
  ];

  const results: Array<{ title: string; text: string; itemUrl: string }> = [];

  if (PERPLEXITY_API_KEY) {
    for (const query of queries) {
      try {
        const resp = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'sonar-pro',
            messages: [
              {
                role: 'system',
                content: `You are a research assistant extracting expert knowledge. The person you are researching is ${expertName}${expertTitle ? ` — ${expertTitle}` : ''}${slugHint}. Summarize their specific expert advice, named frameworks, tactical recommendations, mental models, and key principles they are known for teaching. Focus on the domains: ${domainHint}. If you cannot find this specific person, say "Not found" rather than describing someone else.`,
              },
              { role: 'user', content: query },
            ],
            temperature: 0.1,
            search_recency_filter: 'year',
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (resp.ok) {
          const data = await resp.json();
          const content = data.choices?.[0]?.message?.content || '';
          const citations: string[] = data.citations || [];

          // Skip if Perplexity couldn't find this specific person
          if (content.toLowerCase().includes('not found') && content.length < 200) continue;

          if (content.length > 50) {
            results.push({
              title: `${expertName} — ${domainHint} (via Perplexity)`,
              text: content + (citations.length ? `\n\nSources:\n${citations.join('\n')}` : ''),
              itemUrl: linkedinUrl,
            });
            // One good result is enough per expert — don't over-query
            if (results.length >= 2) break;
          }
        }
      } catch (e) {
        console.error('[ingest-expert-media] Perplexity search error:', e);
      }
    }
  }

  // Fallback: try a direct LinkedIn fetch (may get partial pre-login content)
  if (results.length === 0) {
    const fetched = await fetchPageContent(linkedinUrl);
    if (fetched.text.length > 50) {
      results.push({ title: fetched.title || expertName, text: fetched.text, itemUrl: linkedinUrl });
    }
  }

  return results;
}

// ── Generic page fetcher ────────────────────────────────────────────────────
async function fetchPageContent(url: string): Promise<{ title: string; text: string }> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SecurityBot/1.0)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return { title: '', text: '' };
    const html = await resp.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = (titleMatch?.[1] || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').trim();

    // Strip scripts, styles, nav, footer
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 15000);

    return { title, text: stripped };
  } catch (err) {
    console.error('[ingest-expert-media] Page fetch error:', err);
    return { title: '', text: '' };
  }
}

// ── Topic-driven deep ingestion ─────────────────────────────────────────────
// Runs one Perplexity query per topic, extracts structured knowledge entries,
// and stores them. This is the primary way to capture an expert's full body
// of work across books, frameworks, interviews, and online content.
async function ingestExpertTopics(params: {
  expertName: string;
  expertTitle: string;
  linkedinUrl: string | null;
  topics: string[];
  domains: string[];
  expertProfileId: string;
  supabase: any;
  force?: boolean;
}): Promise<any> {
  const { expertName, expertTitle, linkedinUrl, topics, domains, expertProfileId, supabase, force } = params;
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

  if (!PERPLEXITY_API_KEY) {
    return { source: 'topic_ingestion', entries_stored: 0, error: 'PERPLEXITY_API_KEY not configured' };
  }

  const slugMatch = linkedinUrl?.match(/linkedin\.com\/in\/([^/?&#]+)/);
  const slugHint = slugMatch ? ` (linkedin.com/in/${slugMatch[1]})` : '';
  let totalStored = 0;
  const topicResults: any[] = [];

  // ── Skip already-ingested topics (unless force) ──────────────────────
  let topicsToProcess = topics;
  if (!force) {
    const { data: existingTitles } = await supabase
      .from('expert_knowledge')
      .select('title')
      .eq('expert_profile_id', expertProfileId)
      .eq('source_type', 'expert_topic_search');
    const existingSet = new Set((existingTitles || []).map((r: any) => r.title.toLowerCase()));
    topicsToProcess = topics.filter(t =>
      !existingSet.has(`${expertName}: ${t.split(' ').slice(0, 6).join(' ')}`.toLowerCase())
    );
  }

  if (topicsToProcess.length === 0) {
    return { source: 'topic_ingestion', entries_stored: 0, skipped: 'all topics already ingested' };
  }

  // ── Query all topics in parallel with a 50s budget ───────────────────
  const queryTopic = async (topic: string): Promise<{ topic: string; content: string; citations: string[] } | null> => {
    try {
      const resp = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'sonar-pro',
          messages: [
            {
              role: 'system',
              content: `You are a research analyst building a detailed knowledge base entry about ${expertName}${expertTitle ? ` (${expertTitle})` : ''}${slugHint}. Extract their specific expert knowledge — exact frameworks they've named, specific techniques they teach, direct quotes, step-by-step methodologies, and concrete actionable advice. Be specific and dense. Do not describe other people. If ${expertName} has not covered this topic, say "NOT COVERED" and nothing else.`,
            },
            {
              role: 'user',
              content: `What does ${expertName} specifically teach, recommend, or practice regarding: ${topic}? Include named frameworks, specific procedures, and key principles they are known for in this area.`,
            },
          ],
          temperature: 0.1,
          search_recency_filter: 'year',
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (content.length < 50 || content.startsWith('NOT COVERED')) return null;
      return { topic, content, citations: data.citations || [] };
    } catch (_) {
      return null;
    }
  };

  // Run in parallel batches of 5 to stay within rate limits
  const BATCH_SIZE = 5;
  const allRaw: Array<{ topic: string; content: string; citations: string[] }> = [];
  for (let i = 0; i < topicsToProcess.length; i += BATCH_SIZE) {
    const batch = topicsToProcess.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(queryTopic));
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) allRaw.push(r.value);
    }
  }

  // ── Extract + store results ───────────────────────────────────────────
  for (const raw of allRaw) {
    const fullText = raw.content + (raw.citations.length ? `\n\nSources: ${raw.citations.join(', ')}` : '');
    const entries = await extractKnowledgeFromContent({
      text: fullText,
      title: `${expertName}: ${raw.topic}`,
      expertName,
      expertTitle,
      domains,
      sourceUrl: linkedinUrl || `expert:${expertName}`,
    });

    if (entries.length > 0) {
      const rows = entries.map(e => ({
        expert_profile_id: expertProfileId,
        expert_name: expertName,
        source_url: linkedinUrl || `expert:${expertName.toLowerCase().replace(/\s+/g, '-')}`,
        media_type: 'topic_search',
        domain: e.domain || (domains[0] || 'general'),
        subdomain: e.subdomain,
        knowledge_type: e.knowledge_type,
        title: e.title,
        content: e.content,
        applicability_tags: e.tags,
        citation: `${expertName}${expertTitle ? ` (${expertTitle})` : ''} — ${raw.topic}`,
        confidence_score: 0.82,
        source_type: 'expert_topic_search',
        last_validated_at: new Date().toISOString(),
      }));
      const { error: insertErr } = await supabase.from('expert_knowledge').insert(rows);
      const stored = insertErr ? 0 : rows.length;
      totalStored += stored;
      topicResults.push({ topic: raw.topic, entries_stored: stored });
    } else {
      // Store raw summary as fallback
      const { error: rawErr } = await supabase.from('expert_knowledge').insert({
        expert_profile_id: expertProfileId,
        expert_name: expertName,
        source_url: linkedinUrl || `expert:${expertName.toLowerCase().replace(/\s+/g, '-')}`,
        media_type: 'topic_search',
        domain: domains[0] || 'general',
        subdomain: raw.topic.split(' ')[0],
        knowledge_type: 'methodology',
        title: `${expertName}: ${raw.topic.split(' ').slice(0, 6).join(' ')}`,
        content: fullText.slice(0, 2000),
        applicability_tags: domains,
        citation: `${expertName}${expertTitle ? ` (${expertTitle})` : ''}`,
        confidence_score: 0.70,
        source_type: 'expert_topic_raw',
        last_validated_at: new Date().toISOString(),
      });
      if (!rawErr) totalStored += 1;
      topicResults.push({ topic: raw.topic, entries_stored: rawErr ? 0 : 1, raw: true });
    }
  }

  return {
    source: 'topic_ingestion',
    topics_processed: topics.length,
    entries_stored: totalStored,
    topic_results: topicResults,
  };
}

// ── AI knowledge extraction ─────────────────────────────────────────────────
async function extractKnowledgeFromContent(params: {
  text: string;
  title: string;
  expertName: string;
  expertTitle: string;
  domains: string[];
  sourceUrl: string;
}): Promise<Array<{
  title: string;
  content: string;
  domain: string;
  subdomain: string;
  knowledge_type: string;
  tags: string[];
}>> {
  const { text, title, expertName, expertTitle, domains } = params;

  const domainHint = domains.length > 0
    ? `The expert specializes in: ${domains.join(', ')}.`
    : '';

  const systemPrompt = `You are a senior intelligence analyst extracting structured expert knowledge.
Your task: read content from a real-world expert and distill it into 3-5 actionable knowledge entries for a security operations platform.
${domainHint}

Each entry must have:
- "title": concise (max 100 chars)
- "content": 150-400 words of dense, actionable knowledge. Preserve the expert's specific frameworks, mental models, principles, and tactical advice. Quote their exact phrases or frameworks where possible.
- "domain": one of: cyber, physical_security, executive_protection, crisis_management, threat_intelligence, travel_security, compliance, geopolitical, counter_terrorism, fraud_social_engineering, leadership, insider_threat, maritime_security
- "subdomain": specific area (e.g., "lock_picking", "surveillance_detection", "extreme_ownership")
- "knowledge_type": one of: best_practice, framework, methodology, case_study, threat_pattern, mental_model, tactical_doctrine
- "tags": 3-6 applicability tags

IMPORTANT: Extract ONLY real knowledge that appears in the content. Do not invent or hallucinate. If the content is too thin, return fewer entries.
Return ONLY a JSON array. No markdown, no explanation.`;

  const userPrompt = `Expert: ${expertName}${expertTitle ? ` (${expertTitle})` : ''}
Source: ${title || 'Unknown'}

CONTENT:
${text.slice(0, 6000)}`;

  try {
    const result = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      functionName: 'ingest-expert-media-extract',
      retries: 1,
      extraBody: { max_completion_tokens: 3000 },
    });

    if (result.error || !result.content) return [];

    const cleaned = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : (parsed.entries || parsed.knowledge || []);
    return Array.isArray(arr) ? arr.slice(0, 5) : [];
  } catch (err) {
    console.error('[ingest-expert-media] Extraction error:', err);
    return [];
  }
}
