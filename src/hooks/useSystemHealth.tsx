import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SystemHealthStatus {
  overallStatus: 'healthy' | 'degraded' | 'critical';
  recentErrors: number;
  unresolvedErrors: number;
  openCircuits: string[];
  pendingRetries: number;
  exhaustedRetries: number;
}

/**
 * Fetches a unified system health pulse from error logs,
 * circuit breaker state, and dead letter queue.
 */
export const useSystemHealth = (enabled: boolean = true) => {
  return useQuery({
    queryKey: ['system-health'],
    queryFn: async (): Promise<SystemHealthStatus> => {
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

      // Parallel queries for speed
      const [errorsRes, circuitRes, dlqRes] = await Promise.all([
        supabase
          .from('edge_function_errors')
          .select('id, severity, resolved_at', { count: 'exact' })
          .gte('created_at', oneHourAgo),
        supabase
          .from('circuit_breaker_state')
          .select('service_name, state')
          .in('state', ['open', 'half_open']),
        supabase
          .from('dead_letter_queue')
          .select('id, status', { count: 'exact' })
          .in('status', ['pending', 'retrying', 'exhausted']),
      ]);

      const recentErrors = errorsRes.count || 0;
      const unresolvedErrors = (errorsRes.data || []).filter(e => !e.resolved_at).length;
      const criticalErrors = (errorsRes.data || []).filter(e => e.severity === 'critical' && !e.resolved_at).length;
      const openCircuits = (circuitRes.data || []).map(c => c.service_name);
      const pendingRetries = (dlqRes.data || []).filter(d => d.status === 'pending' || d.status === 'retrying').length;
      const exhaustedRetries = (dlqRes.data || []).filter(d => d.status === 'exhausted').length;

      let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
      if (criticalErrors > 0 || openCircuits.length > 0 || exhaustedRetries > 2) {
        overallStatus = 'critical';
      } else if (unresolvedErrors > 5 || pendingRetries > 10) {
        overallStatus = 'degraded';
      }

      return {
        overallStatus,
        recentErrors,
        unresolvedErrors,
        openCircuits,
        pendingRetries,
        exhaustedRetries,
      };
    },
    refetchInterval: 60_000, // Refresh every minute
    enabled,
  });
};
