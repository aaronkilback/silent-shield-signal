import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

const BREACH_KEYWORDS = [
  'database', 'dump', 'leaked', 'breach', 'hacked',
  'credentials', 'passwords', 'emails', 'customer data',
  'stolen', 'exposed', 'compromised', 'ransomware'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

  const { data: historyEntry } = await supabase
    .from('monitoring_history')
    .insert({
      source_name: 'Dark Web Monitoring',
      status: 'running'
    })
    .select()
    .single();

  try {
    console.log('Starting dark web monitoring scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry');

    if (clientsError) throw clientsError;

    console.log(`Monitoring dark web mentions for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    // Monitor via breach aggregator sites (clearnet proxies for dark web data)
    for (const client of clients || []) {
      try {
        // Search Have I Been Pwned for domain breaches
        const domain = client.organization?.toLowerCase().replace(/\s+/g, '') + '.com';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(
          `https://haveibeenpwned.com/api/v3/breaches?domain=${domain}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
            },
            signal: controller.signal
          }
        ).finally(() => clearTimeout(timeout));

        if (response.ok) {
          const breaches = await response.json();
          
          console.log(`Found ${breaches.length} breaches for ${client.name}`);

          for (const breach of breaches.slice(0, 3)) {
            const signalText = `Data Breach Detected: ${breach.Name} - ${breach.Description}`;
            
            const { error: signalError } = await supabase
              .from('signals')
              .insert({
                client_id: client.id,
                normalized_text: signalText,
                category: 'data_exposure',
                severity: 'critical',
                location: 'Dark Web/Breach Database',
                raw_json: {
                  platform: 'haveibeenpwned',
                  breach_name: breach.Name,
                  breach_date: breach.BreachDate,
                  compromised_accounts: breach.PwnCount,
                  data_classes: breach.DataClasses
                },
                status: 'new',
                confidence: 0.9
              });

            if (!signalError) {
              signalsCreated++;
              console.log(`Created dark web signal for ${client.name}: ${breach.Name}`);
              
              await correlateSignalEntities({
                supabase,
                signalText,
                clientId: client.id,
                additionalContext: `Breach: ${breach.Name}, Date: ${breach.BreachDate}, Affected: ${breach.PwnCount} accounts`
              });
            }
          }
        } else {
          console.log(`Dark web search failed for ${client.name}: ${response.status}`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`Dark web search timeout for ${client.name}`);
        } else {
          console.error(`Error monitoring dark web for ${client.name}:`, error);
        }
      }
    }

    console.log(`Dark web monitoring complete. Created ${signalsCreated} signals.`);

    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: clients?.length || 0,
          signals_created: signalsCreated,
          scan_metadata: {
            sources: ['Have I Been Pwned', 'Breach Databases'],
            check_types: ['Data Breaches', 'Credential Leaks', 'Dark Web Mentions'],
            clients_monitored: clients?.map(c => c.name) || []
          }
        })
        .eq('id', historyEntry.id);
    }

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated,
      source: 'darkweb'
    });

  } catch (error) {
    console.error('Error in dark web monitoring:', error);
    
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'failed',
          scan_completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', historyEntry.id);
    }

    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
