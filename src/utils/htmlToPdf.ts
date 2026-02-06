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
    // If CORS fails, try without mode
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

  // Create offscreen container
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = `${RENDER_WIDTH_PX}px`;
  container.style.background = bgColor;
  container.style.overflow = "visible";

  // Extract body content if it's a full HTML document
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  container.innerHTML = bodyMatch ? bodyMatch[1] : html;

  // Extract and apply styles
  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  if (styleMatches) {
    const styleEl = document.createElement("style");
    styleEl.textContent = styleMatches
      .map((s) => s.replace(/<\/?style[^>]*>/gi, ""))
      .join("\n");
    container.prepend(styleEl);
  }

  document.body.appendChild(container);

  try {
    // Preload all images as base64
    const images = Array.from(container.querySelectorAll("img"));
    await Promise.allSettled(images.map(safeLoadImage));

    // Let styles settle
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 400)));

    const scale = 2;

    // Render the entire container as one tall canvas
    const fullCanvas = await html2canvas(container, {
      scale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: bgColor,
      windowWidth: RENDER_WIDTH_PX,
      imageTimeout: 10000,
    });

    if (fullCanvas.width === 0 || fullCanvas.height === 0) {
      throw new Error("html2canvas produced an empty canvas");
    }

    // Slice the canvas into A4-sized strips
    const pdf = new jsPDF("p", "mm", "a4");
    const mmPerPx = CONTENT_W_MM / (fullCanvas.width / scale);
    const stripHeightPx = (CONTENT_H_MM / mmPerPx) * scale;

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
      const stripHeightMM = (thisStripH / scale) * mmPerPx;

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

    return pdf;
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
