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

    console.log('Starting Facebook monitoring scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry');

    if (clientsError) throw clientsError;

    console.log(`Monitoring Facebook for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    // Monitor Facebook via Google search (Facebook blocks direct scraping)
    for (const client of clients || []) {
      try {
        // Add initial delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 3000));
        
        const searchQuery = encodeURIComponent(`site:facebook.com "${client.name}" (breach OR hack OR security OR scam)`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(
          `https://www.google.com/search?q=${searchQuery}&num=10`,
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
          console.log(`Facebook search failed for ${client.name}: ${response.status}`);
          if (response.status === 429) {
            console.log('Rate limited, waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 30000));
          }
          continue;
        }

        const html = await response.text();
        
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
                title: `Facebook mention: ${client.name}`,
                raw_text: text,
                metadata: {
                  source: 'facebook',
                  client_id: client.id,
                  client_name: client.name,
                  search_query: searchQuery
                }
              })
              .select()
              .single();

            if (!docError && doc) {
              // Invoke intelligence processing with AI
              await supabase.functions.invoke('process-intelligence-document', {
                body: { documentId: doc.id }
              });
              signalsCreated++;
              console.log(`Ingested Facebook content for AI analysis: ${client.name}`);
            }
          }
        }

        console.log(`Processed Facebook mentions for ${client.name}`);

        // Extended rate limiting removed - delay is at start of loop

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Facebook search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring Facebook for ${client.name}:`, error);
        }
      }
    }

    console.log(`Facebook monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
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
