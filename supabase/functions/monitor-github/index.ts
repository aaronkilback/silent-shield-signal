import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SECURITY_KEYWORDS = [
  'password', 'api key', 'secret', 'token', 'credential',
  'vulnerability', 'exploit', 'cve', 'security advisory',
  'data breach', 'leaked', 'exposed', 'misconfigured'
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

    console.log('Starting GitHub monitoring scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry');

    if (clientsError) throw clientsError;

    console.log(`Monitoring GitHub for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    // Monitor GitHub search for each client
    for (const client of clients || []) {
      try {
        const searchQuery = encodeURIComponent(`"${client.name}" (password OR token OR key OR secret OR credential)`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        // Use GitHub's web search (no auth needed for public results)
        const response = await fetch(
          `https://github.com/search?q=${searchQuery}&type=code`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml',
            },
            signal: controller.signal
          }
        ).finally(() => clearTimeout(timeout));

        if (!response.ok) {
          console.log(`GitHub search failed for ${client.name}: ${response.status}`);
          continue;
        }

        const html = await response.text();
        
        // Parse code results from HTML
        const resultMatches = html.matchAll(/<div class="code-list-item[^"]*"[^>]*>(.*?)<\/div>/gs);
        const results: { snippet: string; repo: string }[] = [];
        
        for (const match of Array.from(resultMatches).slice(0, 5)) {
          const snippet = match[1]
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[^;]+;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (snippet.length > 20) {
            results.push({
              snippet,
              repo: 'GitHub Search Result'
            });
          }
        }

        console.log(`Found ${results.length} potential exposures for ${client.name}`);

        for (const result of results) {
          // Check for actual security keywords
          const snippetLower = result.snippet.toLowerCase();
          const hasSecurityKeyword = SECURITY_KEYWORDS.some(kw => 
            snippetLower.includes(kw.toLowerCase())
          );

          if (hasSecurityKeyword) {
            const signalText = `GitHub Code Exposure: ${result.snippet.substring(0, 200)}`;
            
            const { error: signalError } = await supabase
              .from('signals')
              .insert({
                client_id: client.id,
                normalized_text: signalText,
                category: 'data_exposure',
                severity: 'high',
                location: 'GitHub',
                raw_json: {
                  platform: 'github',
                  repo: result.repo,
                  snippet: result.snippet,
                  search_query: searchQuery
                },
                status: 'new',
                confidence: 0.7
              });

            if (!signalError) {
              signalsCreated++;
              console.log(`Created GitHub signal for ${client.name}: potential exposure`);
              
              await correlateSignalEntities({
                supabase,
                signalText,
                clientId: client.id,
                additionalContext: result.snippet
              });
            }
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`GitHub search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring GitHub for ${client.name}:`, error);
        }
      }
    }

    console.log(`GitHub monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'github'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in GitHub monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
