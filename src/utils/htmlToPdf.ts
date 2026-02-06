import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 12;
const CONTENT_W_MM = A4_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_H_MM = A4_HEIGHT_MM - MARGIN_MM * 2;
const RENDER_WIDTH_PX = 794;

/**
 * Convert an image element's src to a base64 data URI to bypass CORS.
 * Hides the image if conversion fails.
 */
async function safeLoadImage(img: HTMLImageElement): Promise<void> {
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
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    img.src = dataUrl;
    if (!img.complete) {
      await new Promise<void>((r) => {
        img.onload = () => r();
        img.onerror = () => r();
      });
    }
  } catch {
    try {
      const resp2 = await fetch(src);
      if (!resp2.ok) throw new Error();
      const blob2 = await resp2.blob();
      const dataUrl2 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob2);
      });
      img.src = dataUrl2;
      if (!img.complete) {
        await new Promise<void>((r) => {
          img.onload = () => r();
          img.onerror = () => r();
        });
      }
    } catch {
      img.style.display = "none";
    }
  }
}

/**
 * Prepare an offscreen container with the report HTML, preload images,
 * render to canvas, slice into A4 pages, and return a jsPDF instance.
 */
export async function generatePdfFromHtml(
  html: string,
  options?: { backgroundColor?: string }
): Promise<jsPDF> {
  const bgColor = options?.backgroundColor ?? "#0a0a0a";

  // Build a full override stylesheet that nukes ALL height/overflow constraints
  const overrideCSS = `
    *, *::before, *::after {
      overflow: visible !important;
      max-height: none !important;
      height: auto !important;
    }
    html, body {
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
      max-height: none !important;
    }
    /* Preserve image dimensions */
    img, svg, canvas, video {
      height: auto !important;
      max-width: 100% !important;
      overflow: hidden !important;
    }
    /* Preserve table cell heights */
    td, th {
      height: auto !important;
    }
  `;

  // Create container — NOT offscreen with left:-9999px which can cause
  // rendering issues. Instead use fixed positioning behind everything.
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: ${RENDER_WIDTH_PX}px;
    z-index: -9999;
    opacity: 0;
    pointer-events: none;
    background: ${bgColor};
    overflow: visible;
    height: auto;
    max-height: none;
  `;

  // Extract body content if it's a full HTML document
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Extract styles from the HTML
  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  const extractedStyles = (styleMatches || [])
    .map((s) => s.replace(/<\/?style[^>]*>/gi, ""))
    .join("\n");

  // Inject styles + override + content
  container.innerHTML = `
    <style>${extractedStyles}\n${overrideCSS}</style>
    ${bodyContent}
  `;

  document.body.appendChild(container);

  try {
    // Preload all images as base64 to avoid CORS/tainted canvas
    const images = Array.from(container.querySelectorAll("img"));
    await Promise.allSettled(images.map(safeLoadImage));

    // Let layout settle after images load
    await new Promise((r) => setTimeout(r, 500));
    // Force a reflow
    void container.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 500)));

    // Measure the ACTUAL rendered height
    const actualHeight = container.scrollHeight;
    console.log(`[PDF] Container scrollHeight: ${actualHeight}px`);

    if (actualHeight < 100) {
      console.warn("[PDF] Container height suspiciously low, forcing min-height");
    }

    // Explicitly set the container height to match its scrollHeight
    // so html2canvas knows the full extent
    container.style.height = `${actualHeight}px`;
    container.style.opacity = "0.001"; // near-invisible but still rendered

    // Another settle after height fix
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300)));

    const scale = 2;

    // Render the entire container as one tall canvas
    const fullCanvas = await html2canvas(container, {
      scale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: bgColor,
      width: RENDER_WIDTH_PX,
      height: actualHeight,
      windowWidth: RENDER_WIDTH_PX,
      windowHeight: actualHeight,
      imageTimeout: 15000,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
    });

    console.log(`[PDF] Canvas size: ${fullCanvas.width}x${fullCanvas.height}`);

    if (fullCanvas.width === 0 || fullCanvas.height === 0) {
      throw new Error("html2canvas produced an empty canvas");
    }

    // Slice the canvas into A4-sized strips
    const pdf = new jsPDF("p", "mm", "a4");
    const pxPerMm = fullCanvas.width / CONTENT_W_MM;
    const stripHeightPx = Math.floor(CONTENT_H_MM * pxPerMm);

    let offsetY = 0;
    let pageIdx = 0;

    while (offsetY < fullCanvas.height) {
      const thisStripH = Math.min(stripHeightPx, fullCanvas.height - offsetY);

      const stripCanvas = document.createElement("canvas");
      stripCanvas.width = fullCanvas.width;
      stripCanvas.height = thisStripH;
      const ctx = stripCanvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas 2d context");

      ctx.drawImage(
        fullCanvas,
        0, offsetY, fullCanvas.width, thisStripH,
        0, 0, fullCanvas.width, thisStripH
      );

      const imgData = stripCanvas.toDataURL("image/jpeg", 0.92);
      const stripHeightMM = thisStripH / pxPerMm;

      if (pageIdx > 0) {
        pdf.addPage();
      }

      pdf.addImage(
        imgData,
        "JPEG",
        MARGIN_MM,
        MARGIN_MM,
        CONTENT_W_MM,
        stripHeightMM
      );

      offsetY += thisStripH;
      pageIdx++;
    }

    console.log(`[PDF] Generated ${pageIdx} pages`);
    return pdf;
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
