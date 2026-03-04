import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Loader2 } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { format, startOfWeek, parseISO } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";

interface WeeklyPoint {
  week: string;
  score: number;
  label: string;
}

export function RiskTrendChart() {
  const { selectedClientId } = useClientSelection();

  const { data: weeklyData = [], isLoading } = useQuery({
    queryKey: ["risk-trend-12w", selectedClientId],
    queryFn: async () => {
      let query = supabase
        .from("threat_radar_snapshots")
        .select("created_at, overall_score, threat_level")
        .order("created_at", { ascending: false })
        .limit(84); // 12 weeks × 7 days

      if (selectedClientId) {
        query = query.eq("client_id", selectedClientId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Group by week
      const weekMap = new Map<string, { total: number; count: number }>();
      (data || []).forEach((row: any) => {
        const weekStart = startOfWeek(parseISO(row.created_at), { weekStartsOn: 1 });
        const key = weekStart.toISOString();
        const existing = weekMap.get(key) || { total: 0, count: 0 };
        weekMap.set(key, {
          total: existing.total + (row.overall_score || 0),
          count: existing.count + 1,
        });
      });

      // Convert to sorted array (oldest first)
      const points: WeeklyPoint[] = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([key, { total, count }]) => ({
          week: key,
          score: Math.round(total / count),
          label: format(parseISO(key), "MMM d"),
        }));

      return points;
    },
    refetchInterval: 300000,
  });

  const getLineColor = () => {
    if (weeklyData.length < 2) return "#6366f1";
    const first = weeklyData[0]?.score ?? 0;
    const last = weeklyData[weeklyData.length - 1]?.score ?? 0;
    if (last < first) return "#22c55e"; // improving
    if (last > first + 5) return "#ef4444"; // worsening
    return "#f59e0b"; // stable
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          12-Week Risk Trend
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : weeklyData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            No threat snapshot data available yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={weeklyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: 12,
                }}
                formatter={(value: number) => [`${value}`, "Threat Score"]}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke={getLineColor()}
                strokeWidth={2}
                dot={{ r: 3, fill: getLineColor() }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
