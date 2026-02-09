CREATE OR REPLACE FUNCTION public.cascade_delete_signal_feedback()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.feedback_events
  WHERE object_type = 'signal' AND object_id = OLD.id;
  RETURN OLD;
END;
$function$;