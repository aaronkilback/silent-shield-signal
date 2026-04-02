import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 12;
const CONTENT_W_MM = A4_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_H_MM = A4_HEIGHT_MM - MARGIN_MM * 2;
const RENDER_WIDTH_PX = 794;

// All CSS custom properties used by the app's dark theme.
// We set these to light values directly on the render container so they
// override the :root dark values for every descendant element.
const LIGHT_MODE_VARS: [string, string][] = [
  ["--background", "0 0% 100%"],
  ["--foreground", "0 0% 7%"],
  ["--card", "0 0% 100%"],
  ["--card-foreground", "0 0% 7%"],
  ["--popover", "0 0% 100%"],
  ["--popover-foreground", "0 0% 7%"],
  ["--primary", "189 95% 40%"],
  ["--primary-foreground", "0 0% 100%"],
  ["--secondary", "0 0% 96%"],
  ["--secondary-foreground", "0 0% 9%"],
  ["--muted", "0 0% 96%"],
  ["--muted-foreground", "0 0% 45%"],
  ["--accent", "0 0% 96%"],
  ["--accent-foreground", "0 0% 9%"],
  ["--destructive", "0 84% 60%"],
  ["--destructive-foreground", "0 0% 100%"],
  ["--border", "0 0% 89%"],
  ["--input", "0 0% 89%"],
  ["--ring", "0 0% 40%"],
];

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

    for (const el of elements) {
      if (el.top < pageEnd && el.bottom > pageEnd) {
        const elementHeight = el.bottom - el.top;
        const lastBreak = breakPoints[breakPoints.length - 1] ?? 0;
        if (elementHeight < stripHeightPx * 0.5 && el.top > lastBreak + 40) {
          breakAt = el.top - 4;
        }
        break;
      }
    }

    const lastBreak = breakPoints[breakPoints.length - 1] ?? 0;
    breakAt = Math.max(breakAt, lastBreak + Math.floor(stripHeightPx * 0.5));

    breakPoints.push(Math.floor(breakAt));
    pageEnd = Math.floor(breakAt) + stripHeightPx;
  }

  return breakPoints;
}

/**
 * Render report HTML to a multi-page jsPDF.
 *
 * The app uses Tailwind dark-mode CSS variables at :root (--background: 222 47% 5%).
 * CSS custom properties are inherited — any div appended to document.body inherits
 * dark values for all descendants. We defeat this by setting all CSS vars to their
 * light equivalents directly on the render container, overriding :root for the
 * entire subtree.
 */
export async function generatePdfFromHtml(
  html: string,
  options?: { backgroundColor?: string }
): Promise<jsPDF> {
  const bgColor = options?.backgroundColor ?? "#ffffff";

  const container = document.createElement("div");
  container.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    `width:${RENDER_WIDTH_PX}px`,
    "height:auto",
    "max-height:none",
    "overflow:visible",
    "opacity:0",
    "pointer-events:none",
    "z-index:-9999",
    "transform:none",
    "direction:ltr",
    "writing-mode:horizontal-tb",
    `background:${bgColor}`,
    "color:#111111",
    "color-scheme:light",
  ].join(";");

  // Override every dark-mode CSS variable so descendants use light values
  for (const [prop, val] of LIGHT_MODE_VARS) {
    container.style.setProperty(prop, val);
  }

  // Extract body content from full HTML document
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  container.innerHTML = bodyMatch ? bodyMatch[1] : html;

  // Inject the report's own styles + layout overrides
  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  const overrideCSS = `
    .page, .report-container, .bulletin-container, .content, body, html {
      overflow: visible !important;
      max-height: none !important;
      min-height: 0 !important;
    }
    * { transform: none !important; }
    @page { size: auto; margin: 0; }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = (styleMatches || [])
    .map((s) => s.replace(/<\/?style[^>]*>/gi, ""))
    .join("\n") + "\n" + overrideCSS;
  container.prepend(styleEl);

  document.body.appendChild(container);

  try {
    // Preload all images as base64
    const images = Array.from(container.querySelectorAll("img"));
    await Promise.allSettled(images.map(safeLoadImage));

    // Unlock overflow on clipping elements
    container.querySelectorAll("div, section, article, main").forEach((el) => {
      const htmlEl = el as HTMLElement;
      const computed = window.getComputedStyle(htmlEl);
      if (computed.overflow === "hidden" || computed.maxHeight !== "none") {
        htmlEl.style.overflow = "visible";
        htmlEl.style.maxHeight = "none";
      }
    });

    // Let styles settle
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 500)));
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300)));

    container.style.opacity = "1";
    container.style.visibility = "visible";

    const actualHeight = container.scrollHeight;
    console.log(`[PDF] Container scrollHeight: ${actualHeight}px`);

    const scale = 1.5;

    const fullCanvas = await html2canvas(container, {
      scale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: bgColor,
      windowWidth: RENDER_WIDTH_PX,
      height: actualHeight,
      imageTimeout: 15000,
      onclone: (clonedDoc) => {
        // Override dark-mode CSS variables at the root of the CLONED document.
        // html2canvas renders the clone, not the live DOM — so this is the only
        // place where overriding :root variables actually takes effect for rendering.
        const root = clonedDoc.documentElement;
        root.style.background = "white";
        root.style.color = "#111111";
        clonedDoc.body.style.background = "white";
        clonedDoc.body.style.color = "#111111";
        for (const [prop, val] of LIGHT_MODE_VARS) {
          root.style.setProperty(prop, val);
        }
      },
    });

    console.log(`[PDF] Canvas size: ${fullCanvas.width}x${fullCanvas.height}`);

    if (fullCanvas.width === 0 || fullCanvas.height === 0) {
      throw new Error("html2canvas produced an empty canvas");
    }

    const pdf = new jsPDF("p", "mm", "a4");
    const pxPerMm = fullCanvas.width / CONTENT_W_MM;
    const stripHeightPx = Math.floor(CONTENT_H_MM * pxPerMm);

    const breakPoints = findSmartBreakPoints(container, fullCanvas.height, stripHeightPx, scale);
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
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
