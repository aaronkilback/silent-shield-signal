import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Send SMS Edge Function
 * 
 * Sends an outbound SMS via Twilio and logs it to:
 * 1. investigation_communications (for thread tracking)
 * 2. investigation_entries (for unified timeline)
 * 
 * Supports multi-investigator conversations per case.
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = claimsData.claims.sub as string;

    // Parse request
    const body = await req.json();
    const {
      investigation_id,
      to_number,
      message,
      contact_name,
    } = body;

    if (!investigation_id || !to_number || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: investigation_id, to_number, message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve investigation_id: accept either UUID or file_number
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let invFilter: { column: string; value: string };
    if (uuidRegex.test(investigation_id)) {
      invFilter = { column: "id", value: investigation_id };
    } else {
      invFilter = { column: "file_number", value: investigation_id };
    }

    const { data: investigation, error: invError } = await supabase
      .from("investigations")
      .select("id, file_number, client_id, tenant_id")
      .eq(invFilter.column, invFilter.value)
      .single();

    if (invError || !investigation) {
      return new Response(
        JSON.stringify({ error: "Investigation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Twilio credentials
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");

    if (!twilioSid || !twilioToken || !twilioFrom) {
      return new Response(
        JSON.stringify({ error: "Twilio credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Append case reference tag to message for reply routing
    const caseTag = `[${investigation.file_number}]`;
    const fullMessage = message.includes(investigation.file_number)
      ? message
      : `${message}\n\n${caseTag}`;

    // Send via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const twilioBody = new URLSearchParams({
      To: to_number,
      From: twilioFrom,
      Body: fullMessage,
    });

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${twilioSid}:${twilioToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: twilioBody.toString(),
    });

    const twilioResult = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error("[SendSMS] Twilio error:", twilioResult);
      return new Response(
        JSON.stringify({ error: "Failed to send SMS", details: twilioResult.message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();

    // Get investigator profile name
    const { data: profile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", userId)
      .single();

    const investigatorName = profile?.name || "Unknown Investigator";

    // Create investigation entry for unified timeline
    const entryText = `[SMS SENT — To: ${contact_name || to_number} — ${now}]\n\n${message}`;
    const { data: entry, error: entryError } = await supabase
      .from("investigation_entries")
      .insert({
        investigation_id: investigation.id,
        entry_text: entryText,
        created_by_name: investigatorName,
      })
      .select("id")
      .single();

    if (entryError) {
      console.error("[SendSMS] Failed to create entry:", entryError);
    }

    // Log to investigation_communications
    const { data: comm, error: commError } = await supabase
      .from("investigation_communications")
      .insert({
        investigation_id: investigation.id,
        investigator_user_id: userId,
        contact_name: contact_name || null,
        contact_identifier: to_number,
        channel: "sms",
        direction: "outbound",
        message_body: message,
        provider_message_id: twilioResult.sid,
        provider_status: twilioResult.status,
        platform_number: twilioFrom,
        investigation_entry_id: entry?.id || null,
        tenant_id: investigation.tenant_id || null,
        message_timestamp: now,
      })
      .select("id")
      .single();

    if (commError) {
      console.error("[SendSMS] Failed to log communication:", commError);
    }

    console.log(`[SendSMS] Sent SMS to ${to_number} for case ${investigation.file_number} by ${investigatorName}`);

    return new Response(
      JSON.stringify({
        success: true,
        message_sid: twilioResult.sid,
        communication_id: comm?.id,
        entry_id: entry?.id,
        investigation_file_number: investigation.file_number,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[SendSMS] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
