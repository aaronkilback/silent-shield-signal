import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Radar } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ThreatRadarVisualizationProps {
  data: any;
  isLoading: boolean;
}

export const ThreatRadarVisualization = ({ data, isLoading }: ThreatRadarVisualizationProps) => {
  const scores = data?.threat_assessment?.scores || {};
  
  const radarPoints = [
    { label: 'Radical', value: scores.radical_activity || 0, angle: 0 },
    { label: 'Sentiment', value: scores.sentiment_volatility || 0, angle: 90 },
    { label: 'Precursor', value: scores.precursor_activity || 0, angle: 180 },
    { label: 'Infrastructure', value: scores.infrastructure_risk || 0, angle: 270 },
  ];

  const getPointPosition = (value: number, angle: number, radius: number = 120) => {
    const normalizedValue = (value / 100) * radius;
    const radian = (angle - 90) * (Math.PI / 180);
    return {
      x: 150 + normalizedValue * Math.cos(radian),
      y: 150 + normalizedValue * Math.sin(radian)
    };
  };

  const polygonPoints = radarPoints
    .map(p => getPointPosition(p.value, p.angle))
    .map(p => `${p.x},${p.y}`)
    .join(' ');

  return (
    <Card className="border-border/50 h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radar className="w-5 h-5 text-primary" />
          Threat Landscape
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-80">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="relative">
            <svg viewBox="0 0 300 300" className="w-full max-w-md mx-auto">
              {/* Background circles */}
              {[25, 50, 75, 100].map(r => (
                <circle
                  key={r}
                  cx="150"
                  cy="150"
                  r={r * 1.2}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.1}
                  strokeWidth="1"
                />
              ))}
              {/* Axis lines */}
              {radarPoints.map((p, i) => {
                const end = getPointPosition(100, p.angle);
                return (
                  <line
                    key={i}
                    x1="150"
                    y1="150"
                    x2={end.x}
                    y2={end.y}
                    stroke="currentColor"
                    strokeOpacity={0.2}
                    strokeWidth="1"
                  />
                );
              })}
              {/* Data polygon */}
              <polygon
                points={polygonPoints}
                fill="hsl(var(--primary))"
                fillOpacity={0.3}
                stroke="hsl(var(--primary))"
                strokeWidth="2"
              />
              {/* Data points */}
              {radarPoints.map((p, i) => {
                const pos = getPointPosition(p.value, p.angle);
                return (
                  <circle
                    key={i}
                    cx={pos.x}
                    cy={pos.y}
                    r="6"
                    fill="hsl(var(--primary))"
                  />
                );
              })}
              {/* Labels */}
              {radarPoints.map((p, i) => {
                const pos = getPointPosition(115, p.angle);
                return (
                  <text
                    key={i}
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-foreground text-xs font-medium"
                  >
                    {p.label}
                  </text>
                );
              })}
            </svg>
            
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                <span className="text-muted-foreground">Total Signals</span>
                <Badge variant="outline">{data?.intelligence_summary?.total_signals || 0}</Badge>
              </div>
              <div className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                <span className="text-muted-foreground">Dark Web</span>
                <Badge variant="outline">{data?.intelligence_summary?.dark_web_signals || 0}</Badge>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
