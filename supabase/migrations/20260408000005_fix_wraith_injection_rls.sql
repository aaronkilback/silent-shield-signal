-- Fix wraith_prompt_injection_log RLS policy so service role key inserts work.
-- auth.jwt() ->> 'role' doesn't resolve correctly when the Supabase JS client is
-- initialized with createClient(url, service_role_key) — the JWT role claim isn't
-- set in the PostgREST session context. Replace with the standard service_role bypass.

DROP POLICY IF EXISTS "service_role_full_wraith_injection" ON public.wraith_prompt_injection_log;

-- PostgREST sets role = 'service_role' at the DB session level when the service role key
-- is used, so current_setting('role') is the correct check here.
CREATE POLICY "service_role_full_wraith_injection"
  ON public.wraith_prompt_injection_log FOR ALL
  USING (
    auth.jwt() ->> 'role' = 'service_role'
    OR current_setting('role', true) = 'service_role'
  )
  WITH CHECK (
    auth.jwt() ->> 'role' = 'service_role'
    OR current_setting('role', true) = 'service_role'
  );
