-- Create notification preferences table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_notifications BOOLEAN DEFAULT true,
  incident_alerts BOOLEAN DEFAULT true,
  entity_mentions BOOLEAN DEFAULT true,
  weekly_reports BOOLEAN DEFAULT false,
  alert_frequency TEXT DEFAULT 'immediate',
  email_address TEXT,
  slack_webhook TEXT,
  teams_webhook TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view and update their own preferences
CREATE POLICY "Users can view their own notification preferences"
  ON public.notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification preferences"
  ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification preferences"
  ON public.notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role can read all for sending notifications
CREATE POLICY "Service role can read notification preferences"
  ON public.notification_preferences
  FOR SELECT
  USING (true);

-- Create trigger to update updated_at
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to send incident notification
CREATE OR REPLACE FUNCTION public.notify_incident_created()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  pref RECORD;
  signal_data RECORD;
  client_data RECORD;
BEGIN
  -- Get signal details if exists
  IF NEW.signal_id IS NOT NULL THEN
    SELECT normalized_text INTO signal_data
    FROM signals
    WHERE id = NEW.signal_id;
  END IF;

  -- Get client details if exists
  IF NEW.client_id IS NOT NULL THEN
    SELECT name INTO client_data
    FROM clients
    WHERE id = NEW.client_id;
  END IF;

  -- Send notifications to users who have incident alerts enabled
  FOR pref IN
    SELECT email_address, alert_frequency
    FROM notification_preferences
    WHERE incident_alerts = true 
      AND email_notifications = true
      AND email_address IS NOT NULL
      AND (alert_frequency = 'immediate' OR NEW.priority IN ('p1', 'p2'))
  LOOP
    -- Call edge function to send email
    PERFORM net.http_post(
      url := CURRENT_SETTING('app.settings.supabase_url') || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || CURRENT_SETTING('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'to', pref.email_address,
        'type', 'incident',
        'data', jsonb_build_object(
          'priority', NEW.priority,
          'status', NEW.status,
          'opened_at', NEW.opened_at,
          'client_name', client_data.name,
          'signal_text', signal_data.normalized_text,
          'app_url', CURRENT_SETTING('app.settings.app_url')
        )
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- Create trigger for incident notifications
DROP TRIGGER IF EXISTS trigger_notify_incident_created ON public.incidents;
CREATE TRIGGER trigger_notify_incident_created
  AFTER INSERT ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_incident_created();

-- Function to send entity mention notification
CREATE OR REPLACE FUNCTION public.notify_entity_mentioned()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  pref RECORD;
  entity_data RECORD;
BEGIN
  -- Get entity details
  SELECT name, type INTO entity_data
  FROM entities
  WHERE id = NEW.entity_id;

  -- Send notifications to users who have entity alerts enabled
  FOR pref IN
    SELECT email_address
    FROM notification_preferences
    WHERE entity_mentions = true 
      AND email_notifications = true
      AND email_address IS NOT NULL
      AND alert_frequency = 'immediate'
  LOOP
    -- Call edge function to send email
    PERFORM net.http_post(
      url := CURRENT_SETTING('app.settings.supabase_url') || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || CURRENT_SETTING('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'to', pref.email_address,
        'type', 'entity_mention',
        'data', jsonb_build_object(
          'entity_name', entity_data.name,
          'entity_type', entity_data.type,
          'confidence', NEW.confidence,
          'detected_at', NEW.detected_at,
          'context', NEW.context,
          'app_url', CURRENT_SETTING('app.settings.app_url')
        )
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- Create trigger for entity mention notifications
DROP TRIGGER IF EXISTS trigger_notify_entity_mentioned ON public.entity_mentions;
CREATE TRIGGER trigger_notify_entity_mentioned
  AFTER INSERT ON public.entity_mentions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_entity_mentioned();
