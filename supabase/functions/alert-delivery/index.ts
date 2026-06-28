// Alert Delivery v2 — EMAIL ONLY, staging hardened replacement.
//
// Boundary contract (testable core in lib.ts):
//   1. AUTHORIZATION FIRST — dedicated internal header validated (constant-time) BEFORE any
//      service-role client, DB read/write, provider init, or outbound call. Service-role
//      bearer ALONE is rejected. Only POST + OPTIONS are accepted.
//   2. Truthful state — pending -> sending (atomic claim) -> sent | failed |
//      requires_reconciliation. 'sent' only on provider acceptance (+sent_at). 'failed' sets
//      failed_at + sanitized error_class, never sent_at. 'requires_reconciliation' = lease
//      expired AFTER the provider idempotency window; never auto-resent.
//   3. Idempotent — stable delivery_key persisted before provider contact and used as the
//      provider Idempotency-Key; provider_message_id persisted; reclaim/resend only inside the
//      idempotency window; past it -> requires_reconciliation (no second send).
//   4. Safe observability — only sanitized error_class/message, timestamps, provider id,
//      retryability. No raw provider bodies, inbound payloads, recipient PII, or secrets.
//   5. Email safety — sender/reply-to/cc/bcc/attachments/headers/api-key/endpoint are NEVER
//      taken from the alert record or request body. Sender is fixed server config. Staging may
//      send only to the single approved allowlisted mailbox. The request body is never read.
//
// alert-delivery-secure remains deny-all. Legacy failed debt is never touched here.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import {
  authorizeInternal, buildSendParams, classifyError, isRecipientAllowed, isSupportedChannel, nextState,
} from "./lib.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-delivery-internal",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CLAIM_LIMIT = 10;
const LEASE_SECONDS = 120;
const IDEMPOTENCY_WINDOW_SECONDS = 86400; // provider (Resend) idempotency keys expire ~24h

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── 1. AUTHORIZATION FIRST — before any client/db/provider/outbound work ──
  const auth = authorizeInternal(req.headers, Deno.env.get("ALERT_DELIVERY_INTERNAL_SECRET"));
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  // Sender is FIXED server config and must be configured (verified domain). No DB/body override.
  const fromEmail = Deno.env.get("ALERT_FROM_EMAIL");
  if (!fromEmail) return json({ error: "sender_unconfigured" }, 503);

  // NOTE: the request body is intentionally NOT read — callers cannot specify recipients or any
  // delivery configuration. This function only drains the claimed email queue.

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const worker = crypto.randomUUID();

  // Atomic claim. The RPC also reconciles lease-expired 'sending' rows that are past the
  // idempotency window into 'requires_reconciliation' (never returned for resend).
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_pending_email_alerts", {
    p_worker: worker, p_limit: CLAIM_LIMIT, p_lease_seconds: LEASE_SECONDS, p_idempotency_window_seconds: IDEMPOTENCY_WINDOW_SECONDS,
  });
  if (claimErr) { console.error("[alert-delivery v2] claim failed:", claimErr.message); return json({ error: "claim_failed" }, 500); }

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

      const p = buildSendParams(fromEmail, a); // server-controlled config only
      const sent = await resend.emails.send(p as any);
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
  if (error) console.error("[alert-delivery v2] finalize update failed (lease/window-recovered):", error.message);
}
