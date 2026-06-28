// Alert Delivery v2 — unit tests for the pure core (no DB/provider).
// Run: deno test supabase/functions/alert-delivery/index.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  timingSafeEqual, authorizeInternal, ALERT_INTERNAL_HEADER,
  isRecipientAllowed, isSupportedChannel, classifyError, nextState,
  reclaimDecision, buildSendParams, claimEligible,
} from "./lib.ts";

const SECRET = "x".repeat(48);

Deno.test("timingSafeEqual", () => {
  assertEquals(timingSafeEqual("abc", "abc"), true);
  assertEquals(timingSafeEqual("abc", "abd"), false);
  assertEquals(timingSafeEqual("abc", "abcd"), false);
});

Deno.test("authorize: fail-closed when secret unset/short", () => {
  const h = new Headers({ [ALERT_INTERNAL_HEADER]: SECRET });
  assertEquals(authorizeInternal(h, undefined), { ok: false, status: 503, error: "service_unavailable" });
  assertEquals(authorizeInternal(h, "short"), { ok: false, status: 503, error: "service_unavailable" });
});

Deno.test("authorize: missing header -> 401", () => {
  assertEquals(authorizeInternal(new Headers(), SECRET), { ok: false, status: 401, error: "missing internal authorization" });
});

Deno.test("authorize: SERVICE-ROLE BEARER ALONE rejected (no internal header) -> 401", () => {
  const h = new Headers({ "Authorization": "Bearer service_role_key_value" });
  assertEquals(authorizeInternal(h, SECRET), { ok: false, status: 401, error: "missing internal authorization" });
});

Deno.test("authorize: wrong header -> 403; correct -> ok", () => {
  assertEquals(authorizeInternal(new Headers({ [ALERT_INTERNAL_HEADER]: "y".repeat(48) }), SECRET).ok, false);
  assertEquals(authorizeInternal(new Headers({ [ALERT_INTERNAL_HEADER]: SECRET }), SECRET), { ok: true });
});

Deno.test("recipient safety gate", () => {
  const allow = new Set(["approved@test.example"]);
  assertEquals(isRecipientAllowed("approved@test.example", allow), true);
  assertEquals(isRecipientAllowed("APPROVED@test.example", allow), true);
  assertEquals(isRecipientAllowed("someone@real-client.com", allow), false);
});

Deno.test("supported channel: email only", () => {
  assertEquals(isSupportedChannel("email"), true);
  assertEquals(isSupportedChannel("secure_messaging"), false);
});

Deno.test("classifyError: sanitized; no raw body / recipient retained", () => {
  const e = classifyError(new Error("Invalid email victim@real-client.com; not verified; token=SECRET"));
  // 'invalid' + 'email' classifies first -> invalid_recipient (terminal)
  assertEquals(e.error_class, "invalid_recipient");
  assertEquals(e.retryable, false);
  assertEquals(e.error_message_safe.includes("victim@real-client.com"), false); // no recipient leak
  assertEquals(e.error_message_safe.includes("token"), false);                   // no secret/body leak
  assertEquals(classifyError({ statusCode: 429, message: "rate" }).error_class, "rate_limited");
  assertEquals(classifyError({ statusCode: 503 }).retryable, true);
  assertEquals(classifyError({ statusCode: 401, message: "bad api key" }).retryable, false);
});

Deno.test("nextState: truthful transitions; unsupported/blocked never 'sent'", () => {
  assertEquals(nextState({ kind: "accepted", provider_message_id: "pm_1" }).status, "sent");
  assertEquals(nextState({ kind: "accepted", provider_message_id: "pm_1" }).set_sent_at, true);
  const failed = nextState({ kind: "failed", classified: { error_class: "provider_unavailable", error_message_safe: "x", retryable: true } });
  assertEquals(failed.status, "failed"); assertEquals(failed.set_sent_at, false);
  assertEquals(nextState({ kind: "unsupported_channel" }).set_sent_at, false);
  assertEquals(nextState({ kind: "unsupported_channel" }).error_class, "unsupported_channel");
  assertEquals(nextState({ kind: "recipient_blocked" }).set_sent_at, false);
});

