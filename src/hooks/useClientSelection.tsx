import { createContext, useContext, useState, ReactNode } from 'react';

interface ClientSelectionContextType {
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
}

const ClientSelectionContext = createContext<ClientSelectionContextType | undefined>(undefined);

export function ClientSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

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
