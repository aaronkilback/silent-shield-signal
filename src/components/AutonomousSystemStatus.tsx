import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, Zap, TrendingUp, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

export default function AutonomousSystemStatus() {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoMode, setAutoMode] = useState(true);

  useEffect(() => {
    loadMetrics();
    
    // Refresh metrics every 30 seconds
    const interval = setInterval(loadMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadMetrics = async () => {
    try {
      const { data, error } = await supabase
        .from('automation_metrics')
        .select('*')
        .order('metric_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setMetrics(data || undefined);
    } catch (error) {
      console.error('Error loading metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const triggerManualScan = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.functions.invoke('auto-orchestrator');
      
      if (error) throw error;
      
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
        description: "Failed to trigger manual scan",
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">OSINT Monitors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{metrics?.osint_scans_completed || 0}</span>
              <Badge variant="default" className="bg-purple-500">
                6 sources
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Weather, wildfire, earthquake, news, threat intel, Reddit & Hacker News
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
