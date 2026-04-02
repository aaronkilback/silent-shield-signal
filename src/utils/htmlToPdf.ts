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
 * Walk the DOM to find break points that don't cut through block elements.
 * Returns an array of canvas-pixel Y positions where page breaks should occur.
 */
function findSmartBreakPoints(
  container: HTMLElement,
  canvasHeight: number,
  stripHeightPx: number,
  scale: number
): number[] {
  const containerRect = container.getBoundingClientRect();

  // Collect block elements with their canvas-pixel positions
  const elements = Array.from(
    container.querySelectorAll("h1,h2,h3,h4,h5,h6,p,img,table,tr,ul,ol,li,div,section,article")
  ).map((el) => {
    const rect = (el as HTMLElement).getBoundingClientRect();
    return {
      top: Math.round((rect.top - containerRect.top) * scale),
      bottom: Math.round((rect.bottom - containerRect.top) * scale),
    };
  }).filter((el) => el.bottom > el.top && el.bottom > 0 && el.top < canvasHeight);

  const breakPoints: number[] = [];
  let pageEnd = stripHeightPx;

  while (pageEnd < canvasHeight) {
    let breakAt = pageEnd;

    // Find the first element that straddles this page boundary
    for (const el of elements) {
      if (el.top < pageEnd && el.bottom > pageEnd) {
        const elementHeight = el.bottom - el.top;
        const lastBreak = breakPoints[breakPoints.length - 1] ?? 0;
        // Only move the break upward if the element is not taller than half a page
        // and there's enough space above it from the previous break
        if (elementHeight < stripHeightPx * 0.5 && el.top > lastBreak + 40) {
          breakAt = el.top - 4;
        }
        break;
      }
    }

    // Safety: always advance by at least 50% of a page to avoid infinite loops
    const lastBreak = breakPoints[breakPoints.length - 1] ?? 0;
    breakAt = Math.max(breakAt, lastBreak + Math.floor(stripHeightPx * 0.5));

    breakPoints.push(Math.floor(breakAt));
    pageEnd = Math.floor(breakAt) + stripHeightPx;
  }

  return breakPoints;
}

/**
 * Render the report HTML inside an isolated iframe (no parent-page CSS leakage),
 * capture via html2canvas, slice into A4 pages at smart break points,
 * and return a jsPDF instance.
 *
 * Using an iframe is critical: the app uses Tailwind dark-mode CSS variables
 * (--background: 222 47% 5%) that bleed into any div appended to document.body,
 * making the PDF render black even when the report HTML specifies white backgrounds.
 * An iframe has its own browsing context — the parent page's CSS never applies.
 */
export async function generatePdfFromHtml(
  html: string,
  options?: { backgroundColor?: string }
): Promise<jsPDF> {
  const bgColor = options?.backgroundColor ?? "#ffffff";

  const iframe = document.createElement("iframe");
  iframe.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    `width:${RENDER_WIDTH_PX}px`,
    "height:1px",
    "opacity:0",
    "pointer-events:none",
    "z-index:-9999",
    "border:none",
    "overflow:hidden",
  ].join(";");

  document.body.appendChild(iframe);

  try {
    const iframeDoc = iframe.contentDocument!;
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    // Wait for iframe content to fully load
    await new Promise<void>((resolve) => {
      if (iframeDoc.readyState === "complete") { resolve(); return; }
      iframe.onload = () => resolve();
      setTimeout(resolve, 3000); // fallback
    });
    // Extra settle time for fonts and layout
    await new Promise((r) => setTimeout(r, 700));

    const body = iframeDoc.body;
    body.style.margin = "0";
    body.style.padding = "0";
    body.style.overflow = "visible";

    // Unlock overflow on clipping elements
    iframeDoc.querySelectorAll("div, section, article, main").forEach((el) => {
      const htmlEl = el as HTMLElement;
      const win = iframeDoc.defaultView;
      if (!win) return;
      const computed = win.getComputedStyle(htmlEl);
      if (computed.overflow === "hidden" || computed.maxHeight !== "none") {
        htmlEl.style.overflow = "visible";
        htmlEl.style.maxHeight = "none";
      }
    });

    // Preload all images as base64
    const images = Array.from(iframeDoc.querySelectorAll("img"));
    await Promise.allSettled(images.map(safeLoadImage));

    // Expand iframe height to full content height for correct measurements
    const actualHeight = body.scrollHeight;
    iframe.style.height = `${actualHeight}px`;
    console.log(`[PDF] iframe content height: ${actualHeight}px`);

    // Let layout re-settle after height change
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300)));

    const scale = 1.5;

    const fullCanvas = await html2canvas(body, {
      scale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: bgColor,
      windowWidth: RENDER_WIDTH_PX,
      height: actualHeight,
      imageTimeout: 15000,
    });

    console.log(`[PDF] Canvas size: ${fullCanvas.width}x${fullCanvas.height}`);

    if (fullCanvas.width === 0 || fullCanvas.height === 0) {
      throw new Error("html2canvas produced an empty canvas");
    }

    const pdf = new jsPDF("p", "mm", "a4");
    const pxPerMm = fullCanvas.width / CONTENT_W_MM;
    const stripHeightPx = Math.floor(CONTENT_H_MM * pxPerMm);

    // Find smart break points that don't cut through elements
    const breakPoints = findSmartBreakPoints(body, fullCanvas.height, stripHeightPx, scale);
    const allBreaks = [...breakPoints, fullCanvas.height];

    console.log(`[PDF] Page breaks at: ${breakPoints.join(", ")} (canvas px)`);

    let offsetY = 0;
    let pageIdx = 0;

    for (const breakPoint of allBreaks) {
      if (breakPoint <= offsetY) continue;
      const thisStripH = breakPoint - offsetY;
      if (thisStripH <= 0) continue;

      const stripCanvas = document.createElement("canvas");
      stripCanvas.width = fullCanvas.width;
      stripCanvas.height = thisStripH;
      const ctx = stripCanvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas 2d context");

      // Fill background before drawing — required for correct JPEG output
      // (JPEG has no alpha channel; unfilled areas become black)
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, stripCanvas.width, thisStripH);
      ctx.drawImage(
        fullCanvas,
        0, offsetY, fullCanvas.width, thisStripH,
        0, 0, fullCanvas.width, thisStripH
      );

      const imgData = stripCanvas.toDataURL("image/jpeg", 0.85);
      const stripHeightMM = thisStripH / pxPerMm;

      if (pageIdx > 0) pdf.addPage();

      pdf.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM, CONTENT_W_MM, stripHeightMM);

      offsetY = breakPoint;
      pageIdx++;
    }

    console.log(`[PDF] Generated ${pageIdx} pages`);
    return pdf;
  } finally {
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }
}
