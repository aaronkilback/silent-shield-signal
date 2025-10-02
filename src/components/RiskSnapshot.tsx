import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertCircle, Activity, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Signal {
  id: string;
  normalized_text: string | null;
  severity: string | null;
  category: string | null;
  location: string | null;
  confidence: number | null;
  entity_tags: string[] | null;
  received_at: string;
}

interface RiskLevel {
  level: "critical" | "high" | "medium" | "low";
  count: number;
  percentage: number;
  signals: Signal[];
}

const getRiskColor = (level: string) => {
  switch (level) {
    case "critical":
      return "bg-risk-critical";
    case "high":
      return "bg-risk-high";
    case "medium":
      return "bg-risk-medium";
    case "low":
      return "bg-risk-low";
    default:
      return "";
  }
};

const getRiskIcon = (level: string) => {
  switch (level) {
    case "critical":
      return <AlertCircle className="w-5 h-5" />;
    case "high":
      return <Activity className="w-5 h-5" />;
    case "medium":
      return <Activity className="w-5 h-5" />;
    case "low":
      return <CheckCircle className="w-5 h-5" />;
    default:
      return null;
  }
};

export const RiskSnapshot = () => {
  const [riskLevels, setRiskLevels] = useState<RiskLevel[]>([]);
  const [expandedLevel, setExpandedLevel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSignals = async () => {
      const { data, error } = await supabase
        .from('signals')
        .select('id, normalized_text, severity, category, location, confidence, entity_tags, received_at')
        .gte('received_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('received_at', { ascending: false });

      if (error) {
        console.error('Error fetching signals:', error);
        setLoading(false);
        return;
      }

      const signals = data || [];
      const total = signals.length;

      const levels: RiskLevel[] = ['critical', 'high', 'medium', 'low'].map(level => {
        const levelSignals = signals.filter(s => s.severity === level);
        return {
          level: level as "critical" | "high" | "medium" | "low",
          count: levelSignals.length,
          percentage: total > 0 ? Math.round((levelSignals.length / total) * 100) : 0,
          signals: levelSignals
        };
      });

      setRiskLevels(levels);
      setLoading(false);
    };

    fetchSignals();
  }, []);

  const totalEvents = riskLevels.reduce((sum, level) => sum + level.count, 0);
  const criticalAndHigh = riskLevels
    .filter(level => level.level === "critical" || level.level === "high")
    .reduce((sum, level) => sum + level.count, 0);

  if (loading) {
    return (
      <Card className="p-6 bg-card border-border">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-secondary rounded w-1/2" />
          <div className="h-20 bg-secondary/50 rounded" />
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-secondary/30 rounded" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card border-border">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-primary/10">
          <Shield className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Executive Risk Snapshot</h2>
          <p className="text-sm text-muted-foreground">Last 24 hours</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="p-4 rounded-lg bg-secondary/50 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Total Events</span>
            <span className="text-2xl font-bold text-foreground font-mono">{totalEvents}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Requires Attention</span>
            <Badge variant="outline" className="text-destructive border-destructive/50">
              {criticalAndHigh} High Priority
            </Badge>
          </div>
        </div>

        <div className="space-y-3">
          {riskLevels.map((risk) => (
            <div key={risk.level}>
              <div
                className="p-3 rounded-lg bg-secondary/30 border border-border hover:border-primary/30 transition-all duration-200 cursor-pointer"
                onClick={() => setExpandedLevel(expandedLevel === risk.level ? null : risk.level)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`${getRiskColor(risk.level)} p-1.5 rounded text-background`}>
                      {getRiskIcon(risk.level)}
                    </div>
                    <span className="font-semibold text-foreground capitalize">{risk.level}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-foreground font-mono">{risk.count}</span>
                    {expandedLevel === risk.level ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full ${getRiskColor(risk.level)} transition-all duration-500`}
                    style={{ width: `${risk.percentage}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-muted-foreground text-right">{risk.percentage}%</div>
              </div>

              {expandedLevel === risk.level && risk.signals.length > 0 && (
                <div className="mt-2 space-y-2 pl-4 border-l-2 border-border">
                  {risk.signals.map((signal) => (
                    <div
                      key={signal.id}
                      className="p-3 rounded-lg bg-card border border-border text-sm"
                    >
                      <p className="font-medium text-foreground mb-2">
                        {signal.normalized_text || 'Processing...'}
                      </p>
                      <div className="flex gap-2 flex-wrap text-xs">
                        {signal.category && (
                          <Badge variant="outline" className="text-xs">
                            {signal.category}
                          </Badge>
                        )}
                        {signal.location && (
                          <Badge variant="secondary" className="text-xs">
                            📍 {signal.location}
                          </Badge>
                        )}
                        {signal.confidence !== null && (
                          <Badge variant="secondary" className="text-xs">
                            {Math.round(signal.confidence * 100)}% confidence
                          </Badge>
                        )}
                        <span className="text-muted-foreground ml-auto">
                          {new Date(signal.received_at).toLocaleTimeString()}
                        </span>
                      </div>
                      {signal.entity_tags && signal.entity_tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-2">
                          {signal.entity_tags.slice(0, 5).map((tag, idx) => (
                            <span 
                              key={idx}
                              className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
          <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Network Health Status
          </h3>
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <p className="text-xs text-muted-foreground">Overall Score</p>
              <p className="text-xl font-bold text-foreground font-mono">87/100</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Threat Level</p>
              <Badge className="text-risk-high border-risk-high/50 bg-risk-high/10 mt-1">ELEVATED</Badge>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
