// Alert Delivery v2 — pure, testable core (no DB/provider/Deno.serve here).
// Authorization, sanitization, recipient safety, and error classification logic
// live here so they can be unit-tested without a live database or provider.

export const ALERT_INTERNAL_HEADER = "x-alert-delivery-internal";

/**
 * Constant-time string comparison. Always inspects every byte of the longer
 * input so timing does not reveal length or prefix matches. Returns false on
 * any length or content mismatch.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const n = Math.max(ab.length, bb.length);
  // Seed with the length difference so unequal lengths can never pass, while
  // still doing O(n) work regardless of where/whether bytes differ.
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < n; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * AUTHORIZATION FIRST. Validates the dedicated internal header against the
 * dedicated secret. A service-role bearer alone is NOT accepted — only the
 * dedicated header authorizes execution. Fails closed if the secret is unset.
 */
export function authorizeInternal(headers: Headers, secret: string | undefined): AuthResult {
  if (!secret || secret.length < 16) {
    // Misconfiguration must never silently allow work.
    return { ok: false, status: 503, error: "service_unavailable" };
  }
  const provided = headers.get(ALERT_INTERNAL_HEADER) ?? "";
  if (!provided) return { ok: false, status: 401, error: "missing internal authorization" };
  if (!timingSafeEqual(provided, secret)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true };
}

/** Channels this v2 path supports. Email only; everything else fails explicitly. */
export const SUPPORTED_CHANNELS = new Set<string>(["email"]);

export function isSupportedChannel(channel: string | null | undefined): boolean {
  return !!channel && SUPPORTED_CHANNELS.has(channel);
}

/** Recipient safety gate: only an explicitly-approved staging mailbox may receive. */
export function isRecipientAllowed(recipient: string | null | undefined, allow: Set<string>): boolean {
  if (!recipient) return false;
  return allow.has(String(recipient).trim().toLowerCase());
}

export interface ClassifiedError {
  error_class: string;
  error_message_safe: string;
  retryable: boolean;
}

/**
 * Map a provider/transport error to a sanitized class + retryability.
 * NEVER returns raw provider bodies, recipient PII, or secrets — only a small
 * fixed vocabulary of classes and a generic safe message.
 */
export function classifyError(err: unknown): ClassifiedError {
  const name = (err && typeof err === "object" && "name" in err ? String((err as any).name) : "").toLowerCase();
  const statusCode = (err && typeof err === "object" && "statusCode" in err ? Number((err as any).statusCode) : NaN);
  const raw = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();

  // Terminal (do not retry)
  if (raw.includes("invalid") && raw.includes("email")) return { error_class: "invalid_recipient", error_message_safe: "Recipient address rejected.", retryable: false };
  if (raw.includes("not verified") || raw.includes("unverified") || raw.includes("domain")) return { error_class: "sender_unverified", error_message_safe: "Sender/domain not verified.", retryable: false };
  if (statusCode === 401 || statusCode === 403 || raw.includes("api key") || raw.includes("unauthorized")) return { error_class: "provider_auth", error_message_safe: "Provider authentication failed.", retryable: false };
  if (statusCode === 422 || statusCode === 400) return { error_class: "validation", error_message_safe: "Provider rejected the request as invalid.", retryable: false };

  // Retryable (transient)
  if (statusCode === 429 || raw.includes("rate")) return { error_class: "rate_limited", error_message_safe: "Provider rate limited.", retryable: true };
  if (statusCode >= 500 || name.includes("timeout") || raw.includes("timeout") || raw.includes("network") || raw.includes("fetch")) return { error_class: "provider_unavailable", error_message_safe: "Provider temporarily unavailable.", retryable: true };

  return { error_class: "unknown", error_message_safe: "Delivery failed.", retryable: true };
}

/**
 * Decide the next persisted state from a delivery outcome. Pure decision fn so
 * the truthful state model is unit-testable.
 *  - accepted (provider returned an id, no error) -> 'sent' (+sent_at), never 'delivered'.
 *  - failure -> 'failed' (+failed_at, error_class), never sets sent_at.
 *  - unsupported/unconfigured channel -> 'failed' with explicit class, never 'sent'.
 */
export type Outcome =
  | { kind: "accepted"; provider_message_id: string | null }
  | { kind: "failed"; classified: ClassifiedError }
  | { kind: "unsupported_channel" }
  | { kind: "recipient_blocked" };

export interface NextState {
  status: "sent" | "failed";
  set_sent_at: boolean;
  set_failed_at: boolean;
  error_class: string | null;
  provider_message_id: string | null;
}

export function nextState(o: Outcome): NextState {
  switch (o.kind) {
    case "accepted":
      return { status: "sent", set_sent_at: true, set_failed_at: false, error_class: null, provider_message_id: o.provider_message_id };
    case "failed":
      return { status: "failed", set_sent_at: false, set_failed_at: true, error_class: o.classified.error_class, provider_message_id: null };
    case "unsupported_channel":
      return { status: "failed", set_sent_at: false, set_failed_at: true, error_class: "unsupported_channel", provider_message_id: null };
    case "recipient_blocked":
      return { status: "failed", set_sent_at: false, set_failed_at: true, error_class: "recipient_not_allowed", provider_message_id: null };
  }
}
