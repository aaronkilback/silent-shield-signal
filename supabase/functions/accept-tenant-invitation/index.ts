// accept-tenant-invitation
// ─────────────────────────────────────────────────────────────────────────────
// Two modes:
//   peek = true   — read the invite by token (no auth required) so the UI can
//                   show the user which email to sign up with. Returns just the
//                   email + tenant name + expiry — never the token or roles.
//   peek = false  — atomically: verify caller JWT, validate invite, attach the
//                   user to the tenant (tenant_users + user_roles), mark invite
//                   accepted. Idempotent on re-run with same token+user.
//
// Deployed with --no-verify-jwt so peek mode works from the public
// /accept-tenant-invite landing page. The accept path verifies the JWT manually.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface AcceptRequest {
  token: string;
  peek?: boolean;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const body: AcceptRequest = await req.json();
    if (!body.token) {
      return errorResponse("token is required", 400);
    }

    // Service-role client used only for token lookup + acceptance bookkeeping.
    // Never returns secrets to the caller in peek mode.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: invite, error: lookupError } = await admin
      .from("tenant_invitations")
      .select("id, tenant_id, email, role, app_role, status, expires_at, accepted_at")
      .eq("token", body.token)
      .maybeSingle();

    if (lookupError) {
      // Surface the actual PostgREST error to help diagnose mid-deploy issues
      // (auth-key rotation, missing table, etc). Token is not echoed back.
      console.error("[accept-tenant-invitation] lookup error:", lookupError);
      return errorResponse(
        `Could not look up invitation: ${lookupError.message ?? "unknown"} (code=${lookupError.code ?? "n/a"}, hint=${lookupError.hint ?? "n/a"})`,
        500,
      );
    }
    if (!invite) {
      return errorResponse("Invitation not found", 404);
    }

    // Resolve tenant name (for display)
    const { data: tenant } = await admin
      .from("tenants")
      .select("id, name")
      .eq("id", invite.tenant_id)
      .single();

    // ── PEEK MODE ──────────────────────────────────────────────────────────
    if (body.peek === true) {
      // Public-facing — only return display fields, never the token itself.
      const expired = invite.status !== "pending" || new Date(invite.expires_at) <= new Date();
      return successResponse({
        invite_email: invite.email,
        tenant_name: tenant?.name ?? null,
        status: expired ? (invite.status === "accepted" ? "accepted" : "expired") : "pending",
        expires_at: invite.expires_at,
      });
    }

    // ── ACCEPT MODE ────────────────────────────────────────────────────────
    // Verify caller JWT manually (we deployed with --no-verify-jwt to support peek).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Unauthorized — sign in first", 401);
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return errorResponse("Unauthorized — sign in first", 401);
    }

    // Email must match invite (case-insensitive)
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      return errorResponse(
        `This invitation was issued to ${invite.email}. You are signed in as ${user.email}. Sign out and sign in with the invited address.`,
        403,
      );
    }

    // Invite must still be valid
    if (invite.status === "accepted") {
      return successResponse({
        tenant_id: invite.tenant_id,
        tenant_name: tenant?.name,
        status: "already_accepted",
        message: "Invitation was already accepted. Continue to the platform.",
      });
    }
    if (invite.status === "revoked") {
      return errorResponse("Invitation was revoked by the issuing admin.", 410);
    }
    if (new Date(invite.expires_at) <= new Date()) {
      await admin.from("tenant_invitations").update({ status: "expired" }).eq("id", invite.id);
      return errorResponse("Invitation has expired. Contact the issuing admin for a new invite.", 410);
    }

    // Attach user to tenant (idempotent via ON CONFLICT) + assign app_role
    const { error: tuError } = await admin
      .from("tenant_users")
      .upsert(
        { user_id: user.id, tenant_id: invite.tenant_id, role: invite.role },
        { onConflict: "user_id,tenant_id" },
      );
    if (tuError) {
      console.error("[accept-tenant-invitation] tenant_users error:", tuError);
      return errorResponse(`Could not attach user to tenant: ${tuError.message}`, 500);
    }

    const { error: urError } = await admin
      .from("user_roles")
      .upsert(
        { user_id: user.id, role: invite.app_role },
        { onConflict: "user_id,role" },
      );
    if (urError) {
      console.error("[accept-tenant-invitation] user_roles error:", urError);
      // Non-fatal: tenant_users is in place; admin can fix the role later.
    }

    // Mark invitation accepted
    const { error: acceptError } = await admin
      .from("tenant_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: user.id,
      })
      .eq("id", invite.id);
    if (acceptError) {
      console.error("[accept-tenant-invitation] accept-mark error:", acceptError);
    }

    return successResponse({
      tenant_id: invite.tenant_id,
      tenant_name: tenant?.name,
      status: "accepted",
      message: `Welcome to ${tenant?.name ?? "Fortress"}.`,
    });
  } catch (e) {
    console.error("[accept-tenant-invitation] unexpected error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
