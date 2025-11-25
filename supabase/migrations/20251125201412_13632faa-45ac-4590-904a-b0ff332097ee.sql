-- Remove duplicate trigger (keep the newer one: apply_signal_rules_on_insert)
DROP TRIGGER IF EXISTS trigger_process_signal_rules ON public.signals;

-- Verify only one rule trigger remains
-- Note: The existing 68 Cleanfarms signals don't match any rule keywords
-- (no "protest", "blockade", "travel advisory", etc.)
-- They will remain uncategorized until matching rules are created or new signals arrive