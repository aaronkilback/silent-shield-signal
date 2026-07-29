-- WO-SENTINEL item 2 ruling: academy_credentials no-op always-true read -> per-user scope.
drop policy if exists academy_credentials_global_read on public.academy_credentials;
create policy academy_credentials_own_read on public.academy_credentials
  for select to authenticated using (user_id = auth.uid());
