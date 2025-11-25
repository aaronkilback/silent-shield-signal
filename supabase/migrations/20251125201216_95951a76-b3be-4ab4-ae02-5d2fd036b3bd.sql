-- Drop existing trigger if any (defensive)
DROP TRIGGER IF EXISTS apply_signal_rules_on_insert ON signals;

-- Create trigger to apply rules on INSERT
CREATE TRIGGER apply_signal_rules_on_insert
  BEFORE INSERT ON signals
  FOR EACH ROW
  EXECUTE FUNCTION process_signal_with_rules();

-- Update existing signals retroactively to apply rules
-- This will populate rule_category, rule_priority, rule_tags, etc. for all existing signals
UPDATE signals
SET 
  applied_rules = NULL,
  rule_category = NULL,
  rule_priority = NULL,
  rule_tags = NULL,
  routed_to_team = NULL
WHERE applied_rules IS NOT NULL OR rule_category IS NOT NULL;

-- Now trigger the rule application by updating a benign field
-- This forces the trigger logic to run via a function call
DO $$
DECLARE
  signal_record RECORD;
  approved_rules JSONB[];
  rule_config RECORD;
  rule JSONB;
  conditions JSONB;
  actions JSONB;
  signal_text TEXT;
  matched_rules TEXT[];
  final_category TEXT;
  final_priority TEXT;
  final_tags TEXT[];
  routed_team TEXT;
  matches BOOLEAN;
  keyword TEXT;
  has_keyword BOOLEAN;
BEGIN
  -- Load approved rules
  FOR rule_config IN
    SELECT key, value
    FROM intelligence_config
    WHERE key LIKE 'signal_categorization_rules_proposal_%'
  LOOP
    IF (rule_config.value->>'status') = 'approved' AND (rule_config.value->'proposals') IS NOT NULL THEN
      approved_rules := array_append(approved_rules, rule_config.value->'proposals');
    END IF;
  END LOOP;

  -- Process each existing signal
  FOR signal_record IN SELECT id, normalized_text, client_id FROM signals WHERE applied_rules IS NULL OR jsonb_array_length(applied_rules) = 0
  LOOP
    signal_text := LOWER(COALESCE(signal_record.normalized_text, ''));
    matched_rules := '{}';
    final_category := NULL;
    final_priority := NULL;
    final_tags := '{}';
    routed_team := NULL;

    -- Apply each rule
    FOR rule IN SELECT jsonb_array_elements(unnest(approved_rules))
    LOOP
      conditions := rule->'conditions';
      actions := rule->'actions';
      matches := TRUE;

      -- Check keywords
      IF conditions->'keywords' IS NOT NULL THEN
        has_keyword := FALSE;
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
      END IF;

      -- Check client industry
      IF matches AND conditions->>'client_industry' IS NOT NULL AND signal_record.client_id IS NOT NULL THEN
        DECLARE
          client_industry TEXT;
        BEGIN
          SELECT industry INTO client_industry FROM clients WHERE id = signal_record.client_id;
          IF LOWER(client_industry) != LOWER(conditions->>'client_industry') THEN
            matches := FALSE;
          END IF;
        END;
      END IF;

      -- If rule matches, apply actions
      IF matches THEN
        matched_rules := array_append(matched_rules, rule->>'rule_name');
        
        IF actions->>'set_category' IS NOT NULL THEN
          final_category := actions->>'set_category';
        END IF;
        
        IF actions->>'set_priority' IS NOT NULL THEN
          final_priority := actions->>'set_priority';
        END IF;
        
        IF actions->'add_tags' IS NOT NULL THEN
          FOR keyword IN SELECT jsonb_array_elements_text(actions->'add_tags')
          LOOP
            final_tags := array_append(final_tags, keyword);
          END LOOP;
        END IF;
        
        IF actions->>'route_to_team' IS NOT NULL THEN
          routed_team := actions->>'route_to_team';
        END IF;
      END IF;
    END LOOP;

    -- Update signal with rule results
    IF array_length(matched_rules, 1) > 0 THEN
      UPDATE signals
      SET 
        applied_rules = to_jsonb(matched_rules),
        rule_category = final_category,
        rule_priority = final_priority,
        rule_tags = final_tags,
        routed_to_team = routed_team,
        status = 'triaged'
      WHERE id = signal_record.id;
    END IF;
  END LOOP;
END $$;