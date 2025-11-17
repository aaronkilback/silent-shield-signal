import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export const useRealtimeNotifications = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Listen for new incidents
    const incidentsChannel = supabase
      .channel('incidents-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'incidents'
        },
        (payload) => {
          console.log('New incident detected:', payload);
          const incident = payload.new as any;
          
          toast({
            title: `🚨 New ${incident.priority.toUpperCase()} Incident`,
            description: `Incident opened at ${new Date(incident.opened_at).toLocaleTimeString()}`,
            duration: 8000,
          });

          // Invalidate queries to refresh data
          queryClient.invalidateQueries({ queryKey: ['incidents'] });
          queryClient.invalidateQueries({ queryKey: ['incident-feed'] });
        }
      )
      .subscribe();

    // Listen for new signals
    const signalsChannel = supabase
      .channel('signals-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signals'
        },
        (payload) => {
          console.log('New signal detected:', payload);
          const signal = payload.new as any;
          
          // Only notify for non-test signals
          if (!signal.is_test) {
            toast({
              title: '📡 New Signal Received',
              description: signal.normalized_text?.slice(0, 100) || `Signal from ${signal.source_id || 'unknown source'}`,
              duration: 6000,
            });

            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['signals'] });
            queryClient.invalidateQueries({ queryKey: ['signal-feed'] });
          }
        }
      )
      .subscribe();

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(incidentsChannel);
      supabase.removeChannel(signalsChannel);
    };
  }, [toast, queryClient]);
};
