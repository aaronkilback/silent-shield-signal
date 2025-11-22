import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";

export default function MonitoringSources() {
  const [newSource, setNewSource] = useState({
    name: "",
    type: "url_feed",
    url: ""
  });

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

  const quickAddSources = [
    { name: "The Narwhal", url: "https://thenarwhal.ca/feed/" },
    { name: "CBC News", url: "https://www.cbc.ca/cmlink/rss-topstories" },
    { name: "Global News", url: "https://globalnews.ca/feed/" },
    { name: "Vancouver Sun", url: "https://vancouversun.com/feed" },
    { name: "The Globe and Mail", url: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/" }
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
        <div>
          <h1 className="text-3xl font-bold">Monitoring Sources</h1>
          <p className="text-muted-foreground">
            Configure RSS feeds and data sources that monitors will scan for intelligence
          </p>
        </div>

        {/* Quick Add Popular Sources */}
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

        {/* Add Custom Source */}
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
                  placeholder="e.g., The Narwhal"
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

        {/* Configured Sources */}
        <Card>
          <CardHeader>
            <CardTitle>Configured Sources ({sources?.length || 0})</CardTitle>
            <CardDescription>
              These sources will be scanned by the monitor-rss-sources function
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
                No sources configured yet. Add sources above to start monitoring.
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
            <p>1. <strong>Add RSS feeds</strong> for media sources you want to monitor (The Narwhal, CBC, etc.)</p>
            <p>2. <strong>Monitors run automatically</strong> and scan these sources for new content</p>
            <p>3. <strong>AI analyzes</strong> each article with gemini-2.5-pro to extract entities and signals</p>
            <p>4. <strong>Results appear</strong> in your Signals feed and Knowledge Base</p>
            <p className="pt-2 text-muted-foreground">
              Tip: To manually trigger a scan, go to Sources page and click "Run All Monitors"
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
