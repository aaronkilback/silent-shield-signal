import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Clock, Target, TrendingDown, TrendingUp, AlertTriangle, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";
import { formatMinutesToDHM } from "@/lib/timeUtils";

interface MetricProps {
  label: string;
  value: string;
  unit: string;
  trend: "up" | "down" | "neutral";
  trendValue: string;
  icon: React.ReactNode;
  loading?: boolean;
}

const Metric = ({ label, value, unit, trend, trendValue, icon, loading }: MetricProps) => {
  const trendColor = trend === "down" ? "text-status-success" : trend === "up" ? "text-status-error" : "text-muted-foreground";
  const TrendIcon = trend === "down" ? TrendingDown : TrendingUp;

  if (loading) {
    return (
      <Card className="p-6 bg-card border-border">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-secondary rounded w-1/3" />
          <div className="h-8 bg-secondary rounded w-1/2" />
          <div className="h-4 bg-secondary rounded w-1/4" />
        </div>
      </Card>
    );
  }

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
            {trend !== "neutral" && <TrendIcon className="w-4 h-4" />}
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
  const { selectedClientId } = useClientSelection();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    mttd: 0,
    mttr: 0,
    activeTripwires: 0,
    eventsPerHour: 0,
    mttdTrend: 0,
    mttrTrend: 0,
  });

  useEffect(() => {
    if (selectedClientId) {
      loadMetrics();
    }
  }, [selectedClientId]);

  const loadMetrics = async () => {
    if (!selectedClientId) return;
    
    setLoading(true);
    try {
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const previous24Hours = new Date(now.getTime() - 48 * 60 * 60 * 1000);

      // Get incidents for MTTD/MTTR calculation
      const { data: recentIncidents } = await supabase
        .from("incidents")
        .select("opened_at, acknowledged_at, resolved_at")
        .eq("client_id", selectedClientId)
        .gte("opened_at", last24Hours.toISOString())
        .not("acknowledged_at", "is", null);

      const { data: previousIncidents } = await supabase
        .from("incidents")
        .select("opened_at, acknowledged_at, resolved_at")
        .eq("client_id", selectedClientId)
        .gte("opened_at", previous24Hours.toISOString())
        .lt("opened_at", last24Hours.toISOString())
        .not("acknowledged_at", "is", null);

      // Calculate MTTD
      const calculateMTTD = (incidents: any[]) => {
        if (!incidents?.length) return 0;
        const times = incidents
          .filter((i) => i.acknowledged_at)
          .map((i) => {
            const opened = new Date(i.opened_at).getTime();
            const acked = new Date(i.acknowledged_at).getTime();
            return (acked - opened) / 1000 / 60;
          });
        return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
      };

      // Calculate MTTR
      const calculateMTTR = (incidents: any[]) => {
        if (!incidents?.length) return 0;
        const times = incidents
          .filter((i) => i.resolved_at)
          .map((i) => {
            const opened = new Date(i.opened_at).getTime();
            const resolved = new Date(i.resolved_at).getTime();
            return (resolved - opened) / 1000 / 60;
          });
        return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
      };

      const currentMTTD = calculateMTTD(recentIncidents || []);
      const previousMTTD = calculateMTTD(previousIncidents || []);
      const currentMTTR = calculateMTTR(recentIncidents || []);
      const previousMTTR = calculateMTTR(previousIncidents || []);

      // Get active incidents (tripwires)
      const { count: activeTripwires } = await supabase
        .from("incidents")
        .select("*", { count: "exact", head: true })
        .eq("client_id", selectedClientId)
        .in("status", ["open", "acknowledged"]);

      // Get signals in last hour for events/hour
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const { count: eventsLastHour } = await supabase
        .from("signals")
        .select("*", { count: "exact", head: true })
        .eq("client_id", selectedClientId)
        .gte("received_at", oneHourAgo.toISOString());

      // Calculate trends
      const mttdTrend = previousMTTD > 0 ? ((previousMTTD - currentMTTD) / previousMTTD) * 100 : 0;
      const mttrTrend = previousMTTR > 0 ? ((previousMTTR - currentMTTR) / previousMTTR) * 100 : 0;

      setMetrics({
        mttd: currentMTTD,
        mttr: currentMTTR,
        activeTripwires: activeTripwires || 0,
        eventsPerHour: eventsLastHour || 0,
        mttdTrend,
        mttrTrend,
      });
    } catch (error) {
      console.error("Error loading metrics:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatTrend = (trend: number) => {
    if (Math.abs(trend) < 1) return "Stable";
    const direction = trend > 0 ? "faster" : "slower";
    return `${Math.abs(trend).toFixed(0)}% ${direction}`;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Metric
        label="MTTD"
        value={metrics.mttd > 0 ? formatMinutesToDHM(metrics.mttd) : "0m"}
        unit=""
        trend={metrics.mttdTrend > 1 ? "down" : metrics.mttdTrend < -1 ? "up" : "neutral"}
        trendValue={formatTrend(metrics.mttdTrend)}
        icon={<Target className="w-6 h-6" />}
        loading={loading}
      />
      <Metric
        label="MTTR"
        value={metrics.mttr > 0 ? formatMinutesToDHM(metrics.mttr) : "0m"}
        unit=""
        trend={metrics.mttrTrend > 1 ? "down" : metrics.mttrTrend < -1 ? "up" : "neutral"}
        trendValue={formatTrend(metrics.mttrTrend)}
        icon={<Clock className="w-6 h-6" />}
        loading={loading}
      />
      <Metric
        label="Active Tripwires"
        value={metrics.activeTripwires.toString()}
        unit="alerts"
        trend="neutral"
        trendValue={metrics.activeTripwires > 0 ? "Monitoring" : "All clear"}
        icon={<AlertTriangle className="w-6 h-6" />}
        loading={loading}
      />
      <Metric
        label="Events/Hour"
        value={metrics.eventsPerHour.toString()}
        unit="events"
        trend="neutral"
        trendValue="Last hour"
        icon={<Activity className="w-6 h-6" />}
        loading={loading}
      />
    </div>
  );
};
