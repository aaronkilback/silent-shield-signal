import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import DOMPurify from 'dompurify';

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

  const generateReport = async () => {
    setLoading(true);
    try {
      const periodEnd = new Date();
      const { data, error } = await supabase.functions.invoke("generate-report", {
        body: {
          report_type: "72h-snapshot",
          period_hours: 72,
        },
      });

      if (error) throw error;
      setReportHtml(data.html);
      toast.success("72-Hour Risk Snapshot generated successfully");
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

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.width = '210mm';
    container.innerHTML = sanitizeHtml(reportHtml);
    document.body.appendChild(container);

    try {
      toast.loading("Generating PDF...");

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const periodEnd = new Date();
      pdf.save(`risk-snapshot-${periodEnd.toISOString().split("T")[0]}.pdf`);

      toast.dismiss();
      toast.success("PDF report downloaded");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Failed to generate PDF");
    } finally {
      document.body.removeChild(container);
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
      <CardContent className="space-y-3">
        <Button onClick={generateReport} disabled={loading} className="w-full">
          <Download className="w-4 h-4 mr-2" />
          {loading ? "Generating..." : "Generate Risk Snapshot"}
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
