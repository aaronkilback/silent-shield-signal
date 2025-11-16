import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

interface ClientSelectionContextType {
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
}

const ClientSelectionContext = createContext<ClientSelectionContextType | undefined>(undefined);

const STORAGE_KEY = 'selected_client_id';

export function ClientSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => {
    // Initialize from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    console.log('🟢 ClientSelectionProvider INIT - localStorage value:', stored);
    return stored || null;
  });

  // Persist to localStorage whenever it changes
  useEffect(() => {
    console.log('🟢 ClientSelectionProvider - selectedClientId changed to:', selectedClientId);
    if (selectedClientId) {
      localStorage.setItem(STORAGE_KEY, selectedClientId);
      console.log('🟢 Saved to localStorage:', selectedClientId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      console.log('🟢 Removed from localStorage');
    }
  }, [selectedClientId]);

  const wrappedSetSelectedClientId = (id: string | null) => {
    console.log('🟢 setSelectedClientId called with:', id);
    setSelectedClientId(id);
  };

  return (
    <ClientSelectionContext.Provider value={{ selectedClientId, setSelectedClientId: wrappedSetSelectedClientId }}>
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
