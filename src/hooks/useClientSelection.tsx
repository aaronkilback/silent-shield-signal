import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

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
    if (selectedClientId) {
      localStorage.setItem(STORAGE_KEY, selectedClientId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
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
