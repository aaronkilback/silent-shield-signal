import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LEAK_KEYWORDS = [
  'database dump', 'sql dump', 'leaked', 'hacked',
  'credentials', 'passwords', 'user list', 'email list',
  'customer data', 'breach', 'exposed', 'dump'
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

    console.log('Starting Pastebin monitoring scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry');

    if (clientsError) throw clientsError;

    console.log(`Monitoring Pastebin for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    // Scrape recent public pastes
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      // Pastebin archive page
      const response = await fetch(
        'https://pastebin.com/archive',
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
          signal: controller.signal
        }
      ).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        console.log(`Pastebin fetch failed: ${response.status}`);
        return new Response(
          JSON.stringify({
            success: true,
            clients_scanned: clients?.length || 0,
            signals_created: 0,
            source: 'pastebin',
            note: 'Pastebin unavailable'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const html = await response.text();
      
      // Parse paste titles and links
      const pasteMatches = html.matchAll(/<td class="title"[^>]*><a href="([^"]+)"[^>]*>([^<]+)<\/a>/gs);
      const pastes: { title: string; link: string }[] = [];
      
      for (const match of Array.from(pasteMatches).slice(0, 20)) {
        pastes.push({
          link: match[1],
          title: match[2].trim()
        });
      }

      console.log(`Found ${pastes.length} recent pastes`);

      // Check pastes against clients
      for (const paste of pastes) {
        for (const client of clients || []) {
          const clientName = client.name.toLowerCase();
          const titleLower = paste.title.toLowerCase();
          
          // Check if paste mentions client and has leak keywords
          const mentionsClient = titleLower.includes(clientName);
          const hasLeakKeyword = LEAK_KEYWORDS.some(kw => 
            titleLower.includes(kw.toLowerCase())
          );

          if (mentionsClient && hasLeakKeyword) {
            const signalText = `Pastebin Leak: ${paste.title}`;
            
            const { error: signalError } = await supabase
              .from('signals')
              .insert({
                client_id: client.id,
                normalized_text: signalText,
                category: 'data_exposure',
                severity: 'critical',
                location: 'Pastebin',
                raw_json: {
                  platform: 'pastebin',
                  title: paste.title,
                  link: `https://pastebin.com${paste.link}`
                },
                status: 'new',
                confidence: 0.8
              });

            if (!signalError) {
              signalsCreated++;
              console.log(`Created Pastebin signal for ${client.name}: potential data leak`);
              
              await correlateSignalEntities({
                supabase,
                signalText,
                clientId: client.id,
                additionalContext: `Link: https://pastebin.com${paste.link}`
              });
            }
          }
        }
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Pastebin fetch timeout');
      } else {
        console.error('Error monitoring Pastebin:', error);
      }
    }

    console.log(`Pastebin monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'pastebin'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in Pastebin monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
