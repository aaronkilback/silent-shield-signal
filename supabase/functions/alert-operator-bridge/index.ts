// alert-operator-bridge — TEMPORARY STOPGAP (#69).
//
// While alert-delivery v2 client delivery is GATED (the production recipient model is not yet
// shipped — see step-3 design brief), a genuinely-urgent new alert for a live client would
// otherwise reach nobody. This bridge closes that window: every ~15 min it emails the OPERATOR a
// digest of NEW pending alerts for ACTIVE, non-fixture clients, so manual delivery can happen.
//
//   * ALL priorities (P1/P2/P3) are included and priority-TAGGED — NOT filtered. The motivating
//     case (the Petronas severe-thunderstorm alert) was P3; a P1/P2-only bridge would miss it.
//   * Dedup by a created_at watermark: each alert is notified exactly once (no re-nagging).
//   * Send path = Resend (the proven path used by send-daily-briefing), NOT the contained
//     alert-delivery function. Recipient = OPERATOR_EMAIL (fallback ak@silentshieldsecurity.com).
//   * Auth REUSES the already-provisioned ALERT_DELIVERY_INTERNAL_SECRET (no new secret to set or
//     leak). The cron presents it as x-alert-delivery-internal via get_alert_delivery_internal_secret().
//
// SUNSET: retire this function + its cron + state table when the production recipient model ships
// and real client delivery resumes. Tracked in the ledger.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-delivery-internal",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/** Constant-time compare (inspects every byte of the longer input). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a); const bb = enc.encode(b);
  const n = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function ageStr(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── AUTHORIZATION FIRST (reused internal secret) — before any DB/provider work ──
  const secret = Deno.env.get("ALERT_DELIVERY_INTERNAL_SECRET");
  if (!secret || secret.length < 16) return json({ error: "service_unavailable" }, 503);
  const provided = req.headers.get("x-alert-delivery-internal") ?? "";
  if (!provided) return json({ error: "missing internal authorization" }, 401);
  if (!timingSafeEqual(provided, secret)) return json({ error: "forbidden" }, 403);

  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  const toEmail = Deno.env.get("OPERATOR_EMAIL") ?? "ak@silentshieldsecurity.com";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!fromEmail || !resendKey) return json({ error: "sender_unconfigured" }, 503);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Watermark: only alerts created AFTER the last notified boundary. First run -> last 20 min.
  const { data: st } = await supabase
    .from("operator_alert_bridge_state").select("last_notified_created_at").eq("id", true).maybeSingle();
  const since = st?.last_notified_created_at ?? new Date(Date.now() - 20 * 60 * 1000).toISOString();

  // Fresh pending alerts for ACTIVE non-fixture clients (all channels), priority-ordered.
  const { data: rows, error } = await supabase.rpc("operator_bridge_pending_alerts", { p_since: since });
  if (error) { console.error("[operator-bridge] query failed:", error.message); return json({ error: "query_failed" }, 500); }
  const alerts = (rows ?? []) as Array<{
    alert_id: string; created_at: string; recipient: string; channel: string;
    title: string; severity_level: string | null; client_name: string;
  }>;
  if (alerts.length === 0) return json({ notified: 0, since });

  // Build the priority-tagged digest.
  const lines = alerts.map((a) => {
    const pri = a.severity_level ?? "P?";
    return `<tr>
      <td style="padding:4px 10px;font-weight:700">${esc(pri)}</td>
      <td style="padding:4px 10px">${esc(a.client_name)}</td>
      <td style="padding:4px 10px">${esc(a.title ?? "(untitled)")}</td>
      <td style="padding:4px 10px">${esc(a.recipient)} · ${esc(a.channel)}</td>
      <td style="padding:4px 10px">${ageStr(a.created_at)} ago</td>
    </tr>`;
  }).join("");
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif">
    <h2>⚠ ${alerts.length} new pending client alert(s) — delivery is GATED</h2>
    <p>Real client alert delivery is not yet enabled (alert-delivery v2 recipient model pending).
       These need <b>manual delivery</b>. Priority-tagged, newest boundary since ${esc(since)}.</p>
    <table style="border-collapse:collapse;font-size:13px">
      <tr style="text-align:left;border-bottom:1px solid #ccc">
        <th style="padding:4px 10px">Pri</th><th style="padding:4px 10px">Client</th>
        <th style="padding:4px 10px">Alert</th><th style="padding:4px 10px">Intended recipient</th>
        <th style="padding:4px 10px">Age</th></tr>
      ${lines}
    </table>
    <p style="color:#888;font-size:11px">alert-operator-bridge (#69, temporary stopgap). Retires when the production recipient model ships.</p>
  </body></html>`;

  try {
    const resend = new Resend(resendKey);
    const { error: sendErr } = await resend.emails.send({
      from: fromEmail,
      to: [toEmail],
      subject: `[FORTRESS] ${alerts.length} pending client alert(s) need manual delivery`,
      html,
    });
    if (sendErr) throw sendErr;
  } catch (e) {
    console.error("[operator-bridge] send failed:", e instanceof Error ? e.message : String(e));
    return json({ error: "send_failed" }, 502); // do NOT advance the watermark -> retried next run
  }

  // Advance the watermark ONLY after a successful send, so nothing is dropped on a send failure.
  const maxCreated = alerts.reduce((m, a) => (a.created_at > m ? a.created_at : m), alerts[0].created_at);
  await supabase.from("operator_alert_bridge_state").update({ last_notified_created_at: maxCreated }).eq("id", true);

  return json({ notified: alerts.length, watermark_advanced_to: maxCreated });
});
