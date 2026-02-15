import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const ACTIVISM_KEYWORDS = [
  'protest', 'pipeline', 'activist', 'demonstration', 'blockade',
  'environmental', 'climate', 'indigenous rights', 'first nation',
  'stop', 'oppose', 'rally', 'march', 'occupation', 'resistance',
  'campaign', 'PRGT', 'LNG', 'Coastal GasLink', 'CGL'
];

const MAX_SEARCHES = 12;
const FUNCTION_TIMEOUT_MS = 50000; // 50s hard ceiling (gateway is 60s)

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const globalDeadline = Date.now() + FUNCTION_TIMEOUT_MS;

  try {
    const supabase = createServiceClient();
    console.log('Starting LinkedIn monitoring scan...');

    const [{ data: clients, error: clientsError }, { data: watchedEntities, error: entitiesError }] = await Promise.all([
      supabase.from('clients').select('id, name, organization, industry, monitoring_keywords, locations'),
      supabase.from('entities')
        .select('id, name, type, aliases, risk_level, active_monitoring_enabled')
        .or('risk_level.eq.high,risk_level.eq.critical,active_monitoring_enabled.eq.true')
        .in('type', ['organization', 'person']),
    ]);

    if (clientsError) throw clientsError;
    if (entitiesError) console.error('Error fetching entities:', entitiesError);

    console.log(`Monitoring LinkedIn for ${clients?.length || 0} clients, ${watchedEntities?.length || 0} watched entities`);

    let signalsCreated = 0;
    let totalSearches = 0;
    let rateLimited = false;
    const processedUrls = new Set<string>();

    // PART 1: Client-focused searches
    for (const client of clients || []) {
      if (rateLimited || totalSearches >= MAX_SEARCHES || Date.now() > globalDeadline) break;

      try {
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));

        const keywords = client.monitoring_keywords?.length > 0
          ? client.monitoring_keywords.slice(0, 3).join(' OR ')
          : '(pipeline OR LNG OR energy)';

        const searchQueries = [
          `site:linkedin.com "${client.name}" ${keywords}`,
          `site:linkedin.com "${client.name}" (protest OR activist OR opposition OR blockade)`,
        ];

        for (const query of searchQueries) {
          if (rateLimited || totalSearches >= MAX_SEARCHES || Date.now() > globalDeadline) break;
          totalSearches++;
          const result = await processSearch(supabase, query, client.id, client.name, 'client', processedUrls, client.monitoring_keywords || [], entityId => signalsCreated += entityId);
          if (result === 'rate_limited') {
            rateLimited = true;
            console.log('Rate limited — stopping all LinkedIn searches');
            break;
          }
        }

        if (!rateLimited) console.log(`Processed LinkedIn mentions for ${client.name}`);
      } catch (error) {
        console.error(`Error monitoring LinkedIn for ${client.name}:`, error);
      }
    }

    // PART 2: Entity-focused searches
    for (const entity of watchedEntities || []) {
      if (rateLimited || totalSearches >= MAX_SEARCHES || Date.now() > globalDeadline) break;

      try {
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));

        const searchQueries = [
          `site:linkedin.com "${entity.name}" (pipeline OR LNG OR "Coastal GasLink" OR PRGT OR energy)`,
        ];

        if (entity.aliases?.length > 0) {
          for (const alias of entity.aliases.slice(0, 2)) {
            searchQueries.push(`site:linkedin.com "${alias}" (pipeline OR protest)`);
          }
        }

        for (const query of searchQueries) {
          if (rateLimited || totalSearches >= MAX_SEARCHES || Date.now() > globalDeadline) break;
          totalSearches++;
          const result = await processSearch(supabase, query, null, entity.name, 'entity', processedUrls, [], count => signalsCreated += count, entity.id);
          if (result === 'rate_limited') {
            rateLimited = true;
            console.log('Rate limited — stopping all LinkedIn searches');
            break;
          }
        }

        if (!rateLimited) console.log(`Processed LinkedIn mentions for entity: ${entity.name}`);
      } catch (error) {
        console.error(`Error monitoring LinkedIn for entity ${entity.name}:`, error);
      }
    }

    console.log(`LinkedIn monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals.${rateLimited ? ' (ended early: rate limited)' : ''}${Date.now() > globalDeadline ? ' (ended early: timeout)' : ''}`);

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      entities_scanned: watchedEntities?.length || 0,
      searches_executed: totalSearches,
      signals_created: signalsCreated,
      rate_limited: rateLimited,
      source: 'linkedin'
    });

  } catch (error) {
    console.error('Error in LinkedIn monitoring:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function processSearch(
  supabase: any,
  query: string,
  clientId: string | null,
  sourceName: string,
  sourceType: 'client' | 'entity',
  processedUrls: Set<string>,
  monitoringKeywords: string[],
  onSignalCreated: (count: number) => void,
  entityId?: string
): Promise<'ok' | 'rate_limited'> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    console.log(`LinkedIn search: ${query.substring(0, 80)}...`);

    const response = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal
      }
    ).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      console.log(`LinkedIn search failed: ${response.status}`);
      if (response.status === 429) {
        console.log('Google API rate limited — ending LinkedIn scan early');
        return 'rate_limited';
      }
      return 'ok';
    }

    const html = await response.text();
    const textLower = html.toLowerCase();

    let foundKeywords: string[] = [];
    if (monitoringKeywords.length > 0) {
      foundKeywords = monitoringKeywords.filter((kw: string) =>
        textLower.includes(kw.toLowerCase())
      );
    }

    const foundActivismKeywords = ACTIVISM_KEYWORDS.filter(k => textLower.includes(k.toLowerCase()));

    if (foundKeywords.length > 0 || foundActivismKeywords.length > 0 || textLower.includes(sourceName.toLowerCase())) {
      console.log(`✓ KEYWORD MATCH on LinkedIn for ${sourceName}: ${[...foundKeywords, ...foundActivismKeywords].join(', ') || 'name match'}`);

      const resultMatches = html.matchAll(/<div class="g"[^>]*>(.*?)<\/div>/gs);

      for (const match of Array.from(resultMatches).slice(0, 3)) {
        const text = match[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[^;]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const urlMatch = text.match(/linkedin\.com\/[^\s"'<>]+/);
        const linkedinUrl = urlMatch ? `https://${urlMatch[0]}` : null;

        if (linkedinUrl && processedUrls.has(linkedinUrl)) continue;
        if (linkedinUrl) processedUrls.add(linkedinUrl);

        if (text.length > 30) {
          const { data: existing } = await supabase
            .from('ingested_documents')
            .select('id')
            .eq('metadata->>source', 'linkedin')
            .ilike('raw_text', `%${text.substring(0, 50)}%`)
            .limit(1);

          if (existing && existing.length > 0) continue;

          const lowerText = text.toLowerCase();
          let category = 'social_media';
          if (lowerText.includes('protest') || lowerText.includes('blockade') || lowerText.includes('demonstration')) {
            category = 'protest_activity';
          } else if (foundActivismKeywords.length > 0) {
            category = 'activism';
          }

          const { data: doc, error: docError } = await supabase
            .from('ingested_documents')
            .insert({
              title: `LinkedIn ${category}: ${sourceName}`,
              raw_text: text,
              source_url: linkedinUrl,
              metadata: {
                source: 'linkedin',
                source_type: 'social_media',
                client_id: clientId,
                entity_id: entityId,
                source_name: sourceName,
                search_type: sourceType,
                search_query: query,
                category,
                matched_keywords: [...foundKeywords, ...foundActivismKeywords]
              }
            })
            .select()
            .single();

          if (!docError && doc) {
            if (entityId) {
              await supabase.from('document_entity_mentions').insert({
                document_id: doc.id, entity_id: entityId,
                confidence: 0.85, mention_text: sourceName
              });
            }
            await supabase.functions.invoke('process-intelligence-document', {
              body: { documentId: doc.id }
            });
            onSignalCreated(1);
            console.log(`✓ Ingested LinkedIn ${category} content: ${sourceName}`);
          }
        }
      }
    }

    return 'ok';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('LinkedIn search timeout');
    } else {
      throw error;
    }
    return 'ok';
  }
}
