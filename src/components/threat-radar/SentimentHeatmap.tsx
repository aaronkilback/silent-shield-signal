import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SentimentHeatmapProps {
  geoIntelligence: any;
  isLoading: boolean;
}

export const SentimentHeatmap = ({ geoIntelligence, isLoading }: SentimentHeatmapProps) => {
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const hotspots = geoIntelligence?.hotspots || [];

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          Geo-Located Threat Hotspots
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hotspots.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {hotspots.slice(0, 12).map((spot: any, i: number) => (
              <div key={i} className="p-3 rounded-lg bg-secondary/30 border border-border/50">
                <p className="font-medium text-sm">{spot.location || 'Unknown Location'}</p>
                <div className="flex gap-2 mt-2">
                  <Badge variant={spot.severity === 'critical' ? 'destructive' : 'secondary'}>
                    {spot.severity}
                  </Badge>
                  <Badge variant="outline">{spot.category}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">No geo-located intelligence available</p>
        )}
      </CardContent>
    </Card>
  );
};
