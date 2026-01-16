import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertTriangle, 
  Bug, 
  Shield, 
  Database, 
  Globe, 
  RefreshCw,
  TrendingUp,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { getErrorStats, ErrorCategory, ErrorSeverity } from '@/lib/errorTracking';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

const categoryIcons: Record<ErrorCategory, React.ReactNode> = {
  database_constraint: <Database className="h-4 w-4" />,
  rls_policy: <Shield className="h-4 w-4" />,
  api_error: <Globe className="h-4 w-4" />,
  validation: <AlertTriangle className="h-4 w-4" />,
  network: <Globe className="h-4 w-4" />,
  authentication: <Shield className="h-4 w-4" />,
  component_crash: <Bug className="h-4 w-4" />,
  edge_function: <Globe className="h-4 w-4" />,
  unknown: <Bug className="h-4 w-4" />,
};

const severityColors: Record<ErrorSeverity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

export function ErrorMonitoringDashboard() {
  const [timeRange, setTimeRange] = useState<7 | 14 | 30>(7);
  
  const { data: stats, isLoading, refetch } = useQuery({
    queryKey: ['error-stats', timeRange],
    queryFn: () => getErrorStats(timeRange),
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: recentBugs } = useQuery({
    queryKey: ['recent-bugs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bug_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      return data || [];
    },
    refetchInterval: 30000,
  });

  // Calculate health score
  const healthScore = stats ? Math.max(0, 100 - (stats.bySeverity.critical * 25) - (stats.bySeverity.high * 10) - (stats.bySeverity.medium * 5)) : 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Error Monitoring</h2>
          <p className="text-muted-foreground">Track and analyze system errors in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={timeRange.toString()} onValueChange={(v) => setTimeRange(parseInt(v) as 7 | 14 | 30)}>
            <TabsList>
              <TabsTrigger value="7">7 days</TabsTrigger>
              <TabsTrigger value="14">14 days</TabsTrigger>
              <TabsTrigger value="30">30 days</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Health Score & Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className={`text-3xl font-bold ${healthScore >= 80 ? 'text-green-500' : healthScore >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                {healthScore}%
              </span>
              {healthScore >= 80 ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-yellow-500" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold">{stats?.total || 0}</span>
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Last {timeRange} days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Critical Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold text-red-500">{stats?.bySeverity.critical || 0}</span>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Requires immediate attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">High Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold text-orange-500">{stats?.bySeverity.high || 0}</span>
              <Clock className="h-5 w-5 text-orange-500" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Should be addressed soon</p>
          </CardContent>
        </Card>
      </div>

      {/* Error Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* By Category */}
        <Card>
          <CardHeader>
            <CardTitle>Errors by Category</CardTitle>
            <CardDescription>Distribution of error types</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats && Object.entries(stats.byCategory)
                .filter(([_, count]) => count > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([category, count]) => (
                  <div key={category} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {categoryIcons[category as ErrorCategory]}
                      <span className="capitalize">{category.replace('_', ' ')}</span>
                    </div>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              {stats && Object.values(stats.byCategory).every(v => v === 0) && (
                <p className="text-muted-foreground text-sm">No errors in this period</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* By Severity */}
        <Card>
          <CardHeader>
            <CardTitle>Errors by Severity</CardTitle>
            <CardDescription>Priority distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats && Object.entries(stats.bySeverity)
                .sort((a, b) => {
                  const order = ['critical', 'high', 'medium', 'low'];
                  return order.indexOf(a[0]) - order.indexOf(b[0]);
                })
                .map(([severity, count]) => (
                  <div key={severity} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-full ${severityColors[severity as ErrorSeverity]}`} />
                      <span className="capitalize">{severity}</span>
                    </div>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Errors */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Errors</CardTitle>
          <CardDescription>Latest errors across the system</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {recentBugs?.map((bug) => (
                <div 
                  key={bug.id}
                  className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge 
                          variant="secondary"
                          className={
                            bug.severity === 'critical' ? 'bg-red-500/20 text-red-500' :
                            bug.severity === 'high' ? 'bg-orange-500/20 text-orange-500' :
                            bug.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-500' :
                            'bg-blue-500/20 text-blue-500'
                          }
                        >
                          {bug.severity}
                        </Badge>
                        <Badge variant="outline">
                          {bug.status}
                        </Badge>
                      </div>
                      <p className="font-medium truncate">{bug.title}</p>
                      {bug.page_url && (
                        <p className="text-xs text-muted-foreground truncate mt-1">
                          {bug.page_url}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {bug.created_at && formatDistanceToNow(new Date(bug.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
              {(!recentBugs || recentBugs.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No recent errors - system is healthy!</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
