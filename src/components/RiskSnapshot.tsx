import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertCircle, Activity, CheckCircle } from "lucide-react";

interface RiskLevel {
  level: "critical" | "high" | "medium" | "low";
  count: number;
  percentage: number;
}

const riskLevels: RiskLevel[] = [
  { level: "critical", count: 2, percentage: 8 },
  { level: "high", count: 5, percentage: 20 },
  { level: "medium", count: 12, percentage: 48 },
  { level: "low", count: 6, percentage: 24 }
];

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
  const totalEvents = riskLevels.reduce((sum, level) => sum + level.count, 0);
  const criticalAndHigh = riskLevels
    .filter(level => level.level === "critical" || level.level === "high")
    .reduce((sum, level) => sum + level.count, 0);

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
            <div
              key={risk.level}
              className="p-3 rounded-lg bg-secondary/30 border border-border hover:border-primary/30 transition-all duration-200"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`${getRiskColor(risk.level)} p-1.5 rounded text-background`}>
                    {getRiskIcon(risk.level)}
                  </div>
                  <span className="font-semibold text-foreground capitalize">{risk.level}</span>
                </div>
                <span className="text-2xl font-bold text-foreground font-mono">{risk.count}</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full ${getRiskColor(risk.level)} transition-all duration-500`}
                  style={{ width: `${risk.percentage}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground text-right">{risk.percentage}%</div>
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
