import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Loader2 } from "lucide-react";
import { format, subDays, eachDayOfInterval } from "date-fns";

interface MatchingTrendChartProps {
  dateRange: string;
}

export function MatchingTrendChart({ dateRange }: MatchingTrendChartProps) {
  const getDays = () => {
    switch (dateRange) {
      case "7d": return 7;
      case "30d": return 30;
      case "90d": return 90;
      default: return 30;
    }
  };

  const { data: trendData, isLoading } = useQuery({
    queryKey: ["matching-trends", dateRange],
    queryFn: async () => {
      const days = getDays();
      const startDate = subDays(new Date(), days);
      
      const { data, error } = await supabase
        .from("signal_correlation_groups")
        .select("*")
        .gte("created_at", startDate.toISOString());

      if (error) throw error;

      // Cast to any for new columns not in types yet
      const items = (data || []) as any[];

      // Generate all days in range
      const interval = eachDayOfInterval({
        start: startDate,
        end: new Date(),
      });

      // Group by date
      const byDate: Record<string, { matched: number; unmatched: number; ai: number }> = {};
      
      interval.forEach(date => {
        const key = format(date, "yyyy-MM-dd");
        byDate[key] = { matched: 0, unmatched: 0, ai: 0 };
      });

      items.forEach(item => {
        const key = format(new Date(item.created_at), "yyyy-MM-dd");
        if (byDate[key]) {
          if (item.match_confidence === "none" || !item.match_confidence) {
            byDate[key].unmatched++;
          } else if (item.match_confidence === "ai") {
            byDate[key].ai++;
            byDate[key].matched++;
          } else if (item.match_confidence !== "dismissed") {
            byDate[key].matched++;
          }
        }
      });

      return Object.entries(byDate).map(([date, values]) => ({
        date: format(new Date(date), "MMM d"),
        ...values,
      }));
    },
  });

  if (isLoading) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!trendData || trendData.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
        No trend data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={trendData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis 
          dataKey="date" 
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis 
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip 
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
          }}
        />
        <Legend />
        <Area 
          type="monotone" 
          dataKey="matched" 
          stackId="1"
          stroke="#22c55e" 
          fill="#22c55e" 
          fillOpacity={0.6}
          name="Matched"
        />
        <Area 
          type="monotone" 
          dataKey="ai" 
          stackId="2"
          stroke="#a855f7" 
          fill="#a855f7" 
          fillOpacity={0.6}
          name="AI Matched"
        />
        <Area 
          type="monotone" 
          dataKey="unmatched" 
          stackId="3"
          stroke="#6b7280" 
          fill="#6b7280" 
          fillOpacity={0.6}
          name="Unmatched"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
