import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

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

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

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
      .select('id, name, organization, industry, monitored_domains');

    if (clientsError) throw clientsError;

    console.log(`Monitoring domains for ${clients?.length || 0} clients`);

    let signalsCreated = 0;

    let clientsSkippedNoDomains = 0;

    for (const client of clients || []) {
      try {
        // WO-COVERAGE (2026-07-10): fail-closed on empty monitored_domains.
        // The prior behavior fabricated a baseDomain from client.organization/name
        // (e.g. Kilbacks org="Personal" → typosquats of "personal") which produced
        // ~85 low-severity noise signals/day with no relationship to any real
        // client-owned domain. Doctrine: populated data before rubric — no scan
        // when there's nothing real to compare against. Supersedes the interim
        // Option A severity downgrade from #83 for unconfigured clients: they now
        // produce nothing rather than low-severity noise. Petronas Canada + BC
        // Place (the two clients with real monitored_domains) continue producing.
        // Real MEDIUM/HIGH bands (resolving + active MX targeting a REAL client-
        // owned domain) still awaits the approved rubric rebuild per
        // WO-DATA-INTEGRITY.
        const configuredDomains = Array.isArray(client.monitored_domains)
          ? client.monitored_domains.filter((d: unknown): d is string => typeof d === 'string' && d.trim().length > 0)
          : [];
        if (configuredDomains.length === 0) {
          clientsSkippedNoDomains++;
          console.log(`Skipping ${client.name} — no monitored_domains configured (fail-closed per WO-COVERAGE 2026-07-10)`);
          continue;
        }

        const baseDomain = client.organization?.toLowerCase().replace(/\s+/g, '') || client.name.toLowerCase().replace(/\s+/g, '');
        const variants = generateTyposquatVariants(baseDomain);

        console.log(`Checking ${variants.length} domain variants for ${client.name} (${configuredDomains.length} monitored domains configured)`);

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
                    // WO-COVERAGE (2026-07-10): stamp signal_origin so this
                    // producer is visible to the watchdog + attribution reports.
                    // Without this the row falls through the BEFORE INSERT
                    // trigger's deriveOrigin heuristic to 'unknown-legacy',
                    // which hid ~85-90/day of Kilbacks typosquat signals from
                    // the system-watchdog:2966 probe that gates on
                    // signal_origin === 'monitor-domains'.
                    signal_origin: 'monitor-domains',
                    normalized_text: signalText,
                    category: 'phishing',
                    // #83 (2026-07-09) — Option A downgrade to LOW. The "legitimate_domain"
                    // this variant is compared against is FABRICATED from client.organization/
                    // client.name (line ~63: "Petronas Canada" -> petronascanada.com, not the
                    // real petronas.ca), so a registered typosquat of that guess is NOT a
                    // justified high — it was the platform's single biggest severity-inflation
                    // source (~465/wk at hardcoded high). A resolving lookalike of an UNVERIFIED
                    // name-guess is low-confidence noise. Real MEDIUM/HIGH bands (resolving +
                    // active MX targeting a REAL client-owned domain) are rebuilt on the approved
                    // rubric ONLY AFTER clients.monitored_domains is populated (WO-DATA-INTEGRITY;
                    // currently 1/10 active clients). Do not restore high without that data.
                    severity: 'low',
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
                  
                  await correlateSignalEntities({
                    supabase,
                    signalText,
                    clientId: client.id,
                    additionalContext: `Suspicious domain: ${variant}.com, Legitimate: ${baseDomain}.com`
                  });
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

    console.log(`Domain monitoring complete. Created ${signalsCreated} signals (${clientsSkippedNoDomains} clients skipped — no monitored_domains).`);

    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: clients?.length || 0,
          signals_created: signalsCreated,
          scan_metadata: {
            source_type: 'Domain Registration',
            check_types: ['Typosquatting', 'Phishing Domains', 'Brand Impersonation'],
            clients_monitored: clients?.map(c => c.name) || []
          }
        })
        .eq('id', historyEntry.id);
    }

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated,
      source: 'domains'
    });

  } catch (error) {
    console.error('Error in domain monitoring:', error);
    
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
