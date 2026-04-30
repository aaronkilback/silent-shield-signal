/**
 * arcgis-test-connection
 *
 * Validates a client_arcgis_connections row's credentials and discovers the
 * feature services / layers available to it. Two modes:
 *
 *   action='test': uses the credentials to request a token and ping the
 *     /sharing/rest/portals/self endpoint. Updates last_tested_at /
 *     last_test_ok / last_test_error on the row.
 *
 *   action='discover': lists user's content (Feature Services) so the
 *     admin UI can populate the layer-alias picker. Returns up to ~50
 *     items with their URL, type, and layer count.
 *
 * The admin UI (page /clients/:id/arcgis) calls this twice during
 * onboarding: first 'test' to confirm creds work, then 'discover' to let
 * the user pick which layers to expose to agents under friendly aliases.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface TestInput {
  connection_id: string;
  action: 'test' | 'discover';
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  try {
    const body = await req.json().catch(() => ({})) as TestInput;
    if (!body?.connection_id || !body?.action) return errorResponse('connection_id and action required', 400);

    const { data: conn, error: loadError } = await supabase
      .from('client_arcgis_connections')
      .select('id, portal_url, oauth_client_id, oauth_client_secret_ref, api_key_secret_ref')
      .eq('id', body.connection_id)
      .maybeSingle();
    if (loadError || !conn) return errorResponse('Connection not found', 404);

    const portalBase = conn.portal_url.replace(/\/$/, '');
    let token: string | null = null;
    let testError: string | null = null;

    // Acquire a token (OAuth preferred, API-key fallback)
    if (conn.oauth_client_id && conn.oauth_client_secret_ref) {
      const secret = Deno.env.get(conn.oauth_client_secret_ref) || '';
      if (!secret) {
        testError = `Secret '${conn.oauth_client_secret_ref}' not in environment. Add via Supabase function secrets.`;
      } else {
        try {
          const resp = await fetch(`${portalBase}/sharing/rest/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: conn.oauth_client_id,
              client_secret: secret,
              grant_type: 'client_credentials',
              expiration: '1440',
              f: 'json',
            }).toString(),
            signal: AbortSignal.timeout(10_000),
          });
          if (!resp.ok) {
            testError = `OAuth ${resp.status}: ${(await resp.text()).substring(0, 200)}`;
          } else {
            const data = await resp.json();
            if (!data.access_token) {
              testError = `OAuth response missing access_token: ${JSON.stringify(data).substring(0, 200)}`;
            } else {
              token = data.access_token;
              await supabase
                .from('client_arcgis_connections')
                .update({
                  access_token: data.access_token,
                  token_expires_at: new Date(Date.now() + (data.expires_in || 86400) * 1000).toISOString(),
                })
                .eq('id', conn.id);
            }
          }
        } catch (e: any) {
          testError = `OAuth call failed: ${e?.message || e}`;
        }
      }
    } else if (conn.api_key_secret_ref) {
      const key = Deno.env.get(conn.api_key_secret_ref) || '';
      if (!key) testError = `API key secret '${conn.api_key_secret_ref}' not in environment.`;
      else token = key;
    } else {
      testError = 'No credentials configured (need oauth_client_id + oauth_client_secret_ref OR api_key_secret_ref).';
    }

    if (!token) {
      await supabase
        .from('client_arcgis_connections')
        .update({
          last_tested_at: new Date().toISOString(),
          last_test_ok: false,
          last_test_error: testError,
        })
        .eq('id', conn.id);
      return errorResponse(testError || 'No token acquired', 400);
    }

    // Ping portal/self to confirm token works
    try {
      const u = new URL(`${portalBase}/sharing/rest/portals/self`);
      u.searchParams.set('f', 'json');
      u.searchParams.set('token', token);
      const resp = await fetch(u.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) {
        const err = `portals/self ${resp.status}: ${(await resp.text()).substring(0, 200)}`;
        await supabase.from('client_arcgis_connections').update({
          last_tested_at: new Date().toISOString(),
          last_test_ok: false,
          last_test_error: err,
        }).eq('id', conn.id);
        return errorResponse(err, 400);
      }
      const portalInfo = await resp.json();
      if (portalInfo.error) {
        await supabase.from('client_arcgis_connections').update({
          last_tested_at: new Date().toISOString(),
          last_test_ok: false,
          last_test_error: `Portal error: ${portalInfo.error.message}`,
        }).eq('id', conn.id);
        return errorResponse(portalInfo.error.message, 400);
      }

      if (body.action === 'test') {
        await supabase.from('client_arcgis_connections').update({
          last_tested_at: new Date().toISOString(),
          last_test_ok: true,
          last_test_error: null,
        }).eq('id', conn.id);
        return successResponse({
          ok: true,
          portal: { name: portalInfo.name, urlKey: portalInfo.urlKey, organisation: portalInfo.id },
          message: 'Credentials verified. Run discover to list available layers.',
        });
      }

      // action === 'discover': use search endpoint to list Feature Services
      // accessible to this app token.
      const searchUrl = new URL(`${portalBase}/sharing/rest/search`);
      searchUrl.searchParams.set('q', '(type:"Feature Service")');
      searchUrl.searchParams.set('num', '50');
      searchUrl.searchParams.set('f', 'json');
      searchUrl.searchParams.set('token', token);
      const searchResp = await fetch(searchUrl.toString(), { signal: AbortSignal.timeout(15_000) });
      if (!searchResp.ok) {
        return errorResponse(`Discover failed ${searchResp.status}`, 400);
      }
      const searchData = await searchResp.json();
      const items = (searchData.results || []).map((it: any) => ({
        id: it.id,
        title: it.title,
        type: it.type,
        url: it.url,
        owner: it.owner,
        access: it.access,
        modified: it.modified,
      }));

      // Discovery does NOT auto-populate layer_aliases — admin must pick
      // which to expose. We DO save the discovered list for the UI.
      await supabase.from('client_arcgis_connections').update({
        discovered_layers: { items, discovered_at: new Date().toISOString() },
        last_tested_at: new Date().toISOString(),
        last_test_ok: true,
        last_test_error: null,
      }).eq('id', conn.id);

      return successResponse({
        ok: true,
        feature_service_count: items.length,
        items,
      });
    } catch (e: any) {
      const err = `Probe error: ${e?.message || e}`;
      await supabase.from('client_arcgis_connections').update({
        last_tested_at: new Date().toISOString(),
        last_test_ok: false,
        last_test_error: err,
      }).eq('id', conn.id);
      return errorResponse(err, 500);
    }
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
