import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { differenceInDays } from 'date-fns';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { useTenant } from '@/hooks/useTenant';
import { isQuarantineHiddenForRole, type SignalAccessRole } from '@/lib/signal-query-filters';

/** Returns true if a signal's event_date is older than 90 days (historical). */
const isHistoricalSignal = (signal: { event_date?: string | null; created_at?: string }): boolean => {
  const refDate = signal.event_date || signal.created_at;
  if (!refDate) return false;
  return differenceInDays(new Date(), new Date(refDate)) > 90;
};

const POLL_INTERVAL_MS = 30_000; // 30s fallback poll
const VISIBILITY_REFETCH_KEYS = [
  ['signals'],
  ['signal-feed'],
  ['incidents'],
  ['incident-feed'],
  ['entity-notifications'],
];

export const resolveRealtimeSignalAccessRole = (isSuperAdmin: boolean): SignalAccessRole =>
  isSuperAdmin ? 'operator' : 'analyst';

// INC-CRT-VISIBILITY (2026-05-26) — notification tenant-scoping.
//
// PROVEN behavior (docs/platform-operations/incidents/INC-CRT-VISIBILITY-notification-containment.md):
//   • Non-super-admin roles are ALREADY correctly tenant-scoped on BOTH paths:
//       - realtime: Supabase `realtime.apply_rls` gates postgres_changes delivery by the
//         subscriber's RLS SELECT (signals/incidents have relrowsecurity=true);
//       - poll: the user's supabase client enforces RLS.
//     → we MUST NOT add a client-side tenant filter for them (it would wrongly drop their
//       legitimate client-owned rows that currently have a NULL tenant_id).
//   • super_admin bypasses RLS, so it receives EVERY tenant's signal/incident — and frontend
//     impersonation does NOT change the realtime JWT. This is the only leak path.
//
// Therefore `scopeTenantId` is set ONLY for a super_admin who has impersonated a single tenant.
// It is null for (a) non-super-admins (rely on RLS) and (b) super_admin all-tenants view (see all).
// When set, we scope both paths to that tenant PLUS genuine system/broadcast rows.

