import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { tenant_id, email, role = 'viewer' } = await req.json();
    
    console.log('Create invite request:', { tenant_id, email, role, user_id: user.id });
    
    if (!tenant_id || !email) {
      console.log('Missing required fields:', { tenant_id, email });
      return new Response(
        JSON.stringify({ error: 'tenant_id and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate role
    const validRoles = ['owner', 'admin', 'analyst', 'viewer'];
    if (!validRoles.includes(role)) {
      console.log('Invalid role:', role);
      return new Response(
        JSON.stringify({ error: 'Invalid role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user is admin/owner of this tenant
    const { data: membership } = await adminClient
      .from('tenant_users')
      .select('role')
      .eq('tenant_id', tenant_id)
      .eq('user_id', user.id)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      console.log('Permission denied - user membership:', membership);
      return new Response(
        JSON.stringify({ error: 'You must be an admin or owner to create invites' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only owners can create owner/admin invites
    if (['owner', 'admin'].includes(role) && membership.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only owners can create admin or owner invites' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if email is already a member
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    if (existingUser) {
      const { data: existingMembership } = await adminClient
        .from('tenant_users')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('user_id', existingUser.id)
        .single();

      if (existingMembership) {
        console.log('User is already a member:', existingUser.id);
        return new Response(
          JSON.stringify({ error: 'This user is already a member of this tenant' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Check for existing pending invite
    const { data: existingInvite } = await adminClient
      .from('tenant_invites')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('email', email.toLowerCase())
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (existingInvite) {
      console.log('Pending invite already exists:', existingInvite.id);
      return new Response(
        JSON.stringify({ error: 'A pending invite already exists for this email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate random token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // Hash the token for storage
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Set expiry to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Get tenant name for the email
    const { data: tenant } = await adminClient
      .from('tenants')
      .select('name')
      .eq('id', tenant_id)
      .single();

    // Create invite
    const { data: invite, error: inviteError } = await adminClient
      .from('tenant_invites')
      .insert({
        tenant_id,
        email: email.toLowerCase(),
        role,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        invited_by: user.id
      })
      .select()
      .single();

    if (inviteError) {
      console.error('Create invite error:', inviteError);
      return new Response(
        JSON.stringify({ error: 'Failed to create invite' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log audit event
    await adminClient
      .from('audit_events')
      .insert({
        tenant_id,
        user_id: user.id,
        action: 'invite_created',
        resource: 'tenant_invites',
        resource_id: invite.id,
        metadata: {
          invited_email: email,
          role,
          expires_at: expiresAt.toISOString()
        }
      });

    // Build invite URL - use origin from request or fallback
    const origin = req.headers.get('origin') || 'https://silent-shield-signal.lovable.app';
    const inviteUrl = `${origin}/invite/accept?token=${token}`;

    // Send email if Resend is configured
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress <noreply@resend.dev>';
    if (resendApiKey) {
      try {
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
            body: JSON.stringify({
              from: fromEmail,
              to: [email],
              subject: `You're invited to join ${tenant?.name || 'the team'} on Fortress`,
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                  <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">
                    <!-- Header -->
                    <div style="text-align: center; margin-bottom: 32px;">
                      <div style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 12px 20px; border-radius: 12px;">
                        <span style="color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">🛡️ Fortress</span>
                      </div>
                    </div>
                    
                    <!-- Main Card -->
                    <div style="background: #1e293b; border-radius: 16px; padding: 40px; border: 1px solid #334155;">
                      <h1 style="color: #f8fafc; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; text-align: center;">
                        You're Invited to Join the Team
                      </h1>
                      
                      <p style="color: #94a3b8; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0; text-align: center;">
                        You've been invited to join <strong style="color: #f8fafc;">${tenant?.name || 'the organization'}</strong> on Fortress — a secure intelligence platform for managing threats, incidents, and investigations.
                      </p>
                      
                      <!-- Role Badge -->
                      <div style="text-align: center; margin-bottom: 24px;">
                        <span style="display: inline-block; background: #1e3a5f; color: #60a5fa; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                          Your Role: ${role.charAt(0).toUpperCase() + role.slice(1)}
                        </span>
                      </div>
                      
                      <p style="color: #94a3b8; font-size: 15px; line-height: 1.6; margin: 0 0 32px 0; text-align: center;">
                        Click below to create your account and get started. Your team is waiting for you.
                      </p>
                      
                      <!-- CTA Button -->
                      <div style="text-align: center; margin-bottom: 32px;">
                        <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 10px; font-size: 16px; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
                          Accept Invitation
                        </a>
                      </div>
                      
                      <!-- Expiry Note -->
                      <p style="color: #64748b; font-size: 13px; text-align: center; margin: 0;">
                        ⏰ This invitation expires in 7 days
                      </p>
                    </div>
                    
                    <!-- Footer -->
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
              `
            })
        });

        if (!emailResponse.ok) {
          console.error('Email send failed:', await emailResponse.text());
        }
      } catch (emailError) {
        console.error('Email send error:', emailError);
        // Don't fail the request if email fails
      }
    }

    console.log(`Invite created for ${email} to tenant ${tenant_id} with role ${role}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        invite_id: invite.id,
        invite_url: inviteUrl,
        expires_at: expiresAt.toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Create invite error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
  }
});
