import { useState } from "react";
import { Header } from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2, Search, Filter, CheckCircle, XCircle, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { ErrorBoundary } from "@/components/ErrorBoundary";

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

const UnmatchedSignals = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("7d");
  const [selectedSignal, setSelectedSignal] = useState<UnmatchedSignal | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Fetch unmatched signals
  const { data: unmatchedSignals, isLoading: signalsLoading } = useQuery({
    queryKey: ["unmatched-signals", searchTerm, sourceFilter, dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signal_correlation_groups")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;

      if (error) throw error;

      // Cast to any for new columns not in types yet
      const allSignals = (data || []) as any[];
      
      // Filter for unmatched signals (match_confidence = 'none' or null)
      let filtered = allSignals.filter(s => 
        s.match_confidence === 'none' || s.match_confidence === null
      );

      // Date range filter
      const now = new Date();
      if (dateRange === "24h") {
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        filtered = filtered.filter(s => new Date(s.created_at) >= cutoff);
      } else if (dateRange === "7d") {
        const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(s => new Date(s.created_at) >= cutoff);
      } else if (dateRange === "30d") {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(s => new Date(s.created_at) >= cutoff);
      }

      // Filter by search term
      if (searchTerm) {
        const lowerSearch = searchTerm.toLowerCase();
        filtered = filtered.filter(s => 
          s.normalized_text?.toLowerCase().includes(lowerSearch) ||
          s.category?.toLowerCase().includes(lowerSearch) ||
          s.location?.toLowerCase().includes(lowerSearch)
        );
      }

      return filtered as UnmatchedSignal[];
    },
    enabled: !!user,
  });

  // Fetch unique sources for filter
  const { data: sources } = useQuery({
    queryKey: ["signal-sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("id, name")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Dismiss signal mutation
  const dismissMutation = useMutation({
    mutationFn: async (signalId: string) => {
      // Use any type for update with new columns
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Unmatched Signals Review</h1>
          <p className="text-muted-foreground mt-2">
            Review and assign signals that couldn't be automatically matched to a client
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
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
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {sources?.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

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
                Critical/High Severity
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
                Unique Categories
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Set(unmatchedSignals?.map(s => s.category).filter(Boolean)).size || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Signal List */}
        <ErrorBoundary context="Unmatched Signals List">
          <Card>
            <CardHeader>
              <CardTitle>Signals Awaiting Review</CardTitle>
              <CardDescription>
                Click on a signal to view details, then assign to a client or dismiss
              </CardDescription>
            </CardHeader>
            <CardContent>
              {signalsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : unmatchedSignals?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
                  <p>All signals have been reviewed!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {unmatchedSignals?.map((signal) => (
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
                              <span className="ml-2">• {signal.signal_count} related signals</span>
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
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </ErrorBoundary>
      </main>

      {/* Assign Client Dialog */}
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

      {/* Signal Detail Sheet */}
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
    </div>
  );
};

export default UnmatchedSignals;
