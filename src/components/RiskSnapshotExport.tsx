import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import DOMPurify from 'dompurify';
import { generatePdfFromHtml } from "@/utils/htmlToPdf";
import { useReportArchive } from "@/hooks/useReportArchive";

// Configure DOMPurify for safe HTML rendering in reports
const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'tr', 'td', 'th', 'div', 'span', 'img', 'style', 'head', 'body', 'html', 'meta', 'a'],
    ALLOWED_ATTR: ['class', 'style', 'src', 'alt', 'width', 'height', 'href', 'charset', 'content'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
  });
};

export const RiskSnapshotExport = () => {
  const [loading, setLoading] = useState(false);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const { persistReport } = useReportArchive();

  // Real, active clients only — sandbox / QA fixture clients (whose
  // names start with `_`) and inactive clients are filtered out so
  // the operator can't accidentally generate a snapshot scoped to
  // QA test fixtures (which would read as "fake data" in the PDF).
  const { data: clients } = useQuery({
    queryKey: ['snapshot-real-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, status')
        .eq('status', 'active')
        .order('name');
      if (error) throw error;
      return (data ?? []).filter((c: any) => typeof c.name === 'string' && !c.name.startsWith('_'));
    },
  });

  const generateReport = async () => {
    setLoading(true);
    try {
      const invokePromise = supabase.functions.invoke("generate-report", {
        body: {
          report_type: "72h-snapshot",
          period_hours: 72,
          // Empty string from the picker = cross-client (all real
          // clients). Anything else = scoped to that specific client.
          client_id: selectedClientId || undefined,
        },
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Report generation timed out after 60s")), 60000)
      );
      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

      if (error) {
        const reason = (data as any)?.message || (data as any)?.error || error.message;
        throw new Error(reason);
      }
      if (!(data as any)?.html) throw new Error("Report returned no content");
      setReportHtml((data as any).html);

      const scopedClientName = selectedClientId
        ? clients?.find((c: any) => c.id === selectedClientId)?.name
        : null;

      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setHours(periodStart.getHours() - 72);
      persistReport.mutate({
        report_type: 'risk_snapshot',
        title: `72-Hour Operational Snapshot${scopedClientName ? ` — ${scopedClientName}` : ''} (${periodEnd.toISOString().split('T')[0]})`,
        client_id: selectedClientId || undefined,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        html_content: data.html,
      });

      toast.success("Operational Snapshot generated and archived");
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error(error instanceof Error ? error.message : "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  const downloadHTML = () => {
    if (!reportHtml) return;
    const periodEnd = new Date();

    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `risk-snapshot-${periodEnd.toISOString().split("T")[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success("HTML report downloaded");
  };

  const downloadPDF = async () => {
    if (!reportHtml) return;

    // Capture the loading toast id so we dismiss exactly that toast on
    // completion. Without an explicit id, sonner's toast.dismiss() can
    // race against subsequent toasts (e.g. a separate success toast
    // fired between save and dismiss) and the loader stays on screen.
    // Belt-and-suspenders: also dismiss inside finally{} so any
    // un-anticipated throw or awaited resolution still kills the loader.
    const loadingId = toast.loading("Generating PDF...");
    try {
      const pdf = await generatePdfFromHtml(reportHtml, { backgroundColor: "#ffffff" });
      const periodEnd = new Date();
      pdf.save(`risk-snapshot-${periodEnd.toISOString().split("T")[0]}.pdf`);
      toast.success("PDF report downloaded");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Failed to generate PDF");
    } finally {
      toast.dismiss(loadingId);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>72-Hour Operational Snapshot</CardTitle>
        <CardDescription>
          Trends + important signals, incidents, and investigations across the last 72 hours.
          Sandbox and QA fixture data are excluded — only real, active client signals are reported.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <label className="text-sm font-medium">Client Scope</label>
          <Select value={selectedClientId || "_all"} onValueChange={(v) => setSelectedClientId(v === "_all" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="All real clients (cross-client)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All real clients (cross-client)</SelectItem>
              {clients?.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={generateReport} disabled={loading} className="w-full">
          <Download className="w-4 h-4 mr-2" />
          {loading ? "Generating..." : "Generate Operational Snapshot"}
        </Button>

        {reportHtml && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadHTML} className="flex-1">
              <Download className="w-4 h-4 mr-2" />
              Download HTML
            </Button>
            <Button variant="outline" onClick={downloadPDF} className="flex-1">
              <FileDown className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
