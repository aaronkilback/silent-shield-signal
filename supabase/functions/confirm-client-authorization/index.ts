import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { token, action, otp } = await req.json();

    if (!token) return new Response(JSON.stringify({ error: "Missing token" }), { status: 400, headers: corsHeaders });

    // Fetch the authorization record
    const { data: record, error: fetchError } = await supabase
      .from("client_authorizations")
      .select("id, client_name, client_email, target_name, scan_type, scope_summary, data_retention_date, status, token_expires_at, otp_code, otp_expires_at, otp_attempts, authorized_at")
      .eq("token", token)
      .single();

    if (fetchError || !record) {
      return new Response(JSON.stringify({ error: "Invalid or expired authorization link" }), { status: 404, headers: corsHeaders });
    }

    // Check token expiry
    if (new Date(record.token_expires_at) < new Date()) {
      await supabase.from("client_authorizations").update({ status: "expired" }).eq("id", record.id);
      return new Response(JSON.stringify({ error: "This authorization link has expired" }), { status: 410, headers: corsHeaders });
    }

    // GET details (no OTP needed)
    if (action === "get_details") {
      return new Response(JSON.stringify({
        client_name: record.client_name,
        target_name: record.target_name,
        scan_type: record.scan_type,
        scope_summary: record.scope_summary,
        data_retention_date: record.data_retention_date,
        status: record.status,
        authorized_at: record.authorized_at,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // CONFIRM: verify OTP and mark authorized
    if (action === "confirm") {
      if (record.status === "authorized") {
        return new Response(JSON.stringify({ success: true, already_authorized: true }), { headers: corsHeaders });
      }

      // Check OTP attempt limit
      if (record.otp_attempts >= 5) {
        return new Response(JSON.stringify({ error: "Too many attempts. Please request a new authorization." }), { status: 429, headers: corsHeaders });
      }

      // Check OTP expiry
      if (new Date(record.otp_expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "Verification code has expired. Please request a new one." }), { status: 410, headers: corsHeaders });
      }

      if (!otp || otp !== record.otp_code) {
        await supabase.from("client_authorizations").update({ otp_attempts: record.otp_attempts + 1 }).eq("id", record.id);
        const remaining = 4 - record.otp_attempts;
        return new Response(JSON.stringify({ error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` }), { status: 400, headers: corsHeaders });
      }

      // OTP valid — record authorization
      const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
      const ua = req.headers.get("user-agent") || "unknown";

      await supabase.from("client_authorizations").update({
        status: "authorized",
        authorized_at: new Date().toISOString(),
        ip_address: ip,
        user_agent: ua,
      }).eq("id", record.id);

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });

  } catch (err: any) {
    console.error("[confirm-client-authorization]", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
