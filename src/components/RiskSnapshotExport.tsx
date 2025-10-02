import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const RiskSnapshotExport = () => {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - 72 * 60 * 60 * 1000); // 72 hours ago

      const { data, error } = await supabase.functions.invoke("generate-report", {
        body: {
          type: "72h-snapshot",
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
        },
      });

      if (error) throw error;

      // Create and download HTML report
      const blob = new Blob([data.html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `risk-snapshot-${periodEnd.toISOString().split("T")[0]}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("72-Hour Risk Snapshot exported successfully");
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>72-Hour Risk Snapshot</CardTitle>
        <CardDescription>
          Export a comprehensive risk report for the last 72 hours
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleExport} disabled={loading} className="w-full">
          <Download className="w-4 h-4 mr-2" />
          {loading ? "Generating..." : "Export Risk Snapshot"}
        </Button>
      </CardContent>
    </Card>
  );
};
