// inbound-call-notify — ATLAS platform-webhook receiver for the published voice number (825 904 8566).
//
// Atlas owns the Twilio call leg + fires platform webhooks (call_started / call_completed) on every call,
// independently of the voice model (a model-invoked Action is unreliable — Atlas dropped a call
// mid-conversation). This fires ONE operator SMS per event.
//
// AUTH: Atlas does NOT sign requests — a random token in the URL PATH is the secret. The last path segment
// must equal ATLAS_WEBHOOK_PATH_TOKEN, else 403. (Twilio's X-Twilio-Signature HMAC verifier is kept below
// but UNUSED, so we can revert to a Twilio status callback without rewriting.)
// Deploy verify_jwt=false. No tenant data-plane access. Set the full URL (with token) as the Atlas hookUrl.

import { createClient } from "npm:@supabase/supabase-js@2";

const NOTIFY_HEADERS = { "Content-Type": "text/plain" };
const digitsOnly = (s: string | null | undefined) => (s || "").replace(/[^\d]/g, "");

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ── UNUSED (kept for revert to a Twilio status callback) ─────────────────────────────────────────────
// Twilio signature: base64( HMAC-SHA1( url + concat(sorted key+value pairs), authToken ) ).
async function _twilioSignature(url: string, params: URLSearchParams, authToken: string): Promise<string> {
  let data = url;
  for (const key of [...params.keys()].sort()) data += key + params.get(key);
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

// Process one Atlas event: dedupe (at-least-once) then send exactly one SMS. Runs AFTER the 2xx response.
async function processAtlasEvent(body: string): Promise<void> {
  let ev: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(body);                       // Atlas body = JSON array containing the event object
    ev = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch { console.error("[atlas] unparseable body"); return; }
  if (!ev) return;

  const callId = String(ev.callId ?? "");
  const customerNumber = String(ev.customerNumber ?? "");
  if (!callId) { console.error("[atlas] event missing callId"); return; }

  const rawType = String(ev.type ?? ev.event ?? ev.triggerName ?? ev.eventType ?? "").toLowerCase();
  const isCompleted = rawType.includes("completed") || ev.durationSeconds != null || ev.endedReason != null;
  const eventType = isCompleted ? "call_completed" : "call_started";

  // Loop guard: never alert on calls from the operator's own number or the Twilio number itself.
  const cn = digitsOnly(customerNumber);
  if (cn && (cn === digitsOnly(Deno.env.get("AARON_ALERT_NUMBER")) || cn === digitsOnly(Deno.env.get("TWILIO_FROM_NUMBER")))) {
    return;
  }

  // Atomic de-dupe on (callId, eventType): the INSERT winner sends; a duplicate hits the PK and is skipped.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error: dupErr } = await supabase
    .from("atlas_call_notify_dedupe")
    .insert({ call_id: callId, event_type: eventType });
  if (dupErr) {
    if (dupErr.code === "23505") return;                   // duplicate delivery — already handled
    console.error("[atlas] dedupe insert error (sending anyway):", dupErr.message); // don't lose an alert
  }

  const message = isCompleted
    ? `Call ended — ${customerNumber}, ${ev.durationSeconds ?? 0}s. ${ev.endedReason ?? "unknown"}.`
    : `Inbound call from ${customerNumber}.`;

  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operator_alert: true, message }),
    });
    if (!resp.ok) console.error("[atlas] send-sms failed:", resp.status);
  } catch (e) {
    console.error("[atlas] send-sms threw:", e instanceof Error ? e.message : String(e));
  }
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: NOTIFY_HEADERS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: NOTIFY_HEADERS });

  // AUTH: last path segment must equal the secret token. 403 otherwise (indistinguishable from not-found).
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const pathToken = parts[parts.length - 1] || "";
  const expected = Deno.env.get("ATLAS_WEBHOOK_PATH_TOKEN") || "";
  if (!expected || !timingSafeEqual(pathToken, expected)) {
    return new Response("not found", { status: 403, headers: NOTIFY_HEADERS });
  }

  // Respond 2xx IMMEDIATELY, then process (dedupe + SMS) in the background — slow endpoints time out.
  return req.text().then((body) => {
    const work = processAtlasEvent(body);
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") rt.waitUntil(work);
    else work.catch((e) => console.error("[atlas] process error:", e));
    return new Response("ok", { status: 200, headers: NOTIFY_HEADERS });
  });
});
