-- RLS Containment Batch 2 — profiles (handled last/carefully). Applied to prod (version 20260612152039).
-- profiles are user-private L0. Drops the broad "any authenticated reads all profiles" policy
-- (exposed names + schema's last_known_lat/lng geo). Keeps the existing proper "Profile viewing
-- policy" (self OR privileged role OR workspace co-member) + own insert/update + super_admin bypass.
-- Pre-checks (operator-required): 0 purely-nonprivileged users (no name-lookup breakage); analyst
-- operator still sees all 7; a no-role user (future traveller login) sees only self (0 others).
-- Verified before+after via in-txn RLS-as-authenticated probes; 0 residual broad policy on profiles.
DROP POLICY IF EXISTS "auth_users_can_view_profiles" ON public.profiles;
