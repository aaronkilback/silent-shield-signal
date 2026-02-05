import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    // Get auth user from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('Not authenticated', 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return errorResponse('Invalid session', 401);
    }

    const { code, purpose } = await req.json();

    if (!code || code.length !== 6) {
      return errorResponse('Invalid code format', 400);
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
      return errorResponse('Verification failed', 500);
    }

    if (!codeRecord) {
      return errorResponse('Invalid or expired code', 400);
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
        return errorResponse('Failed to enable MFA', 500);
      }
    }

    console.log(`MFA code verified for user ${user.id}, purpose: ${purpose}`);

    return successResponse({ 
      verified: true,
      mfa_enabled: purpose === 'enrollment'
    });

  } catch (error) {
    console.error('Error in verify-mfa-code:', error);
    return errorResponse('Internal server error', 500);
  }
});
