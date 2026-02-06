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
const SECTION_GAP_MM = 3;

/**
 * Pre-process images in a container to handle CORS for external URLs.
 * Replaces external <img> elements with canvas-rendered data: URIs so
 * html2canvas can capture them without tainted-canvas errors.
 */
async function preloadImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));

  await Promise.allSettled(
    images.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
        // Already inline — just wait for load
        if (!img.complete) {
          await new Promise<void>((r) => {
            img.onload = () => r();
            img.onerror = () => r();
          });
        }
        return;
      }

      // External image — fetch as blob, convert to data URI
      try {
        const resp = await fetch(src, { mode: "cors" });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const blob = await resp.blob();
        const dataUrl = await blobToDataUrl(blob);
        img.src = dataUrl;
        // Wait for the new src to settle
        await new Promise<void>((r) => {
          if (img.complete) return r();
          img.onload = () => r();
          img.onerror = () => r();
        });
      } catch {
        // Hide broken images so they don't leave blank space
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
 * Identify logical sections inside the rendered HTML.
 * The bulletin template marks sections with `data-pdf-section`.
 * Falls back to direct children of `.content` and other top-level blocks.
 */
function getSections(container: HTMLElement): HTMLElement[] {
  // Prefer explicitly marked sections
  const marked = Array.from(
    container.querySelectorAll("[data-pdf-section]")
  ) as HTMLElement[];
  if (marked.length > 0) return marked;

  // Fallback: treat each direct child of the page as a section
  const page = container.querySelector(".page") as HTMLElement | null;
  if (page) {
    return Array.from(page.children).filter(
      (el) => el instanceof HTMLElement
    ) as HTMLElement[];
  }

  return [container];
}

export const ReportPdfDownload = ({ url, filename }: ReportPdfDownloadProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const downloadAsPdf = async () => {
    setIsGenerating(true);
    toast.info("Generating PDF — this may take a moment…");

    let container: HTMLDivElement | null = null;

    try {
      // Fetch the HTML content
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch report (${response.status})`);
      const html = await response.text();

      // Create an offscreen container at a fixed pixel width that maps to A4
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
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)));

      // Capture each section individually
      const sections = getSections(container);
      const scale = 2;

      const captures: { imgData: string; heightMM: number }[] = [];

      for (const section of sections) {
        try {
          const canvas = await html2canvas(section, {
            scale,
            useCORS: true,
            allowTaint: false,
            logging: false,
            backgroundColor: null, // transparent — inherit from parent
          });

          const pxWidth = canvas.width / scale;
          const scaleFactor = CONTENT_WIDTH_MM / pxWidth;
          const heightMM = (canvas.height / scale) * scaleFactor;

          captures.push({
            imgData: canvas.toDataURL("image/jpeg", 0.92),
            heightMM,
          });
        } catch (err) {
          console.warn("Section capture failed, skipping:", err);
        }
      }

      if (captures.length === 0) throw new Error("No sections captured");

      // Build PDF page by page, never splitting a section
      const pdf = new jsPDF("p", "mm", "a4");
      let currentY = MARGIN_MM;

      for (let i = 0; i < captures.length; i++) {
        const { imgData, heightMM } = captures[i];
        const remaining = A4_HEIGHT_MM - MARGIN_MM - currentY;

        // If it won't fit AND we're not at the top of a fresh page, start a new page
        if (heightMM > remaining && currentY > MARGIN_MM) {
          pdf.addPage();
          currentY = MARGIN_MM;
        }

        // If a single section is taller than a full page, it'll overflow — place it anyway
        pdf.addImage(imgData, "JPEG", MARGIN_MM, currentY, CONTENT_WIDTH_MM, heightMM);
        currentY += heightMM + SECTION_GAP_MM;
      }

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
