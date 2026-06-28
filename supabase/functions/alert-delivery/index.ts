// Alert Delivery v2 — EMAIL ONLY, staging hardened replacement.
//
// Boundary contract (see lib.ts for the testable core):
//   1. AUTHORIZATION FIRST — the dedicated internal header is validated (constant-time)
//      BEFORE any service-role client, DB read/write, provider init, or outbound call.
//      A service-role bearer ALONE is NOT accepted.
//   2. Truthful state model — pending -> sending (atomic claim) -> sent|failed.
//      'sent' only on provider acceptance (+sent_at). 'delivered' reserved for a verified
//      webhook (unused here). 'failed' sets failed_at + sanitized error_class, never sent_at.
//   3. Idempotent — rows are atomically claimed; the stable delivery_key is used as the
//      provider Idempotency-Key; provider_message_id is persisted so a post-send DB failure
//      cannot cause a duplicate on the next claim (lease recovery re-claims stuck rows).
//   4. Safe observability — only sanitized error_class/message, timestamps, provider id,
//      retryability. No raw provider bodies, inbound payloads, recipient PII, or secrets.
//   5. Staging recipient safety — only explicitly-approved test mailboxes may receive.
//
// alert-delivery-secure remains deny-all. Legacy failed debt is never touched here.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import {
  authorizeInternal, classifyError, isRecipientAllowed, isSupportedChannel, nextState,
} from "./lib.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-delivery-internal",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CLAIM_LIMIT = 10;
const LEASE_SECONDS = 120;

function buildHtml(a: any): string {
  const rj = a.response_json ?? {};
  const subject = typeof rj.subject === "string" ? rj.subject : "Security Alert";
  const body = typeof rj.body === "string" ? rj.body : "Security alert";
  return `<!DOCTYPE html><html><body style="font-family:sans-serif"><h2>${escapeHtml(subject)}</h2><p>${escapeHtml(body)}</p></body></html>`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── 1. AUTHORIZATION FIRST — before any client/db/provider/outbound work ──
  const auth = authorizeInternal(req.headers, Deno.env.get("ALERT_DELIVERY_INTERNAL_SECRET"));
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  // ── privileged work begins only after authorization ──
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const worker = crypto.randomUUID();

  // Atomic claim (durable, lease-based, recovers stuck 'sending' rows).
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_pending_email_alerts", {
    p_worker: worker, p_limit: CLAIM_LIMIT, p_lease_seconds: LEASE_SECONDS,
  });
  if (claimErr) { console.error("[alert-delivery v2] claim failed:", claimErr.message); return json({ error: "claim_failed" }, 500); }

  // Staging recipient allowlist (hard safety gate).
  const { data: allowRows } = await supabase.from("alert_delivery_allowed_recipients").select("email");
  const allow = new Set((allowRows ?? []).map((r: any) => String(r.email).trim().toLowerCase()));

  const resend = new Resend(Deno.env.get("RESEND_API_KEY") as string); // initialized AFTER auth + claim
  const results: any[] = [];

  for (const a of (claimed ?? [])) {
    try {
      if (!isSupportedChannel(a.channel)) { await finalize(supabase, a, nextState({ kind: "unsupported_channel" })); results.push({ id: a.id, outcome: "unsupported_channel" }); continue; }
      if (!isRecipientAllowed(a.recipient, allow)) { await finalize(supabase, a, nextState({ kind: "recipient_blocked" })); results.push({ id: a.id, outcome: "recipient_blocked" }); continue; }

      // Idempotency: a prior attempt accepted by the provider but not finalized leaves a
      // provider_message_id; do NOT resend — finalize as sent.
      if (a.provider_message_id) { await finalize(supabase, a, nextState({ kind: "accepted", provider_message_id: a.provider_message_id })); results.push({ id: a.id, outcome: "already_accepted_finalized" }); continue; }

      const sent = await resend.emails.send({
        from: Deno.env.get("ALERT_FROM_EMAIL") || "Security Alert <alerts@silentshieldsecurity.com>",
        to: [a.recipient],
        subject: (a.response_json?.subject as string) || "Security Alert",
        html: buildHtml(a),
        headers: { "Idempotency-Key": a.delivery_key }, // provider-side dedup keyed on our stable id
      } as any);
      if ((sent as any).error) throw (sent as any).error;
      const pmid = (sent as any).data?.id ?? null;
      await finalize(supabase, a, nextState({ kind: "accepted", provider_message_id: pmid }));
      results.push({ id: a.id, outcome: "sent" });
    } catch (e) {
      const classified = classifyError(e);
      await finalize(supabase, a, nextState({ kind: "failed", classified }), classified);
      results.push({ id: a.id, outcome: "failed", error_class: classified.error_class });
    }
  }

  return json({ worker, claimed: (claimed ?? []).length, results });
});

async function finalize(supabase: any, a: any, ns: ReturnType<typeof nextState>, classified?: { error_message_safe: string; retryable: boolean }) {
  const patch: any = {
    status: ns.status,
    error_class: ns.error_class,
    provider_message_id: ns.provider_message_id ?? a.provider_message_id ?? null,
    claimed_by: null, claimed_at: null, lease_expires_at: null,
    updated_at: new Date().toISOString(),
    // SANITIZED observability only — no raw bodies / inbound payload / PII / secrets.
    response_json: {
      v: 2,
      error_class: ns.error_class,
      error_message_safe: classified?.error_message_safe ?? null,
      retryable: classified?.retryable ?? null,
      provider_message_id: ns.provider_message_id ?? a.provider_message_id ?? null,
      finalized_at: new Date().toISOString(),
    },
  };
  if (ns.set_sent_at) patch.sent_at = new Date().toISOString();
  if (ns.set_failed_at) patch.failed_at = new Date().toISOString();
  const { error } = await supabase.from("alerts").update(patch).eq("id", a.id);
  if (error) console.error("[alert-delivery v2] finalize update failed (will be lease-recovered):", error.message);
}
