import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

/**
 * GitHub Monitor
 * Searches GitHub for public code exposures mentioning client names alongside
 * security-sensitive terms (credentials, tokens, keys, etc.).
 *
 * Requires GITHUB_TOKEN env secret for GitHub REST API access.
 * Without it, exits gracefully with a note — add via: supabase secrets set GITHUB_TOKEN=ghp_...
 *
 * Runs every 6 hours via pg_cron.
 */

const SECURITY_KEYWORDS = [
  'password', 'api_key', 'api key', 'secret', 'token', 'credential',
  'private_key', 'access_key', 'client_secret', 'auth_token'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, 'monitor-github-6h');

  try {
    const githubToken = Deno.env.get('GITHUB_TOKEN');

    if (!githubToken) {
      console.log('[GitHub] GITHUB_TOKEN not configured — skipping. Add via: supabase secrets set GITHUB_TOKEN=ghp_...');
      await completeHeartbeat(supabase, hb, { signals_created: 0, note: 'GITHUB_TOKEN not configured' });
      return successResponse({ success: true, signals_created: 0, note: 'GITHUB_TOKEN not configured' });
    }

    console.log('[GitHub] Starting code exposure scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;

    for (const client of clients || []) {
      const searchTerm = client.organization || client.name;

      for (const keyword of SECURITY_KEYWORDS.slice(0, 3)) {
        try {
          const q = encodeURIComponent(`"${searchTerm}" ${keyword}`);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          const resp = await fetch(
            `https://api.github.com/search/code?q=${q}&per_page=5`,
            {
              headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'Fortress-Security-Platform/1.0',
              },
              signal: controller.signal
            }
          ).finally(() => clearTimeout(timeout));

          if (resp.status === 403 || resp.status === 429) {
            console.log(`[GitHub] Rate limited — pausing`);
            await new Promise(r => setTimeout(r, 10000));
            break;
          }

          if (!resp.ok) {
            console.log(`[GitHub] Search failed for ${searchTerm}/${keyword}: ${resp.status}`);
            continue;
          }

          const data: any = await resp.json();
          const items = data.items || [];
          console.log(`[GitHub] "${searchTerm}" + "${keyword}": ${items.length} results`);

          for (const item of items.slice(0, 3)) {
            const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
              body: {
                text: `GitHub Code Exposure: Possible credential leak mentioning "${searchTerm}" with keyword "${keyword}"\n\nRepo: ${item.repository?.full_name || 'Unknown'}\nFile: ${item.name} (${item.path})\n\nThis file appears in a public GitHub repository and may contain sensitive information related to ${client.name}.`,
                source_url: item.html_url,
                location: 'GitHub',
                clientId: client.id,
              }
            });
            if (!ingestError) signalsCreated++;
          }

          // GitHub API rate limit: 30 requests/min for code search
          await new Promise(r => setTimeout(r, 2200));

        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.log(`[GitHub] Timeout for ${searchTerm}/${keyword}`);
          } else {
            console.error(`[GitHub] Error for ${searchTerm}/${keyword}:`, err.message);
          }
        }
      }
    }

    console.log(`[GitHub] Complete. ${signalsCreated} signals created.`);

    await completeHeartbeat(supabase, hb, {
      signals_created: signalsCreated,
      clients_checked: clients?.length || 0,
    });

    return successResponse({
      success: true,
      signals_created: signalsCreated,
      clients_checked: clients?.length || 0,
      source: 'github'
    });

  } catch (error: any) {
    console.error('[GitHub] Fatal error:', error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error.message, 500);
  }
});
