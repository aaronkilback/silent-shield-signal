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
const SECTION_GAP_MM = 2;
const RENDER_WIDTH_PX = 794; // ≈ 210mm at 96dpi

/**
 * Convert a blob to a base64 data URL.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Pre-process images: fetch external URLs as base64 data URIs to bypass CORS.
 * Uses a proxy approach for Supabase storage URLs.
 */
async function preloadImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));

  await Promise.allSettled(
    images.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
        // Wait for already-loading images
        if (!img.complete) {
          await new Promise<void>((r) => {
            img.onload = () => r();
            img.onerror = () => r();
          });
        }
        return;
      }

      try {
        // Try fetching as blob and converting to data URI
        const resp = await fetch(src, { mode: "cors" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const dataUrl = await blobToDataUrl(blob);
        img.src = dataUrl;
        await new Promise<void>((r) => {
          if (img.complete) return r();
          img.onload = () => r();
          img.onerror = () => r();
        });
      } catch {
        // If CORS fails, try no-cors and create an object URL as fallback
        try {
          const resp2 = await fetch(src);
          if (resp2.ok) {
            const blob2 = await resp2.blob();
            const dataUrl2 = await blobToDataUrl(blob2);
            img.src = dataUrl2;
            await new Promise<void>((r) => {
              if (img.complete) return r();
              img.onload = () => r();
              img.onerror = () => r();
            });
          } else {
            img.style.display = "none";
          }
        } catch {
          // Last resort: hide the image so it doesn't taint the canvas
          img.style.display = "none";
        }
      }
    })
  );
}

/**
 * Render sections individually and place them on PDF pages without splitting.
 * Falls back to full-page rendering if no sections are found.
 */
async function renderSectionsToPdf(
  container: HTMLElement,
  pdf: jsPDF,
  scale: number
): Promise<void> {
  const sections = Array.from(
    container.querySelectorAll("[data-pdf-section]")
  ) as HTMLElement[];

  // Fallback: if no sections marked, render entire container as one tall canvas
  if (sections.length === 0) {
    const fullCanvas = await html2canvas(container, {
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: null,
      windowWidth: RENDER_WIDTH_PX,
    });
    addCanvasStrips(pdf, fullCanvas, scale);
    return;
  }

  // Scale factor: how many mm per CSS pixel
  const mmPerPx = CONTENT_WIDTH_MM / RENDER_WIDTH_PX;
  let currentY_mm = 0; // current Y position on page in mm
  let pageIndex = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    // Render this section as its own canvas
    let sectionCanvas: HTMLCanvasElement;
    try {
      sectionCanvas = await html2canvas(section, {
        scale,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: null,
        windowWidth: RENDER_WIDTH_PX,
        // Capture only this element
        x: 0,
        y: section.offsetTop - container.offsetTop,
        width: container.offsetWidth,
        height: section.offsetHeight,
        scrollX: 0,
        scrollY: -(section.offsetTop - container.offsetTop),
      });
    } catch {
      // Skip sections that fail to render
      continue;
    }

    if (sectionCanvas.height === 0) continue;

    const sectionHeightMm =
      (sectionCanvas.height / scale) * mmPerPx;

    // If this section is taller than a full page, slice it into strips
    if (sectionHeightMm > CONTENT_HEIGHT_MM) {
      // If we're not at the top of a page, start a new page
      if (currentY_mm > 0) {
        pdf.addPage();
        pageIndex++;
        currentY_mm = 0;
      }
      addCanvasStrips(pdf, sectionCanvas, scale, pageIndex > 0);
      // After strips, we're on a new page at position 0
      // Actually addCanvasStrips adds its own pages, so we need to track
      const totalStrips = Math.ceil(
        sectionCanvas.height / ((CONTENT_HEIGHT_MM / mmPerPx) * scale)
      );
      pageIndex += totalStrips - 1;
      currentY_mm = 0; // next section starts on new page
      // The last strip may not fill the page, but for simplicity start fresh
      continue;
    }

    // Check if section fits on current page
    if (currentY_mm + sectionHeightMm > CONTENT_HEIGHT_MM) {
      // Doesn't fit — start a new page
      pdf.addPage();
      pageIndex++;
      currentY_mm = 0;
    }

    // Add this section's canvas as an image at the current Y position
    const imgData = sectionCanvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(
      imgData,
      "JPEG",
      MARGIN_MM,
      MARGIN_MM + currentY_mm,
      CONTENT_WIDTH_MM,
      sectionHeightMm
    );

    currentY_mm += sectionHeightMm + SECTION_GAP_MM;
  }
}

/**
 * Slice a tall canvas into page-height strips (fallback for non-sectioned content
 * or sections taller than a page).
 */
function addCanvasStrips(
  pdf: jsPDF,
  sourceCanvas: HTMLCanvasElement,
  scale: number,
  addFirstPage = false
) {
  const mmPerPx = CONTENT_WIDTH_MM / (sourceCanvas.width / scale);
  const pageHeightPx = (CONTENT_HEIGHT_MM / mmPerPx) * scale;

  let offsetY = 0;
  let stripIndex = 0;

  while (offsetY < sourceCanvas.height) {
    const thisStripH = Math.min(pageHeightPx, sourceCanvas.height - offsetY);

    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = sourceCanvas.width;
    sliceCanvas.height = thisStripH;
    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) break;

    ctx.drawImage(
      sourceCanvas,
      0, offsetY, sourceCanvas.width, thisStripH,
      0, 0, sourceCanvas.width, thisStripH
    );

    const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
    const sliceHeightMM = (thisStripH / scale) * mmPerPx;

    if (stripIndex > 0 || addFirstPage) {
      pdf.addPage();
    }

    pdf.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM, CONTENT_WIDTH_MM, sliceHeightMM);

    offsetY += thisStripH;
    stripIndex++;
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
      container.style.width = `${RENDER_WIDTH_PX}px`;
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

      // Pre-process images (CORS handling — convert to base64)
      await preloadImages(container);

      // Allow a paint cycle so styles settle
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300)));

      const scale = 2;

      // Build PDF using section-aware rendering
      const pdf = new jsPDF("p", "mm", "a4");
      await renderSectionsToPdf(container, pdf, scale);

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
