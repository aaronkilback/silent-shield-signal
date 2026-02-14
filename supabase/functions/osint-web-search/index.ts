import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

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

    if (!entityId) return errorResponse('entity_id is required', 400);

    const { data: entity, error: entityError } = await supabase.from('entities').select('*').eq('id', entityId).single();
    if (entityError || !entity) throw new Error('Entity not found');

    console.log(`Performing OSINT web search for: ${entity.name}`);
    
    const attributes = entity.attributes || {};
    const contactInfo = attributes.contact_info || {};
    const socialMedia = contactInfo.social_media || {};
    const location = entity.current_location || '';

    let contentCreated = 0;
    let signalsCreated = 0;
    let duplicatesSkipped = 0;

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
          const aiResult = await callAiGateway({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'Analyze web search results for relevance. Return JSON with: relevance_score (0-1), is_relevant (boolean), summary, sentiment, security_concerns array, create_signal (boolean), signal_severity.' },
              { role: 'user', content: `Analyze for entity "${entity.name}": Title: ${item.title}, URL: ${item.link}, Snippet: ${item.snippet}` }
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
            content_text: `${item.title}\n\n${item.snippet}`, content_type: 'web',
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
              raw_json: { source_url: item.link, link: item.link, snippet: item.snippet },
            }).select('id').single();
            if (signalData) {
              signalsCreated++;
              await supabase.from('entity_mentions').insert({ entity_id: entityId, signal_id: signalData.id, confidence: analysis.relevance_score, context: item.snippet });
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error processing query "${query}":`, error);
      }
    }

    await supabase.from('entities').update({ updated_at: new Date().toISOString() }).eq('id', entityId);

    return successResponse({ success: true, entity: entity.name, content_created: contentCreated, duplicates_skipped: duplicatesSkipped, signals_created: signalsCreated });
  } catch (error) {
    console.error('OSINT web search error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});