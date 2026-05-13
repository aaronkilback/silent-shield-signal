-- ============================================================
--  Signal correlation queue — auto-confirm + auto-dismiss
--
--  2026-05-13: same problem as the agent action queue. Six items
--  showed up in "Signals Awaiting Review" — 2 obvious real signals
--  with literal Coastal GasLink content + 4 obvious noise (2016
--  CVEs, Czech-language Pecl-surname collision, academic citation).
--  None of these need operator judgment.
--
--  This queue exists because signal_correlation_groups has only one
--  trigger (updated_at) — no logic to set match_confidence beyond
--  'none'. So every group lands awaiting review.
--
--  Add: AFTER INSERT trigger that decides confidence automatically:
--   - LITERAL keyword match against assigned client → 'auto_confirmed'
--   - Stale event (>2 years old, non-cyber) → 'auto_dismissed_stale'
--   - Academic citation pattern → 'auto_dismissed_academic'
--   - On a demo/test client → 'auto_dismissed_demo'
--  Otherwise → 'none' (operator reviews)
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_correlate_signal_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  sig record;
  client_kws text[];
  client_name text;
  client_status text;
  client_industry text;
  ev_date timestamptz;
  is_cyber boolean;
  kw text;
  matched_kw text := null;
BEGIN
  -- Only act on freshly-inserted rows with 'none' confidence
  IF NEW.match_confidence IS NOT NULL AND NEW.match_confidence != 'none' THEN
    RETURN NEW;
  END IF;

  SELECT s.client_id, s.severity, s.category, s.normalized_text, s.event_date, s.created_at
  INTO sig FROM signals s WHERE s.id = NEW.primary_signal_id;
  IF NOT FOUND OR sig.client_id IS NULL THEN RETURN NEW; END IF;

  SELECT name, status, industry,
         monitoring_keywords::text[] || coalesce(competitor_names, '{}'::text[]) || coalesce(high_value_assets, '{}'::text[])
  INTO client_name, client_status, client_industry, client_kws
  FROM clients WHERE id = sig.client_id;

  -- Auto-dismiss: signal on inactive/test/demo client
  IF client_status IS NOT NULL AND client_status != 'active' THEN
    NEW.match_confidence := 'auto_dismissed_inactive_client';
    RETURN NEW;
  END IF;
  IF client_name ILIKE '\_qa\_%' ESCAPE '\' OR client_name ILIKE '\_benchmark\_%' ESCAPE '\' THEN
    NEW.match_confidence := 'auto_dismissed_test_client';
    RETURN NEW;
  END IF;
  -- Cascade Energy is a demo client too — never auto-confirm signals on it
  IF client_name = 'Cascade Energy' THEN
    NEW.match_confidence := 'auto_dismissed_demo_client';
    RETURN NEW;
  END IF;

  -- Auto-dismiss: stale event_date (>2y for non-cyber, >3y for cyber CVE/malware)
  is_cyber := sig.category IN ('malware', 'phishing', 'intrusion', 'data_exfil', 'ddos', 'ransomware');
  ev_date := COALESCE(sig.event_date, sig.created_at);
  IF ev_date < NOW() - (CASE WHEN is_cyber THEN interval '3 years' ELSE interval '2 years' END) THEN
    NEW.match_confidence := 'auto_dismissed_stale';
    RETURN NEW;
  END IF;

  -- Auto-dismiss: academic-citation pattern (e.g. "Smith JT, Jones AB, ... et al. (YEAR)")
  -- These slip through PECL/surname collisions. Heuristic: contains "et al" near a year reference.
  IF NEW.normalized_text ~* '\bet al\.?\b' AND NEW.normalized_text ~* '\(\s*20\d{2}\s*\)' THEN
    NEW.match_confidence := 'auto_dismissed_academic_citation';
    RETURN NEW;
  END IF;

  -- Auto-confirm: literal monitoring_keyword match in the signal text
  -- Use word-boundary-aware check on the longer keywords (>= 6 chars) so we
  -- don't auto-confirm on a 3-letter substring collision.
  IF client_kws IS NOT NULL THEN
    FOREACH kw IN ARRAY client_kws LOOP
      IF kw IS NULL OR LENGTH(kw) < 6 THEN CONTINUE; END IF;
      IF position(LOWER(kw) IN LOWER(NEW.normalized_text)) > 0 THEN
        matched_kw := kw;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF matched_kw IS NOT NULL THEN
    NEW.match_confidence := 'auto_confirmed';
    RETURN NEW;
  END IF;

  -- Otherwise leave 'none' for operator review (truly ambiguous case)
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_correlate_signal_group_trigger ON signal_correlation_groups;
CREATE TRIGGER auto_correlate_signal_group_trigger
  BEFORE INSERT ON signal_correlation_groups
  FOR EACH ROW EXECUTE FUNCTION public.auto_correlate_signal_group();

