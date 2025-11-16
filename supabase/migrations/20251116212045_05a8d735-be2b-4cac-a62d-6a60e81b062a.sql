-- Remove duplicate incidents, keeping only the oldest one for each signal_id
DELETE FROM incidents
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY signal_id ORDER BY created_at ASC) as rn
    FROM incidents
    WHERE signal_id IS NOT NULL
  ) t
  WHERE t.rn > 1
);