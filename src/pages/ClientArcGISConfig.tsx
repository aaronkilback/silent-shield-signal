/**
 * ClientArcGISConfig — admin page at /clients/:id/arcgis
 *
 * Three-step setup:
 *   1) Enter portal URL + OAuth credentials (or API key) for the client's
 *      ArcGIS account. Credentials reference Supabase function secrets, not
 *      raw values in the DB.
 *   2) Click "Test connection" — calls arcgis-test-connection (action=test)
 *      and reports OAuth + portal/self success.
 *   3) Click "Discover layers" — calls arcgis-test-connection (action=discover)
 *      to list Feature Services the app can read. Admin then assigns each
 *      layer a friendly alias (pipeline_centerline, compressor_stations,
 *      operational_easement etc) which agents will reference.
 *
 * Once layer aliases are saved, the agent tools (arcgis_check_signal_proximity,
 * arcgis_query_layer, arcgis_list_layers) start returning real data the
 * next time they fire on a signal for this client.
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { CheckCircle, XCircle, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";

interface Connection {
  id: string;
  client_id: string;
  label: string;
  portal_url: string | null;
  oauth_client_id: string | null;
  oauth_client_secret_ref: string | null;
  api_key_secret_ref: string | null;
  experience_url: string | null;
  experience_label: string | null;
  layer_aliases: Record<string, { url: string; description?: string; geometry_type?: string }>;
  discovered_layers: any;
  is_active: boolean;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
}

interface DiscoveredItem {
  id: string;
  title: string;
  url: string;
  type: string;
  owner: string;
}

export default function ClientArcGISConfig() {
  const { id: clientId } = useParams<{ id: string }>();
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  // Form state for creating new connection
  const [portalUrl, setPortalUrl] = useState("https://www.arcgis.com");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthSecretRef, setOauthSecretRef] = useState("");
  const [apiKeyRef, setApiKeyRef] = useState("");
  const [experienceUrl, setExperienceUrl] = useState("");
  const [experienceLabel, setExperienceLabel] = useState("");

  // Form state for adding layer aliases
  const [newAliasName, setNewAliasName] = useState("");
  const [newAliasUrl, setNewAliasUrl] = useState("");
  const [newAliasDesc, setNewAliasDesc] = useState("");

  const loadConnection = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('client_arcgis_connections')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setConn(data as Connection);
      setPortalUrl(data.portal_url || 'https://www.arcgis.com');
      setOauthClientId(data.oauth_client_id || '');
      setOauthSecretRef(data.oauth_client_secret_ref || '');
      setApiKeyRef(data.api_key_secret_ref || '');
      setExperienceUrl((data as any).experience_url || '');
      setExperienceLabel((data as any).experience_label || '');
    } else {
      setConn(null);
    }
    setLoading(false);
  };

  useEffect(() => { if (clientId) loadConnection(); }, [clientId]);

  const handleSaveBasic = async () => {
    if (!clientId) return;
    if (!portalUrl) {
      toast.error("Portal URL required");
      return;
    }
    if (!oauthClientId && !apiKeyRef) {
      toast.error("Provide either OAuth credentials or an API key secret name");
      return;
    }
    const payload = {
      client_id: clientId,
      portal_url: portalUrl.replace(/\/$/, ''),
      oauth_client_id: oauthClientId || null,
      oauth_client_secret_ref: oauthSecretRef || null,
      api_key_secret_ref: apiKeyRef || null,
      is_active: true,
      label: 'Primary ArcGIS',
      updated_at: new Date().toISOString(),
    };
    if (conn) {
      const { error } = await supabase.from('client_arcgis_connections').update(payload).eq('id', conn.id);
      if (error) return toast.error(`Save failed: ${error.message}`);
    } else {
      const { error } = await supabase.from('client_arcgis_connections').insert(payload);
      if (error) return toast.error(`Save failed: ${error.message}`);
    }
    toast.success("Saved. Run Test connection next.");
    await loadConnection();
  };

  // Save just the public Experience URL — used for Path 3 (link-only mode)
  // when no API credentials are available. Creates a row with portal_url=null
  // if none exists; otherwise just updates the experience fields.
  const handleSaveExperienceLink = async () => {
    if (!clientId) return;
    if (!experienceUrl) {
      toast.error("Experience URL required");
      return;
    }
    const trimmedUrl = experienceUrl.trim();
    const trimmedLabel = experienceLabel.trim() || null;
    if (conn) {
      const { error } = await supabase
        .from('client_arcgis_connections')
        .update({ experience_url: trimmedUrl, experience_label: trimmedLabel, updated_at: new Date().toISOString() })
        .eq('id', conn.id);
      if (error) return toast.error(`Save failed: ${error.message}`);
    } else {
      const { error } = await supabase.from('client_arcgis_connections').insert({
        client_id: clientId,
        label: 'Primary ArcGIS',
        experience_url: trimmedUrl,
        experience_label: trimmedLabel,
        is_active: true,
      });
      if (error) return toast.error(`Save failed: ${error.message}`);
    }
    toast.success("Operational map link saved. Visible on every signal for this client.");
    await loadConnection();
  };

  const handleTest = async () => {
    if (!conn) return;
    setTesting(true);
    const { data, error } = await supabase.functions.invoke('arcgis-test-connection', {
      body: { connection_id: conn.id, action: 'test' },
    });
    setTesting(false);
    if (error) return toast.error(`Test failed: ${error.message}`);
    const r = data as any;
    if (r?.ok) {
      toast.success(`Connected to ${r.portal?.name || 'portal'}`);
    } else {
      toast.error(r?.error || 'Test failed');
    }
    await loadConnection();
  };

  const handleDiscover = async () => {
    if (!conn) return;
    setDiscovering(true);
    const { data, error } = await supabase.functions.invoke('arcgis-test-connection', {
      body: { connection_id: conn.id, action: 'discover' },
    });
    setDiscovering(false);
    if (error) return toast.error(`Discovery failed: ${error.message}`);
    const r = data as any;
    if (r?.ok) {
      toast.success(`Discovered ${r.feature_service_count} feature service(s)`);
      await loadConnection();
    }
  };

  const handleAddAlias = async () => {
    if (!conn || !newAliasName || !newAliasUrl) return;
    const updated = { ...(conn.layer_aliases || {}), [newAliasName]: { url: newAliasUrl, description: newAliasDesc || undefined } };
    const { error } = await supabase.from('client_arcgis_connections').update({ layer_aliases: updated, updated_at: new Date().toISOString() }).eq('id', conn.id);
    if (error) return toast.error(`Save alias failed: ${error.message}`);
    setNewAliasName(""); setNewAliasUrl(""); setNewAliasDesc("");
    toast.success(`Layer "${newAliasName}" added`);
    await loadConnection();
  };

  const handleDeleteAlias = async (alias: string) => {
    if (!conn) return;
    const updated = { ...(conn.layer_aliases || {}) };
    delete updated[alias];
    const { error } = await supabase.from('client_arcgis_connections').update({ layer_aliases: updated, updated_at: new Date().toISOString() }).eq('id', conn.id);
    if (error) return toast.error(`Delete failed: ${error.message}`);
    toast.success(`Layer "${alias}" removed`);
    await loadConnection();
  };

  if (loading) {
    return <div className="container max-w-3xl py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const discoveredItems: DiscoveredItem[] = conn?.discovered_layers?.items ?? [];
  const aliasEntries = Object.entries(conn?.layer_aliases || {});

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ArcGIS connection</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect this client's ArcGIS portal so Fortress agents can reference their pipeline routes,
          facilities, and operational layers as evidence when assessing signals.
        </p>
      </div>

      {/* Step 0: link-only (Experience URL). Path 3 — no API credentials
          needed. The link surfaces on every signal scoped to this client. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operational map link (no API access required)</CardTitle>
          <CardDescription>
            If the client has a published ArcGIS Experience but no API access, paste the URL here.
            It'll appear as a "View on operational map" link on every signal for this client. Analysts
            click through and view the map in their own browser session. Agents can't query the data
            without API access — for that, configure credentials in step 1 below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="experience_url">Experience URL</Label>
            <Input
              id="experience_url"
              value={experienceUrl}
              onChange={(e) => setExperienceUrl(e.target.value)}
              placeholder="https://experience.arcgis.com/experience/..."
            />
          </div>
          <div>
            <Label htmlFor="experience_label">Display label (optional)</Label>
            <Input
              id="experience_label"
              value={experienceLabel}
              onChange={(e) => setExperienceLabel(e.target.value)}
              placeholder="Petronas operational map"
            />
            <p className="text-xs text-muted-foreground mt-1">Defaults to "View operational map" if blank.</p>
          </div>
          <Button onClick={handleSaveExperienceLink} disabled={!experienceUrl}>Save operational map link</Button>
          {conn?.experience_url && (
            <p className="text-xs text-green-400">
              <CheckCircle className="w-3 h-3 inline mr-1" />
              Currently linking to: <a href={conn.experience_url} target="_blank" rel="noreferrer" className="underline">{conn.experience_url.substring(0, 80)}{conn.experience_url.length > 80 ? '…' : ''}</a>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Step 1: credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Credentials</CardTitle>
          <CardDescription>
            OAuth is recommended (revocable, expires every 24h, scoped). API keys work as a fallback.
            Both reference Supabase function secrets — paste the secret <em>name</em> here, then add the
            actual value to function secrets in the Supabase dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="portal_url">Portal URL</Label>
            <Input
              id="portal_url"
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              placeholder="https://www.arcgis.com or https://gis.petronas.com/portal"
            />
            <p className="text-xs text-muted-foreground mt-1">ArcGIS Online or your client's ArcGIS Enterprise portal.</p>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="oauth_client_id">OAuth client_id</Label>
              <Input id="oauth_client_id" value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} placeholder="abc123..." />
            </div>
            <div>
              <Label htmlFor="oauth_secret_ref">OAuth secret reference</Label>
              <Input id="oauth_secret_ref" value={oauthSecretRef} onChange={(e) => setOauthSecretRef(e.target.value)} placeholder="ARCGIS_PETRONAS_SECRET" />
            </div>
          </div>
          <div>
            <Label htmlFor="api_key_ref">API key reference (fallback only)</Label>
            <Input id="api_key_ref" value={apiKeyRef} onChange={(e) => setApiKeyRef(e.target.value)} placeholder="ARCGIS_PETRONAS_API_KEY" />
          </div>
          <Button onClick={handleSaveBasic}>Save credentials</Button>
        </CardContent>
      </Card>

      {/* Step 2: test */}
      {conn && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-base">2. Test connection</CardTitle>
              <CardDescription>Acquires a token and pings portals/self.</CardDescription>
            </div>
            {conn.last_tested_at && (
              conn.last_test_ok
                ? <Badge variant="default" className="gap-1"><CheckCircle className="w-3 h-3" /> OK</Badge>
                : <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> Failed</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            <Button onClick={handleTest} disabled={testing} variant="outline">
              {testing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Test connection
            </Button>
            {conn.last_test_error && (
              <p className="text-xs text-red-400">{conn.last_test_error}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: discover */}
      {conn?.last_test_ok && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Discover available layers</CardTitle>
            <CardDescription>Lists Feature Services this app token can access.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={handleDiscover} disabled={discovering} variant="outline">
              {discovering ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Discover layers
            </Button>
            {discoveredItems.length > 0 && (
              <div className="space-y-1 max-h-64 overflow-y-auto border rounded p-2">
                {discoveredItems.map((it) => (
                  <div key={it.id} className="flex items-start justify-between text-xs gap-2 py-1">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{it.title}</div>
                      <a href={it.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> {it.url.substring(0, 80)}…
                      </a>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setNewAliasUrl(it.url); setNewAliasDesc(it.title); }}
                    >Use</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: layer aliases */}
      {conn && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">4. Layer aliases (what agents see)</CardTitle>
            <CardDescription>
              Map each ArcGIS layer URL to a friendly name. Agents reference layers by these names —
              <code className="text-xs"> pipeline_centerline</code>, <code className="text-xs">compressor_stations</code>,
              <code className="text-xs"> operational_easement</code>, etc. Pick names the agents will use intuitively.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {aliasEntries.length > 0 && (
              <div className="space-y-2">
                {aliasEntries.map(([alias, meta]) => (
                  <div key={alias} className="flex items-center justify-between gap-3 p-2 border rounded">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm">{alias}</div>
                      {meta.description && <div className="text-xs text-muted-foreground">{meta.description}</div>}
                      <div className="text-xs text-muted-foreground truncate">{meta.url}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteAlias(alias)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Separator />
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Alias name</Label>
                <Input value={newAliasName} onChange={(e) => setNewAliasName(e.target.value)} placeholder="pipeline_centerline" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Layer URL (FeatureServer/N)</Label>
                <Input value={newAliasUrl} onChange={(e) => setNewAliasUrl(e.target.value)} placeholder="https://services.arcgis.com/.../FeatureServer/0" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Input value={newAliasDesc} onChange={(e) => setNewAliasDesc(e.target.value)} placeholder="Coastal GasLink centerline route" />
            </div>
            <Button onClick={handleAddAlias} disabled={!newAliasName || !newAliasUrl} variant="outline">
              <Plus className="w-3 h-3 mr-1" /> Add alias
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
