import { lazy, Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, Radar, RefreshCw, AlertTriangle, Shield, TrendingUp, Eye, Zap, Target, Flame, Activity, Search, GitMerge, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DashboardClientSelector } from "@/components/ClientSelector";
import { ThreatRadarVisualization } from "@/components/threat-radar/ThreatRadarVisualization";
import { ThreatScoreCards } from "@/components/threat-radar/ThreatScoreCards";
import { PrecursorActivityPanel } from "@/components/threat-radar/PrecursorActivityPanel";
import { SentimentHeatmap } from "@/components/threat-radar/SentimentHeatmap";
import { RadicalActivityMonitor } from "@/components/threat-radar/RadicalActivityMonitor";
import { PredictiveInsightsPanel } from "@/components/threat-radar/PredictiveInsightsPanel";
import { ThreatTimelineChart } from "@/components/threat-radar/ThreatTimelineChart";
import { WildfireMap, WildfireDataPanel } from "@/components/wildfire";
import { AnticipationIndex } from "@/components/fortress";
import { SpeedMetricsPanel } from "@/components/threat-radar/SpeedMetricsPanel";
import { EscalationProbabilityCard } from "@/components/threat-radar/EscalationProbabilityCard";
import { AgentInteraction } from "@/components/agents/AgentInteraction";
import { useClientSelection } from "@/hooks/useClientSelection";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

