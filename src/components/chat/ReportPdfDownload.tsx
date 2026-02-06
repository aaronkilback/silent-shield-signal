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

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 12;
const CONTENT_WIDTH_MM = A4_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_HEIGHT_MM = A4_HEIGHT_MM - MARGIN_MM * 2;

/**
 * Pre-process images in a container to handle CORS for external URLs.
 * Replaces external <img> with base64 data URIs so html2canvas can capture them.
 */
async function preloadImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));

  await Promise.allSettled(
    images.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
        if (!img.complete) {
          await new Promise<void>((r) => {
            img.onload = () => r();
            img.onerror = () => r();
          });
        }
        return;
      }

      try {
        const resp = await fetch(src, { mode: "cors" });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const blob = await resp.blob();
        const dataUrl = await blobToDataUrl(blob);
        img.src = dataUrl;
        await new Promise<void>((r) => {
          if (img.complete) return r();
          img.onload = () => r();
          img.onerror = () => r();
        });
      } catch {
        img.style.display = "none";
      }
    })
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Slice a tall canvas into page-height strips and add each as a PDF page.
 * This prevents text from being clipped mid-sentence at page boundaries.
 */
function addCanvasToPages(
  pdf: jsPDF,
  sourceCanvas: HTMLCanvasElement,
  scale: number
) {
  const pxWidth = sourceCanvas.width / scale;
  const pxHeight = sourceCanvas.height / scale;

  // How many CSS px correspond to the printable content area
  const scaleFactor = CONTENT_WIDTH_MM / pxWidth;
  const pageHeightPx = CONTENT_HEIGHT_MM / scaleFactor; // page content height in CSS px
  const stripHeightPx = pageHeightPx * scale; // in canvas px

  const totalCanvasHeight = sourceCanvas.height;
  let offsetY = 0;
  let pageIndex = 0;

  while (offsetY < totalCanvasHeight) {
    const remainingHeight = totalCanvasHeight - offsetY;
    const thisStripH = Math.min(stripHeightPx, remainingHeight);

    // Create a slice canvas for this page
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = sourceCanvas.width;
    sliceCanvas.height = thisStripH;
    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) break;

    ctx.drawImage(
      sourceCanvas,
      0, offsetY,                          // source x, y
      sourceCanvas.width, thisStripH,      // source w, h
      0, 0,                                // dest x, y
      sourceCanvas.width, thisStripH       // dest w, h
    );

    const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
    const sliceHeightMM = (thisStripH / scale) * scaleFactor;

    if (pageIndex > 0) {
      pdf.addPage();
    }

    pdf.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM, CONTENT_WIDTH_MM, sliceHeightMM);

    offsetY += thisStripH;
    pageIndex++;
  }
}

export const ReportPdfDownload = ({ url, filename }: ReportPdfDownloadProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const downloadAsPdf = async () => {
    setIsGenerating(true);
    toast.info("Generating PDF — this may take a moment…");

    let container: HTMLDivElement | null = null;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch report (${response.status})`);
      const html = await response.text();

      // Create offscreen container at fixed A4-equivalent pixel width
      container = document.createElement("div");
      container.id = "__pdf-offscreen";
      container.style.position = "absolute";
      container.style.left = "-9999px";
      container.style.top = "0";
      container.style.width = "794px"; // ≈ 210mm at 96dpi
      container.style.background = "#0a0a0a";

      // Extract body content if wrapped in full HTML doc
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      container.innerHTML = bodyMatch ? bodyMatch[1] : html;

      // Apply inline styles from the HTML
      const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (styleMatch) {
        const styleEl = document.createElement("style");
        styleEl.textContent = styleMatch
          .map((s) => s.replace(/<\/?style[^>]*>/gi, ""))
          .join("\n");
        container.prepend(styleEl);
      }

      document.body.appendChild(container);

      // Pre-process images (CORS handling)
      await preloadImages(container);

      // Allow a paint cycle so styles settle
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 200)));

      const scale = 2;

      // Render the entire document as one tall canvas
      const fullCanvas = await html2canvas(container, {
        scale,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: null,
        windowWidth: 794,
      });

      if (fullCanvas.height === 0) throw new Error("Empty canvas rendered");

      // Build PDF by slicing the tall canvas into page-height strips
      const pdf = new jsPDF("p", "mm", "a4");
      addCanvasToPages(pdf, fullCanvas, scale);

      const pdfFilename = filename
        ? filename.replace(/\.html$/i, ".pdf")
        : `report-${new Date().toISOString().split("T")[0]}.pdf`;

      pdf.save(pdfFilename);
      toast.success("PDF downloaded successfully");
    } catch (error) {
      console.error("PDF generation failed:", error);
      toast.error("PDF generation failed — try the HTML version instead");
    } finally {
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
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
