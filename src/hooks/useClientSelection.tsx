import { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ClientSelectionContextType {
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
}

const ClientSelectionContext = createContext<ClientSelectionContextType | undefined>(undefined);

const STORAGE_KEY = 'selected_client_id';

export function ClientSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || null;
  });
  const hasSetInitialContext = useRef(false);
  const previousClientId = useRef<string | null>(selectedClientId);

  useEffect(() => {
    const updateClientContext = async () => {
      // Only proceed if client has actually changed
      if (previousClientId.current === selectedClientId && hasSetInitialContext.current) {
        return;
      }

      const isInitialMount = !hasSetInitialContext.current;
      hasSetInitialContext.current = true;
      previousClientId.current = selectedClientId;

      if (selectedClientId) {
        localStorage.setItem(STORAGE_KEY, selectedClientId);
        const { error } = await supabase.rpc('set_current_client', { client_id_param: selectedClientId });
        if (error) {
          console.error('Failed to set client context:', error);
        }
      } else {
        localStorage.removeItem(STORAGE_KEY);
        const { error } = await supabase.rpc('set_current_client', { client_id_param: '' });
        if (error) {
          console.error('Failed to clear client context:', error);
        }
      }
      
      // Only reload on actual client changes, not initial mount
      if (!isInitialMount) {
        window.location.reload();
      }
    };
    
    updateClientContext();
  }, [selectedClientId]);

  return (
    <ClientSelectionContext.Provider value={{ selectedClientId, setSelectedClientId }}>
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
