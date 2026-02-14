-- Remove stale cron job calling non-existent monitor-canadian-sources-enhanced
SELECT cron.unschedule(9);