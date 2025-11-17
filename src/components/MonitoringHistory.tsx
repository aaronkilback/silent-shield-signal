import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle, XCircle, Clock, Play, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useEffect } from "react";

interface MonitoringHistoryRecord {
  id: string;
  source_name: string;
  scan_started_at: string;
  scan_completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  items_scanned: number;
  signals_created: number;
  error_message: string | null;
  scan_metadata: any;
  created_at: string;
}

export function MonitoringHistory() {
  const { data: history, isLoading, refetch } = useQuery<MonitoringHistoryRecord[]>({
    queryKey: ['monitoring-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('monitoring_history')
        .select('*')
        .order('scan_started_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data as MonitoringHistoryRecord[];
    },
    refetchInterval: 10000, // Refresh every 10 seconds for real-time updates
  });

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel('monitoring-history-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'monitoring_history'
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  const handleManualRun = async () => {
    try {
      toast.info("Starting Canadian sources scan...");
      const { error } = await supabase.functions.invoke('monitor-canadian-sources-enhanced');
      
      if (error) throw error;
      
      toast.success("Scan initiated successfully");
      setTimeout(() => refetch(), 2000);
    } catch (error) {
      console.error('Manual scan error:', error);
      toast.error("Failed to start scan");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'running':
        return <Clock className="h-4 w-4 text-warning animate-pulse" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-success">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'running':
        return <Badge variant="secondary">Running</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Monitoring Scan History
            </CardTitle>
            <CardDescription>
              Real-time tracking of all OSINT source scans • Auto-scheduled hourly
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleManualRun}
            >
              <Play className="h-4 w-4 mr-2" />
              Run Now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading scan history...
            </div>
          ) : !history || history.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">No scans recorded yet</p>
              <Button onClick={handleManualRun}>
                <Play className="h-4 w-4 mr-2" />
                Run First Scan
              </Button>
            </div>
          ) : (
            history.map((scan) => (
              <div
                key={scan.id}
                className="flex items-start justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start gap-3 flex-1">
                  {getStatusIcon(scan.status)}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium">{scan.source_name}</h4>
                      {getStatusBadge(scan.status)}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>
                        Started {formatDistanceToNow(new Date(scan.scan_started_at), { addSuffix: true })}
                      </p>
                      {scan.status === 'completed' && (
                        <>
                          <p>
                            Scanned {scan.items_scanned} source{scan.items_scanned !== 1 ? 's' : ''}
                            {scan.signals_created > 0 && (
                              <span className="text-success ml-2">
                                • Created {scan.signals_created} signal{scan.signals_created !== 1 ? 's' : ''}
                              </span>
                            )}
                          </p>
                          {scan.scan_metadata && (
                            <p className="text-xs">
                              Sources: {(scan.scan_metadata as any).sources?.join(', ')}
                            </p>
                          )}
                        </>
                      )}
                      {scan.status === 'failed' && scan.error_message && (
                        <p className="text-destructive text-xs">
                          Error: {scan.error_message}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