export const useRealtimeNotifications = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useIsSuperAdmin();
  const { currentTenant, isAllTenantsView } = useTenant();

  // Effective client-side scope. Only a super_admin impersonating a single tenant needs it.
  const scopeTenantId: string | null =
    isSuperAdmin && !isAllTenantsView ? currentTenant?.id ?? null : null;

  // Branch 1A R1 (2026-05-23) — current role captured for realtime
  // quarantine-suppression. Ref-mirrored so the channel handler always reads
  // the latest role without channel teardown when role changes mid-session
  // (e.g., after impersonation toggle).
  const roleRef = useRef<SignalAccessRole>(resolveRealtimeSignalAccessRole(isSuperAdmin));
  useEffect(() => {
    roleRef.current = resolveRealtimeSignalAccessRole(isSuperAdmin);
  }, [isSuperAdmin]);
  const lastSeenSignalAt = useRef<string>(new Date().toISOString());
  const lastSeenIncidentAt = useRef<string>(new Date().toISOString());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Tenant-scope predicates (only consulted when scopeTenantId is set) ──
  // signals carry asset_class (INC-XTEN Phase 2A): only system/global_shared null-tenant rows
  // are genuine broadcast; a NULL-tenant client-owned row is NOT treated as broadcast.
  const signalInScope = useCallback((row: any): boolean => {
    if (!scopeTenantId) return true;
    if (row?.tenant_id === scopeTenantId) return true;
    if (row?.tenant_id == null && (row?.asset_class === 'system' || row?.asset_class === 'global_shared')) return true;
    return false;
  }, [scopeTenantId]);

  // incidents have no asset_class; payload is low-sensitivity (priority + time only). Treat a
  // NULL tenant_id as a broadcast/system incident (e.g. NAAD-derived emergency).
  const incidentInScope = useCallback((row: any): boolean => {
    if (!scopeTenantId) return true;
    if (row?.tenant_id === scopeTenantId) return true;
    if (row?.tenant_id == null) return true;
    return false;
  }, [scopeTenantId]);

  // Invalidate all signal/incident queries
  const invalidateAll = useCallback(() => {
    VISIBILITY_REFETCH_KEYS.forEach((key) => {
      queryClient.invalidateQueries({ queryKey: key });
    });
  }, [queryClient]);

  // Polling fallback: catches signals/incidents missed while subscription was dead.
  // Non-super-admin: RLS scopes the query. super_admin-impersonating: add an explicit
  // tenant filter (RLS bypass would otherwise return every tenant's rows).
  const pollForMissed = useCallback(async () => {
    try {
      let signalsQuery = supabase
        .from('signals')
        .select('id, title, normalized_text, is_test, created_at, event_date')
        .gt('created_at', lastSeenSignalAt.current)
        .eq('is_test', false)
        .order('created_at', { ascending: false })
        .limit(5);
      if (scopeTenantId) {
        signalsQuery = signalsQuery.or(
          `tenant_id.eq.${scopeTenantId},and(tenant_id.is.null,asset_class.in.(system,global_shared))`
        );
      }
      const { data: newSignals } = await signalsQuery;

      if (newSignals && newSignals.length > 0) {
        lastSeenSignalAt.current = newSignals[0].created_at;
        // Filter out historical signals before notifying
        const recentSignals = newSignals.filter(s => !isHistoricalSignal(s));
        if (recentSignals.length > 0) {
          invalidateAll();
          toast({
            title: `📡 ${recentSignals.length} New Signal${recentSignals.length > 1 ? 's' : ''}`,
            description: recentSignals[0].title || recentSignals[0].normalized_text?.slice(0, 80) || 'New intelligence received',
            duration: 6000,
          });
        }
      }

      let incidentsQuery = supabase
        .from('incidents')
        .select('id, priority, opened_at')
        .gt('opened_at', lastSeenIncidentAt.current)
        .order('opened_at', { ascending: false })
        .limit(3);
      if (scopeTenantId) {
        incidentsQuery = incidentsQuery.or(`tenant_id.eq.${scopeTenantId},tenant_id.is.null`);
      }
      const { data: newIncidents } = await incidentsQuery;

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
  }, [toast, invalidateAll, scopeTenantId]);

  useEffect(() => {
    // ── Realtime subscriptions ──
    // No server-side filter (postgres_changes can't express "tenant=X OR (null AND system)").
    // Delivery is already RLS-gated by realtime.apply_rls; the in-handler scope check below
    // only narrows the super_admin-impersonating case. The effect re-subscribes when
    // scopeTenantId changes (tenant switch) — React runs the cleanup first, so stale channels
    // are torn down before new ones are created (no duplicate subscriptions/toasts).
    const incidentsChannel = supabase
      .channel('incidents-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'incidents' },
        (payload) => {
          const incident = payload.new as any;
          if (!incidentInScope(incident)) return; // tenant scope (super_admin impersonation)
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
          // Branch 1A R1 (2026-05-23) — quarantine visibility boundary on
          // realtime emit. Supabase realtime does NOT apply our app-level
          // quarantine query filter (it is not an RLS policy); quarantined
          // rows arrive here regardless. This suppression MUST be the FIRST
          // decision in the handler — before ref updates, before toast, before
          // invalidateAll(), before any logging. See doctrine note in
          // src/lib/signal-query-filters.ts.
          if (isQuarantineHiddenForRole(signal, roleRef.current)) {
            return;
          }
          // INC-CRT-VISIBILITY — tenant scope (only narrows super_admin impersonation;
          // non-super-admins are already RLS-scoped by realtime.apply_rls).
          if (!signalInScope(signal)) {
            return;
          }
          if (!signal.is_test) {
            lastSeenSignalAt.current = signal.created_at || new Date().toISOString();

            // Skip toast for historical signals
            if (!isHistoricalSignal(signal)) {
              toast({
                title: '📡 New Signal Received',
                description: signal.normalized_text?.slice(0, 100) || `Signal from ${signal.source_id || 'unknown source'}`,
                duration: 6000,
              });
            }
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
    // scopeTenantId in deps → re-subscribe (teardown + recreate) on tenant switch.
  }, [toast, queryClient, invalidateAll, pollForMissed, scopeTenantId, signalInScope, incidentInScope]);
};
