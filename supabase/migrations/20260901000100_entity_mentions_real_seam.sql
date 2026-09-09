-- WO-ENTITY-MENTION-CONTAMINATION — Step 2 (the seam): single filtered read path + neutralize the
-- dormant notifier. Depends on step 1 (20260901000000) having stamped entity_mentions.is_test.

-- ---------------------------------------------------------------------------
-- 1. The seam. The ONE granted count/read path for real (non-test) mentions. Every consumer reads
--    THIS, never the base table, so test-provenance can never inflate a score, corroboration, or
--    notification. security_invoker=on => the view respects entity_mentions' own RLS (no definer
--    bypass; same access the base table already grants each caller).
-- ---------------------------------------------------------------------------
create or replace view public.entity_mentions_real
  with (security_invoker = on)
as select * from public.entity_mentions where is_test = false;

comment on view public.entity_mentions_real is
  'WO-ENTITY-MENTION-CONTAMINATION seam: non-test entity mentions only (is_test = false). The single granted count/read path; consumers must read this, not entity_mentions, so a test mention can never inflate quality_score / corroboration / narratives / threat scoring.';

-- ---------------------------------------------------------------------------
-- 2. Neutralize notify_entity_mentioned FIRST (operator ruling): it emails real users on a mention
--    and is wired to nothing today — a latent landmine. Add a guard that refuses on a test mention,
--    so whoever eventually wires it cannot page users off a fixture. Body otherwise preserved verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.notify_entity_mentioned()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  pref record;
  entity_data record;
begin
  -- WO-ENTITY-MENTION-CONTAMINATION: never notify on a test-provenance mention.
  -- is_test is stamped by trg_entity_mentions_stamp_is_test (BEFORE INSERT), so it is populated
  -- on NEW by the time any AFTER-INSERT notifier fires.
  if coalesce(new.is_test, false) then
    return new;
  end if;

  -- Get entity details
  select name, type into entity_data
  from entities
  where id = new.entity_id;

  -- Send notifications to users who have entity alerts enabled
  for pref in
    select email_address
    from notification_preferences
    where entity_mentions = true
      and email_notifications = true
      and email_address is not null
      and alert_frequency = 'immediate'
  loop
    perform net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'to', pref.email_address,
        'type', 'entity_mention',
        'data', jsonb_build_object(
          'entity_name', entity_data.name,
          'entity_type', entity_data.type,
          'confidence', new.confidence,
          'detected_at', new.detected_at,
          'context', new.context,
          'app_url', current_setting('app.settings.app_url')
        )
      )
    );
  end loop;

  return new;
end;
$function$;
