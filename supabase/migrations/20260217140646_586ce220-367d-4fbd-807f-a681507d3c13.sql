ALTER TABLE public.investigation_persons DROP CONSTRAINT investigation_persons_status_check;

ALTER TABLE public.investigation_persons ADD CONSTRAINT investigation_persons_status_check 
  CHECK (status = ANY (ARRAY['complainant', 'witness', 'suspect', 'supervisor', 'other']));