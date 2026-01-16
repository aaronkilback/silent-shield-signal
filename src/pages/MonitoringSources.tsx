import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ExternalLink, Globe, Zap, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonitoringDiagnostics } from "@/components/MonitoringDiagnostics";

export default function MonitoringSources() {
  const [newSource, setNewSource] = useState({
    name: "",
    type: "url_feed",
    url: ""
  });
  const [isRunningApac, setIsRunningApac] = useState(false);

  const { data: sources, isLoading, refetch } = useQuery({
    queryKey: ['monitoring-sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sources')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    }
  });

  const addSource = async () => {
    if (!newSource.name || !newSource.url) {
      toast.error('Please fill in all fields');
      return;
    }

    const { error } = await supabase
      .from('sources')
      .insert({
        name: newSource.name,
        type: newSource.type,
        status: 'active',
        config: {
          url: newSource.url,
          feed_url: newSource.url
        }
      });

    if (error) {
      toast.error('Failed to add source');
      console.error(error);
      return;
    }

    toast.success(`Added ${newSource.name}`);
    setNewSource({ name: "", type: "url_feed", url: "" });
    refetch();
  };

  const deleteSource = async (id: string, name: string) => {
    const { error } = await supabase
      .from('sources')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Failed to delete source');
      return;
    }

    toast.success(`Deleted ${name}`);
    refetch();
  };

  const runApacMonitor = async () => {
    setIsRunningApac(true);
    try {
      const { data, error } = await supabase.functions.invoke('monitor-regional-apac');
      
      if (error) throw error;
      
      toast.success(`APAC scan complete: ${data.signals_created} signals from ${data.sources_scanned} sources`);
    } catch (error) {
      console.error('APAC monitor error:', error);
      toast.error('Failed to run APAC monitor');
    } finally {
      setIsRunningApac(false);
    }
  };

  const quickAddSources = [
    { name: "The Narwhal", url: "https://thenarwhal.ca/feed/" },
    { name: "CBC News", url: "https://www.cbc.ca/cmlink/rss-topstories" },
    { name: "Global News", url: "https://globalnews.ca/feed/" },
    { name: "Vancouver Sun", url: "https://vancouversun.com/feed" },
    { name: "The Globe and Mail", url: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/" }
  ];

  // APAC Regional Sources (pre-configured in edge function)
  const apacSources = [
    { name: "Bernama", region: "Malaysia", priority: "high", categories: ["general", "politics", "business"] },
    { name: "The Edge Malaysia", region: "Malaysia", priority: "high", categories: ["business", "markets", "energy"] },
    { name: "New Straits Times", region: "Malaysia", priority: "medium", categories: ["general", "politics"] },
    { name: "Nikkei Asia", region: "Asia-Pacific", priority: "high", categories: ["business", "politics", "energy"] },
    { name: "South China Morning Post", region: "Asia-Pacific", priority: "high", categories: ["politics", "business"] },
    { name: "Channel News Asia", region: "Southeast Asia", priority: "high", categories: ["general", "asia", "business"] },
    { name: "The Straits Times", region: "Singapore", priority: "medium", categories: ["general", "politics"] },
    { name: "Energy Voice", region: "Global", priority: "high", categories: ["energy", "oil_gas"] },
    { name: "Upstream Online", region: "Global", priority: "high", categories: ["energy", "oil_gas"] },
    { name: "Rigzone", region: "Global", priority: "medium", categories: ["energy", "oil_gas"] },
    { name: "S&P Global Platts", region: "Global", priority: "high", categories: ["energy", "commodities"] },
    { name: "LNG World News", region: "Global", priority: "medium", categories: ["energy", "lng"] },
    { name: "Jakarta Post", region: "Indonesia", priority: "medium", categories: ["general", "politics"] },
    { name: "Bangkok Post", region: "Thailand", priority: "medium", categories: ["general", "politics"] },
    { name: "Vietnam News", region: "Vietnam", priority: "low", categories: ["general", "business"] }
  ];

  const addQuickSource = async (name: string, url: string) => {
    const { error } = await supabase
      .from('sources')
      .insert({
        name,
        type: 'url_feed',
        status: 'active',
        config: {
          url,
          feed_url: url
        }
      });

    if (error) {
      toast.error(`Failed to add ${name}`);
      return;
    }

    toast.success(`Added ${name}`);
    refetch();
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Monitoring Sources</h1>
            <p className="text-muted-foreground">
              Configure RSS feeds and regional sources for intelligence monitoring
            </p>
          </div>
          <Button onClick={runApacMonitor} disabled={isRunningApac}>
            {isRunningApac ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Globe className="w-4 h-4 mr-2" />
            )}
            Run APAC Monitor
          </Button>
        </div>

        <Tabs defaultValue="regional" className="space-y-4">
          <TabsList>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            <TabsTrigger value="regional">
              <Globe className="w-4 h-4 mr-2" />
              Regional APAC
            </TabsTrigger>
            <TabsTrigger value="canadian">Canadian Media</TabsTrigger>
            <TabsTrigger value="custom">Custom Sources</TabsTrigger>
          </TabsList>

          <TabsContent value="diagnostics">
            <MonitoringDiagnostics />
          </TabsContent>

          {/* APAC Regional Sources Tab */}
          <TabsContent value="regional" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  Asia-Pacific Regional Sources
                </CardTitle>
                <CardDescription>
                  Pre-configured sources for Malaysian, Southeast Asian, and energy sector intelligence.
                  These sources are monitored via Google News aggregation for comprehensive coverage.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {apacSources.map((source) => (
                    <div
                      key={source.name}
                      className="flex items-start justify-between p-3 border rounded-lg bg-muted/30"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-sm">{source.name}</h3>
                          <Badge 
                            variant={source.priority === 'high' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {source.priority}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{source.region}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {source.categories.slice(0, 3).map((cat) => (
                            <Badge key={cat} variant="outline" className="text-xs">
                              {cat}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Zap className="w-4 h-4 text-primary" />
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <h4 className="font-medium text-sm mb-2">How Regional Monitoring Works</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Sources are monitored via Google News RSS for reliable access</li>
                    <li>• Content is matched against client monitoring keywords and locations</li>
                    <li>• High-priority security content creates signals even without client match</li>
                    <li>• Energy sector keywords trigger enhanced monitoring for oil & gas clients</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Canadian Sources Tab */}
          <TabsContent value="canadian" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Quick Add Canadian Media</CardTitle>
                <CardDescription>
                  Add popular Canadian news sources with one click
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {quickAddSources.map((source) => (
                    <Button
                      key={source.url}
                      variant="outline"
                      size="sm"
                      onClick={() => addQuickSource(source.name, source.url)}
                      disabled={sources?.some(s => (s.config as any)?.url === source.url)}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {source.name}
                      {sources?.some(s => (s.config as any)?.url === source.url) && (
                        <Badge variant="secondary" className="ml-2">Added</Badge>
                      )}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Custom Sources Tab */}
          <TabsContent value="custom" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Add Custom Source</CardTitle>
                <CardDescription>
                  Add an RSS feed URL to monitor
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Source Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., Industry News"
                      value={newSource.name}
                      onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type">Type</Label>
                    <Select
                      value={newSource.type}
                      onValueChange={(value) => setNewSource({ ...newSource, type: value })}
                    >
                      <SelectTrigger id="type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="url_feed">RSS Feed</SelectItem>
                        <SelectItem value="api_feed">API Feed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="url">RSS Feed URL</Label>
                    <Input
                      id="url"
                      placeholder="https://example.com/feed"
                      value={newSource.url}
                      onChange={(e) => setNewSource({ ...newSource, url: e.target.value })}
                    />
                  </div>
                </div>
                <Button onClick={addSource}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Source
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Configured Sources */}
        <Card>
          <CardHeader>
            <CardTitle>Configured Custom Sources ({sources?.length || 0})</CardTitle>
            <CardDescription>
              These sources will be scanned by the RSS monitor function
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Loading sources...</p>
            ) : sources && sources.length > 0 ? (
              <div className="space-y-2">
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{source.name}</h3>
                        <Badge variant={source.status === 'active' ? 'default' : 'secondary'}>
                          {source.status}
                        </Badge>
                        <Badge variant="outline">{source.type}</Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-sm text-muted-foreground">
                          {(source.config as any)?.url || (source.config as any)?.feed_url || 'No URL configured'}
                        </p>
                        {((source.config as any)?.url || (source.config as any)?.feed_url) && (
                          <a
                            href={(source.config as any)?.url || (source.config as any)?.feed_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteSource(source.id, source.name)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                No custom sources configured yet. Add sources above to start monitoring.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>1. <strong>Regional APAC sources</strong> are pre-configured and scan automatically via Google News</p>
            <p>2. <strong>Custom RSS feeds</strong> can be added for specific publications or industry sources</p>
            <p>3. <strong>AI analyzes</strong> content using gemini-2.5-pro for entity extraction and threat assessment</p>
            <p>4. <strong>Signals appear</strong> in your dashboard when content matches client keywords or security concerns</p>
            <p className="pt-2 text-muted-foreground">
              Tip: Use "Run APAC Monitor" button to manually trigger a regional scan
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
