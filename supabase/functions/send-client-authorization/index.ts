import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

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

    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { compliance_id, scan_type, target_name, scope_summary, data_retention_date, client_name, client_email } = await req.json();

    if (!client_name || !client_email || !target_name || !scan_type) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: corsHeaders });
    }

    // Generate unique token and OTP
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const now = new Date();
    const tokenExpiry = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72 hours
    const otpExpiry = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

    // Store in DB
    const { data: authRecord, error: insertError } = await supabase
      .from("client_authorizations")
      .insert({
        compliance_id: compliance_id || null,
        scan_type,
        target_name,
        scope_summary: scope_summary || null,
        data_retention_date: data_retention_date || null,
        client_name,
        client_email,
        token,
        token_expires_at: tokenExpiry.toISOString(),
        otp_code: otp,
        otp_expires_at: otpExpiry.toISOString(),
        created_by: user.id,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    const authUrl = `https://fortress.silentshieldsecurity.com/authorize/${token}`;
    const retentionText = data_retention_date
      ? `All findings will be securely deleted by <strong>${new Date(data_retention_date).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}</strong>.`
      : "";

    // Send email via Resend
    const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);
    const { error: emailError } = await resend.emails.send({
      from: "Silent Shield Security <no-reply@silentshieldsecurity.com>",
      to: client_email,
      subject: `Authorization Required: Vulnerability Scan for ${target_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; padding: 40px; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #f8fafc; font-size: 22px; margin: 0;">Silent Shield Security</h1>
            <p style="color: #94a3b8; margin: 4px 0 0;">Vulnerability Scan Authorization Request</p>
          </div>

          <p style="color: #cbd5e1;">Dear <strong style="color:#f8fafc;">${client_name}</strong>,</p>
          <p style="color: #cbd5e1;">
            You have been identified as the authorizing party for a security vulnerability scan.
            Please review the details below and authorize the scan using the secure link provided.
          </p>

          <div style="background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 20px; margin: 24px 0;">
            <h3 style="color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px;">Scan Details</h3>
            <p style="margin: 6px 0; color: #e2e8f0;"><strong style="color:#94a3b8;">Subject:</strong> ${target_name}</p>
            <p style="margin: 6px 0; color: #e2e8f0;"><strong style="color:#94a3b8;">Scan Type:</strong> ${scan_type.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}</p>
            ${scope_summary ? `<p style="margin: 6px 0; color: #e2e8f0;"><strong style="color:#94a3b8;">Scope:</strong> ${scope_summary}</p>` : ""}
            ${retentionText ? `<p style="margin: 6px 0; color: #e2e8f0;"><strong style="color:#94a3b8;">Data Retention:</strong> ${retentionText}</p>` : ""}
          </div>

          <div style="background: #1e3a5f; border: 1px solid #2563eb; border-radius: 6px; padding: 20px; margin: 24px 0; text-align: center;">
            <p style="color: #93c5fd; margin: 0 0 8px; font-size: 13px;">Your one-time verification code (valid 30 minutes)</p>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #f8fafc; font-family: monospace;">${otp}</div>
          </div>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${authUrl}" style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Review & Authorize Scan
            </a>
          </div>

          <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 20px;">
            This authorization link expires in 72 hours. If you did not expect this request, please contact us immediately.<br/>
            Silent Shield Security · fortress.silentshieldsecurity.com
          </p>
        </div>
      `,
    });

    if (emailError) throw emailError;

    return new Response(
      JSON.stringify({ id: authRecord.id, status: "pending" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[send-client-authorization]", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
