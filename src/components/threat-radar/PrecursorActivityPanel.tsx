import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PrecursorActivityPanelProps {
  precursors: any[];
  isLoading: boolean;
}

export const PrecursorActivityPanel = ({ precursors, isLoading }: PrecursorActivityPanelProps) => {
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-primary" />
          Active Precursor Indicators
        </CardTitle>
      </CardHeader>
      <CardContent>
        {precursors?.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {precursors.map((p: any) => (
              <div key={p.id} className="p-4 rounded-lg bg-secondary/30 border border-border/50">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium">{p.indicator_name}</h4>
                  <Badge variant={p.severity_level === 'critical' ? 'destructive' : 'secondary'}>
                    {p.severity_level}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{p.description}</p>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{p.indicator_type}</Badge>
                  <Badge variant="outline">{p.threat_category}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">No active precursor indicators detected</p>
        )}
      </CardContent>
    </Card>
  );
};
