import { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useTenant } from './useTenant';

interface ClientSelectionContextType {
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
  /**
   * PROD-CC fix A (2026-05-24): user-intent-gated setter. Picker-driven
   * selection MUST go through this so self-healing validation effects
   * know the selection carries explicit user intent and is allowed to
   * be corrected. System-initiated mutations (tenant switch, initial
   * hydration from localStorage) keep using setSelectedClientId and are
   * NOT auto-cleared by the validation effects.
   */
  selectByUser: (id: string | null) => void;
  isContextReady: boolean;
}

const ClientSelectionContext = createContext<ClientSelectionContextType | undefined>(undefined);

const STORAGE_KEY = 'selected_client_id';

export function ClientSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || null;
  });
  const [isContextReady, setIsContextReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const hasSetInitialContext = useRef(false);
  const previousClientId = useRef<string | null>(selectedClientId);
  // PROD-CC fix A: ref defaults false. Selection hydrated from
  // localStorage at mount is NOT user intent for this session — only
  // an explicit picker action sets this true. Self-healing effects
  // below gate destructive clears on this ref.
  const userIntentRef = useRef(false);
  const queryClient = useQueryClient();
  const { currentTenant, isAllTenantsView } = useTenant();

  const selectByUser = (id: string | null) => {
    userIntentRef.current = true;
    setSelectedClientId(id);
  };

  // Track authentication state
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session?.user);
    };
    
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session?.user);
      // Reset context tracking on auth change
      if (!session?.user) {
        hasSetInitialContext.current = false;
        setIsContextReady(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Don't try to set client context if not authenticated
    if (!isAuthenticated) {
      setIsContextReady(false);
      return;
    }

    const updateClientContext = async () => {
      // Only proceed if client has actually changed
      if (previousClientId.current === selectedClientId && hasSetInitialContext.current) {
        // Already set, but make sure isContextReady is true
        setIsContextReady(true);
        return;
      }

      const isInitialMount = !hasSetInitialContext.current;
      hasSetInitialContext.current = true;
      previousClientId.current = selectedClientId;

      setIsContextReady(false);

      try {
        if (selectedClientId) {
          localStorage.setItem(STORAGE_KEY, selectedClientId);
          console.log('[ClientContext] Setting client context:', selectedClientId);
          const { error } = await supabase.rpc('set_current_client', { client_id_param: selectedClientId });
          if (error) {
            console.error('[ClientContext] Failed to set client context:', error);
          } else {
            console.log('[ClientContext] Client context set successfully');
          }
        } else {
          localStorage.removeItem(STORAGE_KEY);
          console.log('[ClientContext] Clearing client context');
          const { error } = await supabase.rpc('set_current_client', { client_id_param: '' });
          if (error) {
            console.error('[ClientContext] Failed to clear client context:', error);
          }
        }
      } finally {
        // Always set context ready, even if RPC failed
        setIsContextReady(true);
      }
      
      // Invalidate all queries when client changes (not on initial mount)
      if (!isInitialMount) {
        console.log('[ClientContext] Client changed, invalidating queries');
        await queryClient.invalidateQueries();
      }
    };
    
    updateClientContext();
  }, [selectedClientId, queryClient, isAuthenticated]);

  // Cross-tenant trust check. Triggered whenever currentTenant or
  // selectedClientId changes: verifies the persisted client_id
  // actually belongs to the active tenant. A stale value from a
  // prior observation session (e.g. localStorage carries Petronas
  // after a super_admin switched to CRT) is discarded here so it
  // cannot be trusted by downstream queries. Skipped when
  // isAllTenantsView is on — super_admin's global platform mode
  // legitimately spans tenants.
  useEffect(() => {
    if (!selectedClientId || !currentTenant?.id || isAllTenantsView) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('clients')
        .select('id')
        .eq('id', selectedClientId)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        // PROD-CC fix A: only auto-clear when the selection was set
        // by an explicit picker action. System-set selections (initial
        // localStorage hydration, tenant-switch helper) log a warning
        // and leave state alone — bouncing was caused by validation
        // effects mutating state during routine refetches.
        if (!userIntentRef.current) {
          console.warn('[ClientContext] Cross-tenant client detected (system-set, skipping clear)', {
            selectedClientId,
            expectedTenant: currentTenant.id,
          });
          return;
        }
        console.warn('[ClientContext] Discarding cross-tenant client', {
          selectedClientId,
          expectedTenant: currentTenant.id,
        });
        setSelectedClientId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClientId, currentTenant?.id, isAllTenantsView]);

  // PROD-J fix C (2026-05-22): all-tenants self-healing validation.
  // The cross-tenant effect above intentionally skips when
  // isAllTenantsView=true, since super_admin's global mode legitimately
  // spans tenants — so a stale localStorage selectedClientId can
  // persist there indefinitely. That gap caused the blank /signals
  // feed: localStorage carried _invariant_client_a (or any
  // deleted/inactive/fixture client) into all-tenants mode, where
  // SignalHistory's fail-closed filter cascade returned 0 rows.
  //
  // This effect runs ONLY in all-tenants mode and validates that the
  // currently selected client (a) still exists, (b) has status='active',
  // and (c) is not a fixture (underscore-prefixed). On any failure it
  // clears the selection, which routes through the main effect above
  // and triggers a query invalidation so SignalHistory re-fetches
  // unfiltered. The status='active' + not-fixture constraint mirrors
  // ClientSelector.fetchClients(), so an "unselectable" client can't
  // remain "selected".
  useEffect(() => {
    if (!selectedClientId || !isAllTenantsView) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name, status')
        .eq('id', selectedClientId)
        .maybeSingle();
      if (cancelled) return;
      const isValid =
        !!data &&
        data.status === 'active' &&
        typeof data.name === 'string' &&
        !data.name.startsWith('_');
      if (!isValid) {
        const reason = !data
          ? 'not_found'
          : data.status !== 'active'
            ? `status=${data.status}`
            : 'fixture_prefix';
        // PROD-CC fix A: same user-intent gate as cross-tenant
        // validation above. PROD-J fix C's slow-burn stale-selection
        // case (localStorage carries a now-invalid client into
        // all-tenants mode) is intentionally degraded to log-only
        // for system-set selections. Operator opens the dropdown
        // and re-picks if a query returns empty. Acute bouncing
        // (chat disappearing) takes priority over the slow-burn UX.
        if (!userIntentRef.current) {
          console.warn('[ClientContext] Invalid client in all-tenants mode (system-set, skipping clear)', {
            selectedClientId,
            reason,
          });
          return;
        }
        console.warn('[ClientContext] Discarding invalid client in all-tenants mode', {
          selectedClientId,
          reason,
        });
        setSelectedClientId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClientId, isAllTenantsView]);

  return (
    <ClientSelectionContext.Provider value={{ selectedClientId, setSelectedClientId, selectByUser, isContextReady }}>
      {children}
    </ClientSelectionContext.Provider>
  );
}

export function useClientSelection() {
  const context = useContext(ClientSelectionContext);
  if (context === undefined) {
    throw new Error('useClientSelection must be used within a ClientSelectionProvider');
  }
  return context;
}
