import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Ingest Email Endpoint
 * 
 * Receives Mailgun inbound email webhooks (multipart/form-data)
 * and routes them to the correct investigation based on the recipient address.
 * 
 * Each investigation has a unique intake_email_tag, so emails sent to
 * {tag}@intake.yourdomain.com are auto-routed and logged as entries.
 * 
 * Also accepts JSON for manual/programmatic email forwarding.
 */

function extractTagFromRecipient(recipient: string): string | null {
  // Extract the local part before @ from the recipient
  // e.g., "inv-2024-001-a3f8b2@intake.fortress.com" → "inv-2024-001-a3f8b2"
  const match = recipient.match(/<?([^@<]+)@/);
  return match ? match[1].trim().toLowerCase() : null;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const contentType = req.headers.get("content-type") || "";

    let sender = "";
    let subject = "";
    let bodyText = "";
    let recipientRaw = "";
    let metadata: Record<string, string> = {};

    // --- Mailgun webhook (multipart/form-data) ---
    if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      sender = formData.get("sender")?.toString() || formData.get("from")?.toString() || "";
      subject = formData.get("subject")?.toString() || "";
      recipientRaw = formData.get("recipient")?.toString() || formData.get("To")?.toString() || "";
      bodyText = formData.get("stripped-text")?.toString() 
        || formData.get("body-plain")?.toString() 
        || "";
      
      // Fallback to HTML body if no plain text
      if (!bodyText) {
        const htmlBody = formData.get("stripped-html")?.toString() || formData.get("body-html")?.toString() || "";
        if (htmlBody) bodyText = stripHtmlTags(htmlBody);
      }

      metadata = {
        message_id: formData.get("Message-Id")?.toString() || "",
        timestamp: formData.get("timestamp")?.toString() || "",
        token: formData.get("token")?.toString() || "",
        signature: formData.get("signature")?.toString() || "",
        attachment_count: formData.get("attachment-count")?.toString() || "0",
      };
    }
    // --- JSON body (manual forward / API) ---
    else {
      const body = await req.json();
      sender = body.from || body.sender || "";
      subject = body.subject || "";
      recipientRaw = body.to || body.recipient || "";
      bodyText = body.body || body.text || body.message || "";
      metadata = body.metadata || {};
    }

    if (!bodyText.trim() && !subject.trim()) {
      return errorResponse("No email content provided", 400);
    }

    // Extract the intake tag from recipient address
    const tag = extractTagFromRecipient(recipientRaw);
    
    if (!tag) {
      console.error(`[IngestEmail] Could not extract tag from recipient: ${recipientRaw}`);
      return errorResponse("Could not determine target investigation from recipient address", 422);
    }

    // Look up investigation by intake_email_tag
    const { data: investigation, error: invError } = await supabase
      .from("investigations")
      .select("id, file_number, client_id")
      .eq("intake_email_tag", tag)
      .maybeSingle();

    if (invError) throw invError;

    if (!investigation) {
      console.log(`[IngestEmail] No investigation found for tag: ${tag}`);
      return errorResponse(`No investigation found for email tag: ${tag}`, 404);
    }

    console.log(`[IngestEmail] Matched tag "${tag}" → case ${investigation.file_number}`);

    // Build structured entry text
    const timestamp = new Date().toISOString();
    const entryText = [
      `[EMAIL RECEIVED — From: ${sender} — ${timestamp}]`,
      subject ? `Subject: ${subject}` : null,
      '',
      bodyText,
    ].filter(Boolean).join('\n');

    // Create investigation entry
    const { data: entry, error: entryError } = await supabase
      .from("investigation_entries")
      .insert({
        investigation_id: investigation.id,
        entry_text: entryText,
        created_by_name: `Email Ingest (${sender || "unknown"})`,
      })
      .select("id, created_at")
      .single();

    if (entryError) {
      console.error("[IngestEmail] Failed to create entry:", entryError);
      throw entryError;
    }

    // Log to investigation_communications for thread tracking
    const { data: comm, error: commError } = await supabase
      .from("investigation_communications")
      .insert({
        investigation_id: investigation.id,
        investigator_user_id: "00000000-0000-0000-0000-000000000000",
        contact_name: sender.match(/^([^<]+)</)?.[1]?.trim() || null,
        contact_identifier: sender,
        channel: "email",
        direction: "inbound",
        message_body: subject ? `[${subject}] ${bodyText}` : bodyText,
        provider_message_id: metadata.message_id || null,
        provider_status: "received",
        investigation_entry_id: entry.id,
        tenant_id: null,
        message_timestamp: timestamp,
      })
      .select("id")
      .single();

    if (commError) {
      console.error("[IngestEmail] Failed to log communication:", commError);
      // Non-fatal
    }

    console.log(`[IngestEmail] Created entry ${entry.id} + comm ${comm?.id} for case ${investigation.file_number}`);

    return successResponse({
      success: true,
      message: `Email logged to case ${investigation.file_number}`,
      entry_id: entry.id,
      communication_id: comm?.id,
      investigation_id: investigation.id,
      tag,
    }, 201);

  } catch (error) {
    console.error("[IngestEmail] Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
