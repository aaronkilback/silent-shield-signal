import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, TrendingUp, Clock, Target, ArrowUpRight, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface EscalationProbabilityCardProps {
  clientId?: string;
  compact?: boolean;
}

interface EscalationPrediction {
  probability: number;
  timeframe: string;
  timeframeHours: number;
  confidence: number;
  topFactors: string[];
  riskLevel: 'low' | 'moderate' | 'elevated' | 'high' | 'critical';
  trendDirection: 'increasing' | 'stable' | 'decreasing';
  hotspots: Array<{
    type: string;
    name: string;
    probability: number;
  }>;
}

export function EscalationProbabilityCard({ clientId, compact = false }: EscalationProbabilityCardProps) {
  const { data: prediction, isLoading } = useQuery({
    queryKey: ['escalation-probability', clientId],
    queryFn: async (): Promise<EscalationPrediction> => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Get recent signals with severity data
      let signalsQuery = supabase
        .from('signals')
        .select('severity, severity_score, confidence, signal_type, created_at, status')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(200);

      if (clientId) {
        signalsQuery = signalsQuery.eq('client_id', clientId);
      }

      const { data: signals } = await signalsQuery;

      // Get recent incidents to understand escalation patterns
      let incidentsQuery = supabase
        .from('incidents')
        .select('severity_level, status, created_at')
        .gte('created_at', sevenDaysAgo.toISOString())
        .eq('status', 'open')
        .is('deleted_at', null);

      if (clientId) {
        incidentsQuery = incidentsQuery.eq('client_id', clientId);
      }

      const { data: incidents } = await incidentsQuery;

      // Calculate escalation probability based on signal patterns
      const signalCount = (signals || []).length;
      const highSeveritySignals = (signals || []).filter(s => 
        s.severity === 'critical' || s.severity === 'high' || (s.severity_score && s.severity_score >= 70)
      ).length;
      
      const recentIncidents = (incidents || []).length;
      const criticalIncidents = (incidents || []).filter(i => 
        i.severity_level === 'P1' || i.severity_level === 'P2'
      ).length;

      // Base probability calculation
      let baseProbability = 15; // 15% baseline

      // Increase based on high severity signal ratio
      if (signalCount > 0) {
        const highSeverityRatio = highSeveritySignals / signalCount;
        baseProbability += highSeverityRatio * 30;
      }

      // Increase based on recent incident frequency
      if (recentIncidents > 0) {
        baseProbability += Math.min(25, recentIncidents * 5);
      }

      // Increase based on critical incidents
      if (criticalIncidents > 0) {
        baseProbability += criticalIncidents * 10;
      }

      // Cap at 95%
      const probability = Math.min(95, Math.round(baseProbability));

      // Determine timeframe based on activity level
      let timeframeHours = 72;
      let timeframe = "next 72 hours";
      if (probability > 60) {
        timeframeHours = 24;
        timeframe = "next 24 hours";
      } else if (probability > 40) {
        timeframeHours = 48;
        timeframe = "next 48 hours";
      }

      // Confidence based on data quality
      const confidence = signalCount > 50 ? 85 : signalCount > 20 ? 70 : 55;

      // Risk level
      const riskLevel = probability >= 70 ? 'critical' :
                        probability >= 50 ? 'high' :
                        probability >= 35 ? 'elevated' :
                        probability >= 20 ? 'moderate' : 'low';

      // Top factors
      const topFactors: string[] = [];
      if (highSeveritySignals > 5) topFactors.push(`${highSeveritySignals} high-severity signals detected`);
      if (criticalIncidents > 0) topFactors.push(`${criticalIncidents} critical incidents in past week`);
      if (signalCount > 100) topFactors.push("High signal volume indicates elevated activity");
      if (topFactors.length === 0) topFactors.push("Normal baseline activity levels");

      // Trend direction
      const firstHalf = (signals || []).slice(signalCount / 2);
      const secondHalf = (signals || []).slice(0, signalCount / 2);
      const firstHalfHigh = firstHalf.filter(s => s.severity === 'critical' || s.severity === 'high').length;
      const secondHalfHigh = secondHalf.filter(s => s.severity === 'critical' || s.severity === 'high').length;
      
      const trendDirection = secondHalfHigh > firstHalfHigh * 1.2 ? 'increasing' :
                             secondHalfHigh < firstHalfHigh * 0.8 ? 'decreasing' : 'stable';

      // Hotspots by signal type
      const typeCounts: Record<string, number> = {};
      (signals || []).forEach(s => {
        if (s.signal_type) {
          typeCounts[s.signal_type] = (typeCounts[s.signal_type] || 0) + 1;
        }
      });
      
      const hotspots = Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, count]) => ({
          type: 'signal_type',
          name: type,
          probability: Math.min(90, Math.round((count / signalCount) * 100 + probability * 0.5))
        }));

      return {
        probability,
        timeframe,
        timeframeHours,
        confidence,
        topFactors,
        riskLevel,
        trendDirection,
        hotspots,
      };
    },
    refetchInterval: 120000, // Refresh every 2 minutes
  });

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const riskColors = {
    low: 'bg-green-500/20 text-green-400 border-green-500/50',
    moderate: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
    elevated: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
    critical: 'bg-red-500/20 text-red-400 border-red-500/50',
  };

  const probabilityColor = (prediction?.probability || 0) >= 50 ? 'text-red-400' :
                           (prediction?.probability || 0) >= 30 ? 'text-orange-400' :
                           (prediction?.probability || 0) >= 15 ? 'text-yellow-400' : 'text-green-400';

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-card border cursor-pointer hover:bg-accent/50 transition-colors">
              <Target className="h-4 w-4 text-orange-400" />
              <span className="text-sm font-medium">Escalation</span>
              <Badge 
                variant="outline" 
                className={cn("text-xs", riskColors[prediction?.riskLevel || 'low'])}
              >
                {prediction?.probability}%
              </Badge>
              <span className="text-xs text-muted-foreground">
                {prediction?.timeframe}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium">Escalation Probability</p>
            <p className="text-xs text-muted-foreground">
              {prediction?.probability}% chance of incident escalation in the {prediction?.timeframe}.
            </p>
            {prediction?.topFactors[0] && (
              <p className="text-xs mt-1 text-primary">{prediction.topFactors[0]}</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-orange-400" />
            <CardTitle className="text-lg">Escalation Probability</CardTitle>
          </div>
          <Badge 
            variant="outline" 
            className={cn(riskColors[prediction?.riskLevel || 'low'])}
          >
            {prediction?.riskLevel?.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Probability Display */}
        <div className={cn(
          "p-4 rounded-lg text-center border",
          prediction?.riskLevel === 'critical' ? 'bg-red-500/10 border-red-500/30' :
          prediction?.riskLevel === 'high' ? 'bg-orange-500/10 border-orange-500/30' :
          'bg-muted/30 border-border/50'
        )}>
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className={cn("text-4xl font-bold", probabilityColor)}>
              {prediction?.probability}%
            </span>
            {prediction?.trendDirection === 'increasing' && (
              <ArrowUpRight className="h-6 w-6 text-red-400" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            chance of escalation in the <span className="font-medium">{prediction?.timeframe}</span>
          </p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {prediction?.confidence}% confidence
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Low Risk</span>
            <span>Critical</span>
          </div>
          <Progress 
            value={prediction?.probability || 0} 
            className={cn(
              "h-2",
              (prediction?.probability || 0) >= 50 && "[&>div]:bg-red-500",
              (prediction?.probability || 0) >= 30 && (prediction?.probability || 0) < 50 && "[&>div]:bg-orange-500"
            )}
          />
        </div>

        {/* Top Factors */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            Contributing Factors
          </p>
          <ul className="space-y-1">
            {prediction?.topFactors.map((factor, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-primary">•</span>
                {factor}
              </li>
            ))}
          </ul>
        </div>

        {/* Hotspots */}
        {prediction?.hotspots && prediction.hotspots.length > 0 && (
          <div className="pt-2 border-t space-y-2">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5" />
              Threat Hotspots
            </p>
            <div className="space-y-1.5">
              {prediction.hotspots.map((hotspot, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{hotspot.name.replace(/_/g, ' ')}</span>
                  <Badge variant="outline" className="text-xs">
                    {hotspot.probability}% risk
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
