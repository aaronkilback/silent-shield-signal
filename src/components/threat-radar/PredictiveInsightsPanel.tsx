import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Zap, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PredictiveInsightsPanelProps {
  predictions: any;
  topAlerts: any[];
  isLoading: boolean;
}

export const PredictiveInsightsPanel = ({ predictions, topAlerts, isLoading }: PredictiveInsightsPanelProps) => {
  if (isLoading) {
    return (
      <Card className="border-border/50 h-full">
        <CardContent className="flex items-center justify-center h-80">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Predictive Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {predictions && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">Escalation Probability</span>
                <Badge variant="destructive">
                  {predictions.escalation_probability != null ? `${predictions.escalation_probability}%` : "Calculating..."}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Timeframe: {predictions.predicted_timeframe}
              </p>
            </div>
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            Top Alerts
          </h4>
          <ScrollArea className="h-48">
            <div className="space-y-2">
              {topAlerts?.slice(0, 5).map((alert: any, i: number) => (
                <div key={i} className="p-2 rounded bg-secondary/30 border border-border/50">
                  <p className="text-xs font-medium line-clamp-2">{alert.title}</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">{alert.type}</Badge>
                    <Badge variant={alert.severity === 'critical' ? 'destructive' : 'secondary'} className="text-xs">
                      {alert.severity}
                    </Badge>
                  </div>
                </div>
              )) || <p className="text-sm text-muted-foreground">No alerts</p>}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
};
