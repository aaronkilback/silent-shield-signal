import { useState } from "react";
import { Header } from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, Link } from "react-router-dom";
import { useEffect } from "react";
import { Loader2, TrendingUp, AlertCircle, CheckCircle2, Users, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MatchConfidenceChart } from "@/components/matching/MatchConfidenceChart";
import { MatchingTrendChart } from "@/components/matching/MatchingTrendChart";
import { CloseMatchWarnings } from "@/components/matching/CloseMatchWarnings";

const MatchingDashboard = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<string>("30d");

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Get date filter
  const getDateFilter = () => {
    const now = new Date();
    if (dateRange === "7d") {
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (dateRange === "30d") {
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (dateRange === "90d") {
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    }
    return null;
  };

  // Fetch overall stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["matching-stats", dateRange],
    queryFn: async () => {
      const dateFilter = getDateFilter();
      let query = supabase
        .from("signal_correlation_groups")
        .select("*");

      if (dateFilter) {
        query = query.gte("created_at", dateFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Cast to any for new columns not in types yet
      const items = (data || []) as any[];
      
      // Calculate stats
      const total = items.length;
      const byConfidence: Record<string, number> = {};
      
      items.forEach(item => {
        const conf = item.match_confidence || "none";
        byConfidence[conf] = (byConfidence[conf] || 0) + 1;
      });

      const matched = total - (byConfidence["none"] || 0) - (byConfidence["dismissed"] || 0);
      const unmatched = byConfidence["none"] || 0;
      const dismissed = byConfidence["dismissed"] || 0;
      const aiMatched = byConfidence["ai"] || 0;
      const manualMatched = byConfidence["manual"] || 0;
      const autoMatched = (byConfidence["explicit"] || 0) + (byConfidence["high"] || 0) + 
                          (byConfidence["medium"] || 0) + (byConfidence["low"] || 0);

      return {
        total,
        matched,
        unmatched,
        dismissed,
        aiMatched,
        manualMatched,
        autoMatched,
        byConfidence,
        matchRate: total > 0 ? ((matched / total) * 100).toFixed(1) : "0",
      };
    },
    enabled: !!user,
  });

  // Fetch close match warnings (runner-up score > 70% of best)
  const { data: closeMatchWarnings } = useQuery({
    queryKey: ["close-match-warnings", dateRange],
    queryFn: async () => {
      const dateFilter = getDateFilter();
      const { data, error } = await supabase
        .from("signal_correlation_groups")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Cast to any and filter for runner_up_score > 0.7
      const items = (data || []) as any[];
      let filtered = items.filter(item => 
        item.runner_up_score != null && item.runner_up_score > 0.7
      );

      if (dateFilter) {
        filtered = filtered.filter(item => 
          new Date(item.created_at) >= new Date(dateFilter)
        );
      }

      return filtered.slice(0, 10).map(item => ({
        id: item.id,
        normalized_text: item.normalized_text,
        created_at: item.created_at,
        runner_up_score: item.runner_up_score,
        runner_up_client_id: item.runner_up_client_id,
        client_id: item.client_id,
      }));
    },
    enabled: !!user,
  });

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

  const confidenceLabels: Record<string, { label: string; color: string }> = {
    explicit: { label: "Explicit", color: "bg-green-500" },
    high: { label: "High", color: "bg-emerald-500" },
    medium: { label: "Medium", color: "bg-yellow-500" },
    low: { label: "Low", color: "bg-orange-500" },
    ai: { label: "AI", color: "bg-purple-500" },
    manual: { label: "Manual", color: "bg-blue-500" },
    none: { label: "Unmatched", color: "bg-gray-500" },
    dismissed: { label: "Dismissed", color: "bg-gray-400" },
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Match Confidence Dashboard</h1>
            <p className="text-muted-foreground mt-2">
              Monitor signal-to-client matching performance and identify areas for improvement
            </p>
          </div>
          <div className="flex gap-4">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button asChild>
              <Link to="/unmatched-signals">
                Review Unmatched
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Match Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.matchRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.matched || 0} of {stats?.total || 0} signals matched
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                Pending Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">{stats?.unmatched || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Signals awaiting manual review
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-purple-500" />
                AI Matched
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">{stats?.aiMatched || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Signals matched by AI analysis
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" />
                Manually Assigned
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{stats?.manualMatched || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Signals manually assigned by analysts
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ErrorBoundary context="Match Confidence Chart">
            <Card>
              <CardHeader>
                <CardTitle>Match Confidence Distribution</CardTitle>
                <CardDescription>
                  Breakdown of signals by matching confidence level
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MatchConfidenceChart 
                  data={stats?.byConfidence || {}} 
                  labels={confidenceLabels}
                />
              </CardContent>
            </Card>
          </ErrorBoundary>

          <ErrorBoundary context="Matching Trend Chart">
            <Card>
              <CardHeader>
                <CardTitle>Matching Trends</CardTitle>
                <CardDescription>
                  Daily signal matching performance over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MatchingTrendChart dateRange={dateRange} />
              </CardContent>
            </Card>
          </ErrorBoundary>
        </div>

        {/* Close Match Warnings */}
        <ErrorBoundary context="Close Match Warnings">
          <CloseMatchWarnings warnings={closeMatchWarnings || []} />
        </ErrorBoundary>

        {/* Confidence Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Confidence Level Breakdown</CardTitle>
            <CardDescription>
              Detailed statistics for each matching confidence category
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(stats?.byConfidence || {}).map(([key, count]) => (
                <div 
                  key={key} 
                  className="border rounded-lg p-4 text-center"
                >
                  <Badge className={`${confidenceLabels[key]?.color || "bg-gray-500"} mb-2`}>
                    {confidenceLabels[key]?.label || key}
                  </Badge>
                  <div className="text-2xl font-bold">{count}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats?.total ? ((count / stats.total) * 100).toFixed(1) : 0}%
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default MatchingDashboard;
