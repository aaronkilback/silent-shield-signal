// inbound-call-notify — Twilio status-callback receiver for the published voice number (825 904 8566).
//
// Twilio owns the call leg and fires this callback on EVERY inbound call regardless of what the Atlas
// voice model does (Atlas dropped a call mid-conversation, so a model-invoked Action cannot be relied on).
// This fires ONE operator SMS per terminal inbound call — including hangups / missed calls.
//
// Auth = Twilio's X-Twilio-Signature (HMAC-SHA1 over the full URL + sorted POST params, keyed with the
// Twilio auth token). Unsigned / invalid → 403. Deploy verify_jwt=false: the signature is the auth, not a
// Supabase JWT. No data-plane access. Set as the status callback on 825 904 8566 in the Twilio console.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-twilio-signature",
};

// Terminal inbound statuses we alert on — every inbound call, including hangups.
const NOTIFY_STATUSES = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

const digitsOnly = (s: string | null | undefined) => (s || "").replace(/[^\d]/g, "");

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Twilio signature: base64( HMAC-SHA1( url + concat(sorted key+value pairs), authToken ) ).
async function twilioSignature(url: string, params: URLSearchParams, authToken: string): Promise<string> {
  let data = url;
  for (const key of [...params.keys()].sort()) data += key + params.get(key);
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });

  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) return new Response("not configured", { status: 500, headers: CORS });

  // Twilio status callbacks are application/x-www-form-urlencoded (NOT JSON).
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);

  // Sign against the exact PUBLIC callback URL Twilio was configured with — the edge runtime's req.url
  // can carry an internal host/path, so pin the canonical public URL and preserve any query string.
  const search = new URL(req.url).search;
  const publicUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/inbound-call-notify${search}`;

  const provided = req.headers.get("X-Twilio-Signature") || "";
  const expected = await twilioSignature(publicUrl, params, authToken);
  if (!provided || !timingSafeEqual(provided, expected)) {
    return new Response("invalid signature", { status: 403, headers: CORS });
  }

  const status = (params.get("CallStatus") || "").toLowerCase();
  const from = params.get("From") || "";
  const duration = params.get("CallDuration") || "0";

  // Only terminal inbound statuses; ack everything else without alerting.
  if (!NOTIFY_STATUSES.has(status)) {
    return new Response("ignored:status", { status: 200, headers: CORS });
  }

  // Loop guard: never alert on calls from the operator's own number or the Twilio number itself.
  const fromD = digitsOnly(from);
  const aaronD = digitsOnly(Deno.env.get("AARON_ALERT_NUMBER"));
  const twilioD = digitsOnly(Deno.env.get("TWILIO_FROM_NUMBER"));
  if (fromD && (fromD === aaronD || fromD === twilioD)) {
    return new Response("ignored:loop-guard", { status: 200, headers: CORS });
  }

  // ONE SMS via the existing send-sms operator_alert mode (targets AARON_ALERT_NUMBER server-side;
  // the recipient number never appears here). Body is exactly the caller + duration, nothing else.
  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operator_alert: true, message: `Inbound call from ${from}, ${duration}s.` }),
    });
    if (!resp.ok) {
      console.error("[inbound-call-notify] send-sms failed:", resp.status);
    }
  } catch (e) {
    // Still ack Twilio (an SMS hiccup should not make Twilio retry the callback storm).
    console.error("[inbound-call-notify] send-sms threw:", e instanceof Error ? e.message : String(e));
  }

  return new Response("ok", { status: 200, headers: CORS });
});
