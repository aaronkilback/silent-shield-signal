import { Card } from "@/components/ui/card";
import { Clock, Target, TrendingDown, TrendingUp } from "lucide-react";

interface MetricProps {
  label: string;
  value: string;
  unit: string;
  trend: "up" | "down" | "neutral";
  trendValue: string;
  icon: React.ReactNode;
}

const Metric = ({ label, value, unit, trend, trendValue, icon }: MetricProps) => {
  const trendColor = trend === "down" ? "text-status-success" : trend === "up" ? "text-status-error" : "text-muted-foreground";
  const TrendIcon = trend === "down" ? TrendingDown : TrendingUp;

  return (
    <Card className="p-6 bg-card border-border hover:border-primary/30 transition-all duration-200">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground font-mono">{value}</span>
            <span className="text-sm text-muted-foreground">{unit}</span>
          </div>
          <div className={`flex items-center gap-1 text-sm ${trendColor}`}>
            <TrendIcon className="w-4 h-4" />
            <span>{trendValue}</span>
          </div>
        </div>
        <div className="p-3 rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
      </div>
    </Card>
  );
};

export const MetricsPanel = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Metric
        label="MTTD"
        value="2.3"
        unit="min"
        trend="down"
        trendValue="12% faster"
        icon={<Target className="w-6 h-6" />}
      />
      <Metric
        label="MTTR"
        value="8.7"
        unit="min"
        trend="down"
        trendValue="18% faster"
        icon={<Clock className="w-6 h-6" />}
      />
      <Metric
        label="Active Tripwires"
        value="23"
        unit="alerts"
        trend="neutral"
        trendValue="Stable"
        icon={<Target className="w-6 h-6" />}
      />
      <Metric
        label="Events/Hour"
        value="847"
        unit="events"
        trend="up"
        trendValue="6% increase"
        icon={<TrendingUp className="w-6 h-6" />}
      />
    </div>
  );
};
