-- Track whether the orientation email has been sent for a given acceptance row.
-- Fired only on first-ever acceptance (source='first_login') AND only after the
-- user reaches the dashboard. The send-orientation-email function atomically
-- updates this column to make the call idempotent — safe to invoke repeatedly
-- (e.g., from a useEffect that fires on every dashboard mount until success).
ALTER TABLE public.onboarding_acceptances
  ADD COLUMN IF NOT EXISTS orientation_email_sent_at timestamptz;

-- Helper index for the lookup pattern: latest first_login acceptance per user
-- where orientation hasn't been sent yet.
CREATE INDEX IF NOT EXISTS idx_onb_first_login_orientation_pending
  ON public.onboarding_acceptances(user_id, accepted_at DESC)
  WHERE source = 'first_login' AND orientation_email_sent_at IS NULL;

COMMENT ON COLUMN public.onboarding_acceptances.orientation_email_sent_at IS
  'Timestamp when the orientation email (Email 2) was successfully sent for this acceptance. NULL means not yet sent. Set atomically by send-orientation-email to enforce idempotent delivery.';
