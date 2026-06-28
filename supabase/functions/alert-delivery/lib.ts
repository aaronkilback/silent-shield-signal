// Alert Delivery v2 — pure, testable core (no DB/provider/Deno.serve here).
// Authorization, sanitization, recipient safety, error classification, the
// idempotency-window reclaim decision, and the delivery-config builder live here
// so they can be unit-tested without a live database or provider.

export const ALERT_INTERNAL_HEADER = "x-alert-delivery-internal";

/** Constant-time string comparison (inspects every byte of the longer input). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const n = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * AUTHORIZATION FIRST. Validates only the dedicated internal header against the dedicated
 * secret. A service-role/user bearer ALONE is never accepted. Fails closed if secret unset.
 */
export function authorizeInternal(headers: Headers, secret: string | undefined): AuthResult {
  if (!secret || secret.length < 16) return { ok: false, status: 503, error: "service_unavailable" };
  const provided = headers.get(ALERT_INTERNAL_HEADER) ?? "";
  if (!provided) return { ok: false, status: 401, error: "missing internal authorization" };
  if (!timingSafeEqual(provided, secret)) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

export const SUPPORTED_CHANNELS = new Set<string>(["email"]);
export function isSupportedChannel(channel: string | null | undefined): boolean {
  return !!channel && SUPPORTED_CHANNELS.has(channel);
}
export function isRecipientAllowed(recipient: string | null | undefined, allow: Set<string>): boolean {
  if (!recipient) return false;
  return allow.has(String(recipient).trim().toLowerCase());
}

export interface ClassifiedError { error_class: string; error_message_safe: string; retryable: boolean; }

/**
 * Map a provider/transport error to a sanitized class + retryability. NEVER returns raw
 * provider bodies, recipient PII, or secrets — only a fixed vocabulary + generic message.
 */
export function classifyError(err: unknown): ClassifiedError {
  const name = (err && typeof err === "object" && "name" in err ? String((err as any).name) : "").toLowerCase();
  const statusCode = (err && typeof err === "object" && "statusCode" in err ? Number((err as any).statusCode) : NaN);
  const raw = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (raw.includes("invalid") && raw.includes("email")) return { error_class: "invalid_recipient", error_message_safe: "Recipient address rejected.", retryable: false };
  if (raw.includes("not verified") || raw.includes("unverified") || raw.includes("domain")) return { error_class: "sender_unverified", error_message_safe: "Sender/domain not verified.", retryable: false };
  if (statusCode === 401 || statusCode === 403 || raw.includes("api key") || raw.includes("unauthorized")) return { error_class: "provider_auth", error_message_safe: "Provider authentication failed.", retryable: false };
  if (statusCode === 422 || statusCode === 400) return { error_class: "validation", error_message_safe: "Provider rejected the request as invalid.", retryable: false };
  if (statusCode === 429 || raw.includes("rate")) return { error_class: "rate_limited", error_message_safe: "Provider rate limited.", retryable: true };
  if (statusCode >= 500 || name.includes("timeout") || raw.includes("timeout") || raw.includes("network") || raw.includes("fetch")) return { error_class: "provider_unavailable", error_message_safe: "Provider temporarily unavailable.", retryable: true };
  return { error_class: "unknown", error_message_safe: "Delivery failed.", retryable: true };
}

export type Outcome =
  | { kind: "accepted"; provider_message_id: string | null }
  | { kind: "failed"; classified: ClassifiedError }
  | { kind: "unsupported_channel" }
  | { kind: "recipient_blocked" };

export interface NextState { status: "sent" | "failed"; set_sent_at: boolean; set_failed_at: boolean; error_class: string | null; provider_message_id: string | null; }

export function nextState(o: Outcome): NextState {
  switch (o.kind) {
    case "accepted": return { status: "sent", set_sent_at: true, set_failed_at: false, error_class: null, provider_message_id: o.provider_message_id };
    case "failed": return { status: "failed", set_sent_at: false, set_failed_at: true, error_class: o.classified.error_class, provider_message_id: null };
    case "unsupported_channel": return { status: "failed", set_sent_at: false, set_failed_at: true, error_class: "unsupported_channel", provider_message_id: null };
    case "recipient_blocked": return { status: "failed", set_sent_at: false, set_failed_at: true, error_class: "recipient_not_allowed", provider_message_id: null };
  }
}

/**
 * Idempotency-window reclaim decision (mirrors the claim RPC). A 'sending' row whose lease expired
 * may be re-sent automatically ONLY while still STRICTLY inside the retry cutoff; at/past it the
 * prior provider outcome is unknown and it must NEVER be auto-resent — it is moved to
 * 'requires_reconciliation'. The cutoff VALUE is owned solely by the database
 * (public.alert_delivery_idempotency_window_seconds()); this pure decision embeds no value.
 */
export type ReclaimDecision = "reclaim" | "reconcile" | "skip";
export function reclaimDecision(p: { status: string; leaseExpired: boolean; withinIdempotencyWindow: boolean }): ReclaimDecision {
  if (p.status === "pending") return "reclaim";
  if (p.status === "sending" && p.leaseExpired) return p.withinIdempotencyWindow ? "reclaim" : "reconcile";
  return "skip";
}

/**
 * Pure boundary helper (tests/clarity only). Returns whether an idempotency anchor is STRICTLY
 * inside the retry cutoff. age == cutoff is OUTSIDE (false) -> reconcile, mirroring the claim RPC
 * ('>' for claim, '<=' for reconcile). The AUTHORITATIVE cutoff value lives ONLY in the database
 * function alert_delivery_idempotency_window_seconds(); this helper takes it as a parameter and
 * embeds NO constant, so it cannot drift from the DB and the handler cannot set it.
 */
export function isWithinIdempotencyWindow(anchorEpochSec: number, nowEpochSec: number, cutoffSec: number): boolean {
  return (nowEpochSec - anchorEpochSec) < cutoffSec;
}

/**
 * Build the provider send params from ONLY server-controlled config + the alert's content.
 * Caller/DB-controlled delivery fields (from/sender, reply_to, cc, bcc, attachments, arbitrary
 * headers, api key, endpoint) are NEVER read — they cannot be overridden by the alert record or
 * request body. The recipient is the single allowlist-gated address; the only header is the
 * server-set Idempotency-Key.
 */
export interface SendParams { from: string; to: string[]; subject: string; html: string; headers: Record<string, string>; }
export function buildSendParams(fromEmail: string, alert: { recipient: string; delivery_key: string; response_json?: any }): SendParams {
  const rj = alert.response_json ?? {};
  const subject = typeof rj.subject === "string" ? rj.subject : "Security Alert";
  const body = typeof rj.body === "string" ? rj.body : "Security alert";
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  return {
    from: fromEmail,                 // fixed server config only
    to: [alert.recipient],           // single allowlist-gated recipient
    subject,                         // alert content
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif"><h2>${esc(subject)}</h2><p>${esc(body)}</p></body></html>`,
    headers: { "Idempotency-Key": alert.delivery_key }, // server-controlled only
  };
}

/**
 * STAGING test-mode claim eligibility (mirrors the claim RPC WHERE). A row is eligible ONLY if it
 * is an email row EXPLICITLY marked as a controlled staging test fixture (delivery_test_mode), and
 * is either 'pending' or a lease-expired 'sending' still inside the idempotency window. Recipient
 * allowlisting is a SEPARATE, additional gate. Existing/legacy/generated/unmarked rows are ignored.
 * This strict marker is a staging safety control, NOT the future production recipient model.
 */
export function claimEligible(row: {
  channel: string | null | undefined;
  status: string;
  delivery_test_mode: boolean | null | undefined;
  leaseExpired: boolean;
  withinIdempotencyWindow: boolean;
}): boolean {
  if (row.channel !== "email") return false;
  if (row.delivery_test_mode !== true) return false; // marker required
  if (row.status === "pending") return true;
  if (row.status === "sending" && row.leaseExpired && row.withinIdempotencyWindow) return true;
  return false;
}
