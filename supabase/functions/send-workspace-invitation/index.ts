import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface InvitationRequest {
  workspaceId: string;
  email: string;
  role: string;
  systemRole?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { workspaceId, email, role, systemRole }: InvitationRequest = await req.json();

    if (!workspaceId || !email) {
      return new Response(JSON.stringify({ error: "workspaceId and email are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get workspace details
    const { data: workspace, error: workspaceError } = await supabase
      .from("investigation_workspaces")
      .select("id, title")
      .eq("id", workspaceId)
      .single();

    if (workspaceError || !workspace) {
      return new Response(JSON.stringify({ error: "Workspace not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get inviter's profile
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .single();

    const inviterName = inviterProfile?.name || "A team member";

    // Create invitation record
    const { data: invitation, error: invitationError } = await supabase
      .from("workspace_invitations")
      .insert({
        workspace_id: workspaceId,
        email: email.toLowerCase().trim(),
        role: role || "contributor",
        system_role: systemRole || "viewer",
        invited_by: user.id,
      })
      .select("id, token")
      .single();

    if (invitationError) {
      console.error("Invitation creation error:", invitationError);
      return new Response(JSON.stringify({ error: invitationError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build signup URL with invitation token
    const appUrl = Deno.env.get("APP_URL") || "https://silent-shield-signal.lovable.app";
    const signupUrl = `${appUrl}/auth?invite=${invitation.token}`;

    // Send invitation email
    const emailResponse = await resend.emails.send({
      from: "Fortress <onboarding@resend.dev>",
      to: [email],
      subject: `You've been invited to join "${workspace.title}" on Fortress`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; padding: 40px 20px;">
          <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #18181b; font-size: 24px; margin: 0;">🛡️ Fortress</h1>
            </div>
            
            <h2 style="color: #18181b; font-size: 20px; margin-bottom: 16px;">You've been invited!</h2>
            
            <p style="color: #52525b; line-height: 1.6; margin-bottom: 16px;">
              <strong>${inviterName}</strong> has invited you to collaborate on the workspace:
            </p>
            
            <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
              <p style="color: #18181b; font-weight: 600; margin: 0;">${workspace.title}</p>
              <p style="color: #71717a; font-size: 14px; margin: 4px 0 0 0;">Role: ${role || "Contributor"}</p>
            </div>
            
            <p style="color: #52525b; line-height: 1.6; margin-bottom: 24px;">
              Click the button below to create your account and join the workspace:
            </p>
            
            <div style="text-align: center; margin-bottom: 24px;">
              <a href="${signupUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">
                Accept Invitation
              </a>
            </div>
            
            <p style="color: #a1a1aa; font-size: 12px; text-align: center;">
              This invitation expires in 7 days.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 32px 0;">
            
            <p style="color: #a1a1aa; font-size: 12px; text-align: center; margin: 0;">
              If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </div>
        </body>
        </html>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ 
      success: true, 
      invitation: { id: invitation.id },
      message: `Invitation sent to ${email}` 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in send-workspace-invitation:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
