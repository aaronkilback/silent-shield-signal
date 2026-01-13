import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

interface ThreatTimelineChartProps {
  snapshots: any[];
  isLoading: boolean;
}

export const ThreatTimelineChart = ({ snapshots, isLoading }: ThreatTimelineChartProps) => {
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const chartData = snapshots?.slice(0, 20).reverse().map((s: any) => ({
    time: format(new Date(s.created_at), 'MMM d HH:mm'),
    overall: s.threat_score,
    radical: s.radical_activity_score,
    infrastructure: s.infrastructure_risk_score,
  })) || [];

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          Threat Score Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Line type="monotone" dataKey="overall" stroke="hsl(var(--primary))" strokeWidth={2} name="Overall" />
                <Line type="monotone" dataKey="radical" stroke="#ef4444" strokeWidth={1.5} name="Radical" />
                <Line type="monotone" dataKey="infrastructure" stroke="#f59e0b" strokeWidth={1.5} name="Infrastructure" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">No historical data available</p>
        )}
      </CardContent>
    </Card>
  );
};
