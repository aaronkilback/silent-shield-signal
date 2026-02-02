import { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

interface ClientSelectionContextType {
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
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
  const queryClient = useQueryClient();

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
      return;
    }

    const updateClientContext = async () => {
      // Only proceed if client has actually changed
      if (previousClientId.current === selectedClientId && hasSetInitialContext.current) {
        return;
      }

      const isInitialMount = !hasSetInitialContext.current;
      hasSetInitialContext.current = true;
      previousClientId.current = selectedClientId;

      setIsContextReady(false);

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

      setIsContextReady(true);
      
      // Invalidate all queries when client changes (not on initial mount)
      if (!isInitialMount) {
        console.log('[ClientContext] Client changed, invalidating queries');
        await queryClient.invalidateQueries();
      }
    };
    
    updateClientContext();
  }, [selectedClientId, queryClient, isAuthenticated]);

  return (
    <ClientSelectionContext.Provider value={{ selectedClientId, setSelectedClientId, isContextReady }}>
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
