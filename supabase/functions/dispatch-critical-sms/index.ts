// dispatch-critical-sms — pages the operator by SMS for NEW security-exposure CRITICAL findings only.
// SCOPE (agreed): category='security_posture' + severity='critical' + NEW (first seen ≤24h) + not
// already paged (dedupe by fingerprint) + daily cap 3 (overflow stays on the email digest). Operational
// criticals stay on email. Volume target: near-zero (0 over the last 30 days at build time).
// Internal-only (x-fortress-internal). Reuses the MFA Twilio credentials.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireInternalCaller } from "../_shared/require-internal-caller.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

const OPERATOR_UID = "d7edb69f-66e8-4776-9e5d-7ac54b401cfb"; // ak@silentshieldsecurity.com
const DAILY_CAP = 3;
const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

async function sendTwilioSms(to: string, bodyText: string): Promise<{ ok: boolean; sid: string | null; error?: string }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) return { ok: false, sid: null, error: "twilio_not_configured" };
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { "Authorization": `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: to, Body: bodyText.slice(0, 320) }),
  });
  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, sid: json?.sid ?? null, error: resp.ok ? undefined : (json?.message || `http_${resp.status}`) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const denied = requireInternalCaller(req);
  if (denied) return denied;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const isTest = body?.test === true;

  // Operator phone from the on-file MFA settings — never returned/logged in full.
  const { data: settings } = await supabase.from("user_mfa_settings")
    .select("phone_number, phone_verified").eq("user_id", OPERATOR_UID)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const to = settings?.phone_number as string | undefined;
  if (!to) return new Response(JSON.stringify({ error: "no operator phone on file" }), { status: 412, headers: cors });
  const last4 = to.slice(-4);

  // Daily cap counts REAL (non-test) sends since UTC midnight.
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await supabase.from("sms_alert_log")
    .select("id", { count: "exact", head: true }).eq("is_test", false).eq("status", "sent").gte("sent_at", midnight.toISOString());

  if (isTest) {
    const r = await sendTwilioSms(to, "[TEST] Fortress critical-alert SMS channel is live. You will receive this only for security_posture CRITICAL findings (cap 3/day). This is a one-off test.");
    await supabase.from("sms_alert_log").insert({ is_test: true, status: r.ok ? "test" : "failed", twilio_sid: r.sid, to_number_last4: last4, finding_title: "[test page]" });
    return new Response(JSON.stringify({ test: true, ok: r.ok, sid: r.sid, error: r.error, to_last4: last4 }), { status: r.ok ? 200 : 502, headers: cors });
  }

  // Due = security_posture + critical + unresolved + NEW (first seen ≤24h) + not already paged (dedupe).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: due } = await supabase.from("platform_findings")
    .select("fingerprint, title, first_seen_at")
    .eq("category", "security_posture").eq("severity", "critical").is("resolved_at", null)
    .gte("first_seen_at", since);
  const { data: pagedRows } = await supabase.from("sms_alert_log").select("fingerprint").not("fingerprint", "is", null);
  const paged = new Set((pagedRows || []).map((r: any) => r.fingerprint));
  const toPage = (due || []).filter((f: any) => f.fingerprint && !paged.has(f.fingerprint));

  let remaining = Math.max(0, DAILY_CAP - (sentToday || 0));
  const results: any[] = [];
  for (const f of toPage) {
    if (remaining <= 0) {
      // Overflow: the email digest (system-watchdog isCritical) covers it. Log so it is audited and not re-paged.
      await supabase.from("sms_alert_log").insert({ fingerprint: f.fingerprint, finding_title: f.title, status: "skipped_cap", to_number_last4: last4 });
      results.push({ fingerprint: f.fingerprint, status: "skipped_cap" });
      continue;
    }
    const r = await sendTwilioSms(to, `\u{1F534} FORTRESS CRITICAL (security): ${String(f.title).slice(0, 150)} — see platform_findings.`);
    await supabase.from("sms_alert_log").insert({ fingerprint: f.fingerprint, finding_title: f.title, status: r.ok ? "sent" : "failed", twilio_sid: r.sid, to_number_last4: last4 });
    if (r.ok) remaining--;
    results.push({ fingerprint: f.fingerprint, status: r.ok ? "sent" : "failed", sid: r.sid });
  }
  const pagedCount = results.filter((r) => r.status === "sent").length;
  await recordHeartbeat(supabase, "dispatch-critical-sms-15min", "completed", { paged: pagedCount, evaluated: (due || []).length });
  return new Response(JSON.stringify({ paged: pagedCount, evaluated: (due || []).length, results }), { status: 200, headers: cors });
});
