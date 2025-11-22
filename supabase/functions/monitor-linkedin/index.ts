import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SECURITY_KEYWORDS: string[] = []; // Kept for backward compatibility but no longer used for filtering

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

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry, monitoring_keywords');

    if (clientsError) throw clientsError;

    console.log(`Monitoring LinkedIn for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    // Monitor LinkedIn posts via Google search (LinkedIn blocks direct scraping)
    for (const client of clients || []) {
      try {
        // Add initial delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 3000));
        
        // Build search query with client keywords
        const keywords = client.monitoring_keywords && client.monitoring_keywords.length > 0
          ? client.monitoring_keywords.slice(0, 3).join(' OR ')
          : '(breach OR security OR attack OR incident)';
        
        const searchQuery = `site:linkedin.com "${client.name}" ${keywords}`;
        console.log(`LinkedIn search for ${client.name}: ${searchQuery}`);
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(
          `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&num=10`,
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
          console.log(`LinkedIn search failed for ${client.name}: ${response.status}`);
          if (response.status === 429) {
            console.log('Rate limited, waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 30000));
          }
          continue;
        }

        const html = await response.text();
        const textLower = html.toLowerCase();
        
        // Check if any client keywords are in the results
        let foundKeywords: string[] = [];
        if (client.monitoring_keywords && client.monitoring_keywords.length > 0) {
          foundKeywords = client.monitoring_keywords.filter((kw: string) => 
            textLower.includes(kw.toLowerCase())
          );
        }
        
        if (foundKeywords.length > 0 || textLower.includes(client.name.toLowerCase())) {
          console.log(`✓ KEYWORD MATCH on LinkedIn for ${client.name}: ${foundKeywords.join(', ') || 'client name'}`);
          
          // Parse and ingest for AI processing
          const resultMatches = html.matchAll(/<div class="g"[^>]*>(.*?)<\/div>/gs);
          
          for (const match of Array.from(resultMatches).slice(0, 5)) {
            const text = match[1]
              .replace(/<[^>]+>/g, ' ')
              .replace(/&[^;]+;/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            
            if (text.length > 30) {
              // Create ingested document for AI analysis
              const { data: doc, error: docError } = await supabase
                .from('ingested_documents')
                .insert({
                  title: `LinkedIn mention: ${client.name}`,
                  raw_text: text,
                  metadata: {
                    source: 'linkedin',
                    client_id: client.id,
                    client_name: client.name,
                    search_query: searchQuery,
                    matched_keywords: foundKeywords
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
                console.log(`✓ Ingested LinkedIn content for ${client.name} (keywords: ${foundKeywords.join(', ')})`);
              }
            }
          }
        } else {
          console.log(`- No keyword matches found for ${client.name}`);
        }

        console.log(`Processed LinkedIn mentions for ${client.name}`);

        // Extended rate limiting removed - delay is at start of loop

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`LinkedIn search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring LinkedIn for ${client.name}:`, error);
        }
      }
    }

    console.log(`LinkedIn monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
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
