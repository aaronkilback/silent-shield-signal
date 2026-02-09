import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

const POLL_INTERVAL_MS = 30_000; // 30s fallback poll
const VISIBILITY_REFETCH_KEYS = [
  ['signals'],
  ['signal-feed'],
  ['incidents'],
  ['incident-feed'],
  ['entity-notifications'],
];

export const useRealtimeNotifications = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const lastSeenSignalAt = useRef<string>(new Date().toISOString());
  const lastSeenIncidentAt = useRef<string>(new Date().toISOString());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Invalidate all signal/incident queries
  const invalidateAll = useCallback(() => {
    VISIBILITY_REFETCH_KEYS.forEach((key) => {
      queryClient.invalidateQueries({ queryKey: key });
    });
  }, [queryClient]);

  // Polling fallback: catches signals/incidents missed while subscription was dead
  const pollForMissed = useCallback(async () => {
    try {
      const { data: newSignals } = await supabase
        .from('signals')
        .select('id, title, normalized_text, is_test, created_at')
        .gt('created_at', lastSeenSignalAt.current)
        .eq('is_test', false)
        .order('created_at', { ascending: false })
        .limit(5);

      if (newSignals && newSignals.length > 0) {
        lastSeenSignalAt.current = newSignals[0].created_at;
        invalidateAll();
        // Only toast the most recent one to avoid spam
        toast({
          title: `📡 ${newSignals.length} New Signal${newSignals.length > 1 ? 's' : ''}`,
          description: newSignals[0].title || newSignals[0].normalized_text?.slice(0, 80) || 'New intelligence received',
          duration: 6000,
        });
      }

      const { data: newIncidents } = await supabase
        .from('incidents')
        .select('id, priority, opened_at')
        .gt('opened_at', lastSeenIncidentAt.current)
        .order('opened_at', { ascending: false })
        .limit(3);

      if (newIncidents && newIncidents.length > 0) {
        lastSeenIncidentAt.current = newIncidents[0].opened_at;
        invalidateAll();
        toast({
          title: `🚨 New ${newIncidents[0].priority?.toUpperCase()} Incident`,
          description: `${newIncidents.length} new incident${newIncidents.length > 1 ? 's' : ''} detected`,
          duration: 8000,
        });
      }
    } catch (err) {
      // Silent fail — poll will retry next interval
      console.warn('Poll fallback error:', err);
    }
  }, [toast, invalidateAll]);

  useEffect(() => {
    // ── Realtime subscriptions ──
    const incidentsChannel = supabase
      .channel('incidents-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'incidents' },
        (payload) => {
          const incident = payload.new as any;
          lastSeenIncidentAt.current = incident.opened_at || new Date().toISOString();

          toast({
            title: `🚨 New ${incident.priority?.toUpperCase()} Incident`,
            description: `Incident opened at ${new Date(incident.opened_at).toLocaleTimeString()}`,
            duration: 8000,
          });
          invalidateAll();
        }
      )
      .subscribe();

    const signalsChannel = supabase
      .channel('signals-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signals' },
        (payload) => {
          const signal = payload.new as any;
          if (!signal.is_test) {
            lastSeenSignalAt.current = signal.created_at || new Date().toISOString();

            toast({
              title: '📡 New Signal Received',
              description: signal.normalized_text?.slice(0, 100) || `Signal from ${signal.source_id || 'unknown source'}`,
              duration: 6000,
            });
            invalidateAll();
          }
        }
      )
      .subscribe();

    // ── Polling fallback (catches missed events on mobile/sleep) ──
    pollTimerRef.current = setInterval(pollForMissed, POLL_INTERVAL_MS);

    // ── Visibility change handler (refetch when phone wakes / tab refocuses) ──
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Immediate catch-up when user returns
        pollForMissed();
        invalidateAll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ── Online handler (refetch when network reconnects) ──
    const handleOnline = () => {
      pollForMissed();
      invalidateAll();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      supabase.removeChannel(incidentsChannel);
      supabase.removeChannel(signalsChannel);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [toast, queryClient, invalidateAll, pollForMissed]);
};
