import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

// Common typosquatting patterns
function generateTyposquatVariants(domain: string): string[] {
  const variants: string[] = [];
  const baseDomain = domain.replace(/\.(com|net|org|io|ca)$/, '');

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

// WO-COVERAGE priority 1c (2026-07-11): parse a real client-owned domain like
// "petronas.ca" or "coastalgaslink.com" into { label, tld } so we can typosquat
// the LABEL and reattach the ORIGINAL TLD. Prior behavior fabricated a base
// string from client.organization ("Petronas Canada Ltd." → "petronascanadaltd")
// and hardcoded .com — the sensor was aimed at fiction. Now we typosquat the
// actual monitored domains, TLD-preserving, so pretronas.ca / petr0nas.ca get
// checked instead of petronascanadaltd.com variants.
function splitLabelTld(domain: string): { label: string; tld: string } | null {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === clean.length - 1) return null;
  return { label: clean.substring(0, lastDot), tld: clean.substring(lastDot + 1) };
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

        console.log(`Checking typosquat variants of ${configuredDomains.length} real monitored_domains for ${client.name}`);

        // WO-COVERAGE priority 1c (2026-07-11): typosquat each REAL monitored
        // domain, not the fabricated client.organization/name string. The prior
        // shape passed the fail-closed gate but still typosquatted fiction
        // (Petronas's org "Petronas Canada Ltd." → "petronascanadaltd" variants
        // in .com when the real domains are petronas.ca, petronas.com,
        // progressenergy.com, lngcanada.ca, coastalgaslink.com). Zero false
        // positives, but also zero true positives possible. Now: for each real
        // monitored domain, split into label+TLD, typosquat the label, keep
        // the original TLD. petronas.ca → petr0nas.ca / petrona5.ca / etc.
        for (const realDomain of configuredDomains) {
          const parsed = splitLabelTld(realDomain);
          if (!parsed) {
            console.warn(`Skipping malformed monitored_domain "${realDomain}" for ${client.name}`);
            continue;
          }
          const { label, tld } = parsed;
          const labelVariants = generateTyposquatVariants(label);

          console.log(`  → ${realDomain}: ${labelVariants.length} label variants`);

          for (const variant of labelVariants) {
            const suspiciousDomain = `${variant}.${tld}`;
            // Skip the exact legitimate domain (a variant might reproduce it
            // in edge cases — e.g. label already contained numerics).
            if (suspiciousDomain === realDomain) continue;

            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 5000);

              const response = await fetch(
                `https://dns.google/resolve?name=${suspiciousDomain}&type=A`,
                { signal: controller.signal }
              ).finally(() => clearTimeout(timeout));

              if (response.ok) {
                const data = await response.json();

                if (data.Answer && data.Answer.length > 0) {
                  const signalText = `Suspicious Domain Detected: ${suspiciousDomain} - Potential typosquatting of ${realDomain}`;

                  const { error: signalError } = await supabase
                    .from('signals')
                    .insert({
                      client_id: client.id,
                      // WO-COVERAGE (2026-07-10): stamp signal_origin so this
                      // producer is visible to the watchdog + attribution reports.
                      signal_origin: 'monitor-domains',
                      normalized_text: signalText,
                      category: 'phishing',
                      // #83 severity guidance retained: 'low' until the MEDIUM/HIGH
                      // rubric (resolving + active MX targeting a REAL client-owned
                      // domain) ships. But now — post priority 1c — the
                      // "legitimate_domain" comparison IS a real client-owned
                      // domain, not a fabricated org string. When the rubric
                      // arrives, these signals can honestly graduate to
                      // MEDIUM/HIGH on the MX + activity evidence.
                      severity: 'low',
                      location: 'Domain Registration',
                      raw_json: {
                        platform: 'dns',
                        suspicious_domain: suspiciousDomain,
                        legitimate_domain: realDomain,
                        dns_records: data.Answer,
                      },
                      status: 'new',
                      confidence: 0.75,
                    });

                  if (!signalError) {
                    signalsCreated++;
                    console.log(`Created domain signal for ${client.name}: ${suspiciousDomain} vs ${realDomain}`);

                    await correlateSignalEntities({
                      supabase,
                      signalText,
                      clientId: client.id,
                      additionalContext: `Suspicious domain: ${suspiciousDomain}, Legitimate: ${realDomain}`
                    });
                  }
                }
              }

              // Rate limiting between checks
              await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') {
                console.log(`DNS check timeout for ${suspiciousDomain}`);
              }
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
