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
import { renderEmail, sectionHeading, ctaButton, escapeHtml, formatExpiry } from "../_shared/email-templates.ts";

// Lazy-init Resend so missing RESEND_API_KEY does not crash module load.
// Email send becomes a non-fatal "email_sent: false" with the accept_url returned
// to the admin for manual delivery (also useful when the SMTP provider is rotated).
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Production has a RESEND_FROM_EMAIL secret already set (e.g. when the verified
// sender domain changes). Prefer it; fall back to the historical address.
const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL")
  || "Fortress AEGIS <onboarding@silentshieldsecurity.com>";
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
    const supportEmail = Deno.env.get("SUPPORT_EMAIL") ?? "support@silentshieldsecurity.com";
    const expiresHuman = formatExpiry(invitation.expires_at);

    // EMAIL 1 — ACCESS GRANTED
    // Voice: calm, operator-grade, high-trust. No emoji. No sales copy.
    const bodyHtml = `
      <p style="margin:0 0 14px; font-size:17px; font-weight:600; color:#0b0d10;">Your Fortress access has been provisioned.</p>
      <p style="margin:0 0 14px;">This environment has been configured for your operational use under <strong>${escapeHtml(tenant.name)}</strong>.</p>
      <p style="margin:0 0 4px;">Invitation issued by <strong>${escapeHtml(inviterName)}</strong>.</p>

      ${ctaButton("Activate your access", acceptUrl)}

      <p style="margin:0 0 14px; font-size:13px; color:#5b6573;">
        This link is single-use. It expires <strong>${escapeHtml(expiresHuman)}</strong>.
        If it expires before you use it, contact ${escapeHtml(inviterName)} for a new invitation.
      </p>

      ${sectionHeading("What happens next")}
      <ol style="margin:0 0 0 18px; padding:0;">
        <li style="margin-bottom:10px;">
          <strong>Set your password.</strong>
          You create your own credentials on first click. Fortress does not store or transmit administrator-set passwords.
        </li>
        <li style="margin-bottom:10px;">
          <strong>Enroll mobile multi-factor authentication.</strong>
          You will be prompted for a mobile number to receive a one-time verification code. MFA is mandatory; you cannot reach the dashboard without enrolling.
        </li>
        <li style="margin-bottom:10px;">
          <strong>Review and accept the operating terms.</strong>
          Three short acknowledgements — platform terms, AI use, and lawful upload authority. Required on first session.
        </li>
        <li style="margin-bottom:0;">
          <strong>Confirm tenant scope.</strong>
          You will see the assets and clients your account has access to before you reach the dashboard. If anything looks wrong, stop and contact your administrator.
        </li>
      </ol>

      ${sectionHeading("Confidentiality")}
      <p style="margin:0 0 14px;">
        Material visible inside ${escapeHtml(tenant.name)} is confidential and operational. Do not forward this invitation. Do not share dashboard screenshots outside your authorized team.
      </p>

      ${sectionHeading("Support")}
      <p style="margin:0;">
        If you need assistance during activation, reply to this message or contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#0b0d10;">${escapeHtml(supportEmail)}</a>.
      </p>
    `;

    const html = renderEmail({
      preheader: `Single-use activation link for ${tenant.name}. Expires in 72 hours.`,
      bodyHtml,
    });

    // If RESEND_API_KEY is not configured, return the accept URL so the admin can
    // deliver it manually. Useful on staging (no Resend) and during prod-side
    // SMTP rotation.
    if (!RESEND_API_KEY) {
      return successResponse({
        invitation_id: invitation.id,
        email_sent: false,
        accept_url: acceptUrl,
        expires_at: invitation.expires_at,
        warning: "RESEND_API_KEY is not configured. Invitation row created; copy accept_url to the invitee manually.",
      });
    }

    try {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: RESEND_FROM,
        to: [email],
        subject: `Fortress access provisioned — ${tenant.name}`,
        html,
      });
    } catch (mailErr) {
      console.error("[send-tenant-invitation] resend error:", mailErr);
      // Invitation row exists; admin can hand-deliver the URL.
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
