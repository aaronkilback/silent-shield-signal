import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Activism and protest-related keywords
const ACTIVISM_KEYWORDS = [
  'protest', 'pipeline', 'activist', 'demonstration', 'blockade',
  'environmental', 'climate', 'indigenous rights', 'first nation',
  'stop', 'oppose', 'rally', 'march', 'occupation', 'resistance',
  'campaign', 'PRGT', 'LNG', 'Coastal GasLink', 'CGL'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting LinkedIn monitoring scan...');

    // Fetch clients with monitoring keywords
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry, monitoring_keywords, locations');

    if (clientsError) throw clientsError;

    // Fetch high-risk/monitored entities (activist groups, threat actors, etc.)
    const { data: watchedEntities, error: entitiesError } = await supabase
      .from('entities')
      .select('id, name, type, aliases, risk_level')
      .or('risk_level.eq.high,risk_level.eq.critical,is_active_monitoring.eq.true')
      .in('type', ['organization', 'person']);

    if (entitiesError) {
      console.error('Error fetching entities:', entitiesError);
    }

    console.log(`Monitoring LinkedIn for ${clients?.length || 0} clients and ${watchedEntities?.length || 0} watched entities`);

    let signalsCreated = 0;
    let totalSearches = 0;
    const processedUrls = new Set<string>();

    // PART 1: Client-focused searches
    for (const client of clients || []) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        
        const searchQueries: string[] = [];
        
        // Build search query with client keywords
        const keywords = client.monitoring_keywords && client.monitoring_keywords.length > 0
          ? client.monitoring_keywords.slice(0, 3).join(' OR ')
          : '(pipeline OR LNG OR energy)';
        
        searchQueries.push(`site:linkedin.com "${client.name}" ${keywords}`);
        
        // Client name + activism/protest terms
        searchQueries.push(`site:linkedin.com "${client.name}" (protest OR activist OR opposition OR blockade)`);

        for (const query of searchQueries) {
          totalSearches++;
          await processSearch(supabase, query, client.id, client.name, 'client', processedUrls, client.monitoring_keywords || [], (count) => signalsCreated += count);
        }

        console.log(`Processed LinkedIn mentions for ${client.name}`);

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`LinkedIn search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring LinkedIn for ${client.name}:`, error);
        }
      }
    }

    // PART 2: Entity-focused searches (activist groups, threat actors, etc.)
    for (const entity of watchedEntities || []) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        
        const searchQueries: string[] = [];
        
        // Entity name + pipeline/energy project terms
        searchQueries.push(`site:linkedin.com "${entity.name}" (pipeline OR LNG OR "Coastal GasLink" OR PRGT OR energy)`);
        
        // Include aliases
        if (entity.aliases && entity.aliases.length > 0) {
          for (const alias of entity.aliases.slice(0, 2)) {
            searchQueries.push(`site:linkedin.com "${alias}" (pipeline OR protest)`);
          }
        }

        for (const query of searchQueries) {
          totalSearches++;
          await processSearch(supabase, query, null, entity.name, 'entity', processedUrls, [], (count) => signalsCreated += count, entity.id);
        }

        console.log(`Processed LinkedIn mentions for entity: ${entity.name}`);

      } catch (error) {
        console.error(`Error monitoring LinkedIn for entity ${entity.name}:`, error);
      }
    }

    console.log(`LinkedIn monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        entities_scanned: watchedEntities?.length || 0,
        searches_executed: totalSearches,
        signals_created: signalsCreated,
        source: 'linkedin'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in LinkedIn monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
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
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

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
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      return;
    }

    const html = await response.text();
    const textLower = html.toLowerCase();

    // Check for keyword matches
    let foundKeywords: string[] = [];
    if (monitoringKeywords.length > 0) {
      foundKeywords = monitoringKeywords.filter((kw: string) => 
        textLower.includes(kw.toLowerCase())
      );
    }

    // Also check activism keywords
    const foundActivismKeywords = ACTIVISM_KEYWORDS.filter(k => textLower.includes(k.toLowerCase()));

    if (foundKeywords.length > 0 || foundActivismKeywords.length > 0 || textLower.includes(sourceName.toLowerCase())) {
      console.log(`✓ KEYWORD MATCH on LinkedIn for ${sourceName}: ${[...foundKeywords, ...foundActivismKeywords].join(', ') || 'name match'}`);

      const resultMatches = html.matchAll(/<div class="g"[^>]*>(.*?)<\/div>/gs);

      for (const match of Array.from(resultMatches).slice(0, 5)) {
        const text = match[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[^;]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Extract LinkedIn URL
        const urlMatch = text.match(/linkedin\.com\/[^\s"'<>]+/);
        const linkedinUrl = urlMatch ? `https://${urlMatch[0]}` : null;

        // Skip duplicates
        if (linkedinUrl && processedUrls.has(linkedinUrl)) continue;
        if (linkedinUrl) processedUrls.add(linkedinUrl);

        if (text.length > 30) {
          // Check for DB duplicates
          const { data: existing } = await supabase
            .from('ingested_documents')
            .select('id')
            .eq('metadata->>source', 'linkedin')
            .ilike('raw_text', `%${text.substring(0, 50)}%`)
            .limit(1);

          if (existing && existing.length > 0) {
            console.log('Skipping duplicate LinkedIn content');
            continue;
          }

          // Determine category
          const lowerText = text.toLowerCase();
          let category = 'social_media';
          if (lowerText.includes('protest') || lowerText.includes('blockade') || lowerText.includes('demonstration')) {
            category = 'protest_activity';
          } else if (foundActivismKeywords.length > 0) {
            category = 'activism';
          }

          // Create ingested document
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
                category: category,
                matched_keywords: [...foundKeywords, ...foundActivismKeywords]
              }
            })
            .select()
            .single();

          if (!docError && doc) {
            // Link to entity if applicable
            if (entityId) {
              await supabase
                .from('document_entity_mentions')
                .insert({
                  document_id: doc.id,
                  entity_id: entityId,
                  confidence: 0.85,
                  mention_text: sourceName
                });
            }

            // Invoke intelligence processing
            await supabase.functions.invoke('process-intelligence-document', {
              body: { documentId: doc.id }
            });
            onSignalCreated(1);
            console.log(`✓ Ingested LinkedIn ${category} content: ${sourceName} (keywords: ${[...foundKeywords, ...foundActivismKeywords].join(', ')})`);
          }
        }
      }
    } else {
      console.log(`- No keyword matches found for ${sourceName}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`LinkedIn search timeout`);
    } else {
      throw error;
    }
  }
}
