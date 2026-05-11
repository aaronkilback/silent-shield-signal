-- Recommendation lifecycle tracking — action notes + closure metadata.
--
-- Field need surfaced 2026-05-11 during Camp 132 walk: operator going
-- to camp manager to get doors locked, no place to log who/when/what.
-- Without this, recommendations rot — next-audit operator has no
-- context on what was actioned.
--
-- Schema additions on audit_recommendations:
--   action_notes      — free-text running log the operator appends to
--   last_action_at    — most recent status change or note append
--   last_action_by    — who touched it last
--   closed_at         — set when status transitions to complete/dismissed

BEGIN;

ALTER TABLE public.audit_recommendations
  ADD COLUMN IF NOT EXISTS action_notes   text,
  ADD COLUMN IF NOT EXISTS last_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_action_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS closed_at      timestamptz;

-- Auto-stamp closed_at when status flips to terminal.
CREATE OR REPLACE FUNCTION public.audit_recommendation_close_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.status IN ('complete', 'dismissed')) AND (OLD.status NOT IN ('complete', 'dismissed')) THEN
    NEW.closed_at := NOW();
  ELSIF (OLD.status IN ('complete', 'dismissed')) AND (NEW.status NOT IN ('complete', 'dismissed')) THEN
    -- Re-opened — clear the close stamp.
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_recommendation_close_stamp_trigger ON public.audit_recommendations;
CREATE TRIGGER audit_recommendation_close_stamp_trigger
  BEFORE UPDATE ON public.audit_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.audit_recommendation_close_stamp();

COMMIT;
