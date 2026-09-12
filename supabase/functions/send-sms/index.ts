import { createClient } from "npm:@supabase/supabase-js@2";
import { getAccessibleClientIds } from "../_shared/supabase-client.ts";

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

// Normalize phone to E.164 format (+1XXXXXXXXXX)
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

// Operator identity for operator_alert (same source dispatch-critical-sms uses: the operator's
// verified MFA phone). ak@silentshieldsecurity.com.
const OPERATOR_UID = "d7edb69f-66e8-4776-9e5d-7ac54b401cfb";

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

    const callerRole = (claimsData.claims.role as string) || "";

    // WO-INBOUND-WEBHOOK-UNSIGNED — operator_alert branch. The AEGIS lead qualifier (qualifier-handoff.ts,
    // invoked by aegis-qualify / aegis-qualify-sweep with the SERVICE-ROLE key) fires a "New qualified
    // lead" SMS to the operator with NO investigation. The prior code required investigation_id/to_number
    // and returned 400 for every such call — which is why zero qualifier alerts had ever sent. Handle it
    // here: SERVICE-ROLE ONLY (a user token must never be able to page the operator), sent to the
    // operator's on-file number (same source as dispatch-critical-sms), no investigation, no comms log
    // (the CRM side records callback_notified_at on success).
    if (body.operator_alert === true) {
      if (callerRole !== "service_role") {
        return new Response(
          JSON.stringify({ error: "Forbidden: operator_alert is service-role only" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!message) {
        return new Response(
          JSON.stringify({ error: "Missing required field: message" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: op } = await supabase
        .from("user_mfa_settings")
        .select("phone_number, phone_verified")
        .eq("user_id", OPERATOR_UID)
        .maybeSingle();
      const opPhone = op?.phone_number as string | undefined;
      if (!opPhone) {
        return new Response(
          JSON.stringify({ error: "No operator phone on file" }),
          { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const tok = Deno.env.get("TWILIO_AUTH_TOKEN");
      const from = Deno.env.get("TWILIO_FROM_NUMBER");
      if (!sid || !tok || !from) {
        return new Response(
          JSON.stringify({ error: "Twilio credentials not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { "Authorization": "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: normalizePhone(opPhone), From: from, Body: String(message).slice(0, 320) }).toString(),
      });
      const result = await resp.json();
      if (!resp.ok) {
        console.error("[SendSMS] operator_alert Twilio error:", result);
        return new Response(
          JSON.stringify({ error: "Failed to send operator alert", details: result?.message }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.log(`[SendSMS] operator_alert sent (sid ${result.sid})`);
      return new Response(
        JSON.stringify({ success: true, operator_alert: true, message_sid: result.sid }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!investigation_id || !to_number || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: investigation_id, to_number, message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize recipient phone number to E.164
    const normalizedTo = normalizePhone(to_number);

    // Resolve investigation_id: accept either UUID or file_number
    const trimmedId = String(investigation_id).trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(trimmedId);

    console.log(`[SendSMS] Resolving investigation: "${trimmedId}" (isUuid: ${isUuid})`);

    let investigation;
    let invError;

    if (isUuid) {
      const result = await supabase
        .from("investigations")
        .select("id, file_number, client_id")
        .eq("id", trimmedId)
        .single();
      investigation = result.data;
      invError = result.error;
    } else {
      // Try file_number first, then ilike for flexibility
      const result = await supabase
        .from("investigations")
        .select("id, file_number, client_id")
        .eq("file_number", trimmedId)
        .single();
      investigation = result.data;
      invError = result.error;

      // If not found, try case-insensitive match
      if (invError || !investigation) {
        const result2 = await supabase
          .from("investigations")
          .select("id, file_number, client_id")
          .ilike("file_number", trimmedId)
          .single();
        investigation = result2.data;
        invError = result2.error;
      }
    }

    if (invError || !investigation) {
      console.error(`[SendSMS] Investigation not found: "${trimmedId}", error:`, invError);
      return new Response(
        JSON.stringify({ error: `Investigation not found for: ${trimmedId}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SendSMS] Resolved to investigation ${investigation.file_number} (${investigation.id})`);

    // WO-INBOUND-WEBHOOK-UNSIGNED — send-sms AUTHORIZATION (costs money per message).
    // Authentication (getClaims above) proves you're logged in; it does NOT prove you may spend on
    // THIS case. A user (any role/tenant) must have access to the investigation's client, or a leaked
    // low-priv token becomes a toll-fraud / arbitrary-SMS vector. Trusted internal service-role callers
    // bypass this check. (callerRole computed once, above.)
    if (callerRole !== "service_role") {
      const accessible = await getAccessibleClientIds(supabase, userId);
      if (!investigation.client_id || !accessible.includes(investigation.client_id)) {
        console.warn(`[SendSMS] REJECTED: user ${userId} has no access to investigation client ${investigation.client_id}`);
        return new Response(
          JSON.stringify({ error: "Forbidden: no access to this investigation" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
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

    // Send the message as-is — no visible case tag appended
    // Inbound replies are routed by matching the sender's phone number
    // to recent outbound conversations, not by requiring a tag in the reply
    const fullMessage = message;

    // Send via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const twilioBody = new URLSearchParams({
      To: normalizedTo,
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
    const entryText = `[SMS SENT — To: ${contact_name || normalizedTo} — ${now}]\n\n${message}`;
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
        contact_identifier: normalizedTo,
        channel: "sms",
        direction: "outbound",
        message_body: message,
        provider_message_id: twilioResult.sid,
        provider_status: twilioResult.status,
        platform_number: twilioFrom,
        investigation_entry_id: entry?.id || null,
        tenant_id: null,
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
