import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 12;
const CONTENT_W_MM = A4_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_H_MM = A4_HEIGHT_MM - MARGIN_MM * 2;
const RENDER_WIDTH_PX = 794;

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

async function safeLoadImage(img: HTMLImageElement): Promise<void> {
  const src = img.getAttribute("src") || "";
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
    if (!img.complete) {
      await new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); });
    }
    return;
  }
  try {
    const resp = await fetch(src, { mode: "cors" });
    if (!resp.ok) throw new Error();
    const blob = await resp.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    img.src = dataUrl;
    if (!img.complete) {
      await new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); });
    }
  } catch {
    img.style.display = "none";
  }
}

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
 * Open the report in a print-ready popup window and trigger the browser's
 * native print dialog. This is the only reliable approach — html2canvas
 * consistently renders black in this app because the dark-mode CSS variables
 * (:root --background: 222 47% 5%) cannot be overridden in the cloned document
 * it uses for rendering.
 *
 * The popup is fully isolated (no app CSS), matches the preview, and the
 * browser's print-to-PDF produces a vector PDF. Returns a no-op jsPDF stub
 * so existing callers that call .save() still compile without changes.
 */
export async function generatePdfFromHtml(
  html: string,
  _options?: { backgroundColor?: string },
  preOpenedWindow?: Window | null
): Promise<jsPDF> {
  const printHtml = html
    .replace("</style>", `
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @page { margin: 0.8in; size: A4; }
    body { background: white !important; color: #111 !important; }
  }
</style>`)
    .replace("</body>", `
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 600);
    });
  </script>
</body>`);

  // Use pre-opened window if provided (required when called after an async gap,
  // since browsers block window.open() outside a synchronous user-gesture callstack).
  const popup = preOpenedWindow ?? window.open("", "_blank", "width=900,height=700");
  if (!popup) throw new Error("Popup blocked — allow popups for this site and try again.");

  popup.document.write(printHtml);
  popup.document.close();

  // Return a stub so callers that do pdf.save(filename) don't throw.
  // The actual save happens via the browser print dialog.
  return {
    save: (_filename: string) => {},
  } as unknown as jsPDF;
}