const IntelligenceHubContent = lazy(() => import("./IntelligenceHub"));
const MatchingDashboardContent = lazy(() => import("./MatchingDashboard"));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const ThreatRadar = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { selectedClientId } = useClientSelection();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aegisOpen, setAegisOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const { data: radarData, isLoading: isLoadingRadar, refetch: refetchRadar } = useQuery({
    queryKey: ['threat-radar', selectedClientId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('threat-radar-analysis', {
        body: {
          client_id: selectedClientId,
          timeframe_hours: 168,
          include_predictions: true,
          generate_snapshot: true
        }
      });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: 300000,
  });

  const { data: snapshots } = useQuery({
    queryKey: ['threat-radar-snapshots', selectedClientId],
    queryFn: async () => {
      let query = supabase
        .from('threat_radar_snapshots')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      if (selectedClientId) {
        query = query.eq('client_id', selectedClientId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: aegisAgent } = useQuery({
    queryKey: ["aegis-agent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("id, header_name, codename, call_sign, avatar_color, system_prompt")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: aegisOpen,
    staleTime: 5 * 60 * 1000,
  });

  const handleRefresh = async () => {
    setIsAnalyzing(true);
    try {
      await refetchRadar();
      toast.success("Threat radar updated with latest intelligence");
    } catch (error) {
      toast.error("Failed to refresh threat radar");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!user && !loading) return null;

  const threatLevel = radarData?.threat_assessment?.overall_level || 'low';
  const threatScore = radarData?.threat_assessment?.overall_score || 0;
  const activeSignals = radarData?.top_alerts?.length ?? radarData?.threat_assessment?.scores?.active_signals ?? 0;
  const activePrecursors = radarData?.active_precursors?.length ?? 0;
  const escalationPct = radarData?.threat_assessment?.scores?.escalation_probability ?? 0;

  const getThreatLevelColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'elevated': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'moderate': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      default: return 'bg-green-500/20 text-green-400 border-green-500/50';
    }
  };

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (threatScore / 100) * circumference;

  const ringColor =
    threatLevel === 'critical' ? 'text-red-400' :
    threatLevel === 'high' ? 'text-orange-400' :
    threatLevel === 'elevated' ? 'text-yellow-400' :
    'text-green-400';

  return (
    <PageLayout loading={loading}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <Radar className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              Threat Radar
              <Badge className={`ml-2 ${getThreatLevelColor(threatLevel)}`}>
                {threatLevel.toUpperCase()}
              </Badge>
            </h1>
            <p className="text-muted-foreground">
              Proactive threat intelligence & predictive analytics
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <DashboardClientSelector />
          <Button
            onClick={handleRefresh}
            disabled={isAnalyzing || isLoadingRadar}
            variant="outline"
          >
            {isAnalyzing || isLoadingRadar ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh Analysis
          </Button>
        </div>
      </div>

      {/* Hero Section */}
      <div className="flex flex-col sm:flex-row items-center gap-6 p-6 rounded-xl border border-border/50 bg-muted/20">
        <div className="relative flex-shrink-0">
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-border/30"
            />
            <circle
              cx="50" cy="50" r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className={ringColor}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px', transition: 'stroke-dashoffset 0.5s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold">{threatScore}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Threat Level:</span>
            <Badge className={getThreatLevelColor(threatLevel)}>
              {threatLevel.toUpperCase()}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-background text-sm">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <span className="text-muted-foreground">Active Signals:</span>
              <span className="font-semibold">{isLoadingRadar ? '—' : activeSignals}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-background text-sm">
              <Eye className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-muted-foreground">Precursors:</span>
              <span className="font-semibold">{isLoadingRadar ? '—' : activePrecursors}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-background text-sm">
              <Zap className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-muted-foreground">Escalation:</span>
              <span className="font-semibold">{isLoadingRadar ? '—' : `${escalationPct}%`}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Threat Score Cards */}
      <ErrorBoundary context="Threat Score Cards">
        <ThreatScoreCards
          scores={radarData?.threat_assessment?.scores}
          overallScore={threatScore}
          overallLevel={threatLevel}
          isLoading={isLoadingRadar}
        />
      </ErrorBoundary>

      {/* Main Visualization + Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ErrorBoundary context="Threat Radar Visualization">
            <ThreatRadarVisualization data={radarData} isLoading={isLoadingRadar} />
          </ErrorBoundary>
        </div>
        <div>
          <ErrorBoundary context="Predictive Insights">
            <PredictiveInsightsPanel
              predictions={radarData?.predictions}
              topAlerts={radarData?.top_alerts}
              isLoading={isLoadingRadar}
            />
          </ErrorBoundary>
        </div>
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="overview" className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="precursors" className="flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            Precursors
          </TabsTrigger>
          <TabsTrigger value="wildfire" className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5" />
            Wildfire
          </TabsTrigger>
          <TabsTrigger value="sentiment" className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Sentiment
          </TabsTrigger>
          <TabsTrigger value="forecast" className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            Forecast
          </TabsTrigger>
          <TabsTrigger value="search" className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" />
            Search
          </TabsTrigger>
          <TabsTrigger value="matching" className="flex items-center gap-1.5">
            <GitMerge className="w-3.5 h-3.5" />
            Matching
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ErrorBoundary context="Speed Metrics">
              <SpeedMetricsPanel clientId={selectedClientId || undefined} />
            </ErrorBoundary>
            <ErrorBoundary context="Escalation Probability">
              <EscalationProbabilityCard clientId={selectedClientId || undefined} />
            </ErrorBoundary>
          </div>
          <ErrorBoundary context="Anticipation Index">
            <AnticipationIndex clientId={selectedClientId || undefined} />
          </ErrorBoundary>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-destructive" />
                  High-Threat Entities
                </CardTitle>
                <CardDescription>Top entities requiring attention</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingRadar ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : radarData?.high_threat_entities?.length > 0 ? (
                  <div className="space-y-3">
                    {radarData.high_threat_entities.slice(0, 3).map((entity: any) => (
                      <div key={entity.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
                        <div>
                          <p className="font-medium">{entity.name}</p>
                          <p className="text-sm text-muted-foreground">{entity.type}</p>
                        </div>
                        <Badge variant={entity.risk_level === 'critical' ? 'destructive' : 'secondary'}>
                          {entity.threat_score}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No high-threat entities detected</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  Critical Assets at Risk
                </CardTitle>
                <CardDescription>Infrastructure requiring protection</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingRadar ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : radarData?.critical_assets?.length > 0 ? (
                  <div className="space-y-3">
                    {radarData.critical_assets.slice(0, 3).map((asset: any) => (
                      <div key={asset.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
                        <div>
                          <p className="font-medium">{asset.asset_name}</p>
                          <p className="text-sm text-muted-foreground">{asset.asset_type} • {asset.location}</p>
                        </div>
                        <Badge variant={asset.business_criticality === 'mission_critical' ? 'destructive' : 'secondary'}>
                          {asset.business_criticality?.replace('_', ' ')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No critical assets identified</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="precursors" className="space-y-6">
          <ErrorBoundary context="Precursor Activity">
            <PrecursorActivityPanel
              precursors={radarData?.active_precursors}
              isLoading={isLoadingRadar}
            />
          </ErrorBoundary>
          <ErrorBoundary context="Radical Activity Monitor">
            <RadicalActivityMonitor
              intelligenceSummary={radarData?.intelligence_summary}
              isLoading={isLoadingRadar}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="wildfire">
          <ErrorBoundary context="Wildfire Intelligence">
            <div className="space-y-6">
              <WildfireMap clientId={selectedClientId} region="world" />
              <WildfireDataPanel />
            </div>
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="sentiment">
          <ErrorBoundary context="Sentiment Heatmap">
            <SentimentHeatmap
              geoIntelligence={radarData?.geo_intelligence}
              isLoading={isLoadingRadar}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="forecast">
          <ErrorBoundary context="Threat Timeline">
            <ThreatTimelineChart
              snapshots={snapshots}
              isLoading={isLoadingRadar}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="search">
          <Suspense fallback={<TabLoader />}>
            <IntelligenceHubContent />
          </Suspense>
        </TabsContent>

        <TabsContent value="matching">
          <Suspense fallback={<TabLoader />}>
            <MatchingDashboardContent />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Floating Ask Aegis Button */}
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          onClick={() => setAegisOpen(true)}
          className="rounded-full shadow-lg gap-2"
          size="lg"
        >
          <Bot className="w-4 h-4" />
          Ask Aegis about this threat
        </Button>
      </div>

      <Dialog open={aegisOpen} onOpenChange={setAegisOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              Ask Aegis
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden px-6 pb-6">
            {aegisAgent && <AgentInteraction agent={aegisAgent} />}
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
};

export default ThreatRadar;
