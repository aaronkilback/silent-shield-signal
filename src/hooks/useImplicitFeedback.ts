import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Track implicit analyst behavior as feedback signals.
 * Records: view duration, escalation, report inclusion, investigation, sharing, quick dismissal.
 */
export const useImplicitFeedback = () => {
  const { session } = useAuth();
  const viewTimers = useRef<Map<string, number>>(new Map());

  const trackEvent = useCallback(async (
    signalId: string,
    eventType: 'view_duration' | 'escalated' | 'included_in_report' | 'investigated' | 'dismissed_quickly' | 'shared',
    eventValue?: number
  ) => {
    if (!session?.user?.id) return;
    try {
      await supabase.from('implicit_feedback_events').insert({
        signal_id: signalId,
        user_id: session.user.id,
        event_type: eventType,
        event_value: eventValue ?? 1.0,
      });
    } catch (err) {
      console.error('[ImplicitFeedback] Error:', err);
    }
  }, [session?.user?.id]);

  const startViewing = useCallback((signalId: string) => {
    viewTimers.current.set(signalId, Date.now());
  }, []);

  const stopViewing = useCallback((signalId: string) => {
    const start = viewTimers.current.get(signalId);
    if (start) {
      const duration = (Date.now() - start) / 1000;
      viewTimers.current.delete(signalId);
      if (duration > 5) { // Only track if viewed > 5 seconds
        trackEvent(signalId, 'view_duration', duration);
      }
      if (duration < 2) {
        trackEvent(signalId, 'dismissed_quickly', duration);
      }
    }
  }, [trackEvent]);

  return { trackEvent, startViewing, stopViewing };
};
