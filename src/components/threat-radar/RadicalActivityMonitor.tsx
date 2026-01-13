import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertTriangle, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface RadicalActivityMonitorProps {
  intelligenceSummary: any;
  isLoading: boolean;
}

export const RadicalActivityMonitor = ({ intelligenceSummary, isLoading }: RadicalActivityMonitorProps) => {
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const sources = intelligenceSummary?.signals_by_source || {};

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          Radical Activity Monitoring
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-4 h-4 text-red-400" />
              <span className="text-sm text-muted-foreground">Dark Web Signals</span>
            </div>
            <p className="text-2xl font-bold text-red-400">{intelligenceSummary?.dark_web_signals || 0}</p>
          </div>
          <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-4 h-4 text-orange-400" />
              <span className="text-sm text-muted-foreground">Radical Signals</span>
            </div>
            <p className="text-2xl font-bold text-orange-400">{intelligenceSummary?.radical_signals || 0}</p>
          </div>
          <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-muted-foreground">Social Media</span>
            </div>
            <p className="text-2xl font-bold text-blue-400">{intelligenceSummary?.social_media_signals || 0}</p>
          </div>
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-muted-foreground">Infrastructure</span>
            </div>
            <p className="text-2xl font-bold text-yellow-400">{intelligenceSummary?.infrastructure_signals || 0}</p>
          </div>
        </div>
        
        <div className="mt-6">
          <h4 className="font-medium mb-3">Signal Sources</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(sources).map(([source, count]) => (
              <Badge key={source} variant="outline" className="text-sm">
                {source}: {count as number}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
