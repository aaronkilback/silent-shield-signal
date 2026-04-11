/**
 * ingest-email-intel
 *
 * Webhook endpoint that receives forwarded security intelligence emails
 * (e.g. weekly 3Si Risk Strategies reports for Petronas Canada) and
 * automatically processes PDF attachments into the Fortress intelligence
 * pipeline:
 *
 *   Email arrives → PDF extracted → archival_documents record created
 *   → process-security-report runs → expert_knowledge updated
 *   → knowledge-synthesizer forms agent beliefs
 *
 * Uses Resend inbound email webhooks.
 *
 * Setup:
 *   1. Deploy this function
 *   2. Set RESEND_API_KEY in Supabase secrets
 *   3. In Resend: Domains → <your domain> → Inbound → Add webhook URL:
 *      https://<project>.supabase.co/functions/v1/ingest-email-intel
 *   4. Petronas forwards (or adds) the Fortress inbound address to the
 *      3Si distribution list
 *
 * Sender → client routing is configured in SENDER_CLIENT_MAP below.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Sender → client routing ────────────────────────────────────────────────
const SENDER_CLIENT_MAP: { pattern: RegExp; client_id: string; client_name: string }[] = [
  { pattern: /3si\.ca/i,    client_id: "0f5c809d-60ec-4252-b94b-1f4b6c8ac95d", client_name: "Petronas Canada" },
  { pattern: /petronas/i,   client_id: "0f5c809d-60ec-4252-b94b-1f4b6c8ac95d", client_name: "Petronas Canada" },
  // Add more: { pattern: /securitas\.com/i, client_id: "...", client_name: "..." },
];

function resolveClient(from: string, subject: string, body: string): { client_id: string; client_name: string } | null {
  const haystack = `${from} ${subject} ${body}`.toLowerCase();
  for (const mapping of SENDER_CLIENT_MAP) {
    if (mapping.pattern.test(haystack)) return { client_id: mapping.client_id, client_name: mapping.client_name };
  }
  return null;
}

function detectProvider(from: string): string {
  if (/3si\.ca/i.test(from))           return "3Si Risk Strategies";
  if (/securitas/i.test(from))         return "Securitas";
  if (/garda/i.test(from))             return "GardaWorld";
  if (/control\s*risks/i.test(from))   return "Control Risks";
  return "unknown";
}

// ─── Decode base64 attachment content ────────────────────────────────────────
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const payload = await req.json();

    if (payload.type !== "cloudflare.email") {
      return new Response(JSON.stringify({ ok: true, message: "ignored_event_type" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data    = payload.data;
    const from    = String(data.from || "");
    const subject = String(data.subject || "");
    const bodyText = String(data.text || "");

    const rawAttachments: { filename: string; content_type: string; content: string }[] =
      (data.attachments || []);

    console.log(`[ingest-email-intel] cloudflare.email | from=${from} | subject=${subject} | attachments=${rawAttachments.length}`);

    if (rawAttachments.length === 0) {
      console.log("[ingest-email-intel] No supported attachments — ignoring");
      return new Response(JSON.stringify({ ok: true, message: "no_attachments" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = resolveClient(from, subject, bodyText);
    if (!client) {
      console.warn(`[ingest-email-intel] Could not resolve client for sender: ${from}`);
    }

    const processed: { filename: string; document_id: string }[] = [];

    for (const att of rawAttachments) {
      const bytes = base64ToBytes(att.content);

      const ext         = att.filename.split(".").pop() || "pdf";
      const storageName = `email-intel/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { data: storageData, error: storageErr } = await supabase.storage
        .from("ai-chat-attachments")
        .upload(storageName, bytes, { contentType: att.content_type, upsert: false });

      if (storageErr || !storageData) {
        console.error(`[ingest-email-intel] Storage upload failed for ${att.filename}:`, storageErr?.message);
        continue;
      }

      const { data: doc, error: docErr } = await supabase
        .from("archival_documents")
        .insert({
          filename: att.filename,
          file_type: att.content_type,
          file_size: bytes.byteLength,
          storage_path: storageName,
          client_id: client?.client_id || null,
          tags: ["email-intel", "automated-ingest"],
          content_text: `Processing email attachment: ${att.filename}...`,
          metadata: {
            source: "email_intel",
            from,
            subject,
            storage_bucket: "ai-chat-attachments",
            provider: detectProvider(from),
            client_name: client?.client_name || "unknown",
            processing_status: "pending",
            ingested_at: new Date().toISOString(),
          },
        })
        .select("id")
        .single();

      if (docErr || !doc) {
        console.error(`[ingest-email-intel] archival_documents insert failed:`, docErr?.message);
        continue;
      }

      console.log(`[ingest-email-intel] Created document ${doc.id} for ${att.filename}`);
      processed.push({ filename: att.filename, document_id: doc.id });

      // Fire process-security-report in background
      fetch(`${supabaseUrl}/functions/v1/process-security-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
        body: JSON.stringify({ documentId: doc.id }),
      }).then(r => {
        if (!r.ok) console.warn(`[ingest-email-intel] process-security-report returned ${r.status} for ${doc.id}`);
        else       console.log(`[ingest-email-intel] process-security-report fired for ${doc.id}`);
      }).catch(e => console.error(`[ingest-email-intel] process-security-report fire failed:`, e));
    }

    // Log to monitoring_history so watchdog tracks it
    await supabase.from("monitoring_history").insert({
      source_name: `email-intel:${from}`,
      scan_completed_at: new Date().toISOString(),
      items_found: processed.length,
      raw_data: { from, subject, documents_created: processed },
    }).catch(() => {});

    return new Response(
      JSON.stringify({ ok: true, processed: processed.length, documents: processed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[ingest-email-intel] Handler error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
