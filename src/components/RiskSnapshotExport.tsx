import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
  const { persistReport } = useReportArchive();

  const generateReport = async () => {
    setLoading(true);
    try {
      const genDate = new Date();
      const invokePromise = supabase.functions.invoke("generate-report", {
        body: { report_type: "72h-snapshot", period_hours: 72 },
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
      
      // Auto-archive
      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setHours(periodStart.getHours() - 72);
      persistReport.mutate({
        report_type: 'risk_snapshot',
        title: `72-Hour Vulnerability Snapshot (${periodEnd.toISOString().split('T')[0]})`,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        html_content: data.html,
      });
      
      toast.success("Vulnerability Snapshot generated and archived");
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Failed to generate report");
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

    try {
      toast.loading("Generating PDF...");
      const pdf = await generatePdfFromHtml(reportHtml, { backgroundColor: "#ffffff" });
      const periodEnd = new Date();
      pdf.save(`risk-snapshot-${periodEnd.toISOString().split("T")[0]}.pdf`);
      toast.dismiss();
      toast.success("PDF report downloaded");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.dismiss();
      toast.error("Failed to generate PDF");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>72-Hour Vulnerability Snapshot</CardTitle>
        <CardDescription>
          Export a comprehensive vulnerability report for the last 72 hours
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={generateReport} disabled={loading} className="w-full">
          <Download className="w-4 h-4 mr-2" />
          {loading ? "Generating..." : "Generate Vulnerability Snapshot"}
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
