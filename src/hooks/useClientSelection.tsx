import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
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
  const [isInitialMount, setIsInitialMount] = useState(true);

  useEffect(() => {
    const updateClientContext = async () => {
      if (selectedClientId) {
        localStorage.setItem(STORAGE_KEY, selectedClientId);
        // Set the database session variable for RLS policies
        const { error } = await supabase.rpc('set_current_client', { client_id_param: selectedClientId });
        if (error) {
          console.error('Failed to set client context:', error);
        }
      } else {
        localStorage.removeItem(STORAGE_KEY);
        // Clear the session variable
        await supabase.rpc('set_current_client', { client_id_param: '' });
      }
      
      // Only reload on actual client changes, not initial mount
      if (!isInitialMount) {
        window.location.reload();
      } else {
        setIsInitialMount(false);
      }
    };
    
    updateClientContext();
  }, [selectedClientId, isInitialMount]);

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
