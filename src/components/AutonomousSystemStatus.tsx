import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, Zap, TrendingUp, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { useClientSelection } from '@/hooks/useClientSelection';
import { OSINTSourcesDialog } from './OSINTSourcesDialog';

export default function AutonomousSystemStatus() {
  const { toast } = useToast();
  const { selectedClientId } = useClientSelection();
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoMode, setAutoMode] = useState(true);
  const [osintDialogOpen, setOsintDialogOpen] = useState(false);
  const [sources, setSources] = useState<any[]>([]);

  useEffect(() => {
    loadMetrics();
    loadSources();
    
    // Refresh metrics every 30 seconds
    const interval = setInterval(() => {
      loadMetrics();
      loadSources();
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedClientId]);

  const loadSources = async () => {
    try {
      const { data, error } = await supabase
        .from('sources')
        .select('id');
      
      if (!error && data) {
        setSources(data);
      }
    } catch (error) {
      console.error('Error loading sources:', error);
    }
  };

  const loadMetrics = async () => {
    try {
      // Calculate client-specific metrics from signals and incidents
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Build query with optional client filter
      let signalsQuery = supabase
        .from('signals')
        .select('id, status, created_at', { count: 'exact' })
        .gte('created_at', thirtyDaysAgo.toISOString());
      
      let incidentsQuery = supabase
        .from('incidents')
        .select('id, status, priority, created_at', { count: 'exact' })
        .gte('created_at', thirtyDaysAgo.toISOString());

      // Get OSINT scan metrics from automation_metrics table
      const metricsQuery = supabase
        .from('automation_metrics')
        .select('osint_scans_completed')
        .gte('metric_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('metric_date', { ascending: false });

      if (selectedClientId) {
        signalsQuery = signalsQuery.eq('client_id', selectedClientId);
        incidentsQuery = incidentsQuery.eq('client_id', selectedClientId);
      }

      const [signalsResult, incidentsResult, metricsResult] = await Promise.all([
        signalsQuery,
        incidentsQuery,
        metricsQuery
      ]);

      if (signalsResult.error) throw signalsResult.error;
      if (incidentsResult.error) throw incidentsResult.error;
      if (metricsResult.error) throw metricsResult.error;

      const signalsProcessed = signalsResult.count || 0;
      const incidentsCreated = incidentsResult.count || 0;
      const autoEscalated = incidentsResult.data?.filter(i => 
        i.priority === 'p1' || i.priority === 'p2'
      ).length || 0;
      
      // Calculate accuracy rate from incident outcomes
      let outcomesQuery = supabase
        .from('incident_outcomes')
        .select('was_accurate, false_positive, incidents!inner(client_id)')
        .gte('created_at', thirtyDaysAgo.toISOString());

      if (selectedClientId) {
        outcomesQuery = outcomesQuery.eq('incidents.client_id', selectedClientId);
      }

      const { data: outcomesData } = await outcomesQuery;
      
      const accurateCount = outcomesData?.filter(o => o.was_accurate === true).length || 0;
      const totalOutcomes = outcomesData?.length || 0;
      const accuracyRate = totalOutcomes > 0 
        ? ((accurateCount / totalOutcomes) * 100).toFixed(1)
        : '0.0';

      // Sum up OSINT scans from all days in the period
      const totalOsintScans = metricsResult.data?.reduce((sum, day) => 
        sum + (day.osint_scans_completed || 0), 0
      ) || 0;

      setMetrics({
        signals_processed: signalsProcessed,
        incidents_created: incidentsCreated,
        incidents_auto_escalated: autoEscalated,
        accuracy_rate: parseFloat(accuracyRate),
        osint_scans_completed: totalOsintScans
      });
    } catch (error) {
      console.error('Error loading metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const triggerManualScan = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('auto-orchestrator');
      
      if (error) {
        console.error('Auto-orchestrator error:', error);
        
        // Check if it's a credits error
        if (error.message?.includes('credits') || error.message?.includes('402')) {
          toast({
            title: "AI Credits Exhausted",
            description: "Please add credits in Settings → Workspace → Usage to continue using AI features.",
            variant: "destructive",
          });
          return;
        }
        
        throw error;
      }
      
      console.log('Auto-orchestrator response:', data);
      
      // Check if response indicates credits error
      if (data?.error && data.error.includes('credits')) {
        toast({
          title: "AI Credits Exhausted",
          description: data.error,
          variant: "destructive",
        });
        return;
      }
      
      toast({
        title: "Manual scan triggered",
        description: "The autonomous system is now processing all pending items.",
      });
      
      // Reload metrics after a delay
      setTimeout(loadMetrics, 3000);
    } catch (error) {
      console.error('Error triggering scan:', error);
      toast({
        title: "Error",
        description: `Failed to trigger manual scan: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading && !metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 animate-pulse" />
            Loading System Status...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Zap className="h-6 w-6 text-primary" />
                Autonomous SOC System
              </CardTitle>
              <CardDescription className="mt-2">
                AI-powered security operations running 24/7 without human intervention
              </CardDescription>
            </div>
            <Badge 
              variant={autoMode ? "default" : "secondary"} 
              className="text-lg px-4 py-2"
            >
              <Activity className="h-4 w-4 mr-2 animate-pulse" />
              {autoMode ? "ACTIVE" : "STANDBY"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                Signals Processed
              </div>
              <div className="text-3xl font-bold">{metrics?.signals_processed || 0}</div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                Incidents Created
              </div>
              <div className="text-3xl font-bold">{metrics?.incidents_created || 0}</div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Zap className="h-4 w-4" />
                Auto-Escalated
              </div>
              <div className="text-3xl font-bold">{metrics?.incidents_auto_escalated || 0}</div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                Accuracy Rate
              </div>
              <div className="text-3xl font-bold">
                {metrics?.accuracy_rate ? `${metrics.accuracy_rate}%` : 'N/A'}
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-4">
            <Button onClick={triggerManualScan} disabled={loading}>
              <Activity className="h-4 w-4 mr-2" />
              Trigger Manual Scan
            </Button>
            
            {metrics?.created_at && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                Last updated: {new Date(metrics.created_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">AI Decision Engine</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">Active</span>
              <Badge variant="default" className="bg-green-500">
                <Activity className="h-3 w-3 mr-1 animate-pulse" />
                Online
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Autonomous threat analysis and incident creation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Auto-Orchestrator</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">Running</span>
              <Badge variant="default" className="bg-blue-500">
                Every 5 min
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Automated workflow management and escalation
            </p>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => setOsintDialogOpen(true)}
        >
          <CardHeader>
            <CardTitle className="text-sm font-medium">OSINT Monitors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{metrics?.osint_scans_completed || 0}</span>
              <Badge variant="default" className="bg-purple-500">
                {sources?.length || 0} sources
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Click to view all monitoring sources and their status
            </p>
          </CardContent>
        </Card>
      </div>

      <OSINTSourcesDialog 
        open={osintDialogOpen} 
        onOpenChange={setOsintDialogOpen}
      />
    </div>
  );
}
