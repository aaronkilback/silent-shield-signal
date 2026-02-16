/**
 * API v1 Security — Mobile-accessible WRAITH security operations
 * 
 * Exposes breach checks, URL analysis, email phishing detection, threat feeds,
 * and security scoring via API key authentication for mobile app access.
 * 
 * Auth: X-API-Key header (fai_ prefixed keys)
 * Required permission: read:security
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface AuthValidation {
  valid: boolean;
  authType: 'api_key' | null;
  apiKey?: {
    id: string;
    name: string;
    client_id: string | null;
    permissions: string[];
    rate_limit_per_minute: number;
    created_by: string | null;
  };
  error?: string;
}

async function validateApiKey(supabase: any, apiKeyHeader: string): Promise<AuthValidation> {
  if (!apiKeyHeader) {
    return { valid: false, authType: null, error: 'Missing X-API-Key header' };
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(apiKeyHeader);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const { data: apiKey, error } = await supabase
    .from('api_keys')
    .select('id, name, client_id, permissions, rate_limit_per_minute, is_active, expires_at, created_by')
    .eq('key_hash', keyHash)
    .single();

  if (error || !apiKey) {
    return { valid: false, authType: null, error: 'Invalid API key' };
  }

  if (!apiKey.is_active) {
    return { valid: false, authType: null, error: 'API key is inactive' };
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return { valid: false, authType: null, error: 'API key has expired' };
  }

  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id);

  return {
    valid: true,
    authType: 'api_key',
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      client_id: apiKey.client_id,
      permissions: apiKey.permissions,
      rate_limit_per_minute: apiKey.rate_limit_per_minute,
      created_by: apiKey.created_by,
    }
  };
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Breach Check via HIBP ───────────────────────────────────────────────
async function checkBreaches(email: string) {
  if (!email) return { error: 'Email is required' };

  const HIBP_API_KEY = Deno.env.get("HIBP_API_KEY");
  if (!HIBP_API_KEY) {
    return {
      email, breach_count: 0, risk_level: 'unknown',
      message: 'Breach checking service not configured.',
      recommendations: [
        'Use unique passwords for every account',
        'Enable MFA everywhere possible',
        'Monitor your email on haveibeenpwned.com manually',
      ]
    };
  }

  try {
    const response = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      { headers: { "hibp-api-key": HIBP_API_KEY, "user-agent": "Fortress-WRAITH-API" } }
    );

    if (response.ok) {
      const breaches = await response.json();
      const criticalBreaches = breaches.filter((b: any) =>
        (b.DataClasses || []).some((dc: string) => /password|credit|financial|social.*security/i.test(dc))
      );

      const recs = [
        'Change passwords for all breached services immediately',
        'Enable Multi-Factor Authentication (MFA) on all accounts',
      ];
      if (criticalBreaches.length > 0) {
        recs.unshift('CRITICAL: Financial/password data exposed — freeze credit and change all passwords NOW');
        recs.push('Monitor bank statements and credit reports for unauthorized activity');
      }
      if (breaches.length > 5) {
        recs.push('Your email has significant exposure — consider using email aliases');
      }
      recs.push('Use a hardware security key (YubiKey) for critical accounts');

      return {
        email, found: true,
        breach_count: breaches.length,
        critical_count: criticalBreaches.length,
        risk_level: criticalBreaches.length > 0 ? 'critical' : breaches.length > 5 ? 'high' : breaches.length > 2 ? 'medium' : 'low',
        breaches: breaches.slice(0, 15).map((b: any) => ({
          name: b.Name, domain: b.Domain, date: b.BreachDate,
          data_exposed: b.DataClasses?.slice(0, 8) || [],
          pwn_count: b.PwnCount,
          is_critical: (b.DataClasses || []).some((dc: string) => /password|credit|financial/i.test(dc))
        })),
        recommendations: recs,
        checked_at: new Date().toISOString()
      };
    } else if (response.status === 404) {
      return {
        email, found: false, breach_count: 0, critical_count: 0,
        risk_level: 'low', message: 'No breaches found.',
        recommendations: ['Continue monitoring', 'Keep MFA enabled'],
        checked_at: new Date().toISOString()
      };
    }
    return { error: `Breach check failed: ${response.status}` };
  } catch (e) {
    return { error: `Breach check error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

// ─── Paste Check via HIBP ────────────────────────────────────────────────
async function checkPastes(email: string) {
  if (!email) return { error: 'Email is required' };

  const HIBP_API_KEY = Deno.env.get("HIBP_API_KEY");
  if (!HIBP_API_KEY) return { email, paste_count: 0, message: 'Paste checking not configured' };

  try {
    const response = await fetch(
      `https://haveibeenpwned.com/api/v3/pasteaccount/${encodeURIComponent(email)}`,
      { headers: { "hibp-api-key": HIBP_API_KEY, "user-agent": "Fortress-WRAITH-API" } }
    );

    if (response.ok) {
      const pastes = await response.json();
      return {
        email, found: true, paste_count: pastes.length,
        pastes: pastes.slice(0, 10).map((p: any) => ({
          source: p.Source, title: p.Title, date: p.Date, email_count: p.EmailCount
        })),
        risk_level: pastes.length > 5 ? 'high' : pastes.length > 0 ? 'medium' : 'low',
        checked_at: new Date().toISOString()
      };
    } else if (response.status === 404) {
      return { email, found: false, paste_count: 0, risk_level: 'low', checked_at: new Date().toISOString() };
    }
    return { error: `Paste check failed: ${response.status}` };
  } catch (e) {
    return { error: `Paste check error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

// ─── CISA Threat Feed ────────────────────────────────────────────────────
async function getThreatFeed() {
  try {
    const response = await fetch(
      "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      const vulns = (data.vulnerabilities || []).slice(0, 10);
      return {
        source: 'CISA Known Exploited Vulnerabilities',
        count: vulns.length,
        vulnerabilities: vulns.map((v: any) => ({
          cve: v.cveID, vendor: v.vendorProject, product: v.product,
          description: v.shortDescription, due_date: v.dueDate,
          action: v.requiredAction
        })),
        last_updated: data.catalogVersion || new Date().toISOString()
      };
    }
    return { source: 'CISA', count: 0, error: 'Feed unavailable' };
  } catch {
    return { source: 'CISA', count: 0, error: 'Failed to fetch threat feed' };
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Authenticate via API key
    const apiKeyHeader = req.headers.get('x-api-key');
    if (!apiKeyHeader) {
      return jsonResponse({ error: 'API key required. Include x-api-key header.' }, 401);
    }

    const auth = await validateApiKey(supabase, apiKeyHeader);
    if (!auth.valid) {
      return jsonResponse({ error: auth.error }, 401);
    }

    // Check permission
    const permissions = auth.apiKey?.permissions || [];
    const hasPermission = permissions.includes('read:security') || 
                          permissions.includes('read:all') ||
                          permissions.includes('*');
    if (!hasPermission) {
      return jsonResponse({ error: 'Insufficient permissions. Required: read:security' }, 403);
    }

    // Parse request
    const url = new URL(req.url);
    let body: any = {};
    if (req.method === 'POST') {
      body = await req.json();
    }

    const action = body.action || url.searchParams.get('action');
    if (!action) {
      return jsonResponse({
        error: 'Missing "action" parameter.',
        available_actions: [
          'check_breaches',
          'check_pastes', 
          'full_exposure_check',
          'threat_feed'
        ],
        usage: {
          check_breaches: { method: 'POST', body: { action: 'check_breaches', email: 'user@example.com' } },
          full_exposure_check: { method: 'POST', body: { action: 'full_exposure_check', email: 'user@example.com' } },
          threat_feed: { method: 'GET', query: '?action=threat_feed' },
        }
      }, 400);
    }

    console.log(`[api-v1-security] Action: ${action}, API Key: ${auth.apiKey?.name}`);

    switch (action) {
      case 'check_breaches': {
        const email = body.email || url.searchParams.get('email');
        if (!email) return jsonResponse({ error: 'Email parameter required' }, 400);
        const result = await checkBreaches(email);
        return jsonResponse(result);
      }

      case 'check_pastes': {
        const email = body.email || url.searchParams.get('email');
        if (!email) return jsonResponse({ error: 'Email parameter required' }, 400);
        const result = await checkPastes(email);
        return jsonResponse(result);
      }

      case 'full_exposure_check': {
        const email = body.email || url.searchParams.get('email');
        if (!email) return jsonResponse({ error: 'Email parameter required' }, 400);
        
        // Run both breach and paste checks
        const [breachResult, pasteResult] = await Promise.all([
          checkBreaches(email),
          checkPastes(email),
        ]);

        const breachCount = (breachResult as any).breach_count || 0;
        const criticalCount = (breachResult as any).critical_count || 0;
        const pasteCount = (pasteResult as any).paste_count || 0;

        let overallRisk = 'low';
        if (criticalCount > 0) overallRisk = 'critical';
        else if (breachCount > 5 || pasteCount > 5) overallRisk = 'high';
        else if (breachCount > 0 || pasteCount > 0) overallRisk = 'medium';

        return jsonResponse({
          email,
          overall_risk_level: overallRisk,
          breaches: breachResult,
          pastes: pasteResult,
          summary: `${email}: ${breachCount} breach(es), ${criticalCount} critical, ${pasteCount} paste(s). Risk: ${overallRisk.toUpperCase()}.`,
          checked_at: new Date().toISOString()
        });
      }

      case 'threat_feed': {
        const result = await getThreatFeed();
        return jsonResponse(result);
      }

      default:
        return jsonResponse({
          error: `Unknown action: ${action}`,
          available_actions: ['check_breaches', 'check_pastes', 'full_exposure_check', 'threat_feed']
        }, 400);
    }

  } catch (error) {
    console.error('[api-v1-security] Error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});
