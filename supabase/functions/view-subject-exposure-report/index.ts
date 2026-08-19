// view-subject-exposure-report — the client-facing "secure portal" (v1): a tokenized, EXPIRING public URL
// that serves ONE report's rendered HTML. No account needed (the token is the credential). Fails closed:
// unknown/expired token → 404/410; report not issuable → 404 (issuance can be revoked after delivery).
// Deploy with --no-verify-jwt (token-gated, not JWT-gated).
import { createServiceClient } from "../_shared/supabase-client.ts";

const H = { "Content-Type": "text/html; charset=utf-8" };
const page = (title: string, msg: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Georgia,serif;max-width:560px;margin:80px auto;padding:24px;color:#333;text-align:center}h1{font-size:20px}</style></head><body><h1>${title}</h1><p>${msg}</p><p style="color:#999;font-size:13px">Silent Shield Security</p></body></html>`;

Deno.serve(async (req) => {
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return new Response(page("Invalid link", "This link is missing its access token."), { status: 400, headers: H });
    const supabase = createServiceClient();
    const { data: t } = await supabase.from("report_delivery_tokens").select("id, report_id, expires_at, viewed_at, view_count").eq("token", token).maybeSingle();
    if (!t) return new Response(page("Report not found", "This link is not valid. Contact your Silent Shield analyst."), { status: 404, headers: H });
    if (new Date(t.expires_at) < new Date()) return new Response(page("Link expired", "This secure link has expired. Contact your Silent Shield analyst for renewed access."), { status: 410, headers: H });
    const { data: report } = await supabase.from("reports").select("storage_url, issuable").eq("id", t.report_id).maybeSingle();
    if (!report || report.issuable !== true || !report.storage_url) {
      return new Response(page("Report not available", "This report is not currently available. Contact your Silent Shield analyst."), { status: 404, headers: H });
    }
    const { data: blob } = await supabase.storage.from("generated-reports").download(report.storage_url);
    if (!blob) return new Response(page("Report not found", "The report content could not be loaded."), { status: 404, headers: H });
    const html = await blob.text();
    // chain of custody — first-view timestamp + view count (best-effort)
    await supabase.from("report_delivery_tokens").update({ viewed_at: t.viewed_at ?? new Date().toISOString(), view_count: (t.view_count ?? 0) + 1 }).eq("id", t.id);
    return new Response(html, { headers: H });
  } catch (_e) {
    return new Response(page("Error", "Something went wrong loading this report."), { status: 500, headers: H });
  }
});
