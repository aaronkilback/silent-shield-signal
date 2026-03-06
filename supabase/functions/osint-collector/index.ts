/**
 * OSINT Collector — Consolidated Domain Service
 * 
 * Single entry point for all OSINT monitoring and collection operations.
 * Replaces ~30 individual monitor-* edge functions with action-based routing.
 * 
 * Actions:
 *   monitor-news             — Google News monitoring
 *   monitor-news-google      — Emergency Google News monitoring
 *   monitor-social           — Social media monitoring (aggregated)
 *   monitor-twitter          — Twitter/X monitoring
 *   monitor-facebook         — Facebook monitoring
 *   monitor-instagram        — Instagram monitoring
 *   monitor-linkedin         — LinkedIn monitoring
 *   monitor-github           — GitHub code exposure monitoring
 *   monitor-darkweb          — Dark web monitoring
 *   monitor-rss              — RSS feed monitoring
 *   monitor-weather          — Weather alert monitoring
 *   monitor-wildfires        — Wildfire monitoring
 *   monitor-wildfire-comprehensive — Comprehensive wildfire monitoring
 *   monitor-earthquakes      — Earthquake monitoring
 *   monitor-domains          — Domain monitoring
 *   monitor-threat-intel     — Threat intelligence feeds
 *   monitor-travel-risks     — Travel risk monitoring
 *   monitor-regulatory       — Regulatory changes monitoring
 *   monitor-pastebin         — Pastebin leak monitoring
 *   monitor-naad             — NAAD alert monitoring
 *   monitor-csis             — CSIS monitoring
 *   monitor-court            — Court registry monitoring
 *   monitor-canadian         — Canadian sources monitoring
 *   monitor-community        — Community outreach monitoring
 *   monitor-regional-apac    — APAC regional monitoring
 *   monitor-emergency-google — Emergency Google monitoring
 *   monitor-entity-proximity — Entity proximity monitoring
 *   web-search               — OSINT web search
 *   manual-scan              — Manual scan trigger
 *   discover-sources         — AI-powered autonomous source discovery
 */

import { corsHeaders, handleCors, errorResponse } from "../_shared/supabase-client.ts";

const ACTION_TO_FUNCTION: Record<string, string> = {
  'monitor-news': 'monitor-news',
  'monitor-news-google': 'monitor-news-google',
  'monitor-social': 'monitor-social',
  'monitor-social-unified': 'monitor-social-unified',
  'monitor-linkedin': 'monitor-linkedin',
  'monitor-github': 'monitor-github',
  'monitor-darkweb': 'monitor-darkweb',
  'monitor-rss': 'monitor-rss-sources',
  'monitor-weather': 'monitor-weather',
  'monitor-wildfires': 'monitor-wildfires',
  'monitor-wildfire-comprehensive': 'monitor-wildfire-comprehensive',
  'monitor-earthquakes': 'monitor-earthquakes',
  'monitor-domains': 'monitor-domains',
  'monitor-threat-intel': 'monitor-threat-intel',
  'monitor-travel-risks': 'monitor-travel-risks',
  'monitor-regulatory': 'monitor-regulatory-changes',
  'monitor-pastebin': 'monitor-pastebin',
  'monitor-naad': 'monitor-naad-alerts',
  'monitor-csis': 'monitor-csis',
  'monitor-court': 'monitor-court-registry',
  'monitor-canadian': 'monitor-canadian-sources',
  'monitor-community': 'monitor-community-outreach',
  'monitor-regional-apac': 'monitor-regional-apac',
  'monitor-emergency-google': 'monitor-emergency-google',
  'monitor-entity-proximity': 'monitor-entity-proximity',
  'web-search': 'osint-web-search',
  'manual-scan': 'manual-scan-trigger',
  'entity-scan': 'osint-entity-scan',
  'test-connectivity': 'test-osint-source-connectivity',
  'discover-sources': 'autonomous-source-discovery',
};

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (!action) {
      return errorResponse(
        `Missing "action" field. Valid actions: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
        400
      );
    }

    console.log(`[OsintCollector] Dispatching action: ${action}`);

    const functionName = ACTION_TO_FUNCTION[action];
    if (!functionName) {
      return errorResponse(
        `Unknown action: ${action}. Valid actions: ${Object.keys(ACTION_TO_FUNCTION).join(', ')}`,
        400
      );
    }

    return await delegateToFunction(functionName, body);
  } catch (error) {
    console.error('[OsintCollector] Router error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function delegateToFunction(functionName: string, body: Record<string, unknown>): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const { action, ...forwardBody } = body;

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(forwardBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return errorResponse(`${functionName} timed out after 55s`, 504);
    }
    return errorResponse(
      `Failed to delegate to ${functionName}: ${err instanceof Error ? err.message : 'Unknown'}`,
      502
    );
  }
}
