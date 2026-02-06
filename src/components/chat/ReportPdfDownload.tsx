import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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
      // Fetch the HTML content
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch report (${response.status})`);
      const html = await response.text();

      // Create an offscreen container
      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-9999px";
      container.style.width = "210mm";
      container.style.background = "#ffffff";
      container.innerHTML = html;

      // Strip <html>/<head>/<body> wrappers if present, keep the inner content
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) {
        container.innerHTML = bodyMatch[1];
      }

      // Extract and apply inline <style> blocks
      const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (styleMatch) {
        const styleEl = document.createElement("style");
        styleEl.textContent = styleMatch.map(s => s.replace(/<\/?style[^>]*>/gi, "")).join("\n");
        container.prepend(styleEl);
      }

      document.body.appendChild(container);

      // Wait for images to load
      const images = container.querySelectorAll("img");
      await Promise.allSettled(
        Array.from(images).map(
          (img) => new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
        )
      );

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#0a0a0a", // match dark theme reports
      });

      const imgWidth = 210; // A4 width mm
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      const pdf = new jsPDF("p", "mm", "a4");
      const imgData = canvas.toDataURL("image/jpeg", 0.92);

      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const pdfFilename = filename
        ? filename.replace(/\.html$/i, ".pdf")
        : `report-${new Date().toISOString().split("T")[0]}.pdf`;

      pdf.save(pdfFilename);
      toast.success("PDF downloaded successfully");
    } catch (error) {
      console.error("PDF generation failed:", error);
      toast.error("PDF generation failed — try downloading the HTML version instead");
    } finally {
      // Cleanup offscreen container
      const container = document.querySelector('div[style*="-9999px"]');
      if (container) document.body.removeChild(container);
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
