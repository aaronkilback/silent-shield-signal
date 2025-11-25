-- Create function to process signals through rule engine
CREATE OR REPLACE FUNCTION process_signal_with_rules()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  approved_rules JSONB[];
  rule_config RECORD;
  rule JSONB;
  conditions JSONB;
  actions JSONB;
  signal_text TEXT;
  matched_rules TEXT[] := '{}';
  final_category TEXT;
  final_priority TEXT;
  final_tags TEXT[] := '{}';
  routed_team TEXT;
  matches BOOLEAN;
BEGIN
  -- Skip if already processed
  IF NEW.applied_rules IS NOT NULL AND array_length(NEW.applied_rules, 1) > 0 THEN
    RETURN NEW;
  END IF;

  -- Load approved categorization rules from intelligence_config
  FOR rule_config IN
    SELECT key, value
    FROM intelligence_config
    WHERE key LIKE 'signal_categorization_rules_proposal_%'
  LOOP
    IF (rule_config.value->>'status') = 'approved' AND (rule_config.value->'proposals') IS NOT NULL THEN
      approved_rules := array_append(approved_rules, rule_config.value->'proposals');
    END IF;
  END LOOP;

  -- Get signal text
  signal_text := LOWER(COALESCE(NEW.normalized_text, ''));

  -- Apply each rule
  FOR rule IN SELECT jsonb_array_elements(unnest(approved_rules))
  LOOP
    conditions := rule->'conditions';
    actions := rule->'actions';
    matches := TRUE;

    -- Check keywords
    IF conditions->'keywords' IS NOT NULL THEN
      DECLARE
        keyword TEXT;
        has_keyword BOOLEAN := FALSE;
      BEGIN
        FOR keyword IN SELECT jsonb_array_elements_text(conditions->'keywords')
        LOOP
          IF signal_text LIKE '%' || LOWER(keyword) || '%' THEN
            has_keyword := TRUE;
            EXIT;
          END IF;
        END LOOP;
        IF NOT has_keyword THEN
          matches := FALSE;
        END IF;
      END;
    END IF;

    -- Check client industry (if we have client_id)
    IF matches AND conditions->>'client_industry' IS NOT NULL AND NEW.client_id IS NOT NULL THEN
      DECLARE
        client_industry TEXT;
      BEGIN
        SELECT industry INTO client_industry FROM clients WHERE id = NEW.client_id;
        IF LOWER(client_industry) != LOWER(conditions->>'client_industry') THEN
          matches := FALSE;
        END IF;
      END;
    END IF;

    -- If rule matches, apply actions
    IF matches THEN
      matched_rules := array_append(matched_rules, rule->>'rule_name');
      
      -- Apply category
      IF actions->>'set_category' IS NOT NULL THEN
        final_category := actions->>'set_category';
      END IF;
      
      -- Apply priority
      IF actions->>'set_priority' IS NOT NULL THEN
        final_priority := actions->>'set_priority';
      END IF;
      
      -- Apply tags
      IF actions->'add_tags' IS NOT NULL THEN
        DECLARE
          tag TEXT;
        BEGIN
          FOR tag IN SELECT jsonb_array_elements_text(actions->'add_tags')
          LOOP
            final_tags := array_append(final_tags, tag);
          END LOOP;
        END;
      END IF;
      
      -- Apply routing
      IF actions->>'route_to_team' IS NOT NULL THEN
        routed_team := actions->>'route_to_team';
      END IF;
    END IF;
  END LOOP;

  -- Update signal with rule results
  IF array_length(matched_rules, 1) > 0 THEN
    NEW.applied_rules := matched_rules;
    NEW.rule_category := final_category;
    NEW.rule_priority := final_priority;
    NEW.rule_tags := final_tags;
    NEW.routed_to_team := routed_team;
    NEW.status := 'triaged';
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to process signals on insert
DROP TRIGGER IF EXISTS trigger_process_signal_rules ON signals;
CREATE TRIGGER trigger_process_signal_rules
  BEFORE INSERT ON signals
  FOR EACH ROW
  EXECUTE FUNCTION process_signal_with_rules();