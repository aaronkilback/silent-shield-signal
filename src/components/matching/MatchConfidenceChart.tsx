import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface MatchConfidenceChartProps {
  data: Record<string, number>;
  labels: Record<string, { label: string; color: string }>;
}

const COLORS = {
  explicit: "#22c55e",
  high: "#10b981",
  medium: "#eab308",
  low: "#f97316",
  ai: "#a855f7",
  manual: "#3b82f6",
  none: "#6b7280",
  dismissed: "#9ca3af",
};

export function MatchConfidenceChart({ data, labels }: MatchConfidenceChartProps) {
  const chartData = Object.entries(data)
    .filter(([_, value]) => value > 0)
    .map(([key, value]) => ({
      name: labels[key]?.label || key,
      value,
      color: COLORS[key as keyof typeof COLORS] || "#6b7280",
    }));

  if (chartData.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
          outerRadius={100}
          fill="#8884d8"
          dataKey="value"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip 
          formatter={(value: number) => [value, "Count"]}
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
          }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
