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
 * Attribution: every signal passes source_key = DARKWEB_SOURCE_KEY so ingest-signal
 * resolves a real sources.source_id (the sources row must exist first).
 *
 * Paste URL resolution (HIBP Pastes API): `Id` is a Pastebin *key* ONLY when
 * `Source === 'Pastebin'`. For `AdHocUrl` (and other URL-bearing sources) `Id`
 * is a full URL. Blind-prefixing `https://pastebin.com/${Id}` produced malformed
 * source_urls like `https://pastebin.com/http://142.44.253.104/...` (signal
 * 349bcb29). Resolve per Source; never fabricate a host for an unknown source.
 */

const DARKWEB_SOURCE_KEY = 'HIBP Exposure Monitor (email/paste)';
// Free-mail providers — a breaches-by-domain query on one is meaningless (millions of unrelated accounts).
// A client whose only "domain" is one of these has no real corporate domain and is skipped.
const FREE_MAIL_DOMAINS = new Set([
  'hotmail.com', 'gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com',
  'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'msn.com', 'me.com', 'ymail.com',
]);

/**
 * Build a citation URL for a HIBP paste per its `Source`.
 * - Id already a full URL (AdHocUrl and any URL-bearing source) → verbatim.
 * - Source === 'Pastebin' → https://pastebin.com/{Id} (documented key form).
 * - Any other source → return the raw Id with NO prefix (source is noted in the
 *   signal text). We do not hardcode unverified per-site URL templates, because
 *   a wrong-but-plausible URL is the same false-provenance class as the original bug.
 */
