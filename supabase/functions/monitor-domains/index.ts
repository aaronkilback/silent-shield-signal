import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Common typosquatting patterns
function generateTyposquatVariants(domain: string): string[] {
  const variants: string[] = [];
  const baseDomain = domain.replace(/\.(com|net|org|io)$/, '');
  
  // Character substitution
  const substitutions: Record<string, string[]> = {
    'o': ['0'],
    'i': ['1', 'l'],
    'l': ['1', 'i'],
    's': ['5'],
    'a': ['@']
  };
  
  for (const [char, subs] of Object.entries(substitutions)) {
    if (baseDomain.includes(char)) {
      for (const sub of subs) {
        variants.push(baseDomain.replace(char, sub));
      }
    }
  }
  
  // Common prefixes/suffixes
  variants.push(`${baseDomain}-secure`, `${baseDomain}-login`, `${baseDomain}-support`);
  variants.push(`secure-${baseDomain}`, `login-${baseDomain}`, `verify-${baseDomain}`);
  
  return variants.slice(0, 10);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: historyEntry } = await supabase
    .from('monitoring_history')
    .insert({
      source_name: 'Domain Monitoring',
      status: 'running'
    })
    .select()
    .single();

  try {
    console.log('Starting domain monitoring scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry');

    if (clientsError) throw clientsError;

    console.log(`Monitoring domains for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    for (const client of clients || []) {
      try {
        const baseDomain = client.organization?.toLowerCase().replace(/\s+/g, '') || client.name.toLowerCase().replace(/\s+/g, '');
        const variants = generateTyposquatVariants(baseDomain);
        
        console.log(`Checking ${variants.length} domain variants for ${client.name}`);

        for (const variant of variants) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            
            // Check if domain is registered via DNS lookup (using Google DNS over HTTPS)
            const response = await fetch(
              `https://dns.google/resolve?name=${variant}.com&type=A`,
              {
                signal: controller.signal
              }
            ).finally(() => clearTimeout(timeout));

            if (response.ok) {
              const data = await response.json();
              
              // If domain has DNS records, it's registered
              if (data.Answer && data.Answer.length > 0) {
                const signalText = `Suspicious Domain Detected: ${variant}.com - Potential typosquatting or phishing domain`;
                
                const { error: signalError } = await supabase
                  .from('signals')
                  .insert({
                    client_id: client.id,
                    normalized_text: signalText,
                    category: 'phishing',
                    severity: 'high',
                    location: 'Domain Registration',
                    raw_json: {
                      platform: 'dns',
                      suspicious_domain: `${variant}.com`,
                      legitimate_domain: `${baseDomain}.com`,
                      dns_records: data.Answer
                    },
                    status: 'new',
                    confidence: 0.75
                  });

                if (!signalError) {
                  signalsCreated++;
                  console.log(`Created domain signal for ${client.name}: ${variant}.com`);
                }
              }
            }

            // Rate limiting between checks
            await new Promise(resolve => setTimeout(resolve, 500));

          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              console.log(`DNS check timeout for ${variant}.com`);
            }
          }
        }

        // Rate limiting between clients
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`Error monitoring domains for ${client.name}:`, error);
      }
    }

    console.log(`Domain monitoring complete. Created ${signalsCreated} signals.`);

    return new Response(
      JSON.stringify({
        success: true,
        clients_scanned: clients?.length || 0,
        signals_created: signalsCreated,
        source: 'domains'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in domain monitoring:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
