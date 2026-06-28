// Alert Delivery v2 — unit tests for the pure core (no DB/provider).
// Run: deno test supabase/functions/alert-delivery/index.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  timingSafeEqual,
  authorizeInternal,
  ALERT_INTERNAL_HEADER,
  isRecipientAllowed,
  isSupportedChannel,
  classifyError,
  nextState,
} from "./lib.ts";

const SECRET = "x".repeat(48); // realistic length

Deno.test("timingSafeEqual: equal/unequal/length", () => {
  assertEquals(timingSafeEqual("abc", "abc"), true);
  assertEquals(timingSafeEqual("abc", "abd"), false);
  assertEquals(timingSafeEqual("abc", "abcd"), false);
  assertEquals(timingSafeEqual("", ""), true);
});

Deno.test("authorize: fail-closed when secret unset/short", () => {
  const h = new Headers({ [ALERT_INTERNAL_HEADER]: SECRET });
  assertEquals(authorizeInternal(h, undefined), { ok: false, status: 503, error: "service_unavailable" });
  assertEquals(authorizeInternal(h, "short"), { ok: false, status: 503, error: "service_unavailable" });
});

Deno.test("authorize: missing header -> 401", () => {
  assertEquals(authorizeInternal(new Headers(), SECRET), { ok: false, status: 401, error: "missing internal authorization" });
});

Deno.test("authorize: SERVICE-ROLE BEARER ALONE is rejected (no internal header) -> 401", () => {
  // A request carrying only a service-role/user bearer, but NOT the dedicated header.
  const h = new Headers({ "Authorization": "Bearer " + "service_role_key_value" });
  assertEquals(authorizeInternal(h, SECRET), { ok: false, status: 401, error: "missing internal authorization" });
});

Deno.test("authorize: wrong header value -> 403", () => {
  const h = new Headers({ [ALERT_INTERNAL_HEADER]: "y".repeat(48) });
  assertEquals(authorizeInternal(h, SECRET), { ok: false, status: 403, error: "forbidden" });
});

Deno.test("authorize: correct dedicated header -> ok", () => {
  const h = new Headers({ [ALERT_INTERNAL_HEADER]: SECRET });
  assertEquals(authorizeInternal(h, SECRET), { ok: true });
});

Deno.test("recipient safety gate", () => {
  const allow = new Set(["approved@test.example"]);
  assertEquals(isRecipientAllowed("approved@test.example", allow), true);
  assertEquals(isRecipientAllowed("APPROVED@test.example", allow), true);
  assertEquals(isRecipientAllowed("someone@real-client.com", allow), false);
  assertEquals(isRecipientAllowed(null, allow), false);
});

Deno.test("supported channel: email only", () => {
  assertEquals(isSupportedChannel("email"), true);
  assertEquals(isSupportedChannel("secure_messaging"), false);
  assertEquals(isSupportedChannel("sms"), false);
});

Deno.test("classifyError: sanitized class + retryability, no raw body leak", () => {
  const unverified = classifyError(new Error("The domain is not verified. See resend.dev/abc?token=SECRET"));
  assertEquals(unverified.error_class, "sender_unverified");
  assertEquals(unverified.retryable, false);
  // sanitized message must NOT echo the raw provider body/token
  assertEquals(unverified.error_message_safe.includes("token"), false);
  assertEquals(unverified.error_message_safe.includes("SECRET"), false);

  assertEquals(classifyError({ statusCode: 429, message: "rate" }).error_class, "rate_limited");
  assertEquals(classifyError({ statusCode: 429, message: "rate" }).retryable, true);
  assertEquals(classifyError({ statusCode: 503, message: "upstream" }).retryable, true);
  assertEquals(classifyError(new Error("request timeout")).retryable, true);
  assertEquals(classifyError({ statusCode: 401, message: "bad api key" }).error_class, "provider_auth");
  assertEquals(classifyError({ statusCode: 401, message: "bad api key" }).retryable, false);
});

Deno.test("nextState: truthful transitions", () => {
  const sent = nextState({ kind: "accepted", provider_message_id: "pm_123" });
  assertEquals(sent.status, "sent");
  assertEquals(sent.set_sent_at, true);
  assertEquals(sent.set_failed_at, false);
  assertEquals(sent.provider_message_id, "pm_123");

  const failed = nextState({ kind: "failed", classified: { error_class: "provider_unavailable", error_message_safe: "x", retryable: true } });
  assertEquals(failed.status, "failed");
  assertEquals(failed.set_sent_at, false); // failed never sets sent_at
  assertEquals(failed.set_failed_at, true);

  const unsupported = nextState({ kind: "unsupported_channel" });
  assertEquals(unsupported.status, "failed");
  assertEquals(unsupported.set_sent_at, false); // unsupported never becomes 'sent'
  assertEquals(unsupported.error_class, "unsupported_channel");

  const blocked = nextState({ kind: "recipient_blocked" });
  assertEquals(blocked.status, "failed");
  assertEquals(blocked.set_sent_at, false);
  assertEquals(blocked.error_class, "recipient_not_allowed");
});
