-- Slice E2: operator triage review fields on traveller_trip_requests (non-operational).
-- Set only by the operator-trip-request-review service function (operator-only). No RLS change:
-- operators still SELECT via ttr_operator_select; the function writes via service role after
-- validating operator role + selectedClientId scope. No operational-table change.
ALTER TABLE public.traveller_trip_requests
  ADD COLUMN IF NOT EXISTS review_note  text CHECK (review_note IS NULL OR char_length(review_note) <= 2000),
  ADD COLUMN IF NOT EXISTS reviewed_by  uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at  timestamptz;
