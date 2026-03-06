import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";

/**
 * Autonomous Source Discovery
 *
 * Uses AI to discover new monitoring sources relevant to each client's
 * keyword profile, validates them by testing accessibility, then inserts
 * verified sources into the sources table.
 *
 * Invoked:
 *   - Manually via POST (body: { client_id?: string, dry_run?: boolean })
 *   - Via cron job (discovers sources for all active clients)
 */

const EXECUTION_CEILING_MS = 55_000;
const startTime = Date.now();
function isTimeUp() { return Date.now() - startTime > EXECUTION_CEILING_MS; }

interface SuggestedSource {
  name: string;
  type: "rss" | "url_feed" | "api" | "gov" | "court";
  url: string;
  description: string;
  monitor_type: string;
  keywords?: string[];
  rationale: string;
}

interface DiscoveryResult {
  client_id: string;
  client_name: string;
  suggested: number;
  verified: number;
  added: number;
  skipped_existing: number;
  sources_added: string[];
}

/** Try to fetch a URL; return true if it responds with a 2xx status within timeout. */
async function isAccessible(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FortressBot/1.0; +https://fortressintel.com)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*",
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    return res.ok;
  } catch {
    return false;
  }
}

/** Extract existing source URLs from configs to avoid duplicates */
function extractUrl(config: any): string | null {
  if (!config) return null;
  return config.url || config.feed_url || config.endpoint || null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { client_id, dry_run = false } = body;

    console.log(`[source-discovery] Starting. dry_run=${dry_run}, client_id=${client_id || 'all'}`);

    // 1. Fetch clients
    let clientQuery = supabase
      .from("clients")
      .select("id, name, industry, monitoring_keywords, organization")
      .eq("status", "active");
    if (client_id) clientQuery = clientQuery.eq("id", client_id);

    const { data: clients, error: clientsError } = await clientQuery;
    if (clientsError || !clients?.length) {
      console.error("[source-discovery] No clients found:", clientsError);
      return successResponse({ message: "No active clients found", results: [] });
    }

    // 2. Fetch existing source URLs to deduplicate
    const { data: existingSources } = await supabase.from("sources").select("config, name");
    const existingUrls = new Set<string>(
      (existingSources || [])
        .map((s: any) => extractUrl(s.config))
        .filter(Boolean)
        .map((u: string) => u.toLowerCase())
    );
    const existingNames = new Set<string>(
      (existingSources || []).map((s: any) => (s.name || "").toLowerCase())
    );

    console.log(`[source-discovery] ${existingUrls.size} existing source URLs, ${clients.length} clients to process`);

    const allResults: DiscoveryResult[] = [];

    for (const client of clients) {
      if (isTimeUp()) {
        console.log("[source-discovery] Execution ceiling reached, stopping early");
        break;
      }

      const keywords: string[] = client.monitoring_keywords || [];
      const industryContext = client.industry || "energy/pipeline";
      const orgName = client.organization || client.name;

      console.log(`[source-discovery] Discovering sources for client: ${client.name} (${keywords.length} keywords)`);

      const result: DiscoveryResult = {
        client_id: client.id,
        client_name: client.name,
        suggested: 0,
        verified: 0,
        added: 0,
        skipped_existing: 0,
        sources_added: [],
      };

      // 3. Ask AI to suggest new monitoring sources
      const prompt = `You are an intelligence source analyst for a ${industryContext} security monitoring platform.

Organization: ${orgName}
Industry: ${industryContext}
Monitoring keywords: ${keywords.slice(0, 30).join(", ")}

Identify 15 high-value, publicly accessible monitoring sources that do NOT already appear in this list of already-monitored URL patterns:
${[...existingUrls].slice(0, 50).join("\n")}

Focus on:
- RSS/Atom feeds from news outlets, government agencies, regulatory bodies
- Government press releases and advisories relevant to ${industryContext} in Canada
- Court dockets or legal monitoring feeds
- Threat intelligence feeds (open/free)
- Local/regional news RSS relevant to the organization's operating areas

Respond ONLY with a JSON array. Each element must have exactly these fields:
{
  "name": "short display name (max 60 chars)",
  "type": "rss" | "url_feed" | "gov" | "court" | "api",
  "url": "full URL to the feed or page (must be a real, working URL)",
  "description": "one sentence explaining what this source monitors",
  "monitor_type": "monitor-rss" | "monitor-canadian-sources" | "monitor-social-unified",
  "keywords": ["optional", "filter", "keywords"],
  "rationale": "why this is relevant to ${orgName}"
}

Return ONLY the JSON array, no other text.`;

      const aiResult = await callAiGatewayJson<SuggestedSource[]>({
        model: "google/gemini-2.5-flash-lite",
        functionName: "autonomous-source-discovery",
        messages: [{ role: "user", content: prompt }],
        skipGuardrails: true,
      });

      if (!aiResult.data || !Array.isArray(aiResult.data)) {
        console.error(`[source-discovery] AI failed for ${client.name}:`, aiResult.error);
        allResults.push(result);
        continue;
      }

      const suggestions = aiResult.data.filter(
        (s) => s.url && s.name && typeof s.url === "string" && s.url.startsWith("http")
      );
      result.suggested = suggestions.length;
      console.log(`[source-discovery] AI suggested ${suggestions.length} sources for ${client.name}`);

      // 4. Validate and insert each suggestion
      for (const suggestion of suggestions) {
        if (isTimeUp()) break;

        const urlLower = suggestion.url.toLowerCase();

        // Skip if URL already tracked
        if (existingUrls.has(urlLower)) {
          result.skipped_existing++;
          continue;
        }
        // Skip if name already tracked
        if (existingNames.has(suggestion.name.toLowerCase())) {
          result.skipped_existing++;
          continue;
        }

        // Test accessibility
        const accessible = await isAccessible(suggestion.url);
        if (!accessible) {
          console.log(`[source-discovery] Inaccessible, skipping: ${suggestion.url}`);
          continue;
        }
        result.verified++;

        if (!dry_run) {
          const { error: insertError } = await supabase.from("sources").insert({
            name: suggestion.name,
            type: suggestion.type || "rss",
            config: {
              url: suggestion.url,
              description: suggestion.description,
              keywords: suggestion.keywords || keywords.slice(0, 5),
              discovered_by: "autonomous-source-discovery",
              rationale: suggestion.rationale,
            },
            status: "active",
            monitor_type: suggestion.monitor_type || "monitor-rss",
          });

          if (insertError) {
            console.error(`[source-discovery] Insert failed for ${suggestion.name}:`, insertError);
          } else {
            result.added++;
            result.sources_added.push(suggestion.name);
            existingUrls.add(urlLower);
            existingNames.add(suggestion.name.toLowerCase());
            console.log(`[source-discovery] Added source: ${suggestion.name}`);
          }
        } else {
          // dry_run: just report what would be added
          result.added++;
          result.sources_added.push(`[DRY RUN] ${suggestion.name}`);
        }
      }

      allResults.push(result);
      console.log(`[source-discovery] ${client.name}: suggested=${result.suggested}, verified=${result.verified}, added=${result.added}, skipped=${result.skipped_existing}`);
    }

    const totalAdded = allResults.reduce((sum, r) => sum + r.added, 0);
    const totalVerified = allResults.reduce((sum, r) => sum + r.verified, 0);

    return successResponse({
      success: true,
      dry_run,
      clients_processed: allResults.length,
      total_sources_added: totalAdded,
      total_verified: totalVerified,
      results: allResults,
    });

  } catch (err) {
    console.error("[source-discovery] Fatal error:", err);
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
});