function resolveHibpPasteUrl(paste: { Source?: string; Id?: string }): string | undefined {
  const id = typeof paste?.Id === 'string' ? paste.Id.trim() : '';
  if (!id) return undefined;
  if (/^https?:\/\//i.test(id)) return id;
  if ((paste?.Source || '').trim() === 'Pastebin') return `https://pastebin.com/${id}`;
  return id;
}

/** Best-effort date for a paste: paste.Date, else a date parsed from the Id/URL, else 'undated'. */
function resolvePasteDate(paste: { Date?: string; Id?: string }): string {
  if (typeof paste?.Date === 'string' && paste.Date.trim()) return paste.Date.trim();
  const id = typeof paste?.Id === 'string' ? paste.Id : '';
  const m = id.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : 'undated';
}

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
      .select('id, name, organization, contact_email, monitored_domains');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;
    const skippedClients: string[] = [];   // no real corporate domain → honestly skipped (reported below)

    for (const client of clients || []) {
      // SALVAGE FIX (operator ruling 2026-08-19): breaches-by-DOMAIN is only meaningful for a client's OWN
      // corporate domain. Use ONLY operator-configured monitored_domains, minus free-mail providers. NO
      // contact_email fallback, NO org-name guess — those produced meaningless queries (a personal client's
      // contact 'akilback@hotmail.com' → querying breaches on 'hotmail.com'). A monitor that queries a
      // free-mail provider's domain and reports success is worse than one that skips honestly. Per-subject
      // personal-email breach exposure is handled by subject-breach-check (HIBP account API), not here.
      const domains: string[] = [];
      if (Array.isArray(client.monitored_domains)) {
        for (const d of client.monitored_domains) {
          const dom = typeof d === 'string' ? d.trim().toLowerCase() : '';
          if (dom && !FREE_MAIL_DOMAINS.has(dom)) domains.push(dom);
        }
      }
      if (domains.length === 0) {
        console.log(`[monitor-darkweb] SKIP client "${client.name}" (${client.id}) — no real corporate monitored_domains (free-mail/contact-email fallback removed).`);
        skippedClients.push(client.name);
        continue;
      }

      for (const domain of domains) {
        // --- Domain breach check (no API key required) ---
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

            const recent = breaches
              .sort((a, b) => new Date(b.BreachDate || 0).getTime() - new Date(a.BreachDate || 0).getTime())
              .slice(0, 5);

            for (const breach of recent) {
              // Tier 1A: track every breach we see for this client+domain.
              // observation_value is `breach_name@domain` so re-emergence
              // of an old breach (e.g. data re-shared on a new dump site)
              // shows as first_seen_30d, not first_seen_ever.
              try {
                const { recordObservation } = await import('../_shared/observation-baselines.ts');
                await recordObservation(supabase, client.id, 'hibp_breach',
                  `${(breach.Name || 'unknown').toLowerCase()}@${domain}`,
                  { breach_date: breach.BreachDate, pwn_count: breach.PwnCount });
              } catch { /* non-blocking */ }

              const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
                body: {
                  text: `Data Breach Detected: ${breach.Title || breach.Name}\n\nDomain: ${domain} | Breach date: ${breach.BreachDate || 'Unknown'} | Affected accounts: ${breach.PwnCount?.toLocaleString() || 'Unknown'}\n\nData exposed: ${(breach.DataClasses || []).join(', ')}\n\n${breach.Description ? breach.Description.replace(/<[^>]+>/g, '') : ''}`,
                  source_url: `https://haveibeenpwned.com/PwnedWebsites#${breach.Name}`,
                  source_key: DARKWEB_SOURCE_KEY,
                  location: 'Dark Web / Breach Database',
                  clientId: client.id,
                  raw_json: {
                    signal_origin: 'monitor-darkweb',
                    monitor_name: 'monitor-darkweb',
                    hibp_breach: true,
                    breach_name: breach.Name ?? null,
                    domain,
                  },
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
              const pasteId = typeof paste.Id === 'string' ? paste.Id.trim() : '';

              // Dedup by (client_email, paste.Id): skip if a signal already exists
              // for this exact paste + email. paste.Id is stamped into raw_json so
              // this is stable across re-runs (the citation URL is not a reliable
              // key — the same paste can surface under different Source/Id forms).
              if (pasteId) {
                const { data: existingPaste } = await supabase
                  .from('signals')
                  .select('id')
                  .eq('client_id', client.id)
                  .eq('raw_json->>paste_id', pasteId)
                  .eq('raw_json->>paste_email', client.contact_email)
                  .limit(1)
                  .maybeSingle();
                if (existingPaste) {
                  console.log(`[DarkWeb] Duplicate paste ${pasteId} for ${client.contact_email} — skipping`);
                  continue;
                }
              }

              const pasteUrl = resolveHibpPasteUrl(paste);
              const pasteDate = resolvePasteDate(paste);

              const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
                body: {
                  text: `Paste Site Exposure: Contact email ${client.contact_email} found in paste.\n\nSource: ${paste.Source || 'Unknown'} | Date: ${pasteDate}\nTitle: ${paste.Title || 'Untitled'} | Email count: ${paste.EmailCount || 'Unknown'}`,
                  source_url: pasteUrl,
                  source_key: DARKWEB_SOURCE_KEY,
                  location: 'Paste Site',
                  clientId: client.id,
                  raw_json: {
                    signal_origin: 'monitor-darkweb',
                    monitor_name: 'monitor-darkweb',
                    hibp_paste: true,
                    paste_source: paste.Source ?? null,
                    paste_id: pasteId || null,
                    paste_email: client.contact_email,
                    paste_date: pasteDate,
                    email_count: paste.EmailCount ?? null,
                  },
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
      clients_skipped_no_domain: skippedClients.length,
      skipped_clients: skippedClients,
    });

    return successResponse({
      success: true,
      signals_created: signalsCreated,
      clients_checked: clients?.length || 0,
      clients_skipped_no_domain: skippedClients,   // honest: who has no real corporate domain
      source: 'darkweb'
    });

  } catch (error: any) {
    console.error('[DarkWeb] Fatal error:', error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error.message, 500);
  }
});
