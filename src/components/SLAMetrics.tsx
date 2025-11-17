import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Target } from "lucide-react";
import { useClientSelection } from "@/hooks/useClientSelection";
import { formatMinutesToDHM, formatMinutesToDHMFull } from "@/lib/timeUtils";

interface SLAData {
  avgMTTD: number; // in minutes
  avgMTTR: number; // in minutes
  mttdTarget: number;
  mttrTarget: number;
}

export const SLAMetrics = () => {
  const { selectedClientId } = useClientSelection();
  const [slaData, setSLAData] = useState<SLAData>({
    avgMTTD: 0,
    avgMTTR: 0,
    mttdTarget: 10,
    mttrTarget: 60,
  });

  useEffect(() => {
    if (selectedClientId) {
      fetchSLAMetrics();
    }
  }, [selectedClientId]);

  const fetchSLAMetrics = async () => {
    if (!selectedClientId) return;

    const { data: incidents } = await supabase
      .from("incidents")
      .select("opened_at, acknowledged_at, resolved_at")
      .eq("client_id", selectedClientId)
      .not("acknowledged_at", "is", null);

    if (!incidents || incidents.length === 0) return;

    // Calculate MTTD (Mean Time To Detect) - time from opened to acknowledged
    const mttdValues = incidents
      .filter((i) => i.acknowledged_at)
      .map((i) => {
        const opened = new Date(i.opened_at).getTime();
        const acked = new Date(i.acknowledged_at!).getTime();
        return (acked - opened) / 1000 / 60; // minutes
      });

    // Calculate MTTR (Mean Time To Resolve) - time from opened to resolved
    const mttrValues = incidents
      .filter((i) => i.resolved_at)
      .map((i) => {
        const opened = new Date(i.opened_at).getTime();
        const resolved = new Date(i.resolved_at!).getTime();
        return (resolved - opened) / 1000 / 60; // minutes
      });

    setSLAData({
      avgMTTD: mttdValues.length > 0 ? mttdValues.reduce((a, b) => a + b, 0) / mttdValues.length : 0,
      avgMTTR: mttrValues.length > 0 ? mttrValues.reduce((a, b) => a + b, 0) / mttrValues.length : 0,
      mttdTarget: 10,
      mttrTarget: 60,
    });
  };

  const getMTTDPercentage = () => {
    if (slaData.avgMTTD === 0) return 100;
    return Math.min(100, (slaData.mttdTarget / slaData.avgMTTD) * 100);
  };

  const getMTTRPercentage = () => {
    if (slaData.avgMTTR === 0) return 100;
    return Math.min(100, (slaData.mttrTarget / slaData.avgMTTR) * 100);
  };

  const getStatusColor = (percentage: number) => {
    if (percentage >= 90) return "text-green-500";
    if (percentage >= 70) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5" />
          SLA Performance
        </CardTitle>
        <CardDescription>Service Level Agreement metrics</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span className="font-medium">MTTD (Mean Time To Detect)</span>
            </div>
            <span className={`font-bold ${getStatusColor(getMTTDPercentage())}`}>
              {formatMinutesToDHM(slaData.avgMTTD)} / {formatMinutesToDHM(slaData.mttdTarget)} target
            </span>
          </div>
          <Progress value={getMTTDPercentage()} className="h-2" />
          <p className="text-xs text-muted-foreground">
            Target: Under {formatMinutesToDHMFull(slaData.mttdTarget)}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span className="font-medium">MTTR (Mean Time To Resolve)</span>
            </div>
            <span className={`font-bold ${getStatusColor(getMTTRPercentage())}`}>
              {formatMinutesToDHM(slaData.avgMTTR)} / {formatMinutesToDHM(slaData.mttrTarget)} target
            </span>
          </div>
          <Progress value={getMTTRPercentage()} className="h-2" />
          <p className="text-xs text-muted-foreground">
            Target: Under {formatMinutesToDHMFull(slaData.mttrTarget)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
