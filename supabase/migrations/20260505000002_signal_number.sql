-- Human-readable signal IDs — May 5 2026.
--
-- Signals have always had a UUID `id`, but UUIDs are unusable for
-- operator reference ("AEGIS, analyze signal a3f8…"). Operators
-- need a short, sortable, year-tagged number they can read off the
-- screen, type into chat, and quote in reports.
--
-- Format: SIG-YYYY-NNNNNN (e.g., SIG-2026-000001).
-- Year prefix makes the number sortable and contextualized; the
-- 6-digit zero-padded sequence covers up to 1M signals/year before
-- needing widening.
--
-- The `id` UUID stays as the system-internal foreign key; the new
-- `signal_number` is purely operator-facing.

BEGIN;

-- Sequence drives the numeric portion. Starts at 1 — backfill below
-- will consume IDs in created_at order so older signals get smaller
-- numbers.
CREATE SEQUENCE IF NOT EXISTS public.signal_number_seq;

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS signal_number text;

-- Backfill existing rows. Order by created_at so old signals get
-- low numbers and the sequence reflects chronological order.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn,
         extract(year from created_at) AS yr
  FROM public.signals
  WHERE signal_number IS NULL
)
UPDATE public.signals s
SET signal_number = 'SIG-' || numbered.yr::int || '-' || lpad(numbered.rn::text, 6, '0')
FROM numbered
WHERE s.id = numbered.id;

-- Advance the sequence past the highest backfilled value so future
-- inserts don't collide. Compute max sequence number from the rn we
-- just used (count of backfilled rows). nextval() will return one
-- past that value on the first new insert.
SELECT setval('public.signal_number_seq', GREATEST(1, (SELECT count(*) FROM public.signals)));

-- Trigger to auto-assign signal_number on new INSERT.
CREATE OR REPLACE FUNCTION public.assign_signal_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.signal_number IS NULL THEN
    NEW.signal_number := 'SIG-'
      || extract(year from COALESCE(NEW.created_at, now()))::int
      || '-'
      || lpad(nextval('public.signal_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signals_assign_number ON public.signals;
CREATE TRIGGER signals_assign_number
  BEFORE INSERT ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_signal_number();

-- Constraints + index after backfill is complete.
ALTER TABLE public.signals
  ALTER COLUMN signal_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS signals_signal_number_uidx
  ON public.signals(signal_number);

COMMIT;

COMMENT ON COLUMN public.signals.signal_number IS
  'Human-readable signal ID, format SIG-YYYY-NNNNNN. Auto-assigned on insert via assign_signal_number() trigger. The system FK is still id (uuid); signal_number is for operator reference, chat input, and report citations.';
