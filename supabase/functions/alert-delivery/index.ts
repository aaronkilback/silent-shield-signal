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
//      provider Idempotency-Key; provider_message_id persisted; reclaim/resend only STRICTLY
//      inside the DB-authoritative retry cutoff (margin-bearing, < the provider's key retention);
//      at/past the cutoff -> requires_reconciliation (no second send).
//   4. Safe observability — only sanitized error_class/message, timestamps, provider id,
//      retryability. No raw provider bodies, inbound payloads, recipient PII, or secrets.
//   5. Email safety — sender/reply-to/cc/bcc/attachments/headers/api-key/endpoint are NEVER
//      taken from the alert record or request body. Sender is fixed server config. Staging may
//      send only to the single approved allowlisted mailbox. The request body is never read.
//
// alert-delivery-secure remains deny-all. Legacy failed debt is never touched here.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { authorizeInternal } from "./lib.ts";
import { processClaimedAlert } from "./processor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-delivery-internal",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CLAIM_LIMIT = 10;
const LEASE_SECONDS = 120;
// The idempotency/retry cutoff is intentionally NOT defined here. It is owned SOLELY by the
// database — public.alert_delivery_idempotency_window_seconds() (currently 22h, strictly inside
// Resend's 24h key retention). The handler cannot pass or drift it: claim_pending_email_alerts
// reads the authoritative value internally and exposes no window parameter.

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

  // Atomic claim. The RPC also reconciles lease-expired 'sending' rows that are at/past the
  // DB-authoritative idempotency cutoff into 'requires_reconciliation' (never returned for resend).
  // No window argument is passed — the cutoff is owned solely by the database (see note above).
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_pending_email_alerts", {
    p_worker: worker, p_limit: CLAIM_LIMIT, p_lease_seconds: LEASE_SECONDS,
  });
  if (claimErr) { console.error("[alert-delivery v2] claim failed:", claimErr.message); return json({ error: "claim_failed" }, 500); }

  const { data: allowRows } = await supabase.from("alert_delivery_allowed_recipients").select("email");
  const allow = new Set((allowRows ?? []).map((r: any) => String(r.email).trim().toLowerCase()));

  const resend = new Resend(Deno.env.get("RESEND_API_KEY") as string); // initialized AFTER auth + claim
  const send = (p: any) => resend.emails.send(p as any);
  const finalizeDep = (alert: any, ns: any, classified?: any) => finalize(supabase, alert, ns, classified);
  const results: any[] = [];

  for (const a of (claimed ?? [])) {
    const r = await processClaimedAlert(a, { fromEmail, allow, send, finalize: finalizeDep });
    results.push({ id: a.id, outcome: r.outcome, ...(r.error_class ? { error_class: r.error_class } : {}) });
  }

  return json({ worker, claimed: (claimed ?? []).length, results });
});

async function finalize(supabase: any, a: any, ns: any, classified?: { error_message_safe: string; retryable: boolean }) {
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
