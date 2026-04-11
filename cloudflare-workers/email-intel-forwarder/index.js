/**
 * Cloudflare Email Worker — intel@silentshieldsecurity.com
 *
 * Receives inbound emails via Cloudflare Email Routing, parses attachments,
 * and forwards them to the Fortress ingest-email-intel Supabase function.
 *
 * Setup:
 *   1. Deploy this worker: wrangler deploy
 *   2. In wrangler.toml set SUPABASE_FUNCTION_URL
 *   3. In Cloudflare: Email Routing → Routes → intel@silentshieldsecurity.com
 *      → Action: Send to Worker → select this worker
 *
 * Dependencies: postal-mime (npm install postal-mime)
 */

import PostalMime from "postal-mime";

export default {
  async email(message, env, ctx) {
    try {
      // Read the raw email stream
      const rawEmail = await new Response(message.raw).arrayBuffer();

      // Parse MIME
      const parser = new PostalMime();
      const email = await parser.parse(rawEmail);

      // Filter to PDF / Office attachments only
      const attachments = [];
      for (const att of (email.attachments || [])) {
        const ct = att.mimeType || "application/octet-stream";
        if (!ct.includes("pdf") && !ct.includes("word") && !ct.includes("officedocument")) continue;

        // Convert binary to base64
        const bytes = new Uint8Array(att.content);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

        attachments.push({
          filename: att.filename || "attachment.pdf",
          content_type: ct,
          content: btoa(binary),
        });
      }

      if (attachments.length === 0) {
        console.log(`[email-forwarder] No PDF attachments in email from ${message.from} — skipping`);
        return;
      }

      console.log(`[email-forwarder] Forwarding ${attachments.length} attachment(s) from ${message.from}`);

      const resp = await fetch(env.SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "cloudflare.email",
          data: {
            from: message.from,
            to: message.to,
            subject: email.subject || "",
            text: email.text || "",
            attachments,
          },
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Supabase function returned ${resp.status}: ${body}`);
      }

      const result = await resp.json();
      console.log(`[email-forwarder] Supabase processed ${result.processed} document(s)`);

    } catch (err) {
      // Log but don't throw — throwing causes Cloudflare to bounce the email
      console.error("[email-forwarder] Error:", err.message);
    }
  },
};
