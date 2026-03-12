-- Auto-assign default client_id to entities inserted without one
-- Prevents the recurring "fix_orphaned_entities" watchdog finding
-- Trigger fires BEFORE INSERT so the row lands with a valid client_id

CREATE OR REPLACE FUNCTION public.auto_assign_entity_client_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_client_id UUID;
BEGIN
  -- Only act when client_id is not provided
  IF NEW.client_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Pick the first active client
  SELECT id INTO v_client_id
  FROM public.clients
  WHERE status = 'active'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_client_id IS NOT NULL THEN
    NEW.client_id := v_client_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_entity_client_id ON public.entities;

CREATE TRIGGER trg_auto_assign_entity_client_id
BEFORE INSERT ON public.entities
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_entity_client_id();
