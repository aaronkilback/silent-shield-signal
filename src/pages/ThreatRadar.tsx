import { PageLayout } from "@/components/PageLayout";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, Radar, RefreshCw, AlertTriangle, Shield, TrendingUp, MapPin, Activity, Eye, Zap, Target, Radio, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DashboardClientSelector } from "@/components/DashboardClientSelector";
import { ThreatRadarVisualization } from "@/components/threat-radar/ThreatRadarVisualization";
import { ThreatScoreCards } from "@/components/threat-radar/ThreatScoreCards";
import { PrecursorActivityPanel } from "@/components/threat-radar/PrecursorActivityPanel";
import { SentimentHeatmap } from "@/components/threat-radar/SentimentHeatmap";
import { RadicalActivityMonitor } from "@/components/threat-radar/RadicalActivityMonitor";
import { PredictiveInsightsPanel } from "@/components/threat-radar/PredictiveInsightsPanel";
import { ThreatTimelineChart } from "@/components/threat-radar/ThreatTimelineChart";
import { WildfireMap, WildfireDataPanel } from "@/components/wildfire";
import { useClientSelection } from "@/hooks/useClientSelection";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

const ThreatRadar = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { selectedClientId } = useClientSelection();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Fetch threat radar data
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
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  // Fetch recent snapshots
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

  if (!user && !loading) {
    return null;
  }

  const threatLevel = radarData?.threat_assessment?.overall_level || 'low';
  const threatScore = radarData?.threat_assessment?.overall_score || 0;

  const getThreatLevelColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'elevated': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'moderate': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      default: return 'bg-green-500/20 text-green-400 border-green-500/50';
    }
  };

  return (
    <PageLayout loading={loading}>
      {/* Header Section */}
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

        {/* Threat Score Cards */}
        <ErrorBoundary context="Threat Score Cards">
          <ThreatScoreCards 
            scores={radarData?.threat_assessment?.scores}
            overallScore={threatScore}
            overallLevel={threatLevel}
            isLoading={isLoadingRadar}
          />
        </ErrorBoundary>

        {/* Main Visualization and Insights */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Radar Visualization */}
          <div className="lg:col-span-2">
            <ErrorBoundary context="Threat Radar Visualization">
              <ThreatRadarVisualization 
                data={radarData}
                isLoading={isLoadingRadar}
              />
            </ErrorBoundary>
          </div>
          
          {/* Predictive Insights */}
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
        <Tabs defaultValue="precursors" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="precursors" className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Precursor Activity
            </TabsTrigger>
            <TabsTrigger value="wildfire" className="flex items-center gap-2">
              <Flame className="w-4 h-4" />
              Wildfire Intel
            </TabsTrigger>
            <TabsTrigger value="radical" className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Radical Monitoring
            </TabsTrigger>
            <TabsTrigger value="sentiment" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Sentiment Analysis
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Threat Timeline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="precursors">
            <ErrorBoundary context="Precursor Activity">
              <PrecursorActivityPanel 
                precursors={radarData?.active_precursors}
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

          <TabsContent value="radical">
            <ErrorBoundary context="Radical Activity Monitor">
              <RadicalActivityMonitor 
                intelligenceSummary={radarData?.intelligence_summary}
                isLoading={isLoadingRadar}
              />
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

          <TabsContent value="timeline">
            <ErrorBoundary context="Threat Timeline">
              <ThreatTimelineChart 
                snapshots={snapshots}
                isLoading={isLoadingRadar}
              />
            </ErrorBoundary>
          </TabsContent>
        </Tabs>

        {/* High-Threat Entities & Critical Assets */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-destructive" />
                High-Threat Entities
              </CardTitle>
              <CardDescription>Entities requiring immediate attention</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingRadar ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {radarData?.high_threat_entities?.slice(0, 5).map((entity: any) => (
                    <div 
                      key={entity.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50"
                    >
                      <div>
                        <p className="font-medium">{entity.name}</p>
                        <p className="text-sm text-muted-foreground">{entity.type}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={entity.risk_level === 'critical' ? 'destructive' : 'secondary'}>
                          {entity.threat_score}%
                        </Badge>
                      </div>
                    </div>
                  )) || (
                    <p className="text-muted-foreground text-center py-4">No high-threat entities detected</p>
                  )}
                </div>
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
              ) : (
                <div className="space-y-3">
                  {radarData?.critical_assets?.slice(0, 5).map((asset: any) => (
                    <div 
                      key={asset.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50"
                    >
                      <div>
                        <p className="font-medium">{asset.asset_name}</p>
                        <p className="text-sm text-muted-foreground">{asset.asset_type} • {asset.location}</p>
                      </div>
                      <Badge 
                        variant={asset.business_criticality === 'mission_critical' ? 'destructive' : 'secondary'}
                      >
                        {asset.business_criticality?.replace('_', ' ')}
                      </Badge>
                    </div>
                  )) || (
                    <p className="text-muted-foreground text-center py-4">No critical assets identified</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
    </PageLayout>
  );
};

export default ThreatRadar;
