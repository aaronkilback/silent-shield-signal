/**
 * Cloudflare Email Worker — intel@silentshieldsecurity.com
 *
 * Receives inbound emails via Cloudflare Email Routing, parses attachments,
 * and forwards them to the Fortress ingest-email-intel Supabase function.
 *
 * Setup:
 *   1. Generate a shared secret:  openssl rand -hex 32
 *   2. wrangler secret put EMAIL_INGEST_SECRET   (paste the secret)
 *      supabase secrets set EMAIL_INGEST_SECRET=...   (same value)
 *      supabase functions deploy ingest-email-intel
 *   3. wrangler deploy
 *   4. In Cloudflare: Email Routing → Routes → intel@silentshieldsecurity.com
 *      → Action: Send to Worker → select this worker
 *
 * Dependencies: postal-mime
 */

import PostalMime from "postal-mime";

// Maximum total attachment size we will base64-encode and forward (50 MB).
// Email Routing already caps email size; this is a defensive secondary cap
// to keep the worker memory footprint bounded.
const MAX_FORWARDED_BYTES = 50 * 1024 * 1024;

// Mime type → file extension fallback (used only when att.filename is missing).
function fallbackFilename(ct) {
  if (/wordprocessingml|officedocument\.wordprocessing/i.test(ct)) return "attachment.docx";
  if (/msword/i.test(ct)) return "attachment.doc";
  if (/pdf/i.test(ct)) return "attachment.pdf";
  return "attachment.bin";
}

// Sanitize a filename: strip path separators and control chars.
function safeFilename(name) {
  return String(name).replace(/[\/\\\x00-\x1f]/g, "_").slice(0, 200);
}

// Convert ArrayBuffer/Uint8Array to base64 in 32 KB chunks.
// The naive `for(...) binary += String.fromCharCode(b)` is O(N^2) and will
// stack-overflow / OOM on multi-MB PDFs (real 3Si reports). Chunked
// String.fromCharCode.apply is bounded.
function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32 KB
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default {
  async email(message, env, ctx) {
    const sender = message.from;
    let stage = "init";
    try {
      stage = "parse";
      const rawEmail = await new Response(message.raw).arrayBuffer();
      const email = await new PostalMime().parse(rawEmail);

      stage = "filter_attachments";
      let totalBytes = 0;
      const attachments = [];
      for (const att of (email.attachments || [])) {
        const ct = att.mimeType || "application/octet-stream";
        if (!ct.includes("pdf") && !ct.includes("word") && !ct.includes("officedocument")) continue;

        const size = att.content?.byteLength ?? att.content?.length ?? 0;
        if (totalBytes + size > MAX_FORWARDED_BYTES) {
          throw new Error(`attachment ${att.filename || "?"} would exceed ${MAX_FORWARDED_BYTES} byte cap (have ${totalBytes}, adding ${size})`);
        }
        totalBytes += size;

        attachments.push({
          filename: safeFilename(att.filename || fallbackFilename(ct)),
          content_type: ct,
          content: arrayBufferToBase64(att.content),
        });
      }

      if (attachments.length === 0) {
        console.log(`[email-forwarder] No PDF/Word attachments from ${sender} — skipping`);
        return;
      }

      console.log(`[email-forwarder] Forwarding ${attachments.length} attachment(s), ${totalBytes} bytes from ${sender}`);

      const headers = { "Content-Type": "application/json" };
      // Shared-secret auth so a leaked function URL can't be used to forge
      // intelligence documents. Worker side is set via `wrangler secret put
      // EMAIL_INGEST_SECRET`; function side via `supabase secrets set`.
      if (env.EMAIL_INGEST_SECRET) {
        headers["X-Ingest-Secret"] = env.EMAIL_INGEST_SECRET;
      }

      stage = "post_supabase";
      const resp = await fetch(env.SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "cloudflare.email",
          data: {
            from: sender,
            to: message.to,
            subject: email.subject || "",
            text: email.text || "",
            attachments,
          },
        }),
      });

      stage = "read_response";
      if (!resp.ok) {
        const body = await resp.text().catch(() => "<unreadable body>");
        // Throw so Cloudflare Email Routing surfaces the failure to the
        // sender (bounce) rather than silently dropping the email. Better
        // a noisy bounce than lost intelligence.
        throw new Error(`Supabase ${resp.status} (${stage}): ${body.slice(0, 500)}`);
      }

      const result = await resp.json().catch(() => ({}));
      console.log(`[email-forwarder] Supabase processed ${result?.processed ?? "?"} document(s)`);

    } catch (err) {
      console.error(`[email-forwarder] Failed at stage=${stage} from=${sender}:`, err?.message || err);
      // Re-throw so Cloudflare bounces the email — silently swallowing
      // means lost intelligence the operator never sees.
      throw err;
    }
  },
};
