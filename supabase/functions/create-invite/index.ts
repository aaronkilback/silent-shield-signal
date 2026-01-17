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
    
    if (!tenant_id || !email) {
      return new Response(
        JSON.stringify({ error: 'tenant_id and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate role
    const validRoles = ['owner', 'admin', 'analyst', 'viewer'];
    if (!validRoles.includes(role)) {
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
            subject: `You've been invited to join ${tenant?.name || 'a tenant'} on Fortress`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>You've Been Invited!</h2>
                <p>You've been invited to join <strong>${tenant?.name || 'a tenant'}</strong> on Fortress as a <strong>${role}</strong>.</p>
                <p>Click the button below to accept your invitation:</p>
                <a href="${inviteUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">Accept Invitation</a>
                <p style="color: #666; font-size: 14px;">This invitation will expire in 7 days.</p>
                <p style="color: #666; font-size: 12px;">If you didn't expect this invitation, you can safely ignore this email.</p>
              </div>
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
