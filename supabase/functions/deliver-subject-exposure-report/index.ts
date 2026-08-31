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
    const action = body?.action ?? "deliver";
    const reportId = body?.reportId;
    if (!reportId) return errorResponse("reportId required", 400);
    const supabase = createServiceClient();

    const { data: report } = await supabase.from("reports").select("id, client_id, issuable, meta_json").eq("id", reportId).maybeSingle();
    if (!report) return errorResponse("report not found", 404);
    if (caller.kind === "user") {
      let ok = report.client_id ? await userCanAccessClient(supabase, caller.userId, report.client_id) : false;
      if (!ok) { const { data: sa } = await supabase.from("user_roles").select("role").eq("user_id", caller.userId).eq("role", "super_admin").maybeSingle(); ok = !!sa; }
      if (!ok) return errorResponse("NOT_AUTHORIZED", 403);
    }

    // ── REVOKE — kill this report's live tokens NOW (finer than issuable=false, which kills all report
    //    links). Records who + why; the reason is surfaced to the viewer, so write it CLIENT-SAFE (the
    //    common case is "a corrected version is available"). "Wait for expiry" is not an answer. ──
    if (action === "revoke") {
      const reason = String(body?.reason ?? "").trim() || "An updated version of this report is being prepared.";
      const { data: revoked, error } = await supabase.from("report_delivery_tokens")
        .update({ revoked_at: new Date().toISOString(), revoked_by: caller.kind === "user" ? caller.userId : null, revoked_reason: reason })
        .eq("report_id", reportId).is("revoked_at", null).select("id");
      if (error) return errorResponse(`revoke failed: ${error.message}`, 500);
      return successResponse({ ok: true, action: "revoke", report_id: reportId, tokens_revoked: revoked?.length ?? 0, reason });
    }

    const recipient = body?.recipient;
    if (!recipient) return errorResponse("recipient (email) required for delivery", 400);

    // ── ISSUABLE GATE (deny-by-default) ──
    if (report.issuable !== true) return errorResponse("REPORT_NOT_ISSUABLE: an operator must set reports.issuable=true (issuance gate) before this report can be delivered", 409);
    // ── DRAFT CHILD-SAFETY HARD BLOCK — belt-and-suspenders to the visible DRAFT banner. Unreviewed
    //     Section-6 guidance cannot reach a family even if issuable was flipped. Regenerate after review. ──
    if (report.meta_json?.child_safety?.contains_draft === true) {
      return errorResponse("CONTAINS_DRAFT_CHILD_SAFETY: this report's Section 6 (Family & Child Safety) contains guidance not yet reviewed/signed by a child-safety professional. Have it reviewed (edit-child-safety-guidance, action=review) and regenerate before delivery.", 409);
    }

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
