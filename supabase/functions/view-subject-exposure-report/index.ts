// view-subject-exposure-report — the client-facing "secure portal": a tokenized, EXPIRING public URL that
// serves ONE report's rendered HTML (web view). No account (the token IS the credential). SCOPING: the
// caller supplies only an opaque token → one report_id → one stored HTML file; nothing else is reachable.
// Fails closed: no/unknown token → 400/404; expired → 410; REVOKED → 410 (with the analyst's reason);
// report not issuable → 404 (revoking issuance kills every link). Injects a live expiry banner and logs
// every open (IP + UA, 90-day retention via purge-report-access-log-90d). Deploy with --no-verify-jwt.
import { createServiceClient } from "../_shared/supabase-client.ts";

const H = { "Content-Type": "text/html; charset=utf-8" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const page = (title: string, msg: string, status: number) => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Georgia,serif;max-width:560px;margin:80px auto;padding:24px;color:#333;text-align:center}h1{font-size:20px}</style></head><body><h1>${esc(title)}</h1><p>${msg}</p><p style="color:#999;font-size:13px">Silent Shield Security</p></body></html>`, { status, headers: H });

Deno.serve(async (req) => {
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return page("Invalid link", "This link is missing its access token.", 400);
    const supabase = createServiceClient();
    const { data: t } = await supabase.from("report_delivery_tokens")
      .select("id, report_id, expires_at, revoked_at, revoked_reason, viewed_at, view_count").eq("token", token).maybeSingle();
    if (!t) return page("Report not found", "This link is not valid. Contact your Silent Shield analyst.", 404);
    // REVOKED — surface the analyst's reason (they write it client-safe; the usual reason is a corrected version)
    if (t.revoked_at) return page("Link revoked", `This link was revoked${t.revoked_reason ? `: ${esc(t.revoked_reason)}` : "."} Contact your Silent Shield analyst for an updated report.`, 410);
    if (new Date(t.expires_at) < new Date()) return page("Link expired", "This secure link has expired. Contact your Silent Shield analyst for renewed access.", 410);
    const { data: report } = await supabase.from("reports").select("storage_url, issuable").eq("id", t.report_id).maybeSingle();
    if (!report || report.issuable !== true || !report.storage_url) {
      return page("Report not available", "This report is not currently available. Contact your Silent Shield analyst.", 404);
    }
    const { data: blob } = await supabase.storage.from("generated-reports").download(report.storage_url);
    if (!blob) return page("Report not found", "The report content could not be loaded.", 404);
    let html = await blob.text();

    // (3) Expiry banner — state the edge BEFORE it is hit. Prominent (red) within 3 days; a client opening
    // on day 29/30 sees "expires tomorrow", not a working link they'll later find broken.
    const exp = new Date(t.expires_at);
    const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86_400_000);
    const soon = daysLeft <= 3;
    const when = daysLeft <= 1 ? "expires <strong>tomorrow</strong>" : `expires in <strong>${daysLeft} days</strong>`;
    const banner = `<div style="background:${soon ? "#7a1f1f" : "#eef2ff"};color:${soon ? "#fff" : "#333"};font-family:Georgia,serif;font-size:13px;text-align:center;padding:10px 16px;border-bottom:1px solid ${soon ? "#5a1515" : "#ccd"}">This secure link ${when} — on ${esc(exp.toUTCString())}. After that it stops working; contact your Silent Shield analyst for a fresh link.</div>`;
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + banner) : banner + html;

    // (4) Access log — one row per open (IP + UA). Best-effort; never blocks serving.
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || null;
    try {
      await supabase.from("report_access_log").insert({ report_id: t.report_id, token_id: t.id, ip, user_agent: req.headers.get("user-agent") || null });
      await supabase.from("report_delivery_tokens").update({ viewed_at: t.viewed_at ?? new Date().toISOString(), view_count: (t.view_count ?? 0) + 1 }).eq("id", t.id);
    } catch (_) { /* logging never blocks the client's access */ }
    return new Response(html, { headers: H });
  } catch (_e) {
    return page("Error", "Something went wrong loading this report.", 500);
  }
});
