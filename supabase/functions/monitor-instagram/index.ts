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
  'occupation', 'resistance', 'campaign', 'PRGT', 'LNG'
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

    console.log(`Monitoring Instagram for ${clients?.length || 0} clients`);

    let signalsCreated = 0;
    let totalSearches = 0;

    for (const client of clients || []) {
      try {
        // Build comprehensive search queries
        const searchQueries: string[] = [];
        
        // 1. Direct client name + activism/protest terms
        searchQueries.push(`site:instagram.com "${client.name}" (protest OR pipeline OR activist OR blockade OR demonstration OR environmental)`);
        
        // 2. Client name + security threats (original functionality)
        searchQueries.push(`site:instagram.com "${client.name}" (hack OR scam OR fake OR phishing OR breach)`);
        
        // 3. Search for known activist organizations mentioning client or related projects
        const orgSearchTerms = ACTIVIST_ORGANIZATIONS.slice(0, 5).map(org => `"${org}"`).join(' OR ');
        searchQueries.push(`site:instagram.com (${orgSearchTerms}) ("${client.name}" OR LNG OR pipeline)`);
        
        // 4. Use client's monitoring keywords if available
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
        
        // 5. Specific search for PRGT/LNG Canada projects (commonly targeted)
        if (client.name.toLowerCase().includes('petronas') || client.industry?.toLowerCase().includes('energy')) {
          searchQueries.push(`site:instagram.com (stand.earth OR standearth) (PRGT OR "LNG Canada" OR "Pacific NorthWest" OR "Coastal GasLink")`);
        }

        // Execute searches with rate limiting
        for (const query of searchQueries) {
          totalSearches++;
          
          // Rate limiting between searches
          await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
          
          const encodedQuery = encodeURIComponent(query);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          
          console.log(`Instagram search: ${query.substring(0, 80)}...`);
          
          const response = await fetch(
            `https://www.google.com/search?q=${encodedQuery}&num=10&tbm=vid`,
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
            continue;
          }

          const html = await response.text();
          
          // Parse search results - look for video results and regular results
          const resultPatterns = [
            /<div class="g"[^>]*>(.*?)<\/div>/gs,
            /<a href="[^"]*instagram\.com[^"]*"[^>]*>(.*?)<\/a>/gs,
            /instagram\.com\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/g
          ];
          
          const processedUrls = new Set<string>();
          
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
              
              // Check for relevance - must contain activism/protest indicators OR client reference
              const lowerText = cleanText.toLowerCase();
              const isRelevant = 
                ACTIVISM_KEYWORDS.some(k => lowerText.includes(k.toLowerCase())) ||
                ACTIVIST_ORGANIZATIONS.some(org => lowerText.includes(org.toLowerCase())) ||
                lowerText.includes(client.name.toLowerCase());
              
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
                    title: `Instagram ${category}: ${client.name}`,
                    raw_text: cleanText,
                    source_url: instagramUrl,
                    metadata: {
                      source: 'instagram',
                      source_type: 'social_media',
                      client_id: client.id,
                      client_name: client.name,
                      search_query: query,
                      category: category,
                      detected_keywords: ACTIVISM_KEYWORDS.filter(k => lowerText.includes(k.toLowerCase())),
                      detected_organizations: ACTIVIST_ORGANIZATIONS.filter(org => lowerText.includes(org.toLowerCase()))
                    }
                  })
                  .select()
                  .single();

                if (!docError && doc) {
                  // Invoke intelligence processing
                  await supabase.functions.invoke('process-intelligence-document', {
                    body: { documentId: doc.id }
                  });
                  signalsCreated++;
                  console.log(`Ingested Instagram ${category} content for AI analysis: ${client.name} - ${cleanText.substring(0, 60)}...`);
                }
              }
            }
          }
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

    console.log(`Instagram monitoring complete. Ran ${totalSearches} searches. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
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
