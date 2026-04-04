import { PageLayout } from "@/components/PageLayout";
import { SignalHistory } from "@/components/SignalHistory";
import { UnifiedDocumentUpload } from "@/components/UnifiedDocumentUpload";
import { ArchivalDocumentsList } from "@/components/ArchivalDocumentsList";
import { ReprocessDocuments } from "@/components/ReprocessDocuments";
import { DashboardClientSelector } from "@/components/ClientSelector";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { AssignClientDialog } from "@/components/signals/AssignClientDialog";
import { SignalDetailSheet } from "@/components/signals/SignalDetailSheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Search, CheckCircle, XCircle, UserPlus, Loader2, FileSearch, VolumeX, Archive, ExternalLink } from "lucide-react";

interface UnmatchedSignal {
  id: string;
  primary_signal_id: string;
  category: string | null;
  severity: string | null;
  location: string | null;
  normalized_text: string | null;
  created_at: string;
  sources_json: any;
  signal_count: number | null;
  source?: string;
}

const Signals = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Derive tab state purely from URL params
  const activeTab = searchParams.get('tab') || 'signals';

  // Unmatched signals state
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState<string>("7d");
  const [minConfidence, setMinConfidence] = useState<string>("all");
  const [hideOld, setHideOld] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<UnmatchedSignal | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    if (value === 'signals') {
      searchParams.delete('tab');
    } else {
      searchParams.set('tab', value);
    }
    setSearchParams(searchParams);
  };

  // Fetch archived (historical) signals
  const { data: archivedSignals, isLoading: archivedLoading, refetch: refetchArchived } = useQuery({
    queryKey: ["archived-signals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signals')
        .select('id, title, description, category, severity, status, event_date, created_at, source_url, raw_json, client_id, clients(name)')
        .eq('status', 'archived')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (signalId: string) => {
      const { error } = await supabase.from('signals').update({ status: 'new' }).eq('id', signalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["archived-signals"] });
      toast.success("Signal restored to feed");
    },
  });

  // Fetch unmatched signals — server-side filtering
  const { data: unmatchedSignals, isLoading: signalsLoading } = useQuery({
    queryKey: ["unmatched-signals", searchTerm, dateRange],
    queryFn: async () => {
      // Compute date cutoff server-side
      const now = new Date();
      let cutoff: Date | null = null;
      if (dateRange === "24h") {
        cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (dateRange === "7d") {
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (dateRange === "30d") {
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      let query = supabase
        .from("signal_correlation_groups")
        .select("*")
        .or('match_confidence.eq.none,match_confidence.is.null')
        .neq('match_confidence', 'assigned')
        .order("created_at", { ascending: false })
        .limit(100);

      if (cutoff) {
        query = query.gte('created_at', cutoff.toISOString());
      }

      if (searchTerm) {
        query = query.ilike('normalized_text', `%${searchTerm}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const filtered = (data || []) as any[];

      // Additional client-side filtering for category/location (search term text match already done server-side)
      if (searchTerm) {
        const lowerSearch = searchTerm.toLowerCase();
        return filtered.filter(s => 
          s.normalized_text?.toLowerCase().includes(lowerSearch) ||
          s.category?.toLowerCase().includes(lowerSearch) ||
          s.location?.toLowerCase().includes(lowerSearch)
        ) as UnmatchedSignal[];
      }

      return filtered as UnmatchedSignal[];
    },
    enabled: !!user,
  });

  // Dismiss signal mutation
  const dismissMutation = useMutation({
    mutationFn: async (signalId: string) => {
      const updateData: Record<string, any> = {
        match_confidence: "dismissed",
        match_timestamp: new Date().toISOString(),
        assigned_by_user_id: user?.id,
      };
      const { error } = await supabase
        .from("signal_correlation_groups")
        .update(updateData as any)
        .eq("id", signalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unmatched-signals"] });
      toast.success("Signal dismissed successfully");
    },
    onError: (error) => {
      toast.error("Failed to dismiss signal: " + error.message);
    },
  });

  // Mark as noise mutation
  const noiseMutation = useMutation({
    mutationFn: async (signalId: string) => {
      const { error } = await supabase
        .from("signal_correlation_groups")
        .update({
          match_confidence: "noise",
          match_timestamp: new Date().toISOString(),
          assigned_by_user_id: user?.id,
        } as any)
        .eq("id", signalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unmatched-signals"] });
      toast.success("Signal marked as noise");
    },
    onError: (error) => {
      toast.error("Failed to mark signal as noise: " + error.message);
    },
  });

  // Client-side quality filters applied after fetch
  const filteredSignals = (unmatchedSignals || []).filter((s) => {
    if (hideOld) {
      const cutoff72h = Date.now() - 72 * 3600 * 1000;
      if (new Date(s.created_at).getTime() < cutoff72h) return false;
    }
    if (minConfidence !== "all") {
      const threshold = minConfidence === "medium" ? 50 : minConfidence === "high" ? 75 : 90;
      if (((s as any).confidence ?? 0) < threshold) return false;
    }
    return true;
  });

  const getSeverityColor = (severity: string | null) => {
    switch (severity?.toLowerCase()) {
      case "critical":
      case "p1":
        return "bg-destructive text-destructive-foreground";
      case "high":
      case "p2":
        return "bg-orange-500 text-white";
      case "medium":
      case "p3":
        return "bg-yellow-500 text-black";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  if (!user && !loading) {
    return null;
  }

  return (
    <PageLayout 
      loading={loading}
      title="Signals & Intelligence"
      description="Intelligence signals, documents, and unmatched signal review"
    >
      <DashboardClientSelector />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="signals">Signal Feed</TabsTrigger>
          <TabsTrigger value="historical" className="relative">
            <Archive className="w-3.5 h-3.5 mr-1" />
            Historical
            {archivedSignals && archivedSignals.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
                {archivedSignals.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="unmatched" className="relative">
            Unmatched
            {unmatchedSignals && unmatchedSignals.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 px-1.5 text-xs">
                {unmatchedSignals.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="documents">Library</TabsTrigger>
        </TabsList>

        <TabsContent value="signals" className="space-y-6 min-h-[400px]">
          <ErrorBoundary context="Signal History">
            <SignalHistory />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="historical" className="space-y-6 min-h-[400px]">
          <ErrorBoundary context="Historical Signals">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Archive className="w-5 h-5" />
                  Historical Intelligence
                </CardTitle>
                <CardDescription>
                  Background intel — useful context but not an active threat. Restore to feed if a signal becomes relevant again.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {archivedLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : !archivedSignals || archivedSignals.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Archive className="h-12 w-12 mx-auto mb-4 opacity-30" />
                    <p>No historical signals yet.</p>
                    <p className="text-sm mt-1">Mark a signal as "Archived (historical)" from its detail view to store it here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {archivedSignals.map((signal: any) => (
                      <div key={signal.id} className="border rounded-lg p-4 bg-muted/20">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={getSeverityColor(signal.severity)}>{signal.severity || 'unknown'}</Badge>
                              {signal.category && <Badge variant="outline">{signal.category}</Badge>}
                              {(signal as any).clients?.name && (
                                <Badge variant="secondary" className="text-xs">{(signal as any).clients.name}</Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium">{signal.title || signal.description?.slice(0, 120)}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {signal.event_date
                                ? `Event: ${format(new Date(signal.event_date), 'PP')}`
                                : `Ingested: ${format(new Date(signal.created_at), 'PP')}`}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {(signal.source_url || signal.raw_json?.url) && (
                              <Button size="sm" variant="ghost" asChild>
                                <a href={signal.source_url || signal.raw_json?.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => unarchiveMutation.mutate(signal.id)}
                              disabled={unarchiveMutation.isPending}
                            >
                              Restore
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="unmatched" className="space-y-6 min-h-[400px]">
          <ErrorBoundary context="Unmatched Signals">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Pending Review
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{unmatchedSignals?.length || 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Critical/High
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">
                    {unmatchedSignals?.filter(s => 
                      ["critical", "high", "p1", "p2"].includes(s.severity?.toLowerCase() || "")
                    ).length || 0}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Categories
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {new Set(unmatchedSignals?.map(s => s.category).filter(Boolean)).size || 0}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search signals..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <Select value={dateRange} onValueChange={setDateRange}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Date range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">Last 24 hours</SelectItem>
                        <SelectItem value="7d">Last 7 days</SelectItem>
                        <SelectItem value="30d">Last 30 days</SelectItem>
                        <SelectItem value="all">All time</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={minConfidence} onValueChange={setMinConfidence}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Min confidence" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All confidence</SelectItem>
                        <SelectItem value="medium">Medium+ (≥50%)</SelectItem>
                        <SelectItem value="high">High+ (≥75%)</SelectItem>
                        <SelectItem value="critical">Critical (≥90%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="hide-old"
                      checked={hideOld}
                      onCheckedChange={setHideOld}
                    />
                    <Label htmlFor="hide-old" className="text-sm text-muted-foreground cursor-pointer">
                      Hide signals older than 72h
                    </Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Signal List */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSearch className="w-5 h-5" />
                  Signals Awaiting Review
                </CardTitle>
                <CardDescription>
                  Click to view details, then assign to a client or dismiss
                </CardDescription>
              </CardHeader>
              <CardContent>
                {signalsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filteredSignals.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
                    <p>All signals have been reviewed!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredSignals.map((signal) => (
                      <div
                        key={signal.id}
                        className="border rounded-lg p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => {
                          setSelectedSignal(signal);
                          setDetailSheetOpen(true);
                        }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className={getSeverityColor(signal.severity)}>
                                {signal.severity || "Unknown"}
                              </Badge>
                              {signal.category && (
                                <Badge variant="outline">{signal.category}</Badge>
                              )}
                              {signal.location && (
                                <Badge variant="secondary">{signal.location}</Badge>
                              )}
                            </div>
                            <p className="text-sm line-clamp-2">
                              {signal.normalized_text || "No text available"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                              {format(new Date(signal.created_at), "PPp")}
                              {signal.signal_count && signal.signal_count > 1 && (
                                <span className="ml-2">• {signal.signal_count} related</span>
                              )}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedSignal(signal);
                                setAssignDialogOpen(true);
                              }}
                            >
                              <UserPlus className="h-4 w-4 mr-1" />
                              Assign
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                dismissMutation.mutate(signal.id);
                              }}
                              disabled={dismissMutation.isPending}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Dismiss
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                noiseMutation.mutate(signal.id);
                              }}
                              disabled={noiseMutation.isPending}
                              className="text-muted-foreground"
                            >
                              <VolumeX className="h-4 w-4 mr-1" />
                              Noise
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="upload" className="space-y-6 min-h-[400px]">
          <ErrorBoundary context="Document Upload">
            <UnifiedDocumentUpload />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="documents" className="space-y-6 min-h-[400px]">
          <ErrorBoundary context="Document Library">
            <ReprocessDocuments />
            <ArchivalDocumentsList />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <AssignClientDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        signal={selectedSignal}
        onAssigned={() => {
          queryClient.invalidateQueries({ queryKey: ["unmatched-signals"] });
          setAssignDialogOpen(false);
          setSelectedSignal(null);
        }}
      />

      <SignalDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        signal={selectedSignal}
        onAssign={() => {
          setDetailSheetOpen(false);
          setAssignDialogOpen(true);
        }}
        onDismiss={() => {
          if (selectedSignal) {
            dismissMutation.mutate(selectedSignal.id);
            setDetailSheetOpen(false);
          }
        }}
      />
    </PageLayout>
  );
};

export default Signals;