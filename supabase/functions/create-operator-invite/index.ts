// create-operator-invite — generates a one-time AEGIS Mobile invite
//
// Distinct from the older tenant-level `create-invite` function:
// this one is conversation-scoped, single-use, 15-minute expiry, and
// produces a token + 6-digit PIN for QR / typed entry alongside an
// optional email magic link. Used by the mobile app's
// "Add operators → New to Fortress" flow.
//
// Auth: caller must be authenticated. For conversation-scoped invites
// the caller must already be a participant of that conversation.
//
// Body:
//   {
//     conversation_id?: string, // auto-add to conv on signup
//     client_id?: string,       // creates client_users mapping on accept
//     role?: app_role,          // assigns user_role on accept
//     email?: string            // also email a magic link
//   }
// Response:
//   { token, pin, expires_at, invite_url, emailed }

import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INVITE_BASE_URL =
  Deno.env.get("INVITE_BASE_URL") || "https://aegis.silentshieldsecurity.com/invite";

function generatePin(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // skip 0/O/1/I
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let pin = "";
  for (let i = 0; i < 6; i++) pin += alphabet[bytes[i] % alphabet.length];
  return pin;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "missing Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey =
      Deno.env.get("SERVICE_ROLE_JWT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const { data: userResp, error: userErr } = await admin.auth.getUser(
      auth.replace(/^Bearer\s+/i, "")
    );
    if (userErr || !userResp?.user) {
      return new Response(JSON.stringify({ error: "invalid auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = userResp.user.id;

    const body = await req.json().catch(() => ({}));
    const conversationId: string | null = body.conversation_id ?? null;
    const clientId: string | null = body.client_id ?? null;
    const role: string | null = body.role ?? null;
    const email: string | null = body.email ?? null;

    if (conversationId) {
      const { data: pcheck } = await admin
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", callerId)
        .maybeSingle();
      if (!pcheck) {
        return new Response(
          JSON.stringify({ error: "not a participant of that conversation" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const pin = generatePin();
    const { data: invite, error: insErr } = await admin
      .from("operator_invites")
      .insert({
        pin,
        conversation_id: conversationId,
        client_id: clientId,
        role,
        email,
        created_by: callerId,
      })
      .select("token, pin, expires_at")
      .single();
    if (insErr || !invite) {
      console.error("[create-operator-invite] insert failed:", insErr);
      return new Response(
        JSON.stringify({ error: insErr?.message ?? "could not create invite" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const inviteUrl = `${INVITE_BASE_URL}/${invite.token}`;
    let emailed = false;

    if (email) {
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      const fromEmail =
        Deno.env.get("RESEND_FROM_EMAIL") || "AEGIS Mobile <noreply@silentshieldsecurity.com>";
      if (RESEND_API_KEY) {
        try {
          const resend = new Resend(RESEND_API_KEY);
          await resend.emails.send({
            from: fromEmail,
            to: email,
            subject: "You've been invited to AEGIS Mobile",
            html: `
              <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:32px 16px;background:#0f172a;color:#f8fafc;border-radius:12px;">
                <h1 style="font-size:22px;margin:0 0 16px;">You've been invited to AEGIS Mobile</h1>
                <p style="line-height:1.6;color:#cbd5e1;">An operator has invited you to the AEGIS Mobile companion to the Fortress security intelligence platform. The invite below adds you straight to their team conversation.</p>
                <p style="text-align:center;margin:28px 0;">
                  <a href="${inviteUrl}" style="display:inline-block;padding:14px 22px;background:#06b6d4;color:#0f172a;border-radius:8px;text-decoration:none;font-weight:700;">Accept invite</a>
                </p>
                <p style="color:#cbd5e1;line-height:1.6;">Or enter this 6-digit code on the AEGIS sign-in screen: <strong style="font-size:22px;letter-spacing:5px;color:#22d3ee;">${pin}</strong></p>
                <p style="color:#64748b;font-size:12px;margin-top:32px;">This invite expires in 15 minutes and can only be used once.</p>
              </div>
            `,
          });
          emailed = true;
        } catch (mailErr) {
          console.error("[create-operator-invite] email send failed:", mailErr);
        }
      }
    }

    return new Response(
      JSON.stringify({
        token: invite.token,
        pin: invite.pin,
        expires_at: invite.expires_at,
        invite_url: inviteUrl,
        emailed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[create-operator-invite] unhandled:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
