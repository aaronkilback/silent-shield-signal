import { useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Subscribes to edge_function_errors via realtime and surfaces
 * critical/error-level failures as in-app toasts.
 * Only active for admin/super_admin users.
 */
export const useErrorNotifications = (userRole?: string) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  const showErrorToast = useCallback((error: any) => {
    const severity = error.severity || 'error';
    const functionName = error.function_name || 'Unknown';
    const message = error.error_message || 'An operation failed';

    // Only show critical and error severity to avoid noise
    if (severity === 'warning') return;

    const icon = severity === 'critical' ? '🔴' : '⚠️';
    const truncatedMsg = message.length > 120 ? message.substring(0, 117) + '...' : message;

    toast({
      title: `${icon} Backend Failure: ${functionName}`,
      description: truncatedMsg,
      variant: 'destructive',
      duration: severity === 'critical' ? 15000 : 8000,
    });

    // Invalidate system health queries
    queryClient.invalidateQueries({ queryKey: ['system-health'] });
    queryClient.invalidateQueries({ queryKey: ['edge-function-errors'] });
  }, [toast, queryClient]);

  useEffect(() => {
    if (!isAdmin) return;

    const channel = supabase
      .channel('edge-function-errors')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'edge_function_errors',
        },
        (payload) => {
          showErrorToast(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, showErrorToast]);
};
