import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SECURITY_KEYWORDS = [
  'hacked', 'compromised', 'breach', 'scam', 'fraud',
  'phishing', 'fake account', 'impersonation', 'stolen',
  'security warning', 'data leak', 'account takeover'
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

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry');

    if (clientsError) throw clientsError;

    console.log(`Monitoring Instagram for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    // Monitor Instagram via Google search (Instagram blocks direct scraping)
    for (const client of clients || []) {
      try {
        // Add initial delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 3000));
        
        const searchQuery = encodeURIComponent(`site:instagram.com "${client.name}" (hack OR scam OR fake OR phishing)`);
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
          console.log(`Instagram search failed for ${client.name}: ${response.status}`);
          if (response.status === 429) {
            console.log('Rate limited, waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 30000));
          }
          continue;
        }

        const html = await response.text();
        
        // Parse search results
        const resultMatches = html.matchAll(/<div class="g"[^>]*>(.*?)<\/div>/gs);
        const results: string[] = [];
        
        for (const match of Array.from(resultMatches).slice(0, 5)) {
          const text = match[1]
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[^;]+;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (text.length > 30) {
            results.push(text);
          }
        }

        console.log(`Found ${results.length} Instagram mentions for ${client.name}`);

        for (const result of results) {
          const resultLower = result.toLowerCase();
          const hasSecurityKeyword = SECURITY_KEYWORDS.some(kw => 
            resultLower.includes(kw.toLowerCase())
          );

          if (hasSecurityKeyword) {
            const signalText = `Instagram Security Alert: ${result.substring(0, 200)}`;
            
            const { error: signalError } = await supabase
              .from('signals')
              .insert({
                client_id: client.id,
                normalized_text: signalText,
                category: 'reputation_risk',
                severity: 'medium',
                location: 'Instagram',
                raw_json: {
                  platform: 'instagram',
                  content: result,
                  search_query: searchQuery
                },
                status: 'new',
                confidence: 0.6
              });

            if (!signalError) {
              signalsCreated++;
              console.log(`Created Instagram signal for ${client.name}`);
              
              await correlateSignalEntities({
                supabase,
                signalText,
                clientId: client.id,
                additionalContext: result
              });
            }
          }
        }

        // Extended rate limiting removed - delay is at start of loop

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Instagram search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring Instagram for ${client.name}:`, error);
        }
      }
    }

    console.log(`Instagram monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
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
