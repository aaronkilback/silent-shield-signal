
-- Fix: Add CASCADE to investigation_communications FK so deleting entries works
ALTER TABLE public.investigation_communications
  DROP CONSTRAINT investigation_communications_investigation_entry_id_fkey,
  ADD CONSTRAINT investigation_communications_investigation_entry_id_fkey
    FOREIGN KEY (investigation_entry_id)
    REFERENCES investigation_entries(id)
    ON DELETE CASCADE;
