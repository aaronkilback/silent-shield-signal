// send-tenant-invitation
// ─────────────────────────────────────────────────────────────────────────────
// Issues a single-use, expiring tenant invitation. Replaces the prior
// admin-creates-user-with-temp-password flow.
//
// Caller must be:
//   - super_admin, OR
//   - has_role(user, 'admin') AND tenant_users.role IN ('admin','owner') for the
//     target tenant.
//
// Flow:
//   1. Verify caller JWT + admin-of-tenant via RLS-respecting client.
//   2. INSERT a row into public.tenant_invitations (RLS gates the insert too,
//      belt-and-braces).
//   3. Send Resend email containing a signed link to
//        ${PUBLIC_APP_URL}/accept-tenant-invite?token=<token>
//   4. Return invitation_id + redacted token preview.
//
// Required env:
//   RESEND_API_KEY
//   PUBLIC_APP_URL (defaults to https://fortress.silentshieldsecurity.com)

import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://fortress.silentshieldsecurity.com";

interface TenantInvitationRequest {
  tenantId: string;
  email: string;
  role?: "analyst" | "admin" | "owner" | "viewer";       // tenant_role
  appRole?: "analyst" | "admin" | "viewer";              // app_role
  inviterName?: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Unauthorized", 401);
    }

    // RLS-respecting client — caller's JWT is forwarded, so the INSERT below
    // is governed by the ti_admin_manage policy on tenant_invitations.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const body: TenantInvitationRequest = await req.json();
    const { tenantId, email } = body;
    const role = body.role ?? "analyst";
    const appRole = body.appRole ?? "analyst";

    if (!tenantId || !email) {
      return errorResponse("tenantId and email are required", 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorResponse("Invalid email address", 400);
    }

    // Resolve tenant name (for the email body). The RLS policy on tenants
    // restricts SELECT to members; the inviting admin is a member so this works.
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant) {
      return errorResponse("Tenant not found or you do not have access", 404);
    }

    // Resolve inviter's display name
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .single();
    const inviterName = body.inviterName ?? inviterProfile?.name ?? "Your administrator";

    // Insert invitation (RLS will reject if caller is not an admin of this tenant)
    const { data: invitation, error: inviteError } = await supabase
      .from("tenant_invitations")
      .insert({
        tenant_id: tenantId,
        email: email.trim().toLowerCase(),
        role,
        app_role: appRole,
        invited_by: user.id,
      })
      .select("id, token, expires_at")
      .single();

    if (inviteError || !invitation) {
      console.error("[send-tenant-invitation] insert error:", inviteError);
      return errorResponse(
        inviteError?.message ?? "Could not create invitation (RLS may have rejected — confirm you are an admin of this tenant)",
        inviteError?.code === "42501" ? 403 : 500,
      );
    }

    const acceptUrl = `${PUBLIC_APP_URL}/accept-tenant-invite?token=${invitation.token}`;

    const html = `
      <div style="font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; max-width: 560px; margin: auto; padding: 24px; color: #111;">
        <h2 style="margin-top:0;">You've been invited to Fortress AEGIS</h2>
        <p>${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(tenant.name)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
        <p>This is a single-use invitation link. It expires on <strong>${new Date(invitation.expires_at).toUTCString()}</strong>.</p>
        <p style="margin: 24px 0;">
          <a href="${acceptUrl}" style="background:#111; color:#fff; padding: 12px 20px; text-decoration:none; border-radius:6px; display:inline-block;">Accept invitation &amp; set your password</a>
        </p>
        <p style="font-size: 12px; color: #555;">
          You will be asked to set your own password and enroll mobile multi-factor authentication.
          You will then review and accept Fortress's Terms of Use, AI Acknowledgement, and Privacy
          attestation before accessing any data.
        </p>
        <p style="font-size: 12px; color: #555;">
          If you did not expect this invitation, you can safely ignore this email.
        </p>
      </div>
    `;

    try {
      await resend.emails.send({
        from: "Fortress AEGIS <onboarding@silentshieldsecurity.com>",
        to: [email],
        subject: `Invitation to ${tenant.name} — Fortress AEGIS`,
        html,
      });
    } catch (mailErr) {
      console.error("[send-tenant-invitation] resend error:", mailErr);
      // We still return success with the accept URL; admin can hand-deliver it.
      return successResponse({
        invitation_id: invitation.id,
        email_sent: false,
        accept_url: acceptUrl,
        expires_at: invitation.expires_at,
        warning: "Invitation created but email send failed; copy the accept_url to the user manually.",
      });
    }

    return successResponse({
      invitation_id: invitation.id,
      email_sent: true,
      expires_at: invitation.expires_at,
    });
  } catch (e) {
    console.error("[send-tenant-invitation] unexpected error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}
