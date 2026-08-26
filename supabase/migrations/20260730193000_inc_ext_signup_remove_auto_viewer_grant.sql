-- INC-EXT-SIGNUP-2026-07-30 hardening: remove the signup auto-'viewer' grant.
-- Keep profile creation. New accounts get NO role by default and must be granted
-- role + tenant membership explicitly by an admin (defense-in-depth with DISABLE_SIGNUP).
-- Applied to prod via single-file apply_migration 2026-07-30 (no db push; ledger prohibition).

drop trigger if exists on_auth_user_created_assign_role on auth.users;
drop function if exists public.handle_new_user_role();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  -- INC-EXT-SIGNUP-2026-07-30: auto 'viewer' role grant REMOVED (was an open-signup
  -- privilege-by-default hole). No role is assigned at signup anymore.
  return new;
end;
$function$;
