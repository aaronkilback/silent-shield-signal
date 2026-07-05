-- Recency / event-time honesty — signals table BEFORE-INSERT resolver + client-scoped dedup.
-- Applied to PROD 2026-07-05 via raw SQL (platform-incident window); this migration captures it
-- so the repo schema history matches prod (WO-PRR drift closure). Idempotent where possible.
--
-- What it does (writer-agnostic — fires for ALL ~19 signal writers, at the TABLE not one function):
--   1. event_time resolution: RESPECT a writer-provided event_date (basis 'extracted_text_date');
--      else pubDate from raw_json (basis 'source_published'); else NULL (basis 'unknown').
--      NEVER now()-as-current. [PATTERN] synthetics -> 'pattern_detected'.
--   2. content_hash: uniform hybrid sha256('url:'||source_url||'|title:'||lower(trim(title))).
--   3. dedup backstop: partial-unique (client_id, content_hash) on real, non-quarantined clients.
--
-- NOTE: the one-time keep-one soft-quarantine of pre-existing dup rows (135 non-Kilbacks) and the
-- full-table content_hash backfill were prod DATA operations, run once; the backfill UPDATE below is
-- idempotent (safe to re-run). Kilbacks (mis-flagged is_test=false + typosquat writer) is EXCLUDED
-- from the unique index by client_id — a time-boxed WO-CENSUS gap, not permanent.

ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS hash_basis text;

CREATE OR REPLACE FUNCTION public.signals_resolve_time_and_hash() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_pub text;
BEGIN
  -- HASH: uniform hybrid, ALWAYS recompute (a writer's URL-only hash is a different basis and must not persist).
  NEW.content_hash := encode(digest('url:'||coalesce(NEW.source_url,'')||'|title:'||lower(btrim(coalesce(NEW.title,''))), 'sha256'),'hex');
  NEW.hash_basis := 'url_title';

  -- EVENT_TIME: respect a provided value; resolve only what's MISSING; never now().
  IF coalesce(NEW.title,'') ILIKE '%[PATTERN]%' THEN
    NEW.event_time_basis := 'pattern_detected';
  ELSIF NEW.event_date IS NOT NULL THEN
    NEW.event_time_basis := coalesce(nullif(NEW.event_time_basis,''), 'extracted_text_date');
  ELSE
    v_pub := coalesce(NEW.raw_json->>'pubDate', NEW.raw_json->>'published_date', NEW.raw_json->>'published',
                      NEW.raw_json->>'article_published_time', NEW.raw_json->>'date');
    IF v_pub IS NOT NULL AND btrim(v_pub) <> '' THEN
      BEGIN NEW.event_date := v_pub::timestamptz; NEW.event_time_basis := 'source_published';
      EXCEPTION WHEN others THEN NEW.event_time_basis := 'unknown'; END;
    ELSE
      NEW.event_time_basis := 'unknown';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_signals_resolve_time_and_hash ON public.signals;
CREATE TRIGGER trg_signals_resolve_time_and_hash BEFORE INSERT ON public.signals
  FOR EACH ROW EXECUTE FUNCTION public.signals_resolve_time_and_hash();

-- Idempotent backfill of existing rows to the hybrid hash + honest basis (UPDATE does not fire the BEFORE-INSERT trigger).
UPDATE public.signals SET
  content_hash = encode(digest('url:'||coalesce(source_url,'')||'|title:'||lower(btrim(coalesce(title,''))),'sha256'),'hex'),
  hash_basis = 'url_title',
  event_time_basis = CASE WHEN coalesce(title,'') ILIKE '%[PATTERN]%' THEN 'pattern_detected'
                          WHEN event_date IS NOT NULL THEN 'extracted_text_date'
                          ELSE 'unknown' END
WHERE hash_basis IS DISTINCT FROM 'url_title';

-- Client-scoped dedup backstop. Real clients only (is_test=false), excluding the deferred Kilbacks
-- tenant (WO-CENSUS) and quarantined rows. Requires collision-free active rows in scope (keep-one done as a data op).
CREATE UNIQUE INDEX IF NOT EXISTS signals_client_content_hash_uidx
  ON public.signals (client_id, content_hash)
  WHERE content_hash IS NOT NULL
    AND is_test = false
    AND client_id <> 'd3b200b5-1f85-453e-bdba-f2b7b463f308'
    AND coalesce(quality_status, '') <> 'quarantined';
