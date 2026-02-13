import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Ingest Communication Endpoint
 * 
 * Accepts incoming SMS (Twilio webhook), email forwards, or manual submissions
 * and creates investigation entries automatically.
 * 
 * Routing: Messages must include a case reference tag like #INV-2024-001
 * or the investigation file_number to be routed correctly.
 */

// Extract case reference tag from message text
function extractCaseReference(text: string): string | null {
  // Match patterns like #INV-2024-001, #2024-001, FILE-123, etc.
  const patterns = [
    /#?(INV[-\s]?\d{4}[-\s]?\d{1,5})/i,
    /#?(FILE[-\s]?\d{1,10})/i,
    /#?(\d{4}[-\s]\d{3,5})/,
    /(?:case|file|ref|inv)[:\s#]*([A-Z0-9\-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].replace(/\s/g, '-').toUpperCase();
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const contentType = req.headers.get("content-type") || "";

    let source = "unknown";
    let senderIdentifier = "";
    let messageBody = "";
    let metadata: Record<string, string> = {};

    // --- Twilio SMS Webhook (application/x-www-form-urlencoded) ---
    if (contentType.includes("application/x-www-form-urlencoded")) {
      source = "sms";
      const formData = await req.formData();
      senderIdentifier = formData.get("From")?.toString() || "";
      messageBody = formData.get("Body")?.toString() || "";
      metadata = {
        twilio_sid: formData.get("MessageSid")?.toString() || "",
        from: senderIdentifier,
        to: formData.get("To")?.toString() || "",
        num_media: formData.get("NumMedia")?.toString() || "0",
      };
    }
    // --- JSON body (email forward, manual, or API call) ---
    else {
      const body = await req.json();
      source = body.source || "manual";
      senderIdentifier = body.sender || body.from || "";
      messageBody = body.message || body.body || body.text || "";
      metadata = body.metadata || {};
    }

    if (!messageBody.trim()) {
      // For Twilio, return TwiML empty response
      if (source === "sms") {
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
          { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: "No message body provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract case reference
    const caseRef = extractCaseReference(messageBody);

    if (!caseRef) {
      console.log(`[IngestComm] No case reference found in message from ${senderIdentifier}`);

      // For Twilio, reply asking for a case reference
      if (source === "sms") {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>No case reference found. Please include a file number (e.g. #INV-2024-001) in your message.</Message></Response>`,
          { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: "No case reference tag found in message",
          hint: "Include a file number like #INV-2024-001 in your message"
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find the investigation by file_number
    const { data: investigation, error: lookupError } = await supabase
      .from("investigations")
      .select("id, file_number, client_id")
      .or(`file_number.ilike.%${caseRef}%`)
      .limit(1)
      .maybeSingle();

    if (lookupError || !investigation) {
      console.log(`[IngestComm] Investigation not found for ref: ${caseRef}`);

      if (source === "sms") {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Case ${caseRef} not found. Please verify the file number.</Message></Response>`,
          { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, error: `Investigation not found for reference: ${caseRef}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build entry text with source context
    const sourceLabel = source === "sms" ? "SMS" : source === "email" ? "Email" : source;
    const timestamp = new Date().toISOString();
    const entryText = `[${sourceLabel.toUpperCase()} — ${senderIdentifier || "Unknown sender"} — ${timestamp}]\n\n${messageBody}`;

    // Create investigation entry
    const { data: entry, error: entryError } = await supabase
      .from("investigation_entries")
      .insert({
        investigation_id: investigation.id,
        entry_text: entryText,
        created_by_name: `${sourceLabel} Ingest (${senderIdentifier || "auto"})`,
      })
      .select("id, created_at")
      .single();

    if (entryError) {
      console.error("[IngestComm] Failed to create entry:", entryError);
      throw entryError;
    }

    console.log(`[IngestComm] Created entry ${entry.id} for case ${investigation.file_number} from ${source}`);

    // For Twilio, return TwiML confirmation
    if (source === "sms") {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Logged to case ${investigation.file_number}.</Message></Response>`,
        { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Communication logged to case ${investigation.file_number}`,
        entry_id: entry.id,
        investigation_id: investigation.id,
        source,
        case_reference: caseRef,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[IngestComm] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
