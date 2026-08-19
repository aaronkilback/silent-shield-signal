// deliver-subject-exposure-report — issue a report to a client via an EXPIRING tokenized secure link + email
// (reuses the send-client-authorization Resend pattern). Two hard rules the operator set:
//   1. ISSUABLE GATE, deny-by-default — refuses unless reports.issuable=true (an operator flips it).
//   2. Every delivery WRITES reports.delivered_at + delivery_channel + recipient (empty across 278 reports).
import {
  createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity, userCanAccessClient,
} from "../_shared/supabase-client.ts";
import { Resend } from "npm:resend@2.0.0";

const VIEW_BASE = "https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/view-subject-exposure-report";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const caller = await getCallerIdentity(req);
    if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
    const body = await req.json().catch(() => null);
    const reportId = body?.reportId, recipient = body?.recipient;
    if (!reportId || !recipient) return errorResponse("reportId + recipient (email) required", 400);
    const supabase = createServiceClient();

    const { data: report } = await supabase.from("reports").select("id, client_id, issuable, meta_json").eq("id", reportId).maybeSingle();
    if (!report) return errorResponse("report not found", 404);
    if (caller.kind === "user") {
      let ok = report.client_id ? await userCanAccessClient(supabase, caller.userId, report.client_id) : false;
      if (!ok) { const { data: sa } = await supabase.from("user_roles").select("role").eq("user_id", caller.userId).eq("role", "super_admin").maybeSingle(); ok = !!sa; }
      if (!ok) return errorResponse("NOT_AUTHORIZED", 403);
    }

    // ── ISSUABLE GATE (deny-by-default) ──
    if (report.issuable !== true) return errorResponse("REPORT_NOT_ISSUABLE: an operator must set reports.issuable=true (issuance gate) before this report can be delivered", 409);

    // ── expiring token ──
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    const days = Number(body?.expiresInDays) > 0 ? Number(body.expiresInDays) : 14;
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    const { error: tokErr } = await supabase.from("report_delivery_tokens").insert({
      report_id: reportId, token, recipient, expires_at: expiresAt, created_by: caller.kind === "user" ? caller.userId : null,
    });
    if (tokErr) return errorResponse(`token create failed: ${tokErr.message}`, 500);
    const link = `${VIEW_BASE}?token=${token}`;

    // ── email (link created regardless; delivered_at set ONLY on send success) ──
    const subjectName = report.meta_json?.subject?.name ?? "your";
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return errorResponse("RESEND_API_KEY not configured — link created but not emailed", 503);
    const resend = new Resend(resendKey);
    const { error: emailErr } = await resend.emails.send({
      from: "Silent Shield Security <no-reply@silentshieldsecurity.com>",
      to: recipient,
      subject: "Your Reputational Exposure Assessment is ready",
      html: `<div style="font-family:Georgia,serif;color:#222;max-width:520px">
        <p>Your confidential reputational exposure assessment is ready to view.</p>
        <p><a href="${link}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:5px;text-decoration:none">View your report</a></p>
        <p style="color:#777;font-size:13px">This secure link expires on <strong>${new Date(expiresAt).toUTCString()}</strong>. It is unique to you — please do not forward it.</p>
        <p style="color:#999;font-size:12px">— Silent Shield Security</p></div>`,
    });
    if (emailErr) return errorResponse(`email delivery failed (secure link was created; you can share it manually): ${emailErr.message ?? emailErr}`, 502);

    // ── populate the delivery columns (first time these are ever written) ──
    const deliveredAt = new Date().toISOString();
    await supabase.from("reports").update({ delivered_at: deliveredAt, delivery_channel: "email", recipient }).eq("id", reportId);

    return successResponse({ ok: true, reportId, recipient, delivered_at: deliveredAt, delivery_channel: "email", expires_at: expiresAt, link });
  } catch (e) {
    console.error("[deliver-subject-exposure-report] error:", e);
    return errorResponse(e instanceof Error ? e.message : "unknown error", 500);
  }
});