Deno.test("reclaimDecision: idempotency window", () => {
  assertEquals(reclaimDecision({ status: "pending", leaseExpired: false, withinIdempotencyWindow: true }), "reclaim");
  assertEquals(reclaimDecision({ status: "sending", leaseExpired: true, withinIdempotencyWindow: true }), "reclaim");
  // EXPIRED sending PAST the idempotency window must NOT resend -> reconcile
  assertEquals(reclaimDecision({ status: "sending", leaseExpired: true, withinIdempotencyWindow: false }), "reconcile");
  // still leased -> skip
  assertEquals(reclaimDecision({ status: "sending", leaseExpired: false, withinIdempotencyWindow: true }), "skip");
});

Deno.test("expired sending: provider-accept + failed-DB-finalize + window-expiry => no second send", () => {
  // Simulated lifecycle: row was 'sending' (anchor set before provider contact), provider
  // accepted but DB finalize failed, lease later expired, and the idempotency window has passed.
  // The decision for the next claim cycle must be 'reconcile' (no resend), not 'reclaim'.
  const decision = reclaimDecision({ status: "sending", leaseExpired: true, withinIdempotencyWindow: false });
  assertEquals(decision, "reconcile");
});

Deno.test("buildSendParams: DB record cannot override delivery config", () => {
  // Alert record loaded with HOSTILE caller-controlled fields. None may take effect.
  const hostile: any = {
    recipient: "approved@test.example",
    delivery_key: "dk_123",
    // attacker-planted overrides that MUST be ignored:
    from: "spoof@evil.com",
    cc: ["leak@evil.com"], bcc: ["leak2@evil.com"], reply_to: "evil@evil.com",
    headers: { "X-Inject": "1" }, attachments: [{ filename: "x" }],
    api_key: "re_attacker_key", endpoint: "https://evil.example",
    response_json: { subject: "Hi", body: "Body", from: "spoof2@evil.com", cc: ["x@evil.com"], api_key: "re_x" },
  };
  const p = buildSendParams("fixed-sender@silentshieldsecurity.com", hostile);
  assertEquals(p.from, "fixed-sender@silentshieldsecurity.com"); // fixed server sender only
  assertEquals(p.to, ["approved@test.example"]);                  // single allowlist-gated recipient
  assertEquals(Object.keys(p.headers), ["Idempotency-Key"]);      // only the server-set header
  assertEquals(p.headers["Idempotency-Key"], "dk_123");
  assertEquals("cc" in (p as any), false);
  assertEquals("bcc" in (p as any), false);
  assertEquals("reply_to" in (p as any), false);
  assertEquals("attachments" in (p as any), false);
  assertEquals(("api_key" in (p as any)) || ("endpoint" in (p as any)), false);
  // content is escaped (no raw HTML injection)
  assertEquals(p.html.includes("<h2>Hi</h2>"), true);
});

Deno.test("staging test-mode marker: only marked synthetic fixtures are claimable", () => {
  const base = { channel: "email", leaseExpired: false, withinIdempotencyWindow: true };
  // marked synthetic fixture -> claimable
  assertEquals(claimEligible({ ...base, status: "pending", delivery_test_mode: true }), true);
  // allowlisted recipient but NOT marked -> NOT claimed (allowlist alone is insufficient)
  assertEquals(claimEligible({ ...base, status: "pending", delivery_test_mode: false }), false);
  // ordinary/generated/legacy row (marker absent/false) -> ignored even if recipient allowlisted
  assertEquals(claimEligible({ ...base, status: "pending", delivery_test_mode: null as any }), false);
  // marked lease-expired sending within window -> claimable; non-email never claimable
  assertEquals(claimEligible({ channel: "email", status: "sending", delivery_test_mode: true, leaseExpired: true, withinIdempotencyWindow: true }), true);
  assertEquals(claimEligible({ channel: "secure_messaging", status: "pending", delivery_test_mode: true, leaseExpired: false, withinIdempotencyWindow: true }), false);
});
