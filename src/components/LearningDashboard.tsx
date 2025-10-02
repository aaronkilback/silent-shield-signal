import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Brain, TrendingUp, Target, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function LearningDashboard() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [outcomes, setOutcomes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      // Load automation metrics (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: metricsData, error: metricsError } = await supabase
        .from('automation_metrics')
        .select('*')
        .gte('metric_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('metric_date', { ascending: true });

      if (metricsError) throw metricsError;
      setMetrics(metricsData || []);

      // Load incident outcomes
      const { data: outcomesData, error: outcomesError } = await supabase
        .from('incident_outcomes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (outcomesError) throw outcomesError;
      setOutcomes(outcomesData || []);

    } catch (error) {
      console.error('Error loading learning data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate statistics
  const stats = {
    totalOutcomes: outcomes.length,
    accurate: outcomes.filter(o => o.was_accurate).length,
    falsePositives: outcomes.filter(o => o.false_positive).length,
    averageResponseTime: outcomes.length > 0
      ? Math.round(outcomes.reduce((sum, o) => sum + (o.response_time_seconds || 0), 0) / outcomes.length)
      : 0,
  };

  const accuracyRate = stats.totalOutcomes > 0 
    ? ((stats.accurate / stats.totalOutcomes) * 100).toFixed(1)
    : 'N/A';

  const falsePositiveRate = stats.totalOutcomes > 0
    ? ((stats.falsePositives / stats.totalOutcomes) * 100).toFixed(1)
    : 'N/A';

  // Prepare chart data
  const accuracyTrendData = metrics.map(m => ({
    date: new Date(m.metric_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    accuracy: m.accuracy_rate || 0,
    falsePositive: m.false_positive_rate || 0,
  }));

  const performanceData = metrics.map(m => ({
    date: new Date(m.metric_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    processed: m.signals_processed || 0,
    incidents: m.incidents_created || 0,
    escalated: m.incidents_auto_escalated || 0,
  }));

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 animate-pulse" />
            Loading Learning Analytics...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Brain className="h-6 w-6 text-purple-600" />
            AI Learning & Performance Analytics
          </CardTitle>
          <CardDescription>
            Track autonomous system accuracy, learning, and continuous improvement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Target className="h-4 w-4" />
                Accuracy Rate
              </div>
              <div className="text-3xl font-bold text-green-600">{accuracyRate}%</div>
              <Progress value={parseFloat(accuracyRate as string)} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                False Positive Rate
              </div>
              <div className="text-3xl font-bold text-orange-600">{falsePositiveRate}%</div>
              <Progress value={parseFloat(falsePositiveRate as string)} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                Correct Decisions
              </div>
              <div className="text-3xl font-bold">{stats.accurate}</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                Avg Response Time
              </div>
              <div className="text-3xl font-bold">{stats.averageResponseTime}s</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="accuracy" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="accuracy">Accuracy Trends</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="outcomes">Recent Outcomes</TabsTrigger>
        </TabsList>

        <TabsContent value="accuracy">
          <Card>
            <CardHeader>
              <CardTitle>Accuracy & False Positive Trends</CardTitle>
              <CardDescription>30-day trend of AI decision accuracy</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={accuracyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="accuracy" stroke="#10b981" name="Accuracy %" />
                  <Line type="monotone" dataKey="falsePositive" stroke="#f59e0b" name="False Positive %" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle>Autonomous Operations Performance</CardTitle>
              <CardDescription>Daily processing and incident creation</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={performanceData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="processed" fill="#3b82f6" name="Signals Processed" />
                  <Bar dataKey="incidents" fill="#ef4444" name="Incidents Created" />
                  <Bar dataKey="escalated" fill="#f59e0b" name="Auto-Escalated" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outcomes">
          <Card>
            <CardHeader>
              <CardTitle>Recent Incident Outcomes</CardTitle>
              <CardDescription>Learning from past decisions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {outcomes.slice(0, 20).map((outcome) => (
                  <div key={outcome.id} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <div>
                      {outcome.was_accurate ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{outcome.outcome_type}</span>
                        {outcome.false_positive && (
                          <Badge variant="destructive" className="text-xs">False Positive</Badge>
                        )}
                      </div>
                      {outcome.lessons_learned && (
                        <p className="text-sm text-muted-foreground">{outcome.lessons_learned}</p>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        Response time: {outcome.response_time_seconds}s
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
