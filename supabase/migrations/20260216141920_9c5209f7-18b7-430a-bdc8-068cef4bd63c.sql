
-- Fix the overly permissive update policy on threat_analysis_requests
DROP POLICY "Service role can update analysis requests" ON public.threat_analysis_requests;

-- Only allow updates on own records
CREATE POLICY "Users can update their own analysis requests"
  ON public.threat_analysis_requests FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
