-- Fix the overly permissive policy on mfa_verification_codes
-- Drop the permissive policy
DROP POLICY IF EXISTS "Service role can manage codes" ON public.mfa_verification_codes;

-- Create proper INSERT policy - codes are created by edge functions using service role
-- No user-facing INSERT policy needed since edge functions use service_role key

-- Create DELETE policy for cleanup
CREATE POLICY "Users can delete their own codes"
  ON public.mfa_verification_codes FOR DELETE
  USING (auth.uid() = user_id);