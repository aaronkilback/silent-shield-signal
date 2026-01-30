import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth user from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { code, purpose } = await req.json();

    if (!code || code.length !== 6) {
      return new Response(JSON.stringify({ error: 'Invalid code format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find valid code
    const { data: codeRecord, error: codeError } = await supabase
      .from('mfa_verification_codes')
      .select('*')
      .eq('user_id', user.id)
      .eq('code', code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeError) {
      console.error('Error fetching code:', codeError);
      return new Response(JSON.stringify({ error: 'Verification failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!codeRecord) {
      return new Response(JSON.stringify({ error: 'Invalid or expired code' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mark code as used
    await supabase
      .from('mfa_verification_codes')
      .update({ used: true })
      .eq('id', codeRecord.id);

    // If enrollment, mark phone as verified and enable MFA
    if (purpose === 'enrollment') {
      const { error: updateError } = await supabase
        .from('user_mfa_settings')
        .update({
          phone_verified: true,
          mfa_enabled: true,
        })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('Failed to update MFA settings:', updateError);
        return new Response(JSON.stringify({ error: 'Failed to enable MFA' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`MFA code verified for user ${user.id}, purpose: ${purpose}`);

    return new Response(JSON.stringify({ 
      success: true, 
      verified: true,
      mfa_enabled: purpose === 'enrollment'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in verify-mfa-code:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
