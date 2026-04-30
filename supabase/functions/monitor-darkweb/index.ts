import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

/**
 * Dark Web / Breach Monitor
 * Uses Have I Been Pwned (HIBP) v3 API to check for breaches affecting client domains.
 * Runs every 6 hours via pg_cron.
 *
 * Sources:
 *   1. /breaches?domain= — all known breaches containing accounts for that domain (no key required)
 *   2. /pasteaccount/{email} — paste mentions of contact email (API key required)
 *
 * Dedup: routes through ingest-signal with source_key = hibp-{breach.Name}-{domain}
 */

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, 'monitor-darkweb-6h');

  try {
    const hibpKey = Deno.env.get('HIBP_API_KEY');
    const hibpHeaders: Record<string, string> = {
      'User-Agent': 'Fortress-Security-Platform/1.0',
      'Accept': 'application/json',
    };
    if (hibpKey) hibpHeaders['hibp-api-key'] = hibpKey;

    console.log('[DarkWeb] Starting HIBP breach monitoring...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, contact_email');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;

    for (const client of clients || []) {
      // Derive domain: prefer contact_email domain, fallback to org name guess
      let domain: string;
      if (client.contact_email && client.contact_email.includes('@')) {
        domain = client.contact_email.split('@')[1].toLowerCase().trim();
      } else {
        domain = (client.organization || client.name)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '') + '.com';
      }

      // --- 1. Domain breach check (no API key required) ---
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const resp = await fetch(
          `https://haveibeenpwned.com/api/v3/breaches?domain=${encodeURIComponent(domain)}`,
          { headers: hibpHeaders, signal: controller.signal }
        ).finally(() => clearTimeout(timeout));

        if (resp.ok) {
          const breaches: any[] = await resp.json();
          console.log(`[DarkWeb] ${domain}: ${breaches.length} breaches found`);

          // Sort by BreachDate descending, take most recent 5
          const recent = breaches
            .sort((a, b) => new Date(b.BreachDate || 0).getTime() - new Date(a.BreachDate || 0).getTime())
            .slice(0, 5);

          for (const breach of recent) {
            const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
              body: {
                text: `Data Breach Detected: ${breach.Title || breach.Name}\n\nDomain: ${domain} | Breach date: ${breach.BreachDate || 'Unknown'} | Affected accounts: ${breach.PwnCount?.toLocaleString() || 'Unknown'}\n\nData exposed: ${(breach.DataClasses || []).join(', ')}\n\n${breach.Description ? breach.Description.replace(/<[^>]+>/g, '') : ''}`,
                source_url: `https://haveibeenpwned.com/PwnedWebsites#${breach.Name}`,
                location: 'Dark Web / Breach Database',
                clientId: client.id,
              }
            });
            if (!ingestError) signalsCreated++;
          }
        } else if (resp.status === 404) {
          console.log(`[DarkWeb] ${domain}: no known breaches`);
        } else {
          console.log(`[DarkWeb] HIBP domain check failed for ${domain}: ${resp.status}`);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log(`[DarkWeb] HIBP domain check timeout for ${domain}`);
        } else {
          console.error(`[DarkWeb] Error checking domain ${domain}:`, err.message);
        }
      }

      // --- 2. Paste check for contact email (requires API key) ---
      if (hibpKey && client.contact_email) {
        // HIBP rate-limits: 1 request per 1500ms for paste endpoints
        await new Promise(r => setTimeout(r, 1600));
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          const resp = await fetch(
            `https://haveibeenpwned.com/api/v3/pasteaccount/${encodeURIComponent(client.contact_email)}`,
            { headers: hibpHeaders, signal: controller.signal }
          ).finally(() => clearTimeout(timeout));

          if (resp.ok) {
            const pastes: any[] = await resp.json();
            console.log(`[DarkWeb] ${client.contact_email}: found in ${pastes.length} pastes`);

            for (const paste of pastes.slice(0, 3)) {
              const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
                body: {
                  text: `Paste Site Exposure: Contact email ${client.contact_email} found in paste.\n\nSource: ${paste.Source || 'Unknown'} | Date: ${paste.Date || 'Unknown'}\nTitle: ${paste.Title || 'Untitled'} | Email count: ${paste.EmailCount || 'Unknown'}`,
                  source_url: paste.Id ? `https://pastebin.com/${paste.Id}` : undefined,
                  location: 'Paste Site',
                  clientId: client.id,
                }
              });
              if (!ingestError) signalsCreated++;
            }
          } else if (resp.status === 404) {
            console.log(`[DarkWeb] ${client.contact_email}: not found in any pastes`);
          } else {
            console.log(`[DarkWeb] Paste check failed for ${client.contact_email}: ${resp.status}`);
          }
        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.log(`[DarkWeb] Paste check timeout for ${client.contact_email}`);
          } else {
            console.error(`[DarkWeb] Error checking pastes for ${client.contact_email}:`, err.message);
          }
        }
      }

      // HIBP rate limit between clients
      await new Promise(r => setTimeout(r, 1600));
    }

    console.log(`[DarkWeb] Complete. ${signalsCreated} signals created.`);

    await completeHeartbeat(supabase, hb, {
      signals_created: signalsCreated,
      clients_checked: clients?.length || 0,
    });

    return successResponse({
      success: true,
      signals_created: signalsCreated,
      clients_checked: clients?.length || 0,
      source: 'darkweb'
    });

  } catch (error: any) {
    console.error('[DarkWeb] Fatal error:', error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error.message, 500);
  }
});
