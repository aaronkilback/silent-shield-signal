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

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token to get their identity
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
    const { token } = await req.json();
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Token is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Hash the token to compare with stored hash
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Use service role to bypass RLS for invite validation
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Find the invite
    const { data: invite, error: inviteError } = await adminClient
      .from('tenant_invites')
      .select('*, tenants(name)')
      .eq('token_hash', tokenHash)
      .is('used_at', null)
      .single();

    if (inviteError || !invite) {
      console.error('Invite lookup error:', inviteError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired invite' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify invite hasn't expired
    if (new Date(invite.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Invite has expired' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify email matches
    if (invite.email.toLowerCase() !== user.email?.toLowerCase()) {
      return new Response(
        JSON.stringify({ error: 'This invite is for a different email address' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is already a member
    const { data: existingMembership } = await adminClient
      .from('tenant_users')
      .select('id')
      .eq('tenant_id', invite.tenant_id)
      .eq('user_id', user.id)
      .single();

    if (existingMembership) {
      // Mark invite as used even if already a member
      await adminClient
        .from('tenant_invites')
        .update({ used_at: new Date().toISOString() })
        .eq('id', invite.id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'You are already a member of this tenant',
          tenant_id: invite.tenant_id,
          tenant_name: invite.tenants?.name
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create tenant membership
    const { error: membershipError } = await adminClient
      .from('tenant_users')
      .insert({
        tenant_id: invite.tenant_id,
        user_id: user.id,
        role: invite.role
      });

    if (membershipError) {
      console.error('Membership creation error:', membershipError);
      return new Response(
        JSON.stringify({ error: 'Failed to create membership' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark invite as used
    await adminClient
      .from('tenant_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id);

    // Log audit event
    await adminClient
      .from('audit_events')
      .insert({
        tenant_id: invite.tenant_id,
        user_id: user.id,
        action: 'invite_accepted',
        resource: 'tenant_users',
        resource_id: invite.tenant_id,
        metadata: {
          invite_id: invite.id,
          role: invite.role,
          invited_by: invite.invited_by
        }
      });

    console.log(`User ${user.id} accepted invite to tenant ${invite.tenant_id} with role ${invite.role}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Successfully joined tenant',
        tenant_id: invite.tenant_id,
        tenant_name: invite.tenants?.name,
        role: invite.role
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Accept invite error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
