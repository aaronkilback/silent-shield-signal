import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface InvitationRequest {
  workspaceId: string;
  email: string;
  mcmRole?: string;
  systemRole?: string;
  role?: string;
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

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const { workspaceId, email, mcmRole, systemRole, role }: InvitationRequest = await req.json();

    if (!workspaceId || !email) {
      return errorResponse("workspaceId and email are required", 400);
    }

    // Get workspace details
    const { data: workspace, error: workspaceError } = await supabase
      .from("investigation_workspaces")
      .select("id, title")
      .eq("id", workspaceId)
      .single();

    if (workspaceError || !workspace) {
      return errorResponse("Workspace not found", 404);
    }

    // Get inviter's profile
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .single();

    const inviterName = inviterProfile?.name || "A team member";

    // MCM role labels
    const mcmRoleLabels: Record<string, string> = {
      team_commander: "Team Commander",
      primary_investigator: "Primary Investigator",
      file_coordinator: "File Coordinator",
      investigator: "Investigator",
      analyst: "Analyst",
      viewer: "Viewer",
    };

    const effectiveMcmRole = mcmRole || "investigator";
    const effectiveRole = role || "contributor";

    // Create invitation record
    const { data: invitation, error: invitationError } = await supabase
      .from("workspace_invitations")
      .insert({
        workspace_id: workspaceId,
        email: email.toLowerCase().trim(),
        role: effectiveRole,
        mcm_role: effectiveMcmRole,
        system_role: systemRole || "viewer",
        invited_by: user.id,
      })
      .select("id, token")
      .single();

    if (invitationError) {
      console.error("Invitation creation error:", invitationError);
      return errorResponse(invitationError.message, 500);
    }

    const mcmRoleLabel = mcmRoleLabels[effectiveMcmRole] || effectiveMcmRole;
    const appUrl = Deno.env.get("APP_URL") || "https://fortress.silentshieldsecurity.com";
    const signupUrl = `${appUrl}/auth?invite=${invitation.token}`;

    // Send invitation email
    const emailResponse = await resend.emails.send({
      from: "Fortress <onboarding@resend.dev>",
      to: [email],
      subject: `${inviterName} invited you to collaborate on Fortress`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 12px 20px; border-radius: 12px;">
                <span style="color: #ffffff; font-size: 24px; font-weight: 700;">🛡️ Fortress</span>
              </div>
            </div>
            
            <div style="background: #1e293b; border-radius: 16px; padding: 40px; border: 1px solid #334155;">
              <h1 style="color: #f8fafc; font-size: 24px; font-weight: 600; margin: 0 0 8px 0; text-align: center;">
                You've Been Invited to Collaborate
              </h1>
              
              <p style="color: #60a5fa; font-size: 15px; margin: 0 0 24px 0; text-align: center;">
                ${inviterName} wants you on the team
              </p>
              
              <div style="background: #0f172a; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #334155;">
                <p style="color: #f8fafc; font-size: 16px; font-weight: 600; margin: 0;">📁 ${workspace.title}</p>
                <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0;">Investigation Workspace</p>
              </div>
              
              <div style="text-align: center; margin-bottom: 24px;">
                <span style="display: inline-block; background: #1e3a5f; color: #60a5fa; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                  Your Role: ${mcmRoleLabel}
                </span>
              </div>
              
              <p style="color: #94a3b8; font-size: 15px; line-height: 1.6; margin: 0 0 32px 0; text-align: center;">
                Join the workspace to collaborate on intelligence gathering, incident management, and investigations with your team.
              </p>
              
              <div style="text-align: center; margin-bottom: 32px;">
                <a href="${signupUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 10px; font-size: 16px; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
                  Accept & Join Workspace
                </a>
              </div>
              
              <p style="color: #64748b; font-size: 13px; text-align: center; margin: 0;">
                ⏰ This invitation expires in 7 days
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 32px;">
              <p style="color: #475569; font-size: 12px; margin: 0 0 8px 0;">
                Didn't expect this invitation? You can safely ignore this email.
              </p>
              <p style="color: #334155; font-size: 11px; margin: 0;">
                Fortress Security Intelligence Platform
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return successResponse({
      success: true,
      invitation: { id: invitation.id },
      message: `Invitation sent to ${email}`
    });

  } catch (error: any) {
    console.error("Error in send-workspace-invitation:", error);
    return errorResponse(error.message, 500);
  }
});
