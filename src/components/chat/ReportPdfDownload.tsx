import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generatePdfFromHtml } from "@/utils/htmlToPdf";

interface ReportPdfDownloadProps {
  url: string;
  filename?: string;
}

export const ReportPdfDownload = ({ url, filename }: ReportPdfDownloadProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const downloadAsPdf = async () => {
    if (!url) {
      toast.error("No report URL available — ask Aegis to regenerate the report.");
      return;
    }

    setIsGenerating(true);
    toast.info("Generating PDF — this may take a moment…");

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const status = response.status;
        if (status === 404 || status === 400) {
          toast.error("Report not found — the file may have expired. Please ask Aegis to regenerate the report.");
        } else {
          toast.error(`Failed to fetch report (HTTP ${status}) — please ask Aegis to regenerate.`);
        }
        setIsGenerating(false);
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      const html = await response.text();

      // Basic validation: must contain some HTML-like content
      if (!html || html.trim().length < 50 || (!html.includes("<") && !contentType.includes("html"))) {
        toast.error("Invalid report format — please ask Aegis to regenerate the report.");
        setIsGenerating(false);
        return;
      }

      const pdf = await generatePdfFromHtml(html);

      const pdfFilename = filename
        ? filename.replace(/\.html$/i, ".pdf")
        : `report-${new Date().toISOString().split("T")[0]}.pdf`;

      pdf.save(pdfFilename);
      toast.success("PDF downloaded successfully");
    } catch (error) {
      console.error("PDF generation failed:", error);
      toast.error("PDF generation failed — please ask Aegis to regenerate the report.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={downloadAsPdf}
      disabled={isGenerating}
      className="mt-1 gap-1.5"
    >
      {isGenerating ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Generating PDF…
        </>
      ) : (
        <>
          <FileDown className="w-3.5 h-3.5" />
          Download PDF
        </>
      )}
    </Button>
  );
};
