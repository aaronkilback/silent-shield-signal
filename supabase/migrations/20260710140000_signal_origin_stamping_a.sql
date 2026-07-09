-- #79 signal_origin stamping (part A): columns + derive fn + BEFORE INSERT trigger (non-bypassable
-- floor for the ~15 direct-insert producers + any future one) + backfill + index + default.
-- Part B (separate migration) adds NOT NULL + CHECK after counts are verified.

ALTER TABLE public.signals          ADD COLUMN IF NOT EXISTS signal_origin text;
ALTER TABLE public.filtered_signals ADD COLUMN IF NOT EXISTS signal_origin text;

-- Canonical vocabulary (single source of truth for derive + trigger; keep in sync with the CHECK
-- in part B and _shared/signal-origins.ts). Adding an origin = update here + the CHECK.
CREATE OR REPLACE FUNCTION public.signal_origin_vocab()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY[
    'monitor-news-google','monitor-news','monitor-cisa-kev','monitor-canadian-sources','monitor-csis',
    'monitor-darkweb','monitor-github','monitor-court-registry','monitor-social-unified','monitor-social',
    'monitor-pastebin','monitor-threat-intel','monitor-wildfires','investigate-poi','osint-web-search',
    'process-stored-document','run-benchmark','fortress-qa-agent','fortress-chaos-monkey','wraith-security-advisor',
    'monitor-rss-sources','monitor-naad-alerts','monitor-earthquakes','monitor-domains','monitor-emergency-google',
    'monitor-macro-indicators','monitor-regional-apac','monitor-wildfire-comprehensive','monitor-entity-proximity',
    'monitor-community-outreach','monitor-instagram','detect-threat-patterns','visibility-gap-scanner',
    'process-intelligence-document','process-security-report','parse-document','entity-deep-scan',
    'agent-chat','dashboard-ai-assistant','pattern-detector','manual','qa-test','unknown-legacy'];
$$;

-- Source-NAME -> origin heuristic (shared by signals derive + the filtered_signals trigger, which
-- has only a source_name, no source_id). Returns a vocab value or NULL (caller coalesces).
CREATE OR REPLACE FUNCTION public.derive_origin_from_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text := lower(btrim(coalesce(p_name, '')));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  -- Many producers write source_name = their own function name (which IS the origin), e.g.
  -- monitor-news-google's source_domain_not_allowlisted rejects. Honour that directly.
  IF v = ANY (public.signal_origin_vocab()) THEN RETURN v; END IF;
  IF    v ~ 'cwfis|viirs|wildfire'      THEN RETURN 'monitor-wildfires';
  ELSIF v ~ 'naad'                      THEN RETURN 'monitor-naad-alerts';
  ELSIF v ~ 'google *news'              THEN RETURN 'monitor-news-google';
  ELSIF v ~ 'cisa|kev'                  THEN RETURN 'monitor-cisa-kev';
  ELSIF v ~ 'cccs|canadian centre'      THEN RETURN 'monitor-canadian-sources';
  ELSIF v ~ 'csis'                      THEN RETURN 'monitor-csis';
  ELSIF v ~ 'hibp|pastebin|breach|dark ?web' THEN RETURN 'monitor-darkweb';
  ELSIF v ~ 'github'                    THEN RETURN 'monitor-github';
  ELSIF v ~ 'court'                     THEN RETURN 'monitor-court-registry';
  ELSIF v ~ 'earthquake|seismic'        THEN RETURN 'monitor-earthquakes';
  ELSIF v ~ 'rss'                       THEN RETURN 'monitor-rss-sources';
  END IF;
  RETURN NULL;
END $$;

-- Best-effort derivation (mirror of _shared/signal-origins.ts deriveOrigin). ALWAYS returns a valid
-- vocab value. Explicit raw_json.signal_origin wins ONLY if it is already a vocab value (else derive).
CREATE OR REPLACE FUNCTION public.derive_signal_origin(
  p_source_id uuid, p_normalized_text text, p_raw_json jsonb, p_is_test boolean)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_name text; v_explicit text; v_by_name text;