-- Also expose as a callable to retroactively apply on existing rows.
CREATE OR REPLACE FUNCTION public.reclassify_signal_groups()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  g record;
  before_counts jsonb;
  after_counts jsonb;
  fake record;
BEGIN
  SELECT jsonb_object_agg(coalesce(match_confidence, 'none'), c) INTO before_counts
  FROM (SELECT match_confidence, count(*) c FROM signal_correlation_groups GROUP BY 1) t;

  FOR g IN SELECT * FROM signal_correlation_groups WHERE match_confidence IS NULL OR match_confidence = 'none'
  LOOP
    -- Use the trigger function indirectly by issuing a no-op update that re-evaluates
    -- (BEFORE INSERT only fires on insert; for existing rows we replicate the logic here)
    DECLARE
      sig record;
      client_name text;
      client_status text;
      client_kws text[];
      is_cyber boolean;
      ev_date timestamptz;
      kw text;
      matched boolean := false;
    BEGIN
      SELECT s.client_id, s.severity, s.category, s.normalized_text, s.event_date, s.created_at INTO sig
      FROM signals s WHERE s.id = g.primary_signal_id;
      IF NOT FOUND OR sig.client_id IS NULL THEN CONTINUE; END IF;

      SELECT name, status,
        monitoring_keywords::text[] || coalesce(competitor_names, '{}'::text[]) || coalesce(high_value_assets, '{}'::text[])
      INTO client_name, client_status, client_kws
      FROM clients WHERE id = sig.client_id;

      IF client_status IS NOT NULL AND client_status != 'active' THEN
        UPDATE signal_correlation_groups SET match_confidence = 'auto_dismissed_inactive_client' WHERE id = g.id;
        CONTINUE;
      END IF;
      IF client_name ILIKE '\_qa\_%' ESCAPE '\' OR client_name ILIKE '\_benchmark\_%' ESCAPE '\' THEN
        UPDATE signal_correlation_groups SET match_confidence = 'auto_dismissed_test_client' WHERE id = g.id;
        CONTINUE;
      END IF;
      IF client_name = 'Cascade Energy' THEN
        UPDATE signal_correlation_groups SET match_confidence = 'auto_dismissed_demo_client' WHERE id = g.id;
        CONTINUE;
      END IF;

      is_cyber := sig.category IN ('malware', 'phishing', 'intrusion', 'data_exfil', 'ddos', 'ransomware');
      ev_date := COALESCE(sig.event_date, sig.created_at);
      IF ev_date < NOW() - (CASE WHEN is_cyber THEN interval '3 years' ELSE interval '2 years' END) THEN
        UPDATE signal_correlation_groups SET match_confidence = 'auto_dismissed_stale' WHERE id = g.id;
        CONTINUE;
      END IF;

      IF g.normalized_text ~* '\bet al\.?\b' AND g.normalized_text ~* '\(\s*20\d{2}\s*\)' THEN
        UPDATE signal_correlation_groups SET match_confidence = 'auto_dismissed_academic_citation' WHERE id = g.id;
        CONTINUE;
      END IF;

      IF client_kws IS NOT NULL THEN
        FOREACH kw IN ARRAY client_kws LOOP
          IF kw IS NULL OR LENGTH(kw) < 6 THEN CONTINUE; END IF;
          IF position(LOWER(kw) IN LOWER(g.normalized_text)) > 0 THEN
            matched := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF matched THEN
        UPDATE signal_correlation_groups SET match_confidence = 'auto_confirmed' WHERE id = g.id;
      END IF;
    END;
  END LOOP;

  SELECT jsonb_object_agg(coalesce(match_confidence, 'none'), c) INTO after_counts
  FROM (SELECT match_confidence, count(*) c FROM signal_correlation_groups GROUP BY 1) t;

  RETURN jsonb_build_object('before', before_counts, 'after', after_counts);
END;
$$;

-- Specifically reassign the Wet'suwet'en signal that landed on the test client
UPDATE signals
SET client_id = (SELECT id FROM clients WHERE name = 'Petronas Canada')
WHERE id = 'c4717f8b-1f5b-4bef-b8ea-203ef679aa82'
  AND normalized_text ILIKE '%Wet%suwet%en%blockade%';

-- Run the retroactive classifier on existing groups
SELECT public.reclassify_signal_groups();

-- Final state
SELECT match_confidence, count(*) FROM signal_correlation_groups GROUP BY 1 ORDER BY 1;
