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

  useEffect(() => {
    const updateClientContext = async () => {
      if (selectedClientId) {
        localStorage.setItem(STORAGE_KEY, selectedClientId);
        // Set the database session variable for RLS policies
        await supabase.rpc('set_current_client', { client_id_param: selectedClientId });
      } else {
        localStorage.removeItem(STORAGE_KEY);
        // Clear the session variable
        await supabase.rpc('set_current_client', { client_id_param: '' });
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
