import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Activism and protest-related keywords to monitor
const ACTIVISM_KEYWORDS = [
  'protest', 'pipeline', 'activist', 'demonstration', 'blockade',
  'environmental', 'climate', 'indigenous rights', 'first nation',
  'stand.earth', 'standearth', 'stop', 'oppose', 'rally', 'march',
  'occupation', 'resistance', 'campaign', 'PRGT', 'LNG', 'Coastal GasLink', 'CGL'
];

// Known activist organizations targeting energy sector
const ACTIVIST_ORGANIZATIONS = [
  'Stand.earth', 'Greenpeace', 'Sierra Club', '350.org', 'Extinction Rebellion',
  'Indigenous Environmental Network', 'Idle No More', 'Rainforest Action Network',
  'Oil Change International', 'RAVEN Trust', 'Dogwood Initiative',
  'Wilderness Committee', 'EcoJustice', 'Pembina Institute'
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

    console.log('Starting Instagram monitoring scan...');

    // Fetch clients with their monitoring keywords
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry, monitoring_keywords, locations');

    if (clientsError) throw clientsError;

    // Fetch high-risk/monitored entities WITH Instagram handles
    const { data: watchedEntities, error: entitiesError } = await supabase
      .from('entities')
      .select('id, name, type, aliases, risk_level, attributes')
      .eq('active_monitoring_enabled', true)
      .in('type', ['organization', 'person']);

    if (entitiesError) {
      console.error('Error fetching entities:', entitiesError);
    }

    // Extract entities with Instagram handles for profile-based monitoring
    const entitiesWithInstagram = (watchedEntities || []).filter(e => 
      e.attributes?.instagram_handle || 
      e.aliases?.some((a: string) => a.startsWith('@'))
    );

    console.log(`Monitoring Instagram for ${clients?.length || 0} clients, ${watchedEntities?.length || 0} watched entities (${entitiesWithInstagram.length} with Instagram profiles)`);

    let signalsCreated = 0;
    let totalSearches = 0;
    const processedUrls = new Set<string>();

    // PART 1: Client-focused searches
    for (const client of clients || []) {
      try {
        const searchQueries: string[] = [];
        
        // Direct client name + activism/protest terms
        searchQueries.push(`site:instagram.com "${client.name}" (protest OR pipeline OR activist OR blockade OR demonstration OR environmental)`);
        
        // Client name + security threats
        searchQueries.push(`site:instagram.com "${client.name}" (hack OR scam OR fake OR phishing OR breach)`);
        
        // Search for known activist organizations mentioning client or related projects
        const orgSearchTerms = ACTIVIST_ORGANIZATIONS.slice(0, 5).map(org => `"${org}"`).join(' OR ');
        searchQueries.push(`site:instagram.com (${orgSearchTerms}) ("${client.name}" OR LNG OR pipeline)`);
        
        // Use client's monitoring keywords if available
        const clientKeywords = client.monitoring_keywords || [];
        const priorityKeywords = clientKeywords.filter((k: string) => 
          k.toLowerCase().includes('pipeline') || 
          k.toLowerCase().includes('lng') || 
          k.toLowerCase().includes('first nation') ||
          k.toLowerCase().includes('indigenous')
        );
        
        if (priorityKeywords.length > 0) {
          const keywordTerms = priorityKeywords.slice(0, 3).map((k: string) => `"${k}"`).join(' OR ');
          searchQueries.push(`site:instagram.com (protest OR activist OR stand.earth) (${keywordTerms})`);
        }
        
        // Specific search for PRGT/LNG Canada projects
        if (client.name.toLowerCase().includes('petronas') || client.industry?.toLowerCase().includes('energy')) {
          searchQueries.push(`site:instagram.com (stand.earth OR standearth) (PRGT OR "LNG Canada" OR "Pacific NorthWest" OR "Coastal GasLink")`);
        }

        for (const query of searchQueries) {
          totalSearches++;
          await processSearch(supabase, query, client.id, client.name, 'client', processedUrls, (count) => signalsCreated += count);
        }

        console.log(`Processed Instagram mentions for ${client.name}`);

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Instagram search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring Instagram for ${client.name}:`, error);
        }
      }
    }

    // PART 2: Entity-focused searches (activist groups, threat actors, etc.)
    for (const entity of watchedEntities || []) {
      try {
        const searchQueries: string[] = [];
        
        // Get Instagram handle if available
        const instagramHandle = entity.attributes?.instagram_handle || 
          entity.aliases?.find((a: string) => a.startsWith('@'));
        
        // PRIORITY: Direct profile search if we have a handle
        if (instagramHandle) {
          const cleanHandle = instagramHandle.replace('@', '');
          // Search for recent posts from this specific profile
          searchQueries.push(`site:instagram.com/${cleanHandle}`);
          searchQueries.push(`site:instagram.com/reel "${cleanHandle}"`);
          searchQueries.push(`site:instagram.com/p "${cleanHandle}" (pipeline OR LNG OR protest OR blockade OR action)`);
          // Search for their tagged content
          searchQueries.push(`site:instagram.com "#${cleanHandle}" OR "@${cleanHandle}"`);
          console.log(`Direct profile monitoring for @${cleanHandle}`);
        }
        
        // Entity name + pipeline/energy project terms
        searchQueries.push(`site:instagram.com "${entity.name}" (pipeline OR LNG OR "Coastal GasLink" OR PRGT OR protest OR blockade)`);
        
        // Entity name + video/reel content (more likely to have protest footage)
        searchQueries.push(`site:instagram.com/reel "${entity.name}"`);
        searchQueries.push(`site:instagram.com/p "${entity.name}" (action OR campaign OR protest)`);
        
        // Include aliases in search
        if (entity.aliases && entity.aliases.length > 0) {
          for (const alias of entity.aliases.slice(0, 2)) {
            if (!alias.startsWith('@')) { // Skip handles, already covered
              searchQueries.push(`site:instagram.com "${alias}" (pipeline OR protest OR blockade)`);
            }
          }
        }
        
        // Search for focus areas if available
        const focusAreas = entity.attributes?.focus_areas || entity.attributes?.client_targets;
        if (focusAreas && focusAreas.length > 0) {
          const focusTerms = focusAreas.slice(0, 3).map((f: string) => `"${f}"`).join(' OR ');
          searchQueries.push(`site:instagram.com "${entity.name}" (${focusTerms})`);
        }

        for (const query of searchQueries) {
          totalSearches++;
          await processSearch(supabase, query, null, entity.name, 'entity', processedUrls, (count) => signalsCreated += count, entity.id);
        }

        console.log(`Processed Instagram mentions for entity: ${entity.name}`);

      } catch (error) {
        console.error(`Error monitoring Instagram for entity ${entity.name}:`, error);
      }
    }

    console.log(`Instagram monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        entities_scanned: watchedEntities?.length || 0,
        searches_executed: totalSearches,
        signals_created: signalsCreated,
        source: 'instagram'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in Instagram monitoring:', error);
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
  // Rate limiting between searches
  await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    console.log(`Instagram search: ${query.substring(0, 80)}...`);
    
    const response = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&tbm=vid`,
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
      console.log(`Instagram search failed: ${response.status}`);
      if (response.status === 429) {
        console.log('Rate limited, waiting longer...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      return;
    }

    const html = await response.text();

    // Parse search results - look for video results and regular results
    const resultPatterns = [
      /<div class="g"[^>]*>(.*?)<\/div>/gs,
      /<a href="[^"]*instagram\.com[^"]*"[^>]*>(.*?)<\/a>/gs,
    ];

    for (const pattern of resultPatterns) {
      const matches = html.matchAll(pattern);

      for (const match of Array.from(matches).slice(0, 5)) {
        const text = match[1] || match[0];
        const cleanText = text
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[^;]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Extract Instagram URL if present
        const urlMatch = text.match(/instagram\.com\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/);
        const instagramUrl = urlMatch ? `https://instagram.com/${urlMatch[0]}` : null;

        // Skip if we've already processed this URL
        if (instagramUrl && processedUrls.has(instagramUrl)) continue;
        if (instagramUrl) processedUrls.add(instagramUrl);

        // Check for relevance
        const lowerText = cleanText.toLowerCase();
        const isRelevant = 
          ACTIVISM_KEYWORDS.some(k => lowerText.includes(k.toLowerCase())) ||
          ACTIVIST_ORGANIZATIONS.some(org => lowerText.includes(org.toLowerCase())) ||
          lowerText.includes(sourceName.toLowerCase());

        if (cleanText.length > 30 && isRelevant) {
          // Check for duplicates before inserting
          const { data: existing } = await supabase
            .from('ingested_documents')
            .select('id')
            .eq('metadata->>source', 'instagram')
            .ilike('raw_text', `%${cleanText.substring(0, 50)}%`)
            .limit(1);

          if (existing && existing.length > 0) {
            console.log('Skipping duplicate Instagram content');
            continue;
          }

          // Determine category based on content
          let category = 'social_media';
          if (ACTIVISM_KEYWORDS.some(k => lowerText.includes(k.toLowerCase()))) {
            category = 'activism';
          }
          if (lowerText.includes('protest') || lowerText.includes('blockade') || lowerText.includes('demonstration')) {
            category = 'protest_activity';
          }

          // Create ingested document for AI analysis
          const { data: doc, error: docError } = await supabase
            .from('ingested_documents')
            .insert({
              title: `Instagram ${category}: ${sourceName}`,
              raw_text: cleanText,
              source_url: instagramUrl,
              metadata: {
                source: 'instagram',
                source_type: 'social_media',
                client_id: clientId,
                entity_id: entityId,
                source_name: sourceName,
                search_type: sourceType,
                search_query: query,
                category: category,
                detected_keywords: ACTIVISM_KEYWORDS.filter(k => lowerText.includes(k.toLowerCase())),
                detected_organizations: ACTIVIST_ORGANIZATIONS.filter(org => lowerText.includes(org.toLowerCase()))
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
            console.log(`Ingested Instagram ${category} content: ${sourceName} - ${cleanText.substring(0, 60)}...`);
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`Instagram search timeout`);
    } else {
      throw error;
    }
  }
}