BEGIN
  v_explicit := NULLIF(btrim(p_raw_json->>'signal_origin'), '');
  IF v_explicit IS NOT NULL AND v_explicit = ANY (public.signal_origin_vocab()) THEN RETURN v_explicit; END IF;
  IF p_normalized_text ~* '^\s*\[pattern\]' THEN RETURN 'pattern-detector'; END IF;
  IF p_is_test IS TRUE THEN RETURN 'qa-test'; END IF;
  SELECT name INTO v_name FROM public.sources WHERE id = p_source_id;
  v_by_name := public.derive_origin_from_name(v_name);
  IF v_by_name IS NOT NULL THEN RETURN v_by_name; END IF;
  IF EXISTS (SELECT 1 FROM public.sources WHERE id = p_source_id AND type = 'rss') THEN
    RETURN 'monitor-rss-sources';
  END IF;
  v_by_name := public.derive_origin_from_name(p_raw_json->>'source');
  IF v_by_name IS NOT NULL THEN RETURN v_by_name; END IF;
  RETURN 'unknown-legacy';
END $$;

-- The non-bypassable floor. Explicit valid stamps pass through; unknown claimed values are logged
-- loudly and re-derived; NULL is derived. Guarantees a valid vocab value on EVERY insert path.
CREATE OR REPLACE FUNCTION public.tg_stamp_signal_origin()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_vocab text[] := public.signal_origin_vocab();
  v_claimed text := NULLIF(btrim(NEW.signal_origin), '');
BEGIN
  IF v_claimed IS NOT NULL AND v_claimed = ANY (v_vocab) THEN
    RETURN NEW;  -- explicit + valid: keep as-is
  END IF;
  IF v_claimed IS NOT NULL THEN
    RAISE LOG '[signal-origin] non-vocab origin % coerced to derived/unknown-legacy', v_claimed;
  END IF;
  NEW.signal_origin := public.derive_signal_origin(NEW.source_id, NEW.normalized_text, NEW.raw_json, NEW.is_test);
  IF NOT (NEW.signal_origin = ANY (v_vocab)) THEN NEW.signal_origin := 'unknown-legacy'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_signal_origin ON public.signals;
CREATE TRIGGER trg_stamp_signal_origin BEFORE INSERT ON public.signals
  FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_signal_origin();

-- filtered_signals floor: rejections are written by MANY producers directly (esp. monitor-news-google's
-- ~2,085/30d source_domain_not_allowlisted rejects — the ones that motivated stamping this table).
-- Derive from source_name so those attribute correctly instead of defaulting to unknown-legacy.
CREATE OR REPLACE FUNCTION public.tg_stamp_filtered_signal_origin()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_vocab text[] := public.signal_origin_vocab();
  v_claimed text := NULLIF(btrim(NEW.signal_origin), '');
BEGIN
  IF v_claimed IS NOT NULL AND v_claimed = ANY (v_vocab) THEN RETURN NEW; END IF;
  IF v_claimed IS NOT NULL THEN
    RAISE LOG '[signal-origin] filtered non-vocab origin % coerced', v_claimed;
  END IF;
  NEW.signal_origin := COALESCE(public.derive_origin_from_name(NEW.source_name), 'unknown-legacy');
  IF NOT (NEW.signal_origin = ANY (v_vocab)) THEN NEW.signal_origin := 'unknown-legacy'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_filtered_signal_origin ON public.filtered_signals;
CREATE TRIGGER trg_stamp_filtered_signal_origin BEFORE INSERT ON public.filtered_signals
  FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_filtered_signal_origin();

-- Backfill existing rows (idempotent: only NULLs).
UPDATE public.signals
   SET signal_origin = public.derive_signal_origin(source_id, normalized_text, raw_json, is_test)
 WHERE signal_origin IS NULL;

UPDATE public.filtered_signals f
   SET signal_origin = COALESCE(public.derive_origin_from_name(f.source_name), 'unknown-legacy')
 WHERE f.signal_origin IS NULL;

-- NO column DEFAULT: a DEFAULT is applied BEFORE the BEFORE-INSERT trigger, so a producer that
-- OMITS signal_origin would arrive with a valid vocab value ('unknown-legacy') and the trigger would
-- keep it instead of deriving — defeating the floor for the direct-insert producers. Leaving it NULL
-- on omit lets the trigger derive; NOT NULL (part B) is satisfied by the trigger's output.
ALTER TABLE public.signals          ALTER COLUMN signal_origin DROP DEFAULT;
ALTER TABLE public.filtered_signals ALTER COLUMN signal_origin DROP DEFAULT;

CREATE INDEX IF NOT EXISTS signals_signal_origin_created_idx
  ON public.signals (signal_origin, created_at DESC);
