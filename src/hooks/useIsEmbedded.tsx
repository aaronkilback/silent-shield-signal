import { createContext, useContext } from "react";

const EmbeddedContext = createContext(false);

export const EmbeddedProvider = ({ children }: { children: React.ReactNode }) => (
  <EmbeddedContext.Provider value={true}>{children}</EmbeddedContext.Provider>
);

export const useIsEmbedded = () => useContext(EmbeddedContext);
