-- #79 signal_origin stamping (part B): enforce NOT NULL + vocabulary CHECK.
-- Apply ONLY after part A's backfill is verified to leave 0 NULLs AND 0 non-vocab values
-- (counts shown before this flip on prod). The BEFORE INSERT trigger guarantees go-forward inserts
-- are always a valid vocab value, so this CHECK can never reject a signal at runtime — it is a
-- belt-and-suspenders backstop against drift. CHECK references the IMMUTABLE signal_origin_vocab()
-- so the vocabulary has a single source of truth (adding an origin = update the function only).

ALTER TABLE public.signals          ALTER COLUMN signal_origin SET NOT NULL;
ALTER TABLE public.filtered_signals ALTER COLUMN signal_origin SET NOT NULL;

ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS signals_signal_origin_check;
ALTER TABLE public.signals ADD CONSTRAINT signals_signal_origin_check
  CHECK (signal_origin = ANY (public.signal_origin_vocab()));

ALTER TABLE public.filtered_signals DROP CONSTRAINT IF EXISTS filtered_signals_signal_origin_check;
ALTER TABLE public.filtered_signals ADD CONSTRAINT filtered_signals_signal_origin_check
  CHECK (signal_origin = ANY (public.signal_origin_vocab()));
