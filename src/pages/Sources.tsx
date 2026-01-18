import { PageLayout } from "@/components/PageLayout";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Plus, Search, Globe, Zap, Loader2, ExternalLink, Trash2, Database, Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AddSourceDialog } from "@/components/AddSourceDialog";
import { EditSourceDialog } from "@/components/EditSourceDialog";
import { SourcesList } from "@/components/SourcesList";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportError } from "@/lib/errorReporting";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonitoringDiagnostics } from "@/components/MonitoringDiagnostics";

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
];

const quickAddSources = [
  { name: "The Narwhal", url: "https://thenarwhal.ca/feed/" },
  { name: "CBC News", url: "https://www.cbc.ca/cmlink/rss-topstories" },
  { name: "Global News", url: "https://globalnews.ca/feed/" },
  { name: "Vancouver Sun", url: "https://vancouversun.com/feed" },
  { name: "The Globe and Mail", url: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/" }
];

const Sources = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const initialTab = searchParams.get('tab') || 'sources';
  const [activeTab, setActiveTab] = useState(initialTab);
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRunningApac, setIsRunningApac] = useState(false);
  
  // Custom source form
  const [newSource, setNewSource] = useState({
    name: "",
    type: "url_feed",
    url: ""
  });

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'sources') {
      searchParams.delete('tab');
    } else {
      searchParams.set('tab', value);
    }
    setSearchParams(searchParams);
  };

  const { data: sources, isLoading, refetch } = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("sources")
        .update({ status: isActive ? 'paused' : 'active' })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source updated successfully");
    },
    onError: (error) => {
      console.error("Error updating source:", error);
      toast.error("Failed to update source");
      reportError({
        title: "Source Update Failed",
        description: "Failed to toggle source active status",
        severity: "medium",
        error: error instanceof Error ? error : new Error(String(error)),
        context: "Source Management"
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("sources")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source deleted successfully");
    },
    onError: (error) => {
      console.error("Error deleting source:", error);
      toast.error("Failed to delete source");
      reportError({
        title: "Source Deletion Failed",
        description: "Failed to delete OSINT source",
        severity: "medium",
        error: error instanceof Error ? error : new Error(String(error)),
        context: "Source Management"
      });
    },
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

  const addQuickSource = async (name: string, url: string) => {
    const { error } = await supabase
      .from('sources')
      .insert({
        name,
        type: 'url_feed',
        status: 'active',
        config: { url, feed_url: url }
      });

    if (error) {
      toast.error(`Failed to add ${name}`);
      return;
    }

    toast.success(`Added ${name}`);
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

  if (!user && !loading) {
    return null;
  }

  const filteredSources = sources?.filter((source) => {
    const searchLower = searchQuery.toLowerCase();
    return (
      source.name?.toLowerCase().includes(searchLower) ||
      source.type?.toLowerCase().includes(searchLower) ||
      source.status?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <PageLayout
      loading={loading || isLoading}
      title="OSINT Sources"
      description="Configure global monitoring sources, regional feeds, and diagnostics"
      headerContent={
        <div className="flex gap-2">
          <Button onClick={runApacMonitor} disabled={isRunningApac} variant="outline">
            {isRunningApac ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Globe className="w-4 h-4 mr-2" />
            )}
            Run APAC
          </Button>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Source
          </Button>
        </div>
      }
    >
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="sources">
            <Database className="w-4 h-4 mr-2" />
            Sources
          </TabsTrigger>
          <TabsTrigger value="regional">
            <Globe className="w-4 h-4 mr-2" />
            Regional APAC
          </TabsTrigger>
          <TabsTrigger value="quick-add">
            <Plus className="w-4 h-4 mr-2" />
            Quick Add
          </TabsTrigger>
          <TabsTrigger value="diagnostics">
            <Activity className="w-4 h-4 mr-2" />
            Diagnostics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search sources by name, type, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Configured Sources ({filteredSources?.length || 0})</CardTitle>
              <CardDescription>
                Configure and manage OSINT sources for intelligence gathering
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ErrorBoundary context="Sources List">
                {filteredSources && filteredSources.length > 0 ? (
                  <SourcesList
                    sources={filteredSources}
                    onToggleActive={(id, isActive) =>
                      toggleActiveMutation.mutate({ id, isActive })
                    }
                    onDelete={(id) => deleteMutation.mutate(id)}
                    onEdit={(source) => {
                      setEditingSource(source);
                      setIsEditDialogOpen(true);
                    }}
                  />
                ) : searchQuery ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No sources match your search.
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No sources configured yet. Add your first source to get started.
                  </div>
                )}
              </ErrorBoundary>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="regional" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Asia-Pacific Regional Sources
              </CardTitle>
              <CardDescription>
                Pre-configured sources for Malaysian, Southeast Asian, and energy sector intelligence.
                These sources are monitored via Google News aggregation.
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

        <TabsContent value="quick-add" className="space-y-4">
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

        <TabsContent value="diagnostics">
          <MonitoringDiagnostics />
        </TabsContent>
      </Tabs>

      <AddSourceDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
      />

      <EditSourceDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        source={editingSource}
      />
    </PageLayout>
  );
};

export default Sources;