// WO-INBOUND-WEBHOOK-UNSIGNED — provider-authenticity verification for inbound webhooks.
//
// Public inbound webhooks run under verify_jwt=false (the provider has no Supabase JWT), so the
// ONLY thing standing between the internet and a service-role write is provider-signature validation.
// These helpers verify that a request genuinely came from the named provider. FAIL CLOSED: a missing
// signing secret or a bad signature must REJECT, never pass — an unverifiable request is treated as
// hostile (spoofable From/recipient otherwise writes into investigation records).

const enc = new TextEncoder();

async function hmac(hash: "SHA-1" | "SHA-256", key: string, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Length-independent, constant-time-ish compare (avoids leaking match position via early return).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Twilio request signature (X-Twilio-Signature).
 * signature = base64( HMAC-SHA1( fullUrl + concat(sortedKey + value for each POST param), authToken ) )
 * `fullUrl` MUST be the exact URL Twilio was configured to POST to. Behind a proxy the request URL can
 * differ from what Twilio signed — pass an override (TWILIO_WEBHOOK_URL) when that is the case.
 */
export async function verifyTwilioSignature(
  fullUrl: string,
  params: Record<string, string>,
  headerSignature: string | null,
  authToken: string | undefined,
): Promise<boolean> {
  if (!authToken || !headerSignature) return false; // fail closed: no secret or no header → reject
  let data = fullUrl;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = toB64(await hmac("SHA-1", authToken, data));
  return safeEqual(expected, headerSignature);
}

/**
 * Mailgun inbound-webhook signature.
 * signature = hex( HMAC-SHA256( timestamp + token, signingKey ) )
 * (Mailgun sends timestamp, token, signature as form fields on every inbound POST.)
 */
export async function verifyMailgunSignature(
  timestamp: string | undefined,
  token: string | undefined,
  signature: string | undefined,
  signingKey: string | undefined,
): Promise<boolean> {
  if (!signingKey || !timestamp || !token || !signature) return false; // fail closed
  const expected = toHex(await hmac("SHA-256", signingKey, timestamp + token));
  return safeEqual(expected, signature);
}
