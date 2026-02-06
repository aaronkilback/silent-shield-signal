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
    setIsGenerating(true);
    toast.info("Generating PDF — this may take a moment…");

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const status = response.status;
        if (status === 404 || status === 400) {
          toast.error("Report not found — the file may have expired. Please ask Aegis to regenerate the report.");
          setIsGenerating(false);
          return;
        }
        throw new Error(`Failed to fetch report (HTTP ${status})`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        toast.error("Invalid report format — please ask Aegis to regenerate the report.");
        setIsGenerating(false);
        return;
      }
      const html = await response.text();

      const pdf = await generatePdfFromHtml(html);

      const pdfFilename = filename
        ? filename.replace(/\.html$/i, ".pdf")
        : `report-${new Date().toISOString().split("T")[0]}.pdf`;

      pdf.save(pdfFilename);
      toast.success("PDF downloaded successfully");
    } catch (error) {
      console.error("PDF generation failed:", error);
      toast.error("PDF generation failed — try the HTML version instead");
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
