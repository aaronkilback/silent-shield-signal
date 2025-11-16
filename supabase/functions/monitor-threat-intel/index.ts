import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting threat intelligence monitoring...');

    // Get all clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, industry');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;

    // AlienVault OTX (Open Threat Exchange) - Free API
    // Cert.pl - Public CVE feed
    // CISA Known Exploited Vulnerabilities
    
    // Monitor CISA KEV Catalog (no API key required)
    try {
      const cisaResponse = await fetch(
        'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
      );

      if (cisaResponse.ok) {
        const cisaData = await cisaResponse.json();
        const recentVulns = cisaData.vulnerabilities?.slice(0, 5) || [];

        for (const vuln of recentVulns) {
          const severity = vuln.cveID.includes('CRITICAL') ? 'critical' : 'high';

          for (const client of clients || []) {
            try {
              const { error: signalError } = await supabase
                .from('signals')
                .insert({
                  source_key: 'threat-intel-monitor',
                  event: 'Known Exploited Vulnerability',
                  text: `CISA KEV: ${vuln.vulnerabilityName} - ${vuln.shortDescription}`,
                  location: 'Global',
                  severity: severity,
                  category: 'vulnerability',
                  normalized_text: `${vuln.cveID}: ${vuln.vulnerabilityName}`,
                  entity_tags: ['cisa', 'kev', 'vulnerability', vuln.cveID],
                  confidence: 0.95,
                  raw_json: {
                    cve_id: vuln.cveID,
                    vendor: vuln.vendorProject,
                    product: vuln.product,
                    vulnerability_name: vuln.vulnerabilityName,
                    date_added: vuln.dateAdded,
                    required_action: vuln.requiredAction,
                    due_date: vuln.dueDate
                  },
                  client_id: client.id
                });

              if (!signalError) {
                signalsCreated++;
                console.log(`Created KEV signal for ${client.name}: ${vuln.cveID}`);
              }
              
              // Limit signals per client
              break;
            } catch (error) {
              console.error(`Error creating signal for ${client.name}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching CISA KEV:', error);
    }

    // Monitor CVE Trending from cvetrend.com RSS with timeout
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
      
      const trendResponse = await fetch(
        'https://cvetrend.com/api/rss',
        { signal: controller.signal }
      ).finally(() => clearTimeout(timeout));

      if (trendResponse.ok) {
        const xmlText = await trendResponse.text();
        const items = xmlText.match(/<item>(.*?)<\/item>/gs) || [];

        for (const item of items.slice(0, 3)) {
          const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
          const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
          const linkMatch = item.match(/<link>(.*?)<\/link>/);

          if (!titleMatch) continue;

          const title = titleMatch[1];
          const description = descMatch ? descMatch[1] : '';
          const link = linkMatch ? linkMatch[1] : '';

          for (const client of clients || []) {
            try {
              const { error: signalError } = await supabase
                .from('signals')
                .insert({
                  source_key: 'threat-intel-monitor',
                  event: 'Trending CVE',
                  text: `Trending Vulnerability: ${title} - ${description}`,
                  location: 'Global',
                  severity: 'medium',
                  category: 'vulnerability',
                  normalized_text: title,
                  entity_tags: ['cve', 'trending', 'vulnerability'],
                  confidence: 0.85,
                  raw_json: {
                    title,
                    description,
                    url: link,
                    source: 'cvetrend'
                  },
                  client_id: client.id
                });

              if (!signalError) {
                signalsCreated++;
              }
              
              break;
            } catch (error) {
              console.error(`Error creating trending CVE signal:`, error);
            }
          }
        }
      }
    } catch (error) {
      // Handle timeout and network errors gracefully
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.log('CVE Trend API timeout - continuing with other sources');
        } else {
          console.error('Error fetching CVE trends:', error.message);
        }
      }
    }

    console.log(`Threat intelligence monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'threat-intelligence'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in threat intel monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
