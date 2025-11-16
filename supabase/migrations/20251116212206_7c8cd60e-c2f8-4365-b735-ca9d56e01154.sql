-- Add unique constraint to prevent duplicate incidents per signal
CREATE UNIQUE INDEX IF NOT EXISTS incidents_signal_id_unique 
ON incidents(signal_id) 
WHERE signal_id IS NOT NULL;