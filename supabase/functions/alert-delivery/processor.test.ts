// Alert Delivery v2 — mocked provider/DB integration tests for the failure paths.
// Run: deno test supabase/functions/alert-delivery/processor.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processClaimedAlert } from "./processor.ts";

const allow = new Set(["approved@test.example"]);
const base = (over: Record<string, unknown> = {}) =>
  ({ id: "a1", channel: "email", recipient: "approved@test.example", delivery_key: "dk_1", response_json: { subject: "s", body: "b" }, ...over });

function recorder() {
  const calls: any[] = [];
  const fn = async (_alert: any, ns: any, classified?: any) =>
    { calls.push({ status: ns.status, set_sent_at: ns.set_sent_at, set_failed_at: ns.set_failed_at, error_class: ns.error_class, provider_message_id: ns.provider_message_id, classified }); };
  return { fn, calls };
}

Deno.test("provider failure -> truthful 'failed' + sanitized, no sent_at", async () => {
  const { fn, calls } = recorder();
  const send = async () => ({ error: { statusCode: 503, message: "upstream unavailable for victim@real-client.com" } });
  const r = await processClaimedAlert(base(), { fromEmail: "from@s.com", allow, send, finalize: fn });
  assertEquals(r.outcome, "failed");
  assertEquals(r.send_calls, 1);
  assertEquals(calls[0].status, "failed");
  assertEquals(calls[0].set_sent_at, false);          // failed never sets sent_at
  assertEquals(calls[0].set_failed_at, true);
  assertEquals(calls[0].error_class, "provider_unavailable");
  assertEquals(calls[0].classified.retryable, true);
  assertEquals(calls[0].classified.error_message_safe.includes("victim@real-client.com"), false); // no recipient leak
});

Deno.test("provider success -> sent once; Idempotency-Key = delivery_key; one pmid + sent_at", async () => {
  const { fn, calls } = recorder();
  let headers: any = null;
  const send = async (p: any) => { headers = p.headers; return { data: { id: "pm_123" } }; };
  const r = await processClaimedAlert(base(), { fromEmail: "from@s.com", allow, send, finalize: fn });
  assertEquals(r.outcome, "sent");
  assertEquals(r.send_calls, 1);
  assertEquals(headers["Idempotency-Key"], "dk_1"); // provider-side dedup keyed on the stable delivery_key
  assertEquals(calls[0].status, "sent");
  assertEquals(calls[0].set_sent_at, true);
  assertEquals(calls[0].provider_message_id, "pm_123");
});

Deno.test("already-accepted (provider_message_id present) -> NO resend (idempotent)", async () => {
  const { fn, calls } = recorder();
  let sendCalled = 0;
  const send = async () => { sendCalled++; return { data: { id: "should_not_happen" } }; };
  const r = await processClaimedAlert(base({ provider_message_id: "pm_prev" }), { fromEmail: "from@s.com", allow, send, finalize: fn });
  assertEquals(r.outcome, "already_accepted_finalized");
  assertEquals(r.send_calls, 0);
  assertEquals(sendCalled, 0);              // no duplicate send
  assertEquals(calls[0].status, "sent");
  assertEquals(calls[0].provider_message_id, "pm_prev");
});

Deno.test("post-provider DB-finalization failure -> NOT marked failed, NOT resent (left 'sending' for recovery)", async () => {
  let sendCalled = 0;
  const send = async () => { sendCalled++; return { data: { id: "pm_abc" } }; };
  const finalize = async () => { throw new Error("DB unavailable"); }; // fails AFTER provider acceptance
  const r = await processClaimedAlert(base(), { fromEmail: "from@s.com", allow, send, finalize });
  assertEquals(r.outcome, "accepted_unfinalized"); // NOT 'failed' (truthful: it was accepted)
  assertEquals(r.send_calls, 1);
  assertEquals(sendCalled, 1);             // exactly one send; no duplicate within the call
  assertEquals(r.provider_message_id, "pm_abc");
});

Deno.test("unsupported channel + blocked recipient -> never send, never 'sent'", async () => {
  let sendCalled = 0;
  const send = async () => { sendCalled++; return { data: { id: "x" } }; };
  const f1 = recorder();
  const r1 = await processClaimedAlert(base({ channel: "secure_messaging" }), { fromEmail: "f", allow, send, finalize: f1.fn });
  assertEquals(r1.outcome, "unsupported_channel"); assertEquals(r1.send_calls, 0); assertEquals(f1.calls[0].status, "failed");
  const f2 = recorder();
  const r2 = await processClaimedAlert(base({ recipient: "real@client.com" }), { fromEmail: "f", allow, send, finalize: f2.fn });
  assertEquals(r2.outcome, "recipient_blocked"); assertEquals(r2.send_calls, 0); assertEquals(f2.calls[0].error_class, "recipient_not_allowed");
  assertEquals(sendCalled, 0);
});
