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

// Repos and orgs known to produce false-positive matches when paired
// with corporate domain searches. EasyList et al. are ad-blocker filter
// lists that contain CSS selectors for hiding cookie banners on public
// websites — domain co-occurrence with words like 'cookie' or 'secret'
// triggers naive matchers. Public dashboards/data projects (e.g. mobility
// dashboards) reference companies in READMEs descriptively. Skip these.
const NOISE_REPO_PATTERNS = [
  /^easylist\//i,
  /^AdguardTeam\//i,
  /^uBlockOrigin\//i,
  /^AdgardOriginalfilters\//i,
  /^duckduckgo\/tracker-radar/i,
  /^disconnectme\//i,
  /\/awesome-/i,         // awesome-* lists are catalogs of public links
  /-dashboard$/i,        // public dashboards reference companies in READMEs
  /^mozilla\/.*-list/i,  // Mozilla maintained block lists
];

// Structural patterns indicating an actual credential — not just words.
// We require ONE of these to appear in the file content (not just in the
// search keyword) before flagging as a credential exposure.
const CREDENTIAL_STRUCTURE_PATTERNS = [
  /BEGIN [A-Z ]*PRIVATE KEY/,           // PEM private keys
  /\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{30,}\b/, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,     // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/,                // AWS access keys
  /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/, // Stripe secret keys
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWTs
  /(?:password|passwd|pwd)\s*[:=]\s*["'][^"'\s]{6,}["']/i, // hardcoded password assignment
  /(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/i,
  /(?:token|bearer)\s*[:=]\s*["'][A-Za-z0-9_.-]{20,}["']/i,
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

    // Pull contact_email so we can derive a real domain for searching.
    // GitHub Code Search returns the most signal when you query for
    // distinctive identifiers (domains, internal hostnames, API keys
    // committed in code). Searching for the client's display name
    // ("Petronas Canada") returns mostly README mentions in benign
    // repos; searching for the email domain ("petronas.com",
    // "petronas.ca") catches credentials.txt-style leaks where
    // someone committed a config file with a corporate email
    // address in it.
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, contact_email, monitored_domains');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;

    /**
     * Build the list of distinctive search terms for a client. Returns
     * everything we can use as a high-signal query target. Empty
     * organization strings get filtered.
     *
     * 2026-05-08: monitored_domains[] takes precedence — every domain
     * the operator marks for the client becomes a search term. Falls back
     * to contact_email-derived domain only when monitored_domains is
     * empty. Drops the org-name search for clients with em-dashes or
     * other GitHub-search-breaking characters in their org name.
     */
    function buildSearchTerms(client: any): string[] {
      const terms: string[] = [];
      // Highest signal: every operator-configured domain.
      if (Array.isArray(client.monitored_domains) && client.monitored_domains.length > 0) {
        for (const d of client.monitored_domains) {
          if (typeof d === 'string' && d.trim().length > 0) terms.push(d.trim().toLowerCase());
        }
      } else if (client.contact_email && client.contact_email.includes('@')) {
        const domain = client.contact_email.split('@')[1].toLowerCase().trim();
        if (domain) terms.push(domain);
      }
      // Organization name as a quoted phrase (lower signal but still
      // worth the call when we have rate budget). Skip orgs that contain
      // em-dashes / non-ASCII punctuation that breaks GitHub query syntax.
      if (client.organization && client.organization.trim().length > 3 && !/[—–]/.test(client.organization)) {
        terms.push(`"${client.organization.trim()}"`);
      }
      return terms;
    }

    for (const client of clients || []) {
      const searchTerms = buildSearchTerms(client);
      if (searchTerms.length === 0) {
        console.log(`[GitHub] ${client.name}: no usable search terms`);
        continue;
      }

      for (const term of searchTerms) {
        // 2026-05-08: replaced generic keyword pairing with file-type
        // qualifiers. The old logic ("petronas.ca password") matched any
        // file containing both words — README mentions, ad-blocker filter
        // lists (easylist), and public dashboards all triggered false
        // "credentials may have been exposed" signals. The new queries
        // target file types where real credentials actually live.
        const TARGETED_QUERIES = [
          `${term} extension:env`,
          `${term} filename:.env`,
          `${term} filename:credentials`,
          `${term} extension:pem`,
          `${term} BEGIN PRIVATE KEY`,
        ];
        for (const queryStr of TARGETED_QUERIES.slice(0, 3)) {
          try {
            const q = encodeURIComponent(queryStr);
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
                signal: controller.signal,
              }
            ).finally(() => clearTimeout(timeout));

            if (resp.status === 403 || resp.status === 429) {
              console.log(`[GitHub] Rate limited — pausing 10s`);
              await new Promise(r => setTimeout(r, 10000));
              break;
            }
            if (!resp.ok) {
              console.log(`[GitHub] Search failed for "${queryStr}": ${resp.status}`);
              continue;
            }

            const data: any = await resp.json();
            const items: any[] = data.items || [];
            console.log(`[GitHub] "${queryStr}": ${items.length} results`);

            for (const item of items.slice(0, 3)) {
              const repoFullName: string = item.repository?.full_name || '';

              // Skip known noise repos (ad-blocker filter lists, public
              // dashboards, awesome-* catalogs).
              const isNoiseRepo = NOISE_REPO_PATTERNS.some(p => p.test(repoFullName));
              if (isNoiseRepo) {
                console.log(`[GitHub] skipping noise repo: ${repoFullName}`);
                continue;
              }

              // Validate the file content actually contains a structural
              // credential pattern before flagging. GitHub Code Search
              // matches descriptive prose ("documentation that mentions
              // password reset"), README catalogs, and example files —
              // we want only files that have a real credential signature.
              let contentValidated = false;
              let matchedPattern: string | null = null;
              try {
                const rawUrl = `https://raw.githubusercontent.com/${repoFullName}/${item.sha || 'HEAD'}/${item.path}`;
                const rawResp = await fetch(rawUrl, { signal: AbortSignal.timeout(8000) });
                if (rawResp.ok) {
                  const content = (await rawResp.text()).slice(0, 50_000);
                  for (const pat of CREDENTIAL_STRUCTURE_PATTERNS) {
                    if (pat.test(content)) {
                      contentValidated = true;
                      matchedPattern = pat.source.slice(0, 50);
                      break;
                    }
                  }
                }
              } catch {
                // Content fetch failed — skip rather than false-flag.
              }

              if (!contentValidated) {
                console.log(`[GitHub] no structural credential pattern in ${repoFullName}/${item.path} — skipping`);
                continue;
              }

              const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
                body: {
                  text: `GitHub Credential Exposure: file contains a credential pattern matching domain ${term} for ${client.name}.\n\nRepo: ${repoFullName}\nFile: ${item.path}\nMatched pattern: ${matchedPattern}\n\nReview the file directly to assess whether the credential is active or already-rotated. Pattern match alone confirms the file has credential-shaped content — operator must validate currency.`,
                  source_url: item.html_url,
                  location: 'GitHub',
                  client_id: client.id,
                  source_key: 'github-code-search',
                  raw_json: {
                    signal_origin: 'monitor-github',
                    source: 'GitHub Code Search',
                    search_query: queryStr,
                    matched_pattern: matchedPattern,
                    repo_full_name: repoFullName,
                    file_path: item.path ?? null,
                    category_hint: 'cyber_credential_leak',
                  },
                },
              });
              if (!ingestError) signalsCreated++;
            }

            // GitHub Code Search: 30 req/min limit. 2.2s between
            // calls keeps us comfortably under.
            await new Promise(r => setTimeout(r, 2200));
          } catch (err: any) {
            if (err.name === 'AbortError') {
              console.log(`[GitHub] Timeout for "${queryStr}"`);
            } else {
              console.error(`[GitHub] Error for "${queryStr}":`, err.message);
            }
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
