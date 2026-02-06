import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, MapPin, AlertTriangle, Brain, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Forecast {
  type: string;
  category?: string;
  location?: string;
  trend?: string;
  momentum?: number;
  risk_score: number;
  signals_14d?: number;
  signals_total?: number;
  high_severity_count?: number;
  escalation_probability?: number;
  recent_count?: number;
  category_diversity?: number;
  categories?: string[];
  incidents_14d?: number;
  incidents_total?: number;
  critical_incidents_14d?: number;
}

interface ForecastResult {
  lookback_days: number;
  total_signals_analyzed: number;
  total_incidents_analyzed: number;
  forecasts: Forecast[];
  ai_summary: string | null;
  generated_at: string;
}

export const ThreatForecastPanel = () => {
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookback, setLookback] = useState("90");

  const runForecast = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('predictive-forecast', {
        body: { days_back: parseInt(lookback) },
      });

      if (error) throw error;
      setResult(data);
      toast.success(`Forecast complete — ${data.forecasts?.length || 0} patterns detected`);
    } catch (err: any) {
      console.error('Forecast error:', err);
      toast.error(err.message || 'Forecast failed');
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (score: number) => {
    if (score >= 70) return 'text-red-400';
    if (score >= 40) return 'text-amber-400';
    return 'text-emerald-400';
  };

  const getRiskBadge = (score: number) => {
    if (score >= 70) return 'destructive';
    if (score >= 40) return 'secondary';
    return 'outline';
  };

  const getTrendIcon = (type: string) => {
    switch (type) {
      case 'category_acceleration': return <TrendingUp className="h-4 w-4" />;
      case 'geographic_hotspot': return <MapPin className="h-4 w-4" />;
      case 'incident_escalation_trend': return <AlertTriangle className="h-4 w-4" />;
      default: return <Brain className="h-4 w-4" />;
    }
  };

  const getForecastTitle = (f: Forecast) => {
    switch (f.type) {
      case 'category_acceleration': return `${f.category} — ${f.trend}`;
      case 'geographic_hotspot': return `Hotspot: ${f.location}`;
      case 'incident_escalation_trend': return `Incident Trend — ${f.trend}`;
      default: return f.type;
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Predictive Threat Forecasting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Analyze historical signal and incident patterns to forecast emerging threats using frequency acceleration, geographic clustering, and AI synthesis.
          </p>
          <div className="flex items-center gap-3">
            <Select value={lookback} onValueChange={setLookback}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={runForecast} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Generate Forecast
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold">{result.total_signals_analyzed}</div>
                <div className="text-xs text-muted-foreground">Signals Analyzed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold">{result.total_incidents_analyzed}</div>
                <div className="text-xs text-muted-foreground">Incidents Analyzed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold">{result.forecasts.length}</div>
                <div className="text-xs text-muted-foreground">Patterns Detected</div>
              </CardContent>
            </Card>
          </div>

          {/* AI Summary */}
          {result.ai_summary && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-3.5 w-3.5 text-primary" />
                  AI Forecast Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{result.ai_summary}</p>
              </CardContent>
            </Card>
          )}

          {/* Forecast Items */}
          {result.forecasts.length > 0 ? (
            <div className="space-y-2">
              {result.forecasts.map((f, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">{getTrendIcon(f.type)}</div>
                        <div>
                          <div className="font-medium text-sm">{getForecastTitle(f)}</div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {f.momentum !== undefined && (
                              <Badge variant="outline" className="text-xs">
                                Momentum: {f.momentum > 0 ? '+' : ''}{(f.momentum * 100).toFixed(0)}%
                              </Badge>
                            )}
                            {f.signals_14d !== undefined && (
                              <Badge variant="outline" className="text-xs">
                                {f.signals_14d} signals (14d)
                              </Badge>
                            )}
                            {f.high_severity_count !== undefined && f.high_severity_count > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                {f.high_severity_count} high-sev
                              </Badge>
                            )}
                            {f.escalation_probability !== undefined && (
                              <Badge variant="outline" className="text-xs">
                                {f.escalation_probability}% escalation prob.
                              </Badge>
                            )}
                            {f.categories && (
                              <Badge variant="outline" className="text-xs">
                                {f.category_diversity} categories
                              </Badge>
                            )}
                            {f.incidents_14d !== undefined && (
                              <Badge variant="outline" className="text-xs">
                                {f.incidents_14d} incidents (14d)
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${getRiskColor(f.risk_score)}`}>
                          {f.risk_score}
                        </div>
                        <Badge variant={getRiskBadge(f.risk_score) as any} className="text-[10px]">
                          {f.risk_score >= 70 ? 'HIGH' : f.risk_score >= 40 ? 'MEDIUM' : 'LOW'}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                No significant threat patterns detected in the last {result.lookback_days} days.
              </CardContent>
            </Card>
          )}

          <p className="text-[10px] text-muted-foreground text-right">
            Generated at {new Date(result.generated_at).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
};
