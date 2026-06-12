-- Self-tracking identity link: connect an auth user to the traveller record it
-- represents. Phase B PWA resolves auth.uid() -> this row to report location and
-- auto check-in. A user maps to at most one traveller per client; a person can be
-- a traveller in multiple clients (one row each). NULL = unlinked record.
ALTER TABLE public.travelers
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS travelers_user_client_uniq
  ON public.travelers (user_id, client_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.travelers.user_id IS
  'Auth user this traveller record represents (self-tracking link). At most one traveller per (user,client). Phase B PWA resolves auth.uid()->this row for location/auto check-in. NULL = unlinked.';
