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

    const { phone_number, purpose } = await req.json();

    // Validate phone number format (basic E.164 validation)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone_number)) {
      return new Response(JSON.stringify({ error: 'Invalid phone number format. Use E.164 format (e.g., +12025551234)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete any existing unused codes for this user
    await supabase
      .from('mfa_verification_codes')
      .delete()
      .eq('user_id', user.id)
      .eq('used', false);

    // Store the code
    const { error: insertError } = await supabase
      .from('mfa_verification_codes')
      .insert({
        user_id: user.id,
        code,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error('Failed to store code:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to generate code' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send SMS via Twilio
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioFromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

    if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
      console.error('Twilio credentials not configured');
      return new Response(JSON.stringify({ error: 'SMS service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const message = purpose === 'enrollment' 
      ? `Your Fortress verification code is: ${code}. This code expires in 10 minutes.`
      : `Your Fortress login code is: ${code}. This code expires in 10 minutes.`;

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${twilioAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: phone_number,
        From: twilioFromNumber,
        Body: message,
      }),
    });

    if (!twilioResponse.ok) {
      const twilioError = await twilioResponse.text();
      console.error('Twilio error:', twilioError);
      return new Response(JSON.stringify({ error: 'Failed to send SMS' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If enrolling, update/upsert the phone number
    if (purpose === 'enrollment') {
      await supabase
        .from('user_mfa_settings')
        .upsert({
          user_id: user.id,
          phone_number,
          phone_verified: false,
          mfa_enabled: false,
        }, { onConflict: 'user_id' });
    }

    console.log(`MFA code sent to ${phone_number.slice(0, -4)}**** for user ${user.id}`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Verification code sent',
      expires_at: expiresAt.toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-mfa-code:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
