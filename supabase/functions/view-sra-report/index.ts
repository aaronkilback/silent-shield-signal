/**
 * view-sra-report — serve a generated SRA HTML file with browser-correct
 * headers so it renders instead of displaying source.
 *
 * The generate-sra-report function uploads the report to storage with
 * contentType="text/html", but Supabase Storage signed URLs were
 * serving with headers that caused browsers to show source rather
 * than render (no charset declaration → Windows-1252 fallback +
 * sometimes Content-Disposition=attachment → download).
 *
 * This function reads the report from storage with the service role
 * and returns it with explicit Content-Type: text/html; charset=utf-8
 * + Content-Disposition: inline so the browser renders the report
 * correctly on every platform.
 *
 * Usage: ?path=audit/<audit_id>/reports/sra-<ts>.html
 */

import { createServiceClient } from "../_shared/supabase-client.ts";

const SITE_AUDIT_MEDIA_BUCKET = "site-audit-media";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) {
      return new Response("Missing ?path= parameter", { status: 400 });
    }
    // Defensive: path must stay inside our bucket convention
    if (!path.startsWith("audit/") || !path.endsWith(".html")) {
      return new Response("Invalid path", { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase.storage
      .from(SITE_AUDIT_MEDIA_BUCKET)
      .download(path);

    if (error || !data) {
      return new Response(`Report not found: ${error?.message ?? "unknown"}`, { status: 404 });
    }

    const html = await data.text();

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": "inline",
        // Cache for 5 min since reports are immutable once generated
        "Cache-Control": "private, max-age=300",
        // CORS in case the wizard wants to embed in an iframe later
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return new Response(`Error: ${msg}`, { status: 500 });
  }
});
