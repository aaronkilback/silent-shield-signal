import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface SourceHealth {
  id: string;
  name: string;
  type: string;
  status: string;
  lastIngested: string | null;
  errorMessage: string | null;
  hasValidUrl: boolean;
  isInternal: boolean;
}

interface MonitoringHistoryItem {
  id: string;
  source_name: string;
  status: string;
  signals_created: number;
  items_scanned: number;
  scan_started_at: string;
  scan_completed_at: string | null;
  error_message: string | null;
}

export function MonitoringDiagnostics() {
  const queryClient = useQueryClient();
  const [runningMonitor, setRunningMonitor] = useState<string | null>(null);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [liveResults, setLiveResults] = useState<Record<string, { success: boolean; error?: string; status_code?: number }>>({});

  // Fetch source health
  const { data: sources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ["monitoring-sources-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("id, name, type, status, last_ingested_at, error_message, config")
        .eq("status", "active")
        .order("last_ingested_at", { ascending: false, nullsFirst: false });

      if (error) throw error;

      return (data || []).map((s) => {
        const config = s.config as Record<string, unknown> | null;
        const feedUrl = config?.feed_url as string | undefined;
        const url = config?.url as string | undefined;
        const isInternal = s.type === 'api_feed' || config?.is_internal === true;
        
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          status: s.status,
          lastIngested: s.last_ingested_at,
          errorMessage: s.error_message,
          hasValidUrl: isInternal || (!!(url || feedUrl) && feedUrl !== 'https://example.com/feed.xml'),
          isInternal,
        } as SourceHealth;
      });
    },
    refetchInterval: 30000,
  });

  // Fetch recent monitoring history
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ["monitoring-history-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitoring_history")
        .select("*")
        .order("scan_started_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as MonitoringHistoryItem[];
    },
    refetchInterval: 10000,
  });

  // Fetch signal counts
  const { data: signalStats } = useQuery({
    queryKey: ["signal-stats-diagnostic"],
    queryFn: async () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const { count: last24h } = await supabase
        .from("signals")
        .select("*", { count: "exact", head: true })
        .gte("created_at", oneDayAgo.toISOString());

      const { count: last7d } = await supabase
        .from("signals")
        .select("*", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo.toISOString());

      const { count: total } = await supabase
        .from("signals")
        .select("*", { count: "exact", head: true });

      return { last24h: last24h || 0, last7d: last7d || 0, total: total || 0 };
    },
    refetchInterval: 30000,
  });

  // Trigger manual scan mutation
  const triggerScan = useMutation({
    mutationFn: async (functionName: string) => {
      setRunningMonitor(functionName);
      const { data, error } = await supabase.functions.invoke(functionName, {});
      if (error) throw error;
      return data;
    },
    onSuccess: (data, functionName) => {
      toast.success(`${functionName} completed`, {
        description: `Created ${data?.signals_created || 0} signals`,
      });
      queryClient.invalidateQueries({ queryKey: ["monitoring-history-recent"] });
      queryClient.invalidateQueries({ queryKey: ["signal-stats-diagnostic"] });
    },
    onError: (error, functionName) => {
      toast.error(`${functionName} failed`, {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
    onSettled: () => {
      setRunningMonitor(null);
    },
  });

  const healthySources = sources.filter(
    (s) => s.hasValidUrl && !s.errorMessage && s.lastIngested
  );
  const warningSources = sources.filter(
    (s) => !s.hasValidUrl || (!s.lastIngested && !s.errorMessage)
  );
  const errorSources = sources.filter((s) => s.errorMessage);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Monitoring Diagnostics
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={runningDiagnostics}
              onClick={async () => {
                setRunningDiagnostics(true);
                setLiveResults({});
                toast.info("Running connectivity tests on external sources...");
                
                const results: Record<string, { success: boolean; error?: string; status_code?: number }> = {};
                
                // Only test external sources (skip api_feed/internal)
                const externalSources = sources.filter(s => !s.isInternal);
                
                for (const source of externalSources) {
                  try {
                    const { data, error } = await supabase.functions.invoke("test-osint-source-connectivity", {
                      body: { source_id: source.id },
                    });
                    
                    if (error) {
                      results[source.id] = { success: false, error: error.message };
                    } else {
                      results[source.id] = {
                        success: data?.success ?? false,
                        error: data?.error,
                        status_code: data?.status_code,
                      };
                    }
                  } catch (err) {
                    results[source.id] = { success: false, error: err instanceof Error ? err.message : "Unknown error" };
                  }
                  setLiveResults({ ...results });
                }
                
                // Mark internal sources as OK
                for (const source of sources.filter(s => s.isInternal)) {
                  results[source.id] = { success: true, status_code: 200 };
                }
                setLiveResults({ ...results });
                
                setRunningDiagnostics(false);
                
                const successCount = Object.values(results).filter(r => r.success).length;
                const failCount = Object.values(results).filter(r => !r.success).length;
                toast.success(`Connectivity check complete: ${successCount} OK, ${failCount} issues`);
                
                await Promise.all([
                  queryClient.refetchQueries({ queryKey: ["monitoring-sources-health"] }),
                  queryClient.refetchQueries({ queryKey: ["monitoring-history-recent"] }),
                ]);
              }}
            >
              {runningDiagnostics ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Activity className="w-4 h-4 mr-1" />
              )}
              {runningDiagnostics ? "Testing..." : "Run Diagnostics"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await Promise.all([
                  queryClient.refetchQueries({ queryKey: ["monitoring-sources-health"] }),
                  queryClient.refetchQueries({ queryKey: ["monitoring-history-recent"] }),
                  queryClient.refetchQueries({ queryKey: ["signal-stats-diagnostic"] }),
                ]);
                toast.success("Data refreshed");
              }}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold">{signalStats?.last24h || 0}</div>
            <div className="text-xs text-muted-foreground">Signals (24h)</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold">{signalStats?.last7d || 0}</div>
            <div className="text-xs text-muted-foreground">Signals (7d)</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{healthySources.length}</div>
            <div className="text-xs text-muted-foreground">Healthy Sources</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold text-amber-600">
              {warningSources.length + errorSources.length}
            </div>
            <div className="text-xs text-muted-foreground">Issues</div>
          </div>
        </div>

        <Tabs defaultValue="sources">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="history">Scan History</TabsTrigger>
            <TabsTrigger value="actions">Manual Scans</TabsTrigger>
          </TabsList>

          <TabsContent value="sources" className="mt-3">
            <ScrollArea className="h-[300px]">
              {sourcesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {sources.map((source) => {
                    const liveResult = liveResults[source.id];
                    return (
                      <div
                        key={source.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {runningDiagnostics && !liveResult ? (
                            <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
                          ) : liveResult ? (
                            liveResult.success ? (
                              <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-destructive shrink-0" />
                            )
                          ) : source.errorMessage ? (
                            <XCircle className="w-4 h-4 text-destructive shrink-0" />
                          ) : !source.hasValidUrl ? (
                            <WifiOff className="w-4 h-4 text-amber-500 shrink-0" />
                          ) : source.lastIngested ? (
                            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                          ) : (
                            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="truncate font-medium">{source.name}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {source.type}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0 ml-2">
                          {liveResult ? (
                            liveResult.success ? (
                              <span className="text-green-500">
                                OK {liveResult.status_code ? `(${liveResult.status_code})` : ""}
                              </span>
                            ) : (
                              <span className="text-destructive truncate max-w-[150px] block">
                                {liveResult.error?.substring(0, 30) || "Failed"}
                              </span>
                            )
                          ) : source.errorMessage ? (
                            <span className="text-destructive truncate max-w-[150px] block">
                              {source.errorMessage.substring(0, 30)}...
                            </span>
                          ) : !source.hasValidUrl ? (
                            <span className="text-amber-500">Invalid URL</span>
                          ) : source.lastIngested ? (
                            formatDistanceToNow(new Date(source.lastIngested), { addSuffix: true })
                          ) : (
                            "Never"
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            <ScrollArea className="h-[300px]">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {history.slice(0, 30).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {item.status === "completed" ? (
                          <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                        ) : item.status === "running" ? (
                          <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive shrink-0" />
                        )}
                        <span className="truncate">{item.source_name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge
                          variant={item.signals_created > 0 ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {item.signals_created} signals
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(item.scan_started_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="actions" className="mt-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { name: "monitor-news-google", label: "Google News API" },
                { name: "monitor-news", label: "News (RSS)" },
                { name: "monitor-rss-sources", label: "RSS Sources" },
                { name: "monitor-social", label: "Social Media" },
                { name: "monitor-linkedin", label: "LinkedIn" },
                { name: "monitor-domains", label: "Domain Monitor" },
              ].map((monitor) => (
                <Button
                  key={monitor.name}
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  disabled={runningMonitor !== null}
                  onClick={() => triggerScan.mutate(monitor.name)}
                >
                  {runningMonitor === monitor.name ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  {monitor.label}
                </Button>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* Warnings */}
        {(warningSources.length > 0 || errorSources.length > 0) && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-amber-600 font-medium text-sm mb-2">
              <AlertTriangle className="w-4 h-4" />
              Configuration Issues Detected
            </div>
            <ul className="text-xs text-muted-foreground space-y-1">
              {warningSources.slice(0, 3).map((s) => (
                <li key={s.id}>• {s.name}: Invalid or placeholder URL</li>
              ))}
              {errorSources.slice(0, 3).map((s) => (
                <li key={s.id}>• {s.name}: {s.errorMessage?.substring(0, 50)}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
