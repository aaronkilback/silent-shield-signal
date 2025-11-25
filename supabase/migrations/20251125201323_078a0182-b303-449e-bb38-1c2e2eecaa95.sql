-- Verify and recreate trigger with explicit schema
DROP TRIGGER IF EXISTS apply_signal_rules_on_insert ON public.signals;

CREATE TRIGGER apply_signal_rules_on_insert
  BEFORE INSERT ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.process_signal_with_rules();

-- Fix client industry casing to match rules (rules expect lowercase "energy")
UPDATE public.clients 
SET industry = LOWER(industry) 
WHERE industry IS NOT NULL AND industry != LOWER(industry);

-- Create a test signal to verify trigger works
INSERT INTO public.signals (
  normalized_text,
  client_id,
  category,
  severity,
  confidence,
  status,
  is_test
) VALUES (
  'BREAKING: Major protest blockade at energy pipeline near Fort St. John causing operational disruption',
  (SELECT id FROM public.clients WHERE name = 'Petronas Canada' LIMIT 1),
  'test',
  'high',
  0.85,
  'new',
  true
) RETURNING id, rule_category, rule_priority, applied_rules;