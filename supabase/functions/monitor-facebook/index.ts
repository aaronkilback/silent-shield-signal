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

    console.log('Starting Facebook monitoring scan...');

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

    console.log(`Monitoring Facebook for ${clients?.length || 0} clients and ${watchedEntities?.length || 0} watched entities`);

    let signalsCreated = 0;
    let totalSearches = 0;
    const processedUrls = new Set<string>();

    // PART 1: Client-focused searches
    for (const client of clients || []) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        
        const searchQueries: string[] = [];
        
        // Client name + activism/protest terms
        searchQueries.push(`site:facebook.com "${client.name}" (protest OR pipeline OR activist OR blockade OR demonstration)`);
        
        // Client name + security threats
        searchQueries.push(`site:facebook.com "${client.name}" (breach OR hack OR security OR scam OR threat)`);
        
        // Use client's monitoring keywords
        const clientKeywords = client.monitoring_keywords || [];
        const priorityKeywords = clientKeywords.filter((k: string) => 
          k.toLowerCase().includes('pipeline') || 
          k.toLowerCase().includes('lng') || 
          k.toLowerCase().includes('first nation')
        );
        
        if (priorityKeywords.length > 0) {
          const keywordTerms = priorityKeywords.slice(0, 3).map((k: string) => `"${k}"`).join(' OR ');
          searchQueries.push(`site:facebook.com (protest OR activist) (${keywordTerms})`);
        }

        for (const query of searchQueries) {
          totalSearches++;
          await processSearch(supabase, query, client.id, client.name, 'client', processedUrls, (count) => signalsCreated += count);
        }

        console.log(`Processed Facebook mentions for ${client.name}`);

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Facebook search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring Facebook for ${client.name}:`, error);
        }
      }
    }

    // PART 2: Entity-focused searches (activist groups, threat actors, etc.)
    for (const entity of watchedEntities || []) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        
        const searchQueries: string[] = [];
        
        // Entity name + pipeline/energy project terms
        searchQueries.push(`site:facebook.com "${entity.name}" (pipeline OR LNG OR "Coastal GasLink" OR PRGT OR protest)`);
        
        // Include aliases in search
        if (entity.aliases && entity.aliases.length > 0) {
          for (const alias of entity.aliases.slice(0, 2)) {
            searchQueries.push(`site:facebook.com "${alias}" (pipeline OR protest OR blockade)`);
          }
        }

        for (const query of searchQueries) {
          totalSearches++;
          await processSearch(supabase, query, null, entity.name, 'entity', processedUrls, (count) => signalsCreated += count, entity.id);
        }

        console.log(`Processed Facebook mentions for entity: ${entity.name}`);

      } catch (error) {
        console.error(`Error monitoring Facebook for entity ${entity.name}:`, error);
      }
    }

    console.log(`Facebook monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        entities_scanned: watchedEntities?.length || 0,
        searches_executed: totalSearches,
        signals_created: signalsCreated,
        source: 'facebook'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in Facebook monitoring:', error);
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
  onSignalCreated: (count: number) => void,
  entityId?: string
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    console.log(`Facebook search: ${query.substring(0, 80)}...`);
    
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
      console.log(`Facebook search failed: ${response.status}`);
      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      return;
    }

    const html = await response.text();
    const resultMatches = html.matchAll(/<div class="g"[^>]*>(.*?)<\/div>/gs);

    for (const match of Array.from(resultMatches).slice(0, 5)) {
      const text = match[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[^;]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Extract Facebook URL if present
      const urlMatch = text.match(/facebook\.com\/[^\s"'<>]+/);
      const facebookUrl = urlMatch ? `https://${urlMatch[0]}` : null;

      // Skip duplicates
      if (facebookUrl && processedUrls.has(facebookUrl)) continue;
      if (facebookUrl) processedUrls.add(facebookUrl);

      // Check for relevance
      const lowerText = text.toLowerCase();
      const isRelevant = 
        ACTIVISM_KEYWORDS.some(k => lowerText.includes(k.toLowerCase())) ||
        lowerText.includes(sourceName.toLowerCase());

      if (text.length > 30 && isRelevant) {
        // Check for duplicates in DB
        const { data: existing } = await supabase
          .from('ingested_documents')
          .select('id')
          .eq('metadata->>source', 'facebook')
          .ilike('raw_text', `%${text.substring(0, 50)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          console.log('Skipping duplicate Facebook content');
          continue;
        }

        // Determine category
        let category = 'social_media';
        if (lowerText.includes('protest') || lowerText.includes('blockade') || lowerText.includes('demonstration')) {
          category = 'protest_activity';
        } else if (ACTIVISM_KEYWORDS.some(k => lowerText.includes(k.toLowerCase()))) {
          category = 'activism';
        }

        // Create ingested document
        const { data: doc, error: docError } = await supabase
          .from('ingested_documents')
          .insert({
            title: `Facebook ${category}: ${sourceName}`,
            raw_text: text,
            source_url: facebookUrl,
            metadata: {
              source: 'facebook',
              source_type: 'social_media',
              client_id: clientId,
              entity_id: entityId,
              source_name: sourceName,
              search_type: sourceType,
              search_query: query,
              category: category,
              detected_keywords: ACTIVISM_KEYWORDS.filter(k => lowerText.includes(k.toLowerCase()))
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
          console.log(`Ingested Facebook ${category} content: ${sourceName} - ${text.substring(0, 60)}...`);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`Facebook search timeout`);
    } else {
      throw error;
    }
  }
}
