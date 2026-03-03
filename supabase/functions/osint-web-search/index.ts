import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const FETCH_TIMEOUT_MS = 8000;
const MAX_ARTICLE_LENGTH = 15000; // chars to keep from fetched articles

/**
 * Fetch full article text from a URL, stripping HTML to plain text.
 * Returns snippet as fallback if fetch fails.
 */
async function fetchArticleContent(url: string, fallbackSnippet: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FortressBot/1.0; +https://fortress.ai)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`[ArticleFetch] HTTP ${response.status} for ${url}, using snippet`);
      return fallbackSnippet;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      console.log(`[ArticleFetch] Non-HTML content (${contentType}) for ${url}, using snippet`);
      await response.text(); // consume body
      return fallbackSnippet;
    }

    const html = await response.text();

    // Strip scripts, styles, nav/header/footer, then tags
    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length < 100) {
      console.log(`[ArticleFetch] Extracted text too short (${cleaned.length} chars) for ${url}, using snippet`);
      return fallbackSnippet;
    }

    const truncated = cleaned.length > MAX_ARTICLE_LENGTH
      ? cleaned.substring(0, MAX_ARTICLE_LENGTH) + '...[truncated]'
      : cleaned;

    console.log(`[ArticleFetch] Extracted ${truncated.length} chars from ${url}`);
    return truncated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      console.log(`[ArticleFetch] Timeout fetching ${url}, using snippet`);
    } else {
      console.log(`[ArticleFetch] Error fetching ${url}: ${msg}, using snippet`);
    }
    return fallbackSnippet;
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const googleApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const googleEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

    if (!googleApiKey || !googleEngineId) throw new Error('Google Search API not configured');

    const body = await req.json().catch(() => ({}));
    const entityId = body.entity_id;
    const skipArticleFetch = body.skip_article_fetch === true;

    if (!entityId) return errorResponse('entity_id is required', 400);

    const { data: entity, error: entityError } = await supabase.from('entities').select('*').eq('id', entityId).single();
    if (entityError || !entity) throw new Error('Entity not found');

    console.log(`Performing OSINT web search for: ${entity.name}${skipArticleFetch ? ' (snippet-only mode)' : ' (full article fetch)'}`);
    
    const attributes = entity.attributes || {};
    const contactInfo = attributes.contact_info || {};
    const socialMedia = contactInfo.social_media || {};
    const location = entity.current_location || '';

    let contentCreated = 0;
    let signalsCreated = 0;
    let duplicatesSkipped = 0;
    let articlesFetched = 0;

    const extractKeywords = (name: string): string[] => {
      const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'of', 'in', 'on', 'at', 'to', 'with', 'by']);
      return name.split(/\s+/).filter(word => word.length > 2 && !stopWords.has(word.toLowerCase())).slice(0, 5);
    };

    const keywords = extractKeywords(entity.name);
    const keywordQuery = keywords.join(' ');
    
    const searchQueries: string[] = [];
    if (entity.name.split(/\s+/).length <= 3) {
      searchQueries.push(`"${entity.name}"`, `"${entity.name}" news`);
    } else {
      searchQueries.push(keywordQuery, `${keywordQuery} news`);
    }
    searchQueries.push(entity.name);
    if (location) searchQueries.push(`${keywordQuery} ${location}`);
    searchQueries.push(`site:facebook.com ${keywordQuery}`, `site:linkedin.com ${keywordQuery}`);

    for (const query of searchQueries.slice(0, 10)) {
      try {
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleEngineId}&q=${encodeURIComponent(query)}&num=5`;
        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) continue;

        const searchData = await searchResponse.json();
        for (const item of searchData.items || []) {
          // Fetch full article content unless skipped
          const articleContent = skipArticleFetch
            ? item.snippet
            : await fetchArticleContent(item.link, item.snippet);
          
          const isFullArticle = articleContent.length > (item.snippet?.length || 0) + 50;
          if (isFullArticle) articlesFetched++;

          // Analyze with richer context when full article is available
          const analysisContent = isFullArticle
            ? `Analyze for entity "${entity.name}":\nTitle: ${item.title}\nURL: ${item.link}\nFull Article Content (first ${MAX_ARTICLE_LENGTH} chars):\n${articleContent}`
            : `Analyze for entity "${entity.name}": Title: ${item.title}, URL: ${item.link}, Snippet: ${item.snippet}`;

          const aiResult = await callAiGateway({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'Analyze web content for relevance to the target entity. Return JSON with: relevance_score (0-1), is_relevant (boolean), summary (2-3 sentence distillation of key facts), sentiment, security_concerns array, create_signal (boolean), signal_severity.' },
              { role: 'user', content: analysisContent }
            ],
            functionName: 'osint-web-search',
            extraBody: { response_format: { type: 'json_object' } },
          });

          if (aiResult.error || !aiResult.content) continue;

          const analysis = JSON.parse(aiResult.content);
          if (!analysis.is_relevant || analysis.relevance_score < 0.5) continue;

          const relevanceInt = Math.round((analysis.relevance_score || 0) * 100);
          const { error: contentError } = await supabase.from('entity_content').insert({
            entity_id: entityId, url: item.link, title: item.title, excerpt: item.snippet,
            content_text: articleContent, content_type: 'web',
            source: new URL(item.link).hostname, relevance_score: relevanceInt, sentiment: analysis.sentiment
          });

          if (contentError?.code === '23505') duplicatesSkipped++;
          else if (!contentError) contentCreated++;

          if (analysis.create_signal && analysis.security_concerns?.length > 0) {
            const severityInt = analysis.signal_severity === 'critical' ? 90 : analysis.signal_severity === 'high' ? 75 : analysis.signal_severity === 'medium' ? 50 : 30;
            const severityLabel = severityInt >= 80 ? 'critical' : severityInt >= 50 ? 'high' : severityInt >= 20 ? 'medium' : 'low';
            const { data: signalData } = await supabase.from('signals').insert({
              title: `Security Intelligence: ${entity.name}`, description: analysis.summary,
              normalized_text: analysis.summary, signal_type: 'osint', severity_score: severityInt,
              severity: severityLabel, category: 'cybersecurity',
              status: 'new', relevance_score: analysis.relevance_score,
              raw_json: { source_url: item.link, link: item.link, snippet: item.snippet, has_full_article: isFullArticle },
            }).select('id').single();
            if (signalData) {
              signalsCreated++;
              await supabase.from('entity_mentions').insert({ entity_id: entityId, signal_id: signalData.id, confidence: analysis.relevance_score, context: analysis.summary || item.snippet });
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error processing query "${query}":`, error);
      }
    }

    await supabase.from('entities').update({ updated_at: new Date().toISOString() }).eq('id', entityId);

    return successResponse({ success: true, entity: entity.name, content_created: contentCreated, duplicates_skipped: duplicatesSkipped, signals_created: signalsCreated, articles_fetched: articlesFetched });
  } catch (error) {
    console.error('OSINT web search error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});