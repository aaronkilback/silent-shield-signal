-- Remove stale cron job calling non-existent monitor-canadian-sources-enhanced
DO $$
BEGIN
  PERFORM cron.unschedule(9);
EXCEPTION WHEN OTHERS THEN
  -- Job may not exist on fresh deployments, ignore error
  NULL;
END $$;
